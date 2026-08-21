import { Modulo } from '../planes/modulo.guard';
import {
  Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ContratosService } from './contratos.service';
import { CarteraService } from './cartera.service';
import { CicloService } from './ciclo.service';
import { IndicesService } from './indices.service';
import { LiquidacionesService } from './liquidaciones.service';
import {
  AgregarGastoDto, CargarIndiceDto, CargarIndicesLoteDto, CondonarPunitorioDto,
  CrearContratoDto, DevolverDepositoDto,
  FiltroCarteraDto, FiltroContratosDto, FiltroVencimientosDto, FiltroIndicesDto, FiltroLiquidacionesDto,
  GenerarLiquidacionesDto, GenerarPeriodosDto, LoteContratosDto, RegistrarCobroDto,
  RenovarContratoDto,
} from './alquileres.dto';
import { PaginacionDto } from '../common/paginacion';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('contratos')
export class ContratosController {
  constructor(
    private readonly contratos: ContratosService,
    // `cartera_` con guión bajo para no chocar con el método `cartera()`.
    private readonly cartera_: CarteraService,
    private readonly ciclo: CicloService,
  ) {}

  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroContratosDto) {
    return this.contratos.listar(a.tenantId, f);
  }

  /**
   * La cartera en formato de gestión: una fila por contrato con su próximo
   * aumento, su última cuota, su saldo y su estado de cobranza ya resueltos.
   *
   * Va ANTES de `@Get(':id')`: Nest resuelve por orden de declaración y
   * `cartera` entraría como un id que después falla en el ParseUUIDPipe.
   */
  @Get('cartera')
  cartera(@ActorActual() a: Actor, @Query() f: FiltroCarteraDto) {
    return this.cartera_.listar(a.tenantId, f);
  }

  /** Genera cuotas para varios contratos. Cada uno con su parte. */
  @Post('lote/periodos')
  @Roles('owner', 'admin')
  periodosEnLote(@ActorActual() a: Actor, @Body() dto: LoteContratosDto) {
    return this.cartera_.generarPeriodosEnLote(a.tenantId, dto);
  }

  @Post('lote/ajustes/proyectar')
  @Roles('owner', 'admin')
  ajustesEnLote(@ActorActual() a: Actor, @Body() dto: LoteContratosDto) {
    return this.cartera_.proyectarAjustesEnLote(a.tenantId, dto);
  }

  /** El tablero de vencimientos: contratos, ajustes y cuotas en una sola lista. */
  @Get('vencimientos')
  vencimientos(@ActorActual() a: Actor, @Query() f: FiltroVencimientosDto) {
    return this.contratos.vencimientos(a.tenantId, f);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.obtener(a.tenantId, id);
  }

  /**
   * Lo que dice cada cabecera de la ficha con su bloque cerrado.
   *
   * **Sin `@Roles`, igual que la ficha**: lo ve todo el equipo, contable
   * incluido. La regla está escrita en `resumenFicha()` — la cabecera no puede
   * decir nada que el bloque abierto no diga, ni al revés esconder algo que el
   * bloque muestra.
   *
   * Va DESPUÉS de `@Get('cartera')` y `@Get('vencimientos')`, como todo lo que
   * cuelga de `:id`: Nest resuelve por orden de declaración y `cartera` entraría
   * como un id que después falla en el ParseUUIDPipe.
   */
  @Get(':id/ficha')
  ficha(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.resumenFicha(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearContratoDto) {
    // El `usuarioId` viaja porque el contrato nuevo genera su pre-contrato en el
    // mismo movimiento, y un documento generado lleva quién lo generó.
    return this.contratos.crear(a.tenantId, dto, a.usuarioId);
  }

  @Get(':id/ajustes')
  ajustes(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() f: PaginacionDto,
  ) {
    return this.contratos.listarAjustes(a.tenantId, id, f);
  }

  @Post(':id/ajustes/proyectar')
  @Roles('owner', 'admin')
  proyectar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contratos.proyectarAjustes(a.tenantId, id);
  }

  @Get(':id/periodos')
  periodos(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() f: PaginacionDto,
  ) {
    return this.contratos.listarPeriodos(a.tenantId, id, f);
  }

  /** La cadena de renovaciones, del contrato más viejo al más nuevo. */
  @Get(':id/cadena')
  cadena(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ciclo.cadena(a.tenantId, id);
  }

  /**
   * Crea el contrato que sigue con todo lo del anterior ya cargado, y deja el
   * anterior en `renovado` — que no es lo mismo que `vencido`: uno es una
   * propiedad que se desocupó, el otro es el mismo inquilino que sigue.
   */
  @Post(':id/renovar')
  @Roles('owner', 'admin')
  renovar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenovarContratoDto,
    @Req() req: Request,
  ) {
    return this.ciclo.renovar(a.tenantId, id, dto, a.usuarioId, req.ip);
  }

  /** Devolución del depósito en garantía, con el detalle de los descuentos. */
  @Post(':id/deposito/devolver')
  @Roles('owner', 'admin')
  devolverDeposito(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DevolverDepositoDto,
    @Req() req: Request,
  ) {
    return this.ciclo.devolverDeposito(a.tenantId, id, dto, a.usuarioId, req.ip);
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
  confirmar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.contratos.confirmarAjuste(a.tenantId, id, a.usuarioId, req.ip);
  }
}

@Controller('cuotas')
export class CuotasController {
  constructor(private readonly contratos: ContratosService) {}

  /**
   * Perdona el interés por mora de una cuota.
   *
   * Es plata que se resigna en nombre del propietario, así que sólo titular y
   * administración, y siempre con motivo.
   */
  @Post(':id/condonar-punitorio')
  @Roles('owner', 'admin')
  condonar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CondonarPunitorioDto,
    @Req() req: Request,
  ) {
    return this.contratos.condonarPunitorio(
      a.tenantId, id, dto.motivo, a.usuarioId, req.ip,
    );
  }
}

@Controller('cobros')
export class CobrosController {
  constructor(private readonly contratos: ContratosService) {}

  @Post()
  @Roles('owner', 'admin')
  registrar(
    @ActorActual() a: Actor,
    @Body() dto: RegistrarCobroDto,
    @Req() req: Request,
  ) {
    return this.contratos.registrarCobro(a.tenantId, dto, a.usuarioId, req.ip);
  }
}

@Controller('indices')
export class IndicesController {
  constructor(private readonly indices: IndicesService) {}

  @Get()
  listar(@Query() f: FiltroIndicesDto) {
    return this.indices.listar(f);
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

@Modulo('liquidaciones', { lecturaLibre: true })
@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(private readonly liquidaciones: LiquidacionesService) {}

  @Get()
  @Roles('owner', 'admin', 'contable')
  listar(@ActorActual() a: Actor, @Query() f: FiltroLiquidacionesDto) {
    return this.liquidaciones.listar(a.tenantId, f);
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
    @Req() req: Request,
  ) {
    return this.liquidaciones.agregarGasto(a.tenantId, id, dto, a.usuarioId, req.ip);
  }

  @Post(':id/cerrar')
  @Roles('owner', 'admin')
  cerrar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.liquidaciones.cerrar(a.tenantId, id, a.usuarioId, req.ip);
  }

  /** El propietario ya cobró. Es lo que evita que se le pague dos veces. */
  @Post(':id/pagada')
  @Roles('owner', 'admin', 'contable')
  pagada(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.liquidaciones.marcarPagada(a.tenantId, id, a.usuarioId, req.ip);
  }
}
