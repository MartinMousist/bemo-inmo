import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { FiltroAuditoriaDto } from './auditoria.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

/**
 * Quién tocó la plata.
 *
 * Mismos roles que las liquidaciones: titular, administración y contable. Un
 * asesor no ve la cobranza de la inmobiliaria, así que tampoco su historia — el
 * registro de auditoría sería la misma información por otra puerta.
 */
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  @Roles('owner', 'admin', 'contable')
  listar(@ActorActual() a: Actor, @Query() f: FiltroAuditoriaDto) {
    return this.auditoria.listar(a.tenantId, f);
  }

  /** La historia de una entidad: "¿qué le pasó a esta liquidación?". */
  @Get(':tipo/:id')
  @Roles('owner', 'admin', 'contable')
  deEntidad(
    @ActorActual() a: Actor,
    @Param('tipo') tipo: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.auditoria.deEntidad(a.tenantId, tipo, id);
  }
}
