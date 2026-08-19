import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env';
import { AppError, ErrorCode } from '../common/app-error';
import { AuthService, esDesafio, type Contexto, type Sesion } from './auth.service';
import { ActorActual, Publico, type Actor } from './decoradores';
import { LimiteEstricto, POR_CUENTA, POR_IP, SinLimite } from './limite-intentos';
import {
  AceptarInvitacionDto,
  LoginDto,
  RegistrarDto,
  SegundoFactorDto,
} from './auth.dto';

const COOKIE_REFRESH = 'bemo_inmo_rt';

/**
 * Los contadores ESTRICTOS —los de dos dígitos— se aplican a este controlador y
 * a los portales, que son las únicas rutas donde un desconocido puede probar
 * credenciales o adivinar un token.
 *
 * Ya no hace falta `@UseGuards`: el guard es global desde la etapa 17.4, y
 * dejarlo puesto contaría cada intento dos veces —el tope real se partiría al
 * medio sin que nada lo dijera—. Lo que queda es la MARCA de que acá van los
 * topes estrictos.
 */
@LimiteEstricto()
@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Throttle({ [POR_IP]: { limit: () => loadEnv().RATE_LIMIT_REGISTRO_IP } })
  @Post('registrar')
  async registrar(
    @Body() dto: RegistrarDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.auth.registrar(dto, ctx(req)), res);
  }

  @Publico()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(dto.email, dto.password, ctx(req));
    // Con segundo factor todavía NO hay sesión: no se pone la cookie de refresh
    // ni se devuelve token. Sale el pase y nada más.
    return esDesafio(r) ? r : this.responder(r, res);
  }

  /**
   * El código, después de la contraseña.
   *
   * Lleva los mismos contadores estrictos que el login —el controlador entero
   * está marcado— porque seis dígitos son un millón de combinaciones: sin tope
   * de intentos, el segundo factor se prueba a fuerza bruta en una tarde.
   */
  @Publico()
  @Post('2fa')
  async segundoFactor(
    @Body() dto: SegundoFactorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(
      await this.auth.completarSegundoFactor(dto.desafio, dto.codigo, ctx(req)),
      res,
    );
  }

  // El refresh no lleva email: no hay cuenta que contar, sólo IP. Y va holgado
  // porque lo dispara el front solo, no una persona tecleando.
  @Publico()
  @SkipThrottle({ [POR_CUENTA]: true })
  @Throttle({ [POR_IP]: { limit: () => loadEnv().RATE_LIMIT_REFRESH_IP } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_REFRESH];
    if (!token) {
      throw new AppError(
        401,
        ErrorCode.SESION_INVALIDA,
        'No hay sesión activa.',
        'Unauthorized',
      );
    }
    try {
      return this.responder(await this.auth.refrescar(token, ctx(req)), res);
    } catch (err) {
      // Si el refresh falla, la cookie no sirve más. Dejarla puesta hace que el
      // front reintente en loop contra un token muerto.
      this.limpiarCookie(res);
      throw err;
    }
  }

  // Acá el identificador es el token de invitación, no un email: contar "por
  // cuenta" no significaría nada. Queda el contador por IP, que es el que frena
  // a alguien probando tokens al voleo.
  @Publico()
  @SkipThrottle({ [POR_CUENTA]: true })
  @Post('invitacion/aceptar')
  async aceptarInvitacion(
    @Body() dto: AceptarInvitacionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(
      await this.auth.aceptarInvitacion(dto.token, dto.password, dto.nombre, ctx(req)),
      res,
    );
  }

  // Cerrar sesión no adivina nada. Limitarlo sólo lograría dejar a alguien con
  // la sesión abierta sin poder cerrarla.
  @Publico()
  @SinLimite()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.cerrarSesion(req.cookies?.[COOKIE_REFRESH], ctx(req));
    this.limpiarCookie(res);
    return { ok: true };
  }

  /**
   * Quién soy. Es lo primero que pide el front al cargar, después de renovar
   * con la cookie. Devuelve la sesión completa —nombres incluidos— para que el
   * front no tenga que pedir un refresh extra sólo para llenar el encabezado.
   */
  // Sin esto, /yo queda limitado a 10 por ventana por IP — y el front lo llama en
  // cada carga de página. Una oficina detrás de una IP se quedaría sin sesión.
  @SinLimite()
  @Get('yo')
  async yo(@ActorActual() actor: Actor) {
    const { usuario, tenant } = await this.auth.quienSoy(actor.usuarioId, actor.tenantId);
    return { usuario, tenant, rol: actor.rol };
  }

  /**
   * El refresh token va en cookie httpOnly y NO en el cuerpo: si el front pudiera
   * leerlo, un XSS se lleva la sesión entera. El access token sí va en el cuerpo,
   * en memoria, y muere en 15 minutos.
   */
  private responder(sesion: Sesion, res: Response) {
    res.cookie(COOKIE_REFRESH, sesion.refreshToken, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: this.env.REFRESH_TTL_DIAS * 24 * 60 * 60 * 1000,
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });

    return {
      accessToken: sesion.accessToken,
      usuario: sesion.usuario,
      tenant: sesion.tenant,
      rol: sesion.rol,
    };
  }

  private limpiarCookie(res: Response) {
    res.clearCookie(COOKIE_REFRESH, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/v1/auth',
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });
  }
}

function ctx(req: Request): Contexto {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}
