import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanesService } from './planes.service';
import type { RequestConActor } from '../auth/decoradores';

export const MODULO = 'plan:modulo';

export interface OpcionesModulo {
  /**
   * Dejar pasar los GET aunque el plan no incluya el módulo.
   *
   * Es para lo que ya se hizo y quedó guardado: liquidaciones emitidas, ventas
   * cerradas, actas firmadas, documentos generados. Bajar de plan tiene que
   * dejar de dar servicio NUEVO, no esconder el trabajo de los últimos dos
   * años. Cortarle a alguien el acceso a sus propios registros no es un límite
   * de plan, es tomarle el trabajo de rehén.
   *
   * NO se usa donde leer ES el servicio —la Red, la bandeja—: ahí un GET libre
   * regalaría justo lo que se cobra.
   */
  lecturaLibre?: boolean;
}

/**
 * Esta ruta exige que el plan incluya el módulo.
 *
 * ── Por qué hacía falta ──
 *
 * Desde la migración 011 los planes declaraban trece módulos y el código exigía
 * dos. Los otros once eran texto en una página de precios: el plan «Inicial»
 * decía no incluir liquidaciones, y las liquidaciones andaban igual.
 *
 * Una promesa que no se cumple en ninguna de las dos direcciones —ni cobra de
 * más ni entrega de menos— es peor que no hacerla.
 */
export const Modulo = (clave: string, opciones: OpcionesModulo = {}) =>
  SetMetadata(MODULO, { clave, ...opciones });

@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planes: PlanesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ clave: string } & OpcionesModulo>(
      MODULO,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest<RequestConActor>();

    // Sin actor no hay plan que consultar. Puede ser una ruta pública dentro de
    // un controlador con módulo —el feed XML, el webhook de un canal— y ésas
    // NO se cortan: del otro lado hay un portal o un proveedor que no tiene por
    // qué enterarse de nuestra facturación con un 403.
    if (!req.actor) return true;

    if (meta.lecturaLibre && req.method === 'GET') return true;

    await this.planes.exigirModulo(req.actor.tenantId, meta.clave);
    return true;
  }
}
