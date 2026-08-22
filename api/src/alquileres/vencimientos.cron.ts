import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { loadEnv } from '../config/env';

/**
 * Pasa a «vencido» los contratos cuya fecha de fin ya pasó.
 *
 * ── Por qué hacía falta ──
 *
 * Nada movía `contrato_alquiler.estado`: el único UPDATE que lo tocaba lo ponía
 * en 'renovado', y sólo al renovarlo a mano. Y `vigente` se calcula del estado
 * GUARDADO y no de las fechas —`c.estado IN ('vigente','por_iniciar')`— así que
 * un contrato terminado hace seis meses seguía figurando como vigente: en la
 * cartera de alquileres, en el tope del plan, y en la ficha de la persona, que
 * seguía diciendo «Inquilino».
 *
 * ── Lo que NO hace, y es lo importante ──
 *
 * **No toca una sola cuota.** La deuda sobrevive al contrato: alguien que se
 * fue debiendo tres meses los sigue debiendo, y si esto las cerrara, la
 * inmobiliaria perdería el reclamo. Mira la FECHA y nada más — nunca el estado
 * de pago.
 *
 * Tampoco toca 'renovado', 'rescindido' ni 'borrador': son decisiones que
 * alguien ya tomó, y pisarlas sería borrarlas.
 *
 * ── `setInterval` y no una librería de cron ──
 *
 * Igual que `IndicesCron` y `FotosColaService`, y por lo mismo: una dependencia
 * más para un ciclo diario no se paga. La consulta es idempotente, así que
 * correrla de más no hace nada.
 */

/** Cada seis horas. Un contrato vence a la medianoche; nadie mira antes. */
const CADA_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class VencimientosCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('VencimientosCron');
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly db: DbService) {}

  onModuleInit(): void {
    // En los tests no arranca: un ciclo que escribe en la base mientras corre
    // la suite la vuelve no determinista. Los tests llaman a `correr()`.
    if (loadEnv().NODE_ENV === 'test') return;

    // Una vuelta al arrancar, y después cada seis horas. Sin la primera, un
    // despliegue a las 9 de la mañana deja los contratos de ayer sin vencer
    // hasta las tres de la tarde.
    void this.correr();
    this.timer = setInterval(() => void this.correr(), CADA_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Devuelve cuántos venció. Idempotente. */
  async correr(): Promise<number> {
    try {
      const filas = await this.db.query<{ app_vencer_contratos: number }>(
        'SELECT app_vencer_contratos()',
      );
      const n = Number(filas[0]?.app_vencer_contratos ?? 0);
      if (n) this.logger.log(`${n} contratos pasaron a vencido`);
      return n;
    } catch (err) {
      // Que falle no puede tumbar el arranque de la API: es una tarea de
      // mantenimiento, no un requisito para atender requests.
      this.logger.error('No se pudieron vencer los contratos',
        err instanceof Error ? err.stack : err);
      return 0;
    }
  }
}
