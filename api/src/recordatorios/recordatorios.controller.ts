import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RecordatoriosService } from './recordatorios.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

@Controller('avisos')
export class RecordatoriosController {
  constructor(private readonly rec: RecordatoriosService) {}

  /** Qué canales pueden enviar de verdad hoy. */
  @Get('canales')
  canales() {
    return this.rec.canales();
  }

  @Get()
  bandeja(@ActorActual() a: Actor, @Query('futuros') futuros?: string) {
    return this.rec.bandeja(a.tenantId, futuros === 'true');
  }

  /**
   * Recalcula los avisos. Idempotente: se puede llamar las veces que sea.
   * Cuando exista el cron, lo va a llamar él; hasta entonces, un botón.
   */
  @Post('generar')
  @Roles('owner', 'admin')
  generar(@ActorActual() a: Actor) {
    return this.rec.generar(a.tenantId);
  }

  @Post(':id/visto')
  visto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.rec.marcarVisto(a.tenantId, id);
  }
}
