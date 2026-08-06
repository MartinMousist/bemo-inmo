import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { IndicesService } from './indices.service';

/**
 * La sincronización de índices, corriendo sola.
 *
 * `sincronizar()` existía desde la etapa 4 y su comentario decía «pensado para
 * un cron». **No había cron.** Sólo corría si alguien hacía
 * `POST /v1/indices/sincronizar` a mano, así que un ICL nuevo entraba al
 * sistema el día que alguien se acordaba — y el día que nadie se acuerda, un
 * ajuste se proyecta con el índice del mes pasado.
 *
 * ── Por qué `setInterval` y no una librería de cron ─────────────────────────
 *
 * Ya hay precedente en el repositorio (`limite-storage.ts` barre lo vencido
 * así) y no hace falta más: **la sincronización es idempotente**.
 * `app_indice_cargar` no pisa un valor ya cargado, así que correrla doce veces
 * al día no tiene efecto salvo el día que el BCRA publica algo nuevo.
 *
 * Eso hace que el problema sea "revisar seguido y barato" y no "acertarle al
 * día de publicación". Un cron mensual al día 5 falla el mes que el BCRA
 * publica el 7; éste no puede fallar por calendario.
 *
 * ── Por qué el IPC no está acá ───────────────────────────────────────────────
 *
 * Porque INDEC no tiene API estable. Raspar un HTML que cambia sin aviso
 * pondría un número equivocado en un aviso de aumento, que es de las peores
 * cosas que puede hacer este producto. Sigue siendo carga manual **a
 * propósito**, y el sistema avisa cuándo falta en vez de estimarlo.
 *
 * ── Una instancia ────────────────────────────────────────────────────────────
 *
 * Con dos réplicas detrás de un balanceador, las dos sincronizan. No rompe
 * nada —es idempotente— pero son dos consultas al BCRA por vuelta. `deploy.md`
 * documenta una sola instancia; el día que sean dos, esto va a un lock de
 * base como el que ya usa el contador de intentos.
 */

/** Cada cuánto se revisa. Doce horas: barato y sin depender del calendario. */
const CADA = 12 * 60 * 60 * 1000;

/**
 * Espera antes de la primera vuelta.
 *
 * Sin esto, arrancar la API dispara una consulta al BCRA en el mismo momento en
 * que se está levantando —y en desarrollo, en cada guardado que reinicia el
 * proceso—. Treinta segundos alcanzan para que el arranque termine.
 */
const PRIMERA = 30 * 1000;

@Injectable()
export class IndicesCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IndicesCron');
  private timer?: ReturnType<typeof setInterval>;
  private arranque?: ReturnType<typeof setTimeout>;
  private corriendo = false;

  constructor(private readonly indices: IndicesService) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (!env.SINCRONIZAR_INDICES) {
      this.logger.log('Sincronización automática apagada (SINCRONIZAR_INDICES=false)');
      return;
    }

    this.arranque = setTimeout(() => {
      void this.correr();
      this.timer = setInterval(() => void this.correr(), CADA);
      this.timer.unref?.();
    }, PRIMERA);
    this.arranque.unref?.();

    this.logger.log('Sincronización automática de ICL y UVA cada 12 h');
  }

  onModuleDestroy(): void {
    if (this.arranque) clearTimeout(this.arranque);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Una vuelta.
   *
   * **Nunca lanza.** Un error del BCRA no puede tumbar el proceso: es una
   * fuente externa que no controlamos, y la aplicación tiene que seguir
   * funcionando con los valores que ya tiene. `sincronizar()` ya devuelve el
   * error por índice en vez de tirar, así que acá sólo queda el imprevisto.
   */
  private async correr(): Promise<void> {
    // Si la vuelta anterior sigue en curso —el BCRA tardando—, esta se saltea.
    // Dos sincronizaciones simultáneas no rompen nada por idempotencia, pero
    // son dos consultas para el mismo resultado.
    if (this.corriendo) return;
    this.corriendo = true;

    try {
      // `usuarioId` nulo: lo cargó el sistema, no una persona. Inventar un
      // usuario acá haría que la auditoría diga que alguien lo hizo.
      const r = await this.indices.sincronizar(null);

      for (const [tipo, res] of Object.entries(r)) {
        if (res.error) this.logger.warn(`${tipo}: ${res.error}`);
        else if (res.cargados) {
          this.logger.log(`${tipo}: ${res.cargados} períodos nuevos`);
        }
        // Cero cargados y sin error es el caso normal: no hay nada nuevo. No
        // se loguea, o son dos líneas de ruido cada doce horas para siempre.
      }
    } catch (err) {
      this.logger.error(
        `La sincronización falló y la aplicación sigue: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.corriendo = false;
    }
  }
}
