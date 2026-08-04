import {
  Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PortalService } from './portal.service';
import { LimiteIntentosGuard, POR_CUENTA, POR_IP } from '../auth/limite-intentos';
import { UseGuards } from '@nestjs/common';
import { ActorActual, Publico, Roles, type Actor } from '../auth/decoradores';

/**
 * Gestión de los enlaces, del lado de la inmobiliaria.
 *
 * Sólo titular y administración: dar acceso a la información de un propietario
 * es una decisión de quien administra la cuenta, no de cualquiera que entre.
 */
@Controller('propietarios')
export class AccesosPropietarioController {
  constructor(private readonly portal: PortalService) {}

  @Get(':personaId/accesos')
  @Roles('owner', 'admin')
  listar(@ActorActual() a: Actor, @Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.portal.listarAccesos(a.tenantId, personaId);
  }

  /**
   * Genera el enlace. El token se devuelve **una sola vez**: en la base queda
   * su hash, así que si se pierde hay que generar otro.
   */
  @Post(':personaId/accesos')
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.portal.crearAcceso(a.tenantId, personaId, a.usuarioId);
  }

  @Delete('accesos/:id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  revocar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.revocar(a.tenantId, id);
  }
}

/**
 * La vista del propietario. **Pública**, con el token en la URL.
 *
 * Es el único endpoint sin sesión que devuelve datos de una inmobiliaria, así
 * que lleva límite de intentos: sin él, un token de 32 bytes es imposible de
 * adivinar en la práctica, pero probar sin costo tampoco tiene por qué ser
 * gratis. Se cuenta por IP; no hay cuenta que contar.
 */
@UseGuards(LimiteIntentosGuard)
@Controller('propietario')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Publico()
  @SkipThrottle({ [POR_CUENTA]: true })
  @Throttle({ [POR_IP]: { limit: 60 } })
  @Get(':token')
  vista(@Param('token') token: string) {
    return this.portal.vista(token);
  }
}
