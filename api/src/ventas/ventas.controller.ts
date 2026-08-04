import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch } from '@nestjs/common';
import { VentasService } from './ventas.service';
import {
  CerrarVentaDto, CobrarComisionDto, CrearVentaDto, RepartoDto,
} from './ventas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Get()
  listar(@ActorActual() a: Actor) {
    return this.ventas.listar(a.tenantId);
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

@Controller('comisiones')
export class ComisionesController {
  constructor(private readonly ventas: VentasService) {}

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
