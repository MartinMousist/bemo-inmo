import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GastosService } from './gastos.service';
import { ReclamosService } from './reclamos.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import {
  CrearGastoDto, CrearProveedorDto, CrearReclamoDto, EditarGastoDto,
  EditarProveedorDto, EditarReclamoDto, FiltroGastosDto, FiltroProveedoresDto,
  FiltroReclamosDto, ResolverReclamoDto,
} from './gastos.dto';

/**
 * Gastos: es plata que se le descuenta a un propietario, así que los roles son
 * los mismos que los de liquidaciones. Un asesor no carga ni ve gastos.
 *
 * `contable` **lee** pero no escribe: su trabajo es rendir, no decidir qué se
 * gastó.
 */
@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

  @Get()
  @Roles('owner', 'admin', 'contable')
  listar(@ActorActual() a: Actor, @Query() f: FiltroGastosDto) {
    return this.gastos.listar(a.tenantId, f);
  }

  @Get(':id')
  @Roles('owner', 'admin', 'contable')
  obtener(@ActorActual() a: Actor, @Param('id') id: string) {
    return this.gastos.obtener(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(
    @ActorActual() a: Actor,
    @Body() dto: CrearGastoDto,
    @Req() req: Request,
  ) {
    return this.gastos.crear(a.tenantId, dto, a.usuarioId, req.ip ?? null);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(@ActorActual() a: Actor, @Param('id') id: string, @Body() dto: EditarGastoDto) {
    return this.gastos.editar(a.tenantId, id, dto);
  }

  /**
   * Anular, no borrar. Un gasto que existió y se anuló deja rastro; uno borrado
   * es un número que apareció y desapareció de una rendición.
   */
  @Post(':id/anular')
  @Roles('owner', 'admin')
  anular(
    @ActorActual() a: Actor,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.gastos.anular(a.tenantId, id, a.usuarioId, req.ip ?? null);
  }
}

@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly gastos: GastosService) {}

  /**
   * Los proveedores los lee también el `agente`: es la agenda de a quién llamar
   * cuando se rompe algo, y esconderla no protege ninguna plata.
   */
  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroProveedoresDto) {
    return this.gastos.listarProveedores(a.tenantId, f);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearProveedorDto) {
    return this.gastos.crearProveedor(a.tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(@ActorActual() a: Actor, @Param('id') id: string, @Body() dto: EditarProveedorDto) {
    return this.gastos.editarProveedor(a.tenantId, id, dto);
  }
}

/**
 * Reclamos: acá el `agente` **sí** entra, y a propósito.
 *
 * Es quien atiende el teléfono cuando el inquilino avisa que se rompió algo. Un
 * reclamo no tiene plata hasta que se resuelve con un costo, y ese paso —el que
 * genera el gasto— sí queda restringido.
 */
@Controller('reclamos')
export class ReclamosController {
  constructor(private readonly reclamos: ReclamosService) {}

  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroReclamosDto) {
    return this.reclamos.listar(a.tenantId, f);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id') id: string) {
    return this.reclamos.obtener(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() a: Actor, @Body() dto: CrearReclamoDto) {
    return this.reclamos.crear(a.tenantId, dto, a.usuarioId);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(@ActorActual() a: Actor, @Param('id') id: string, @Body() dto: EditarReclamoDto) {
    return this.reclamos.editar(a.tenantId, id, dto);
  }

  /**
   * Resolver puede crear un gasto, así que va restringido a quien puede tocar
   * plata. Un permiso que se puede esquivar por otra puerta no es un permiso.
   */
  @Post(':id/resolver')
  @Roles('owner', 'admin')
  resolver(
    @ActorActual() a: Actor,
    @Param('id') id: string,
    @Body() dto: ResolverReclamoDto,
    @Req() req: Request,
  ) {
    return this.reclamos.resolver(a.tenantId, id, dto, a.usuarioId, req.ip ?? null);
  }
}
