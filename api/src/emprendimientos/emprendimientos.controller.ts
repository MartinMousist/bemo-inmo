import { Modulo } from '../planes/modulo.guard';
import {
  Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe,
  Patch, Post, Query,
} from '@nestjs/common';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import {
  AvanceDto, CrearEmprendimientoDto, CrearPlanDto, EditarEmprendimientoDto,
  EditarPlanDto, ImportarUnidadesDto, PresupuestarDto,
} from './emprendimientos.dto';
import { EmprendimientosService } from './emprendimientos.service';
import { ImportarUnidadesService } from './importar-unidades.service';
import { PlanesPagoService } from './planes.service';

/**
 * Emprendimientos: la venta en pozo.
 *
 * Leer es de todo el equipo —un asesor tiene que poder armarle el presupuesto a
 * un cliente parado en la obra—. Cargar unidades, tocar precios y cambiar el
 * avance de obra es de titular y administración: son los números que después
 * alguien firma.
 */
@Modulo('emprendimientos', { lecturaLibre: true })
@Controller('emprendimientos')
export class EmprendimientosController {
  constructor(
    private readonly emp: EmprendimientosService,
    private readonly planes: PlanesPagoService,
    private readonly importador: ImportarUnidadesService,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agente', 'contable')
  listar(@ActorActual() a: Actor) {
    return this.emp.listar(a.tenantId);
  }

  /** La plantilla para cargar unidades. Ruta literal antes que `:id`. */
  @Get('plantilla-unidades.csv')
  @Roles('owner', 'admin')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="unidades.csv"')
  plantilla() {
    // Con BOM: sin él, Excel abre el archivo en Latin-1 y rompe los acentos.
    return `﻿${this.importador.plantilla()}`;
  }

  @Get(':id')
  @Roles('owner', 'admin', 'agente', 'contable')
  leer(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.emp.leer(a.tenantId, id);
  }

  /** El plano: las unidades agrupadas por piso, con su estado. */
  @Get(':id/plano')
  @Roles('owner', 'admin', 'agente', 'contable')
  plano(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.emp.plano(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearEmprendimientoDto) {
    return this.emp.crear(a.tenantId, { ...dto });
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarEmprendimientoDto,
  ) {
    return this.emp.editar(a.tenantId, id, { ...dto });
  }

  /**
   * El avance de obra. Endpoint propio porque se toca una vez por mes y lleva
   * su fecha: un «65%» sin decir de cuándo no le sirve a quien puso plata.
   */
  @Patch(':id/avance')
  @Roles('owner', 'admin')
  avance(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AvanceDto,
  ) {
    return this.emp.avance(a.tenantId, id, dto.pct);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  async borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.emp.borrar(a.tenantId, id);
  }

  /**
   * Carga masiva de unidades.
   *
   * **Simula por defecto.** Sin `confirmar: true` procesa todo y no guarda
   * nada: una planilla de 40 unidades con la columna corrida crea 40
   * propiedades mal cargadas, y deshacer eso es peor que cargarlas a mano.
   */
  @Post(':id/unidades/importar')
  @Roles('owner', 'admin')
  importar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportarUnidadesDto,
  ) {
    return this.importador.importar(a.tenantId, id, dto.csv, {
      simular: dto.confirmar !== true,
      moneda: dto.moneda ?? 'USD',
    });
  }
}

/**
 * Los planes de pago.
 *
 * Van en su propio controlador y no colgados del emprendimiento porque un plan
 * puede ser general de la desarrolladora —«30 + 36 CAC» se ofrece en los tres
 * edificios— y colgarlo de uno obligaría a duplicarlo en cada uno.
 */
@Modulo('emprendimientos', { lecturaLibre: true })
@Controller('planes-pago')
export class PlanesPagoController {
  constructor(private readonly planes: PlanesPagoService) {}

  @Get()
  @Roles('owner', 'admin', 'agente', 'contable')
  listar(@ActorActual() a: Actor, @Query('emprendimientoId') emp?: string) {
    return this.planes.listar(a.tenantId, emp);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearPlanDto) {
    return this.planes.crear(a.tenantId, { ...dto });
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPlanDto,
  ) {
    return this.planes.editar(a.tenantId, id, { ...dto });
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  async borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.planes.borrar(a.tenantId, id);
  }

  /**
   * El presupuesto para el cliente.
   *
   * Lo puede pedir cualquiera del equipo: es la herramienta de venta, y el
   * asesor la usa parado en la obra con el interesado al lado.
   */
  @Post(':id/presupuesto')
  @Roles('owner', 'admin', 'agente', 'contable')
  presupuestar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresupuestarDto,
  ) {
    return this.planes.presupuestar(a.tenantId, id, dto);
  }
}
