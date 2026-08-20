import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import {
  AplicarRespuestaDto, CrearRespuestaDto, EditarRespuestaDto,
  GuardarBotDto, ProbarBotDto,
} from './inbox.dto';
import { PlantillasChatService } from './plantillas.service';
import { BotService } from './bot.service';

/**
 * Respuestas rápidas.
 *
 * Listarlas y usarlas es de todos —es el trabajo de contestar—. Crearlas y
 * borrarlas es de titular y administración: una plantilla mal escrita se manda
 * a cien clientes antes de que alguien la lea.
 */
@Controller('respuestas')
export class RespuestasController {
  constructor(private readonly plantillas: PlantillasChatService) {}

  /** El catálogo de variables, para que la pantalla no lo tenga duplicado. */
  @Get('variables')
  @Roles('owner', 'admin', 'agente', 'contable')
  variables() {
    return this.plantillas.variables();
  }

  /** Las que sirven para este canal, ordenadas por las más usadas. */
  @Get()
  @Roles('owner', 'admin', 'agente', 'contable')
  listar(@ActorActual() a: Actor, @Query('canal') canal?: string) {
    return this.plantillas.listar(a.tenantId, canal);
  }

  /** Todas, incluidas las apagadas: es la vista de administración. */
  @Get('todas')
  @Roles('owner', 'admin')
  todas(@ActorActual() a: Actor) {
    return this.plantillas.listarTodas(a.tenantId);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearRespuestaDto) {
    return this.plantillas.crear(a.tenantId, a.usuarioId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarRespuestaDto,
  ) {
    return this.plantillas.editar(a.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  async borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.plantillas.borrar(a.tenantId, id);
  }

  /**
   * La plantilla resuelta para una conversación.
   *
   * **No la envía**: devuelve el texto para que caiga en el cuadro de respuesta
   * y el asesor lo vea antes de mandarlo. Si una variable no se pudo resolver,
   * viene en `faltantes` y el marcador queda a la vista.
   */
  @Post(':id/aplicar')
  @Roles('owner', 'admin', 'agente', 'contable')
  aplicar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AplicarRespuestaDto,
  ) {
    return this.plantillas.aplicar(a.tenantId, id, dto.conversacionId, a.usuarioId);
  }
}

/**
 * La configuración del bot.
 *
 * Sólo titular y administración: define qué se le contesta solo a un cliente y
 * cuándo se avisa a una persona. No es una preferencia personal.
 */
@Controller('bot')
export class BotController {
  constructor(private readonly bot: BotService) {}

  @Get(':cuentaId')
  @Roles('owner', 'admin')
  leer(@ActorActual() a: Actor, @Param('cuentaId', ParseUUIDPipe) cuentaId: string) {
    return this.bot.leer(a.tenantId, cuentaId);
  }

  @Patch(':cuentaId')
  @Roles('owner', 'admin')
  guardar(
    @ActorActual() a: Actor,
    @Param('cuentaId', ParseUUIDPipe) cuentaId: string,
    @Body() dto: GuardarBotDto,
  ) {
    return this.bot.guardar(a.tenantId, cuentaId, dto);
  }

  /**
   * Qué haría el bot con esta frase. No manda ni guarda nada.
   *
   * Es la mitad de la feature: un bot cuyo comportamiento sólo se descubre
   * cuando le escribe un cliente real es un bot que nadie se anima a tocar.
   */
  @Post(':cuentaId/probar')
  @Roles('owner', 'admin')
  probar(
    @ActorActual() a: Actor,
    @Param('cuentaId', ParseUUIDPipe) cuentaId: string,
    @Body() dto: ProbarBotDto,
  ) {
    return this.bot.probar(a.tenantId, cuentaId, dto.mensaje, dto.esPrimerMensaje);
  }
}
