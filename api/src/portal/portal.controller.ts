import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CATEGORIAS_RECLAMO } from '../gastos/gastos.dto';
import { PortalService } from './portal.service';
import { LimiteEstricto, POR_CUENTA, POR_IP } from '../auth/limite-intentos';
import { ActorActual, Publico, Roles, type Actor } from '../auth/decoradores';

/**
 * Gestión de los enlaces, del lado de la inmobiliaria.
 *
 * Sólo titular y administración: dar acceso a la información de un propietario
 * es una decisión de quien administra la cuenta, no de cualquiera que entre.
 */
/**
 * Lo que manda el inquilino al reportar.
 *
 * `categoria` sale del MISMO catálogo que usa la inmobiliaria
 * (`CATEGORIAS_RECLAMO`): un reclamo del portal que entrara con una categoría
 * propia sería un reclamo que los filtros de la bandeja no encuentran.
 *
 * **Sin prioridad y sin a-cargo-de**: eso lo decide quien administra. Un
 * reclamo que llega marcado «urgente» por quien lo reporta convierte el campo
 * en ruido.
 */
class ReportarDto {
  @IsIn(CATEGORIAS_RECLAMO as unknown as string[])
  categoria!: string;

  @IsString() @MinLength(5) @MaxLength(2000)
  descripcion!: string;
}

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
    return this.portal.crearAcceso(a.tenantId, personaId, a.usuarioId, 'propietario');
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
@LimiteEstricto()
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

/** Los accesos del inquilino, del lado de la inmobiliaria. */
@Controller('inquilinos')
export class AccesosInquilinoController {
  constructor(private readonly portal: PortalService) {}

  @Get(':personaId/accesos')
  @Roles('owner', 'admin')
  listar(@ActorActual() a: Actor, @Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.portal.listarAccesos(a.tenantId, personaId);
  }

  @Post(':personaId/accesos')
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.portal.crearAcceso(a.tenantId, personaId, a.usuarioId, 'inquilino');
  }
}

/**
 * La vista del inquilino. **Pública**, con el token en la URL.
 *
 * Mismo límite por IP que la del propietario, y por el mismo motivo: un token
 * de 32 bytes no se adivina, pero probar tampoco tiene por qué salir gratis.
 */
@LimiteEstricto()
@Controller('inquilino')
export class PortalInquilinoController {
  constructor(private readonly portal: PortalService) {}

  @Publico()
  @SkipThrottle({ [POR_CUENTA]: true })
  @Throttle({ [POR_IP]: { limit: 60 } })
  @Get(':token')
  vista(@Param('token') token: string) {
    return this.portal.vistaInquilino(token);
  }

  /**
   * Reportar un desperfecto.
   *
   * Límite más chico que la lectura: escribir sin sesión es otra cosa. Sesenta
   * lecturas por hora son alguien mirando su cuenta; sesenta reclamos serían
   * alguien inundando la bandeja de la inmobiliaria.
   */
  @Publico()
  @SkipThrottle({ [POR_CUENTA]: true })
  @Throttle({ [POR_IP]: { limit: 5 } })
  @Post(':token/reclamos')
  reportar(@Param('token') token: string, @Body() dto: ReportarDto) {
    return this.portal.reportar(token, dto.categoria, dto.descripcion);
  }
}
