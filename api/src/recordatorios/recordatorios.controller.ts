import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RecordatoriosService } from './recordatorios.service';
import { FiltroAvisosDto } from './recordatorios.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { Modulo } from '../planes/modulo.guard';

// `lecturaLibre`: los avisos ya generados se siguen leyendo si el plan baja.
// Lo que se corta es que el sistema genere más.
@Modulo('avisos', { lecturaLibre: true })
@Controller('avisos')
export class RecordatoriosController {
  constructor(private readonly rec: RecordatoriosService) {}

  /** Qué canales pueden enviar de verdad hoy. */
  @Get('canales')
  canales() {
    return this.rec.canales();
  }

  /**
   * Lo que muestra la campanita. ANTES de `:id`, como toda ruta literal.
   *
   * Sin `@Roles`: cualquiera que entre tiene que ver sus avisos. Un asesor que
   * no ve que un contrato vence no puede hacer nada al respecto.
   */
  @Get('sin-ver')
  sinVer(@ActorActual() a: Actor) {
    return this.rec.sinVer(a.tenantId);
  }

  @Get()
  bandeja(@ActorActual() a: Actor, @Query() f: FiltroAvisosDto) {
    return this.rec.bandeja(a.tenantId, f);
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

  // Marcar visto es del que lo mira: cualquiera que reciba el aviso.
  @Post(':id/visto')
  @Roles('owner', 'admin', 'agente', 'contable')
  visto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.rec.marcarVisto(a.tenantId, id);
  }
}
