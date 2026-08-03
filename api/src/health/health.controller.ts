import { Controller, Get } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { Publico } from '../auth/decoradores';

@Publico()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Liveness: ¿el proceso responde? No toca la base a propósito — si la base
   * se cae, el contenedor no tiene que reiniciarse en loop.
   */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: ¿puede atender tráfico de verdad? Acá sí se verifica la base. */
  @Get()
  async ready(): Promise<{ status: 'ok'; db: 'ok' }> {
    await this.db.verificar();
    return { status: 'ok', db: 'ok' };
  }
}
