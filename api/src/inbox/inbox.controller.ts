import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import {
  AsignarDto, BanderaDto, EstadoConversacionDto, FiltroConversacionesDto,
  ResponderDto, VincularPropiedadDto,
} from './inbox.dto';
import { InboxService } from './inbox.service';

/**
 * La bandeja, para quien atiende.
 *
 * Todos los roles: atender un mensaje es el trabajo de cualquiera que esté en
 * la inmobiliaria, y el contable que ve una consulta de pagos tiene que poder
 * contestarla. Lo que cambia por rol no es el acceso sino **qué ve**: el número
 * del cliente le sale enmascarado a quien no es titular ni administración.
 */
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @Roles('owner', 'admin', 'agente', 'contable')
  listar(@ActorActual() a: Actor, @Query() f: FiltroConversacionesDto) {
    return this.inbox.listar(a.tenantId, a.rol, a.usuarioId, f);
  }

  @Get(':id')
  @Roles('owner', 'admin', 'agente', 'contable')
  hilo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.hilo(a.tenantId, a.rol, a.usuarioId, id);
  }

  /**
   * Contestar. La respuesta dice si SALIÓ o quedó en cola, y la pantalla lo
   * muestra tal cual: un mensaje que el usuario cree enviado y no salió es peor
   * que no tener el cuadro.
   */
  @Post(':id/mensajes')
  @Roles('owner', 'admin', 'agente', 'contable')
  responder(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResponderDto,
  ) {
    return this.inbox.responder(a.tenantId, id, dto.texto, a.usuarioId);
  }

  @Patch(':id/asignado')
  @Roles('owner', 'admin', 'agente', 'contable')
  async asignar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarDto,
  ) {
    await this.inbox.asignar(a.tenantId, id, dto.usuarioId ?? null);
    return { ok: true };
  }

  @Patch(':id/estado')
  @Roles('owner', 'admin', 'agente', 'contable')
  async estado(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EstadoConversacionDto,
  ) {
    await this.inbox.cambiarEstado(a.tenantId, id, dto.estado);
    return { ok: true };
  }

  @Patch(':id/leido')
  @Roles('owner', 'admin', 'agente', 'contable')
  async leido(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BanderaDto,
  ) {
    await this.inbox.marcarLeido(a.tenantId, id, dto.valor);
    return { ok: true };
  }

  /**
   * Vincular o desvincular la propiedad de la que habla la conversación.
   *
   * El detector la engancha sola cuando el cliente escribe el código, pero se
   * equivoca: `null` la desvincula y un id la corrige. **La corrección manda**
   * —la ingesta no vuelve a pisar un vínculo existente— porque si el próximo
   * mensaje lo rompiera, corregir no serviría de nada.
   */
  @Patch(':id/propiedad')
  @Roles('owner', 'admin', 'agente', 'contable')
  async propiedad(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VincularPropiedadDto,
  ) {
    await this.inbox.vincularPropiedad(a.tenantId, id, dto.propiedadId ?? null);
    return { ok: true };
  }

  @Patch(':id/bot')
  @Roles('owner', 'admin', 'agente', 'contable')
  async bot(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BanderaDto,
  ) {
    await this.inbox.cambiarBot(a.tenantId, id, dto.valor);
    return { ok: true };
  }
}
