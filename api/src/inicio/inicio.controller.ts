import { Controller, Get } from '@nestjs/common';
import { InicioService } from './inicio.service';
import { ActorActual, type Actor } from '../auth/decoradores';

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
