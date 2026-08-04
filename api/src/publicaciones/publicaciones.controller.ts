import {
  Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PublicacionesService } from './publicaciones.service';
import { ActualizarPublicacionDto, CrearPublicacionDto } from './publicaciones.dto';
import { ActorActual, Publico, Roles, type Actor } from '../auth/decoradores';

@Controller('publicaciones')
export class PublicacionesController {
  constructor(private readonly pub: PublicacionesService) {}

  /** Qué portales tienen integración y cuáles son copiar y pegar. */
  @Get('portales')
  portales() {
    return this.pub.portales();
  }

  @Get('feed/token')
  @Roles('owner', 'admin')
  token(@ActorActual() a: Actor) {
    return this.pub.token(a.tenantId);
  }

  @Post('feed/rotar')
  @Roles('owner')
  rotar(@ActorActual() a: Actor) {
    return this.pub.rotarToken(a.tenantId);
  }

  @Get()
  listar(@ActorActual() a: Actor) {
    return this.pub.listar(a.tenantId);
  }

  @Get('previsualizar/:operacionId')
  previsualizar(
    @ActorActual() a: Actor,
    @Param('operacionId', ParseUUIDPipe) operacionId: string,
  ) {
    return this.pub.previsualizar(a.tenantId, operacionId);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pub.obtener(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() a: Actor, @Body() dto: CrearPublicacionDto) {
    return this.pub.crear(a.tenantId, dto);
  }

  @Post(':id/regenerar')
  @Roles('owner', 'admin', 'agente')
  regenerar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pub.regenerar(a.tenantId, id);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  actualizar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarPublicacionDto,
  ) {
    return this.pub.actualizar(a.tenantId, id, dto);
  }
}

/**
 * El feed es PÚBLICO: un portal lo consume por HTTP sin sesión. El tenant se
 * resuelve por el token, que es aleatorio y rotable. Sin token no hay feed.
 */
@Controller('feed')
export class FeedController {
  constructor(private readonly pub: PublicacionesService) {}

  @Publico()
  @Get(':token.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=900')
  async feed(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const xml = await this.pub.feed(token);
    res.setHeader('Content-Disposition', 'inline; filename="cartera.xml"');
    return xml;
  }
}
