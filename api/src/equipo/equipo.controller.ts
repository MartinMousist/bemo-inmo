import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EquipoService } from './equipo.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { InvitarDto } from '../auth/auth.dto';
import { ComisionesAgenteDto } from './equipo.dto';

@Controller('equipo')
export class EquipoController {
  constructor(private readonly equipo: EquipoService) {}

  /** Cualquiera del equipo ve quiénes son sus compañeros. */
  @Get()
  listar(@ActorActual() actor: Actor) {
    return this.equipo.listar(actor.tenantId);
  }

  @Get('invitaciones')
  @Roles('owner', 'admin')
  listarInvitaciones(@ActorActual() actor: Actor) {
    return this.equipo.listarInvitaciones(actor.tenantId);
  }

  /** Sumar gente es del titular. Ver docs/spec.md §5. */
  @Post('invitaciones')
  @Roles('owner')
  invitar(@ActorActual() actor: Actor, @Body() dto: InvitarDto) {
    return this.equipo.invitar(actor.tenantId, actor.usuarioId, dto.email, dto.rol);
  }

  /**
   * El perfil de una persona del equipo.
   *
   * Lo abre cualquiera —qué captó un compañero y cuántas operaciones cerró es
   * información de trabajo— pero **los montos se filtran adentro del servicio**:
   * un agente ve los suyos y de los demás recibe `null` con el motivo escrito.
   * Un cero en una pantalla de plata sería mentir.
   *
   * Va DESPUÉS de 'invitaciones' para que el parámetro no se coma esa ruta.
   */
  @Get(':usuarioId/perfil')
  perfil(
    @ActorActual() actor: Actor,
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
  ) {
    return this.equipo.perfil(actor.tenantId, usuarioId, actor);
  }

  /**
   * El % de comisión de una persona.
   *
   * **owner + admin**, y no sólo owner. `docs/spec.md §5` pone «Usuarios y
   * roles» como exclusivo del titular, pero esto es configuración de comisiones
   * —el `PUT /comisiones/config` ya está en owner+admin— y no alta de usuarios:
   * quien maneja los números de la casa tiene que poder ajustar el de una
   * persona sin pedirle la sesión al dueño. El desvío respecto del spec queda
   * escrito acá a propósito.
   */
  @Patch(':usuarioId/comisiones')
  @Roles('owner', 'admin')
  guardarComisiones(
    @ActorActual() actor: Actor,
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
    @Body() dto: ComisionesAgenteDto,
  ) {
    return this.equipo.guardarComisiones(
      actor.tenantId,
      usuarioId,
      dto.comisionCaptadorPct ?? null,
      dto.comisionCerradorPct ?? null,
    );
  }
}
