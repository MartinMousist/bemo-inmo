import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Rol } from './tokens.service';

export const PUBLICO = 'auth:publico';
export const ROLES = 'auth:roles';

/** Marca una ruta como accesible sin token. Nada más que login, signup y refresh. */
export const Publico = () => SetMetadata(PUBLICO, true);

/** Restringe una ruta a ciertos roles. Sin esto, alcanza con estar autenticado. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

export interface Actor {
  usuarioId: string;
  tenantId: string;
  rol: Rol;
}

export type RequestConActor = Request & { actor?: Actor };

/** Inyecta el actor autenticado en el handler. */
export const ActorActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor => {
    const req = ctx.switchToHttp().getRequest<RequestConActor>();
    if (!req.actor) {
      // Sólo pasa si alguien puso @ActorActual en una ruta @Publico.
      throw new Error('No hay actor: la ruta está marcada como pública');
    }
    return req.actor;
  },
);
