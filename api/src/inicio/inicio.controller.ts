import { Controller, Get, Query } from '@nestjs/common';
import { InicioService } from './inicio.service';
import { CajaService } from './caja.service';
import { FiltroCajaDto } from './caja.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('caja')
export class CajaController {
  constructor(private readonly caja: CajaService) {}

  /**
   * Qué entró hoy, por qué medio y quién lo registró.
   *
   * Mismos roles que las liquidaciones: es la cobranza de la inmobiliaria, y un
   * asesor no la ve.
   */
  @Get()
  @Roles('owner', 'admin', 'contable')
  delDia(@ActorActual() a: Actor, @Query() f: FiltroCajaDto) {
    return this.caja.delDia(a.tenantId, f);
  }
}

@Controller('inicio')
export class InicioController {
  constructor(private readonly inicio: InicioService) {}

  /**
   * Sin `@Roles`: lo abre cualquiera con sesión. Lo que cambia por rol es el
   * CONTENIDO, no el acceso — los bloques de plata vienen en `null` para quien
   * no los puede ver. Ver `inicio.service.ts`.
   */
  @Get()
  resumen(@ActorActual() a: Actor) {
    return this.inicio.resumen(a.tenantId, a.rol);
  }
}
