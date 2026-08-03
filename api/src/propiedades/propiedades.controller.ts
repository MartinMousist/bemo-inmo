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
import { PropiedadesService } from './propiedades.service';
import { GeocodingService } from './geocoding.service';
import {
  CrearOperacionDto,
  CrearPropiedadDto,
  EditarOperacionDto,
  EditarPropiedadDto,
  FiltroPropiedadesDto,
} from './propiedades.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('propiedades')
export class PropiedadesController {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly geo: GeocodingService,
  ) {}

  /**
   * Le dice al front si el mapa está disponible. Sin esto, la UI tendría que
   * adivinar por qué una propiedad no tiene coordenadas: puede ser que falte la
   * API key o que la dirección no exista, y son problemas distintos.
   */
  @Get('capacidades')
  capacidades() {
    return { mapas: this.geo.configurado };
  }

  @Get()
  listar(@ActorActual() actor: Actor, @Query() f: FiltroPropiedadesDto) {
    return this.propiedades.listar(actor.tenantId, f);
  }

  @Get(':id')
  obtener(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.propiedades.obtener(actor.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() actor: Actor, @Body() dto: CrearPropiedadDto) {
    return this.propiedades.crear(actor.tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPropiedadDto,
  ) {
    return this.propiedades.editar(actor.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.propiedades.borrar(actor.tenantId, id);
  }

  @Post(':id/operaciones')
  @Roles('owner', 'admin', 'agente')
  agregarOperacion(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CrearOperacionDto,
  ) {
    return this.propiedades.agregarOperacion(actor.tenantId, id, dto);
  }

  @Patch(':id/operaciones/:operacionId')
  @Roles('owner', 'admin', 'agente')
  editarOperacion(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operacionId', ParseUUIDPipe) operacionId: string,
    @Body() dto: EditarOperacionDto,
  ) {
    return this.propiedades.editarOperacion(actor.tenantId, id, operacionId, dto);
  }
}
