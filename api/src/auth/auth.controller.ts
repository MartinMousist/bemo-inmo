import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env';
import { AppError, ErrorCode } from '../common/app-error';
import { AuthService, type Contexto, type Sesion } from './auth.service';
import { ActorActual, Publico, type Actor } from './decoradores';
import {
  AceptarInvitacionDto,
  LoginDto,
  RegistrarDto,
} from './auth.dto';

const COOKIE_REFRESH = 'bemo_inmo_rt';

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: AuthService) {}

  @Publico()
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
    return this.responder(await this.auth.login(dto.email, dto.password, ctx(req)), res);
  }

  @Publico()
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

  @Publico()
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

  @Publico()
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
