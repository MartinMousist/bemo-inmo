import {
  Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { IndicesService, type TipoIndicePublicado } from './indices.service';
import { LiquidacionesService } from './liquidaciones.service';
import {
  AgregarGastoDto, CargarIndiceDto, CargarIndicesLoteDto, CrearContratoDto,
  FiltroContratosDto, GenerarLiquidacionesDto, GenerarPeriodosDto, RegistrarCobroDto,
} from './alquileres.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('contratos')
export class ContratosController {
  constructor(private readonly contratos: ContratosService) {}

  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroContratosDto) {
    return this.contratos.listar(a.tenantId, f);
  }

  /** El tablero de vencimientos: contratos, ajustes y cuotas en una sola lista. */
  @Get('vencimientos')
  vencimientos(@ActorActual() a: Actor, @Query('dias') dias?: string) {
    return this.contratos.vencimientos(a.tenantId, dias ? Number(dias) : 90);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.obtener(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearContratoDto) {
    return this.contratos.crear(a.tenantId, dto);
  }

  @Get(':id/ajustes')
  ajustes(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.listarAjustes(a.tenantId, id);
  }

  @Post(':id/ajustes/proyectar')
  @Roles('owner', 'admin')
  proyectar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.proyectarAjustes(a.tenantId, id);
  }

  @Get(':id/periodos')
  periodos(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.listarPeriodos(a.tenantId, id);
  }

  @Post(':id/periodos/generar')
  @Roles('owner', 'admin')
  generarPeriodos(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerarPeriodosDto,
  ) {
    return this.contratos.generarPeriodos(a.tenantId, id, dto.hasta);
  }
}

@Controller('ajustes')
export class AjustesController {
  constructor(private readonly contratos: ContratosService) {}

  /** Confirmar es el acto de una persona que se hace cargo del número. */
  @Post(':id/confirmar')
  @Roles('owner', 'admin')
  confirmar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.confirmarAjuste(a.tenantId, id, a.usuarioId);
  }
}

@Controller('cobros')
export class CobrosController {
  constructor(private readonly contratos: ContratosService) {}

  @Post()
  @Roles('owner', 'admin')
  registrar(@ActorActual() a: Actor, @Body() dto: RegistrarCobroDto) {
    return this.contratos.registrarCobro(a.tenantId, dto, a.usuarioId);
  }
}

@Controller('indices')
export class IndicesController {
  constructor(private readonly indices: IndicesService) {}

  @Get()
  listar(@Query('tipo') tipo?: TipoIndicePublicado, @Query('desde') desde?: string) {
    return this.indices.listar(tipo, desde);
  }

  /** Hasta qué mes hay datos de cada índice. Es lo primero que mira la pantalla. */
  @Get('cobertura')
  cobertura() {
    return this.indices.cobertura();
  }

  /** Qué índices se traen solos y cuáles siguen siendo manuales, con el motivo. */
  @Get('capacidades')
  capacidades() {
    return this.indices.capacidades();
  }

  /**
   * Trae del BCRA lo que falte de ICL y UVA. Idempotente: pensado para un cron,
   * y mientras tanto para un botón.
   */
  @Post('sincronizar')
  @Roles('owner', 'admin')
  sincronizar(@ActorActual() a: Actor) {
    return this.indices.sincronizar(a.usuarioId);
  }

  @Post()
  @Roles('owner', 'admin')
  cargar(@ActorActual() a: Actor, @Body() dto: CargarIndiceDto) {
    return this.indices.cargar(dto, a.usuarioId);
  }

  @Post('lote')
  @Roles('owner', 'admin')
  cargarLote(@ActorActual() a: Actor, @Body() dto: CargarIndicesLoteDto) {
    return this.indices.cargarLote(dto.valores, a.usuarioId);
  }
}

@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(private readonly liquidaciones: LiquidacionesService) {}

  @Get()
  @Roles('owner', 'admin', 'contable')
  listar(@ActorActual() a: Actor, @Query('periodo') periodo?: string) {
    return this.liquidaciones.listar(a.tenantId, periodo);
  }

  @Get(':id')
  @Roles('owner', 'admin', 'contable')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.liquidaciones.obtener(a.tenantId, id);
  }

  @Post('generar')
  @Roles('owner', 'admin')
  generar(@ActorActual() a: Actor, @Body() dto: GenerarLiquidacionesDto) {
    return this.liquidaciones.generar(a.tenantId, dto.periodo);
  }

  @Post(':id/gastos')
  @Roles('owner', 'admin')
  gasto(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgregarGastoDto,
  ) {
    return this.liquidaciones.agregarGasto(a.tenantId, id, dto);
  }

  @Post(':id/cerrar')
  @Roles('owner', 'admin')
  cerrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.liquidaciones.cerrar(a.tenantId, id);
  }
}
