import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, ErrorCode } from '../common/app-error';
import { TokensService, type Rol } from './tokens.service';
import { AuthService } from './auth.service';
import { PUBLICO, ROLES, type RequestConActor } from './decoradores';

/**
 * Guard global: por defecto TODO exige token. Una ruta sólo es pública si lo
 * dice explícitamente con @Publico().
 *
 * El default importa: si el guard fuera opt-in, un endpoint nuevo al que se le
 * olvidó el decorador queda abierto. Así, el olvido lo deja cerrado.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destinos = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, destinos)) return true;

    const req = ctx.switchToHttp().getRequest<RequestConActor>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new AppError(
        401,
        ErrorCode.UNAUTHENTICATED,
        'Falta el token de acceso.',
        'Unauthorized',
      );
    }

    let claims;
    try {
      claims = this.tokens.verificarAccess(header.slice(7));
    } catch {
      // Sin distinguir "expirado" de "inválido" hacia afuera. El front sabe qué
      // hacer con un 401 y sea cual sea la causa la respuesta es refrescar.
      throw new AppError(
        401,
        ErrorCode.UNAUTHENTICATED,
        'El token de acceso no es válido o expiró.',
        'Unauthorized',
      );
    }

    req.actor = { usuarioId: claims.sub, tenantId: claims.tid, rol: claims.rol };

    const permitidos = this.reflector.getAllAndOverride<Rol[]>(ROLES, destinos);
    if (permitidos?.length && !permitidos.includes(claims.rol)) {
      // Las denegaciones se auditan. Son justamente las que interesan cuando
      // hay que reconstruir qué pasó.
      await this.auth.auditar(
        claims.tid,
        claims.sub,
        `acceso:${req.method} ${req.path}`,
        'denegado',
        { ip: req.ip, userAgent: req.headers['user-agent'] },
        { rol: claims.rol, requeridos: permitidos },
      );
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'Tu rol no tiene permiso para esta operación.',
        'Forbidden',
      );
    }

    return true;
  }
}
