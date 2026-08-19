import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OportunidadesService } from './oportunidades.service';
import {
  AgendaDto,
  CrearOportunidadDto,
  CrearReservaDto,
  CrearVisitaDto,
  EditarOportunidadDto,
  EditarReservaDto,
  EditarVisitaDto,
  FiltroOportunidadesDto,
} from './oportunidades.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('oportunidades')
export class OportunidadesController {
  constructor(private readonly oportunidades: OportunidadesService) {}

  @Get()
  listar(@ActorActual() actor: Actor, @Query() f: FiltroOportunidadesDto) {
    return this.oportunidades.listar(actor.tenantId, f, actor);
  }

  /**
   * La agenda de visitas. Sin `@Roles`: es la pantalla de trabajo de un asesor.
   *
   * Va ANTES de `@Get(':id')` **y eso no es cosmético**: Nest resuelve en
   * orden de declaración, así que con `:id` primero, `/agenda` entra como id y
   * el `ParseUUIDPipe` contesta «uuid is expected». Es la misma lección que ya
   * dejó escrita el router del front con `/propiedades/nueva`.
   */
  @Get('agenda')
  agenda(@ActorActual() a: Actor, @Query() q: AgendaDto) {
    return this.oportunidades.agenda(a.tenantId, {
      // `yo` es el centinela que ya usa el resto del sistema para «lo mío».
      agenteId: q.agenteId === 'yo' ? a.usuarioId : q.agenteId,
      dias: q.dias,
    });
  }

  @Get(':id')
  obtener(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.oportunidades.obtener(actor.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() actor: Actor, @Body() dto: CrearOportunidadDto) {
    return this.oportunidades.crear(actor.tenantId, dto, actor.usuarioId);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarOportunidadDto,
  ) {
    return this.oportunidades.editar(actor.tenantId, id, dto);
  }

  @Post(':id/visitas')
  @Roles('owner', 'admin', 'agente')
  agendarVisita(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CrearVisitaDto,
  ) {
    return this.oportunidades.agendarVisita(actor.tenantId, id, dto, actor.usuarioId);
  }

  @Patch(':id/visitas/:visitaId')
  @Roles('owner', 'admin', 'agente')
  editarVisita(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('visitaId', ParseUUIDPipe) visitaId: string,
    @Body() dto: EditarVisitaDto,
  ) {
    return this.oportunidades.editarVisita(actor.tenantId, id, visitaId, dto);
  }
}

@Controller('reservas')
export class ReservasController {
  constructor(private readonly oportunidades: OportunidadesService) {}

  @Get()
  listar(@ActorActual() actor: Actor) {
    return this.oportunidades.listarReservas(actor.tenantId);
  }

  /** Tomar una seña mueve plata: es del titular o de administración. */
  @Post()
  @Roles('owner', 'admin')
  reservar(@ActorActual() actor: Actor, @Body() dto: CrearReservaDto) {
    return this.oportunidades.reservar(actor.tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  cambiar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarReservaDto,
  ) {
    return this.oportunidades.cambiarReserva(actor.tenantId, id, dto);
  }
}
