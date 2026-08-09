import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PersonasService } from './personas.service';
import { CrearPersonaDto, EditarPersonaDto, ListarPersonasDto } from './personas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  listar(@ActorActual() actor: Actor, @Query() p: ListarPersonasDto) {
    return this.personas.listar(actor.tenantId, p);
  }

  /**
   * Los conteos de la fila de pestañas.
   *
   * Va declarado ANTES de `@Get(':id')` y no es cosmético: Nest resuelve por
   * orden de declaración, así que abajo el literal `conteo-roles` se leería
   * como el parámetro `:id`, el ParseUUIDPipe lo rechazaría y el endpoint
   * devolvería 400 sin llegar nunca al servicio. Es la misma trampa de orden
   * que el router del front ya tiene anotada para `/propiedades/venta`.
   *
   * Sin `@Roles`, igual que el listado: saber cuántos inquilinos hay no es un
   * dato de plata, es la agenda de la inmobiliaria.
   */
  @Get('conteo-roles')
  conteoRoles(@ActorActual() actor: Actor) {
    return this.personas.conteoPorRol(actor.tenantId);
  }

  /** Búsqueda por documento para el alta inline. */
  @Get('por-documento/:doc')
  async porDocumento(@ActorActual() actor: Actor, @Param('doc') doc: string) {
    const persona = await this.personas.buscarPorDocumento(actor.tenantId, doc);
    // 200 con null y no 404: "no existe" es una respuesta esperada de esta
    // búsqueda, no un error. El front abre el alta con el documento cargado.
    return { encontrada: persona !== null, persona };
  }

  @Get(':id')
  obtener(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.personas.obtener(actor.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() actor: Actor, @Body() dto: CrearPersonaDto) {
    return this.personas.crear(actor.tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPersonaDto,
  ) {
    return this.personas.editar(actor.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.personas.borrar(actor.tenantId, id);
  }
}
