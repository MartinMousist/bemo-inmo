import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { CanalesService } from './canales.service';
import { CrearCuentaCanalDto, EditarCuentaCanalDto } from './inbox.dto';

/**
 * Las cuentas de canal conectadas.
 *
 * Sólo titular y administración: conectar un canal es cargar una credencial que
 * habilita a escribirle a todos los clientes de la inmobiliaria en su nombre.
 * No es una tarea de todos los días ni de cualquiera.
 */
@Controller('canales')
export class CanalesController {
  constructor(private readonly canales: CanalesService) {}

  /** Los pares (canal, proveedor) que el sistema sabe manejar. */
  @Get('catalogo')
  @Roles('owner', 'admin')
  catalogo() {
    return this.canales.catalogo();
  }

  @Get()
  @Roles('owner', 'admin')
  listar(@ActorActual() a: Actor) {
    return this.canales.listar(a.tenantId);
  }

  @Post()
  @Roles('owner', 'admin')
  crear(@ActorActual() a: Actor, @Body() dto: CrearCuentaCanalDto) {
    return this.canales.crear(a.tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCuentaCanalDto,
  ) {
    return this.canales.editar(a.tenantId, id, dto);
  }

  /**
   * Deja la cuenta lista contra el proveedor: valida la credencial y registra
   * el webhook si la URL es pública.
   */
  @Post(':id/conectar')
  @Roles('owner', 'admin')
  conectar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const base = `${req.protocol}://${req.get('host')}`;
    return this.canales.conectar(a.tenantId, id, `${base}/v1/webhooks/`);
  }

  /**
   * Busca mensajes sin webhook. Es el camino de DESARROLLO: en una laptop no
   * hay URL pública a la que Telegram pueda pegarle.
   */
  @Post(':id/sondear')
  @Roles('owner', 'admin')
  sondear(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.canales.sondear(a.tenantId, id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  async borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.canales.borrar(a.tenantId, id);
  }
}
