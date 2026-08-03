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
import { CrearPersonaDto, EditarPersonaDto } from './personas.dto';
import { PaginacionDto } from '../common/paginacion';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  listar(@ActorActual() actor: Actor, @Query() p: PaginacionDto) {
    return this.personas.listar(actor.tenantId, p);
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
