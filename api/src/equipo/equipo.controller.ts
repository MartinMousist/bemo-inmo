import { Body, Controller, Get, Post } from '@nestjs/common';
import { EquipoService } from './equipo.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { InvitarDto } from '../auth/auth.dto';

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
}
