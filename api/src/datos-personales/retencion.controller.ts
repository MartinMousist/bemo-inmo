import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { RetencionService } from './retencion.service';

/**
 * Retención y purga de datos personales.
 *
 * Sólo titular y administración: decidir que se borra el legajo de alguien no
 * es una tarea de todos los días ni de cualquiera. El asesor que carga el
 * legajo no es quien decide cuándo deja de existir.
 */
@Controller('datos-personales')
export class RetencionController {
  constructor(private readonly retencion: RetencionService) {}

  @Get('retencion')
  @Roles('owner', 'admin')
  estado(@ActorActual() a: Actor) {
    return this.retencion.estado(a.tenantId);
  }

  /**
   * `POST` y no `DELETE` porque no borra UN recurso identificado por la URL:
   * ejecuta una política sobre todo lo que esté vencido.
   */
  @Post('retencion/purgar')
  @Roles('owner', 'admin')
  purgar(@ActorActual() a: Actor, @Req() req: Request) {
    return this.retencion.purgar(a.tenantId, a.usuarioId, req.ip);
  }
}
