import { Modulo } from '../planes/modulo.guard';
import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch, Put, Query,
} from '@nestjs/common';
import { VentasService } from './ventas.service';
import { ComisionesConfigService } from './comisiones.config.service';
import { ExternasService } from './externas.service';
import { ComisionesContratoService } from './comisiones.contrato.service';
import {
  CerrarVentaDto, CobrarComisionDto, ConfigComisionesDto, CrearVentaDto,
  ExternaCrearDto, ExternaEditarDto, FiltroVentasDto, RepartoDto,
} from './ventas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Modulo('ventas', { lecturaLibre: true })
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroVentasDto) {
    return this.ventas.listar(a.tenantId, f);
  }

  /** Lo que le corresponde a cada agente. El asesor ve lo suyo. */
  @Get('comisiones/por-agente')
  porAgente(@ActorActual() a: Actor) {
    return this.ventas.porAgente(a.tenantId, a);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ventas.obtener(a.tenantId, id);
  }

  /**
   * El reparto que el sistema propone. **Sugiere, no decide**: todo lo que
   * devuelve llega editable a la pantalla, porque el captador no siempre es
   * quien cargó la propiedad.
   *
   * Lo lee cualquiera del equipo: un asesor necesita ver con qué números va a
   * quedar la operación antes de que la cierre administración.
   */
  @Get(':id/reparto/sugerido')
  sugerirReparto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ventas.sugerirReparto(a.tenantId, id, a);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearVentaDto) {
    return this.ventas.crear(a.tenantId, dto);
  }

  /** Calcula y guarda los tres niveles de reparto. */
  @Post(':id/reparto')
  @Roles('owner', 'admin')
  repartir(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepartoDto,
  ) {
    return this.ventas.repartir(a.tenantId, id, dto);
  }

  @Patch(':id/estado')
  @Roles('owner', 'admin')
  avanzar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CerrarVentaDto,
  ) {
    return this.ventas.avanzar(a.tenantId, id, dto);
  }
}

/**
 * Las comisiones de un contrato de alquiler.
 *
 * Controlador propio y no un método más de `ContratosController`: las rutas
 * cuelgan de `/contratos/:id` pero el servicio, el motor y los DTO son los de
 * comisiones. Así, cuando cambie el reparto, cambia un módulo y no dos.
 */
@Modulo('comisiones', { lecturaLibre: true })
@Controller('contratos/:contratoId/comisiones')
export class ComisionesDeContratoController {
  constructor(private readonly comisiones: ComisionesContratoService) {}

  /** La lee cualquiera del equipo: el asesor necesita saber cómo quedó. */
  @Get()
  leer(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.comisiones.leer(a.tenantId, id);
  }

  @Get('sugerido')
  sugerir(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.comisiones.sugerir(a.tenantId, id, a);
  }

  @Post()
  @Roles('owner', 'admin')
  repartir(
    @ActorActual() a: Actor,
    @Param('contratoId', ParseUUIDPipe) id: string,
    @Body() dto: RepartoDto,
  ) {
    return this.comisiones.repartir(a.tenantId, id, dto);
  }
}

@Modulo('comisiones', { lecturaLibre: true })
@Controller('comisiones')
export class ComisionesController {
  constructor(
    private readonly ventas: VentasService,
    private readonly config: ComisionesConfigService,
    private readonly externas: ExternasService,
  ) {}

  /**
   * El catálogo de inmobiliarias con las que se comparte.
   *
   * Va ANTES de `:id/cobrar`, igual que `config`: Nest resuelve por orden de
   * declaración y `externas` se leería como un uuid, con un 400 del
   * ParseUUIDPipe que no explica nada.
   */
  @Get('externas')
  listarExternas(@ActorActual() a: Actor, @Query('todas') todas?: string) {
    return this.externas.listar(a.tenantId, todas === 'true');
  }

  /**
   * El alta la puede hacer un asesor, a propósito.
   *
   * Quien está cerrando una operación compartida a las siete de la tarde no
   * puede quedar trabado esperando que el titular cargue la ficha de la otra
   * agencia. La baja, en cambio, es de titular y administración: saca a la
   * agencia de todos los autocompletar de la inmobiliaria.
   */
  @Post('externas')
  @Roles('owner', 'admin', 'agente')
  crearExterna(@ActorActual() a: Actor, @Body() dto: ExternaCrearDto) {
    return this.externas.crear(a.tenantId, dto);
  }

  @Patch('externas/:id')
  @Roles('owner', 'admin')
  editarExterna(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExternaEditarDto,
  ) {
    return this.externas.editar(a.tenantId, id, dto);
  }

  /**
   * La política de comisiones de la inmobiliaria.
   *
   * La lee cualquiera del equipo —un agente necesita saber con qué números
   * trabaja— y la escriben titular y administración.
   *
   * Va ANTES de `:id/cobrar`: Nest resuelve por orden de declaración.
   */
  @Get('config')
  leerConfig(@ActorActual() a: Actor) {
    return this.config.leer(a.tenantId);
  }

  @Put('config')
  @Roles('owner', 'admin')
  guardarConfig(@ActorActual() a: Actor, @Body() dto: ConfigComisionesDto) {
    return this.config.guardar(a.tenantId, dto);
  }

  @Post(':id/cobrar')
  @Roles('owner', 'admin')
  cobrar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CobrarComisionDto,
  ) {
    return this.ventas.marcarCobrada(a.tenantId, id, dto.fecha);
  }
}
