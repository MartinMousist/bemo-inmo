import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { AppError } from '../common/app-error';
import { CanalesService } from './canales.service';
import { CrearCuentaCanalDto, EditarCuentaCanalDto } from './inbox.dto';

/**
 * Las cuentas de canal conectadas.
 *
 * ── Quién puede qué ──
 *
 * Cada asesor carga SU número y queda esperando que el titular lo habilite. Un
 * canal es una credencial que permite escribirle a los clientes en nombre de la
 * inmobiliaria: que cualquiera lo prenda solo es demasiado, y que el titular
 * tenga que cargar diez tokens ajenos es demasiado poco.
 *
 * Editar y desconectar: cada uno el suyo; titular y administración, todos. El
 * canal de la inmobiliaria sólo lo tocan ellos.
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
  @Roles('owner', 'admin', 'agente', 'contable')
  listar(@ActorActual() a: Actor) {
    return this.canales.listar(a.tenantId, a.rol, a.usuarioId);
  }

  @Post()
  @Roles('owner', 'admin', 'agente', 'contable')
  crear(@ActorActual() a: Actor, @Body() dto: CrearCuentaCanalDto) {
    return this.canales.crear(a.tenantId, dto, { rol: a.rol, usuarioId: a.usuarioId });
  }

  /** El titular habilita un canal que cargó alguien del equipo. */
  @Post(':id/aprobar')
  @Roles('owner', 'admin')
  aprobar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.canales.aprobar(a.tenantId, id, a.usuarioId);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente', 'contable')
  async editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCuentaCanalDto,
  ) {
    await this.exigirDueno(a, id);
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
  @Roles('owner', 'admin', 'agente', 'contable')
  @HttpCode(204)
  async borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.exigirDueno(a, id);
    await this.canales.borrar(a.tenantId, id);
  }

  /**
   * El `@Roles` no alcanza: dice quién puede tocar canales, no CUÁL.
   *
   * Sin esto, un asesor con el id del canal de un compañero le puede cambiar el
   * número o desconectárselo. Es la misma lección de la 17.5 —el decorador no
   * acota los datos, sólo la puerta—.
   */
  private async exigirDueno(a: Actor, id: string): Promise<void> {
    const puede = await this.canales.puedeAdministrar(a.tenantId, id, {
      rol: a.rol, usuarioId: a.usuarioId,
    });
    // 404 y no 403: decir «existe pero no es tuyo» ya confirma que existe.
    if (!puede) throw AppError.notFound('No se encontró esa cuenta de canal.');
  }
}
