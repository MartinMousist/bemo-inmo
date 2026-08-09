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
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import {
  CrearOperacionDto,
  CrearPropiedadDto,
  EditarOperacionDto,
  EditarPropiedadDto,
  FiltroPropiedadesDto,
} from './propiedades.dto';
import { ComisionesOperacionDto } from '../ventas/ventas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('propiedades')
export class PropiedadesController {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly geo: GeocodingService,
    private readonly almacen: AlmacenamientoService,
  ) {}

  /**
   * Qué puede hacer el front hoy, capacidad por capacidad.
   *
   * Antes esto devolvía un solo booleano `mapas`, y ahí estaba el defecto:
   * mezclaba DOS cosas distintas que no dependen de lo mismo.
   *
   *  · **Geocodificar** —de una dirección a lat/lng— lo hace el servidor contra
   *    la Geocoding API y necesita la key. Sin key no hay coordenadas, y la UI
   *    ofrece cargarlas a mano.
   *
   *  · **Mostrar el mapa** de una propiedad que YA tiene coordenadas es un
   *    `<iframe>` a `www.google.com/maps?q=…&output=embed`, que **no lleva key**.
   *    Verificado desde el contenedor de la API: HTTP 200, sin `X-Frame-Options`
   *    que lo bloquee. Con el booleano único, una propiedad con lat/lng cargadas
   *    a mano mostraba «El mapa necesita la API key de Google» y escondía un
   *    mapa que habría funcionado perfecto.
   *
   * `mapaEmbebido` es `true` constante, y está igual porque es un dato del
   * contrato: el día que Google cierre esa URL —no está documentada, ver
   * `docs/CONTINUAR.md`— se apaga acá y las fichas degradan solas.
   */
  @Get('capacidades')
  capacidades() {
    return {
      geocodificacion: this.geo.configurado,
      mapaEmbebido: true,
      fotos: this.almacen.configurado,
    };
  }

  /**
   * Prueba la API key contra Google de verdad.
   *
   * "Hay una key en el `.env`" y "la key funciona" son dos cosas distintas, y
   * las tres formas de que no funcione —API sin habilitar, facturación sin
   * activar, restricción mal puesta— dan todas el mismo síntoma acá adentro:
   * propiedades sin ubicación.
   */
  @Get('geocoding/diagnostico')
  @Roles('owner', 'admin')
  diagnostico() {
    return this.geo.diagnostico();
  }

  /** Cuántas propiedades quedaron sin coordenadas. */
  @Get('geocoding/pendientes')
  @Roles('owner', 'admin')
  pendientes(@ActorActual() actor: Actor) {
    return this.propiedades.contarSinUbicacion(actor.tenantId);
  }

  /**
   * Geocodifica en tanda las que quedaron sin coordenadas.
   *
   * De a 50: cada una es una llamada paga a Google. El tope está para que un
   * clic no dispare una factura de 2.000 consultas sin que nadie lo decida.
   */
  @Post('geocoding/sincronizar')
  @Roles('owner', 'admin')
  sincronizarGeocoding(@ActorActual() actor: Actor) {
    return this.propiedades.geocodificarPendientes(actor.tenantId, 50);
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

  /**
   * Los honorarios de esta operación, distintos de los de la casa.
   *
   * **owner + admin**, sin el asesor: el precio de la propiedad lo carga
   * cualquiera, pero cuánto cobra la inmobiliaria por venderla es política
   * comercial. Es el mismo recorte que ya tiene `PUT /comisiones/config`.
   *
   * Mandar `{}` limpia el override y la operación vuelve a heredar.
   */
  @Patch(':id/operaciones/:operacionId/comisiones')
  @Roles('owner', 'admin')
  editarComisiones(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operacionId', ParseUUIDPipe) operacionId: string,
    @Body() dto: ComisionesOperacionDto,
  ) {
    return this.propiedades.editarComisiones(actor.tenantId, id, operacionId, dto);
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
