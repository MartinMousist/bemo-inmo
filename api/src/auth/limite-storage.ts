import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { DbService } from '../database/db.service';
import { loadEnv } from '../config/env';
import { GENERAL, POR_INMOBILIARIA } from './limite-intentos';

/**
 * El contador del límite de intentos, en Postgres.
 *
 * El storage que trae la librería vive en la memoria del proceso. Con una sola
 * instancia alcanza; con dos réplicas detrás de un balanceador, cada una lleva
 * el suyo y el límite efectivo se duplica **en silencio**, que es la peor forma
 * de que un control de seguridad deje de funcionar.
 *
 * Postgres y no Redis: la base ya está, ya es estado compartido y ya se
 * respalda. Sumar Redis sería otro servicio que vigilar y que puede estar
 * caído, a cambio de nada que acá se note — los intentos de login son decenas
 * por minuto, no miles por segundo.
 *
 * Se activa con `RATE_LIMIT_EN_BASE=true`. Por defecto sigue el entorno: en
 * producción sí, en desarrollo y en tests no, para no meterle una escritura a
 * cada request de una suite de 429.
 */
@Injectable()
export class LimiteStoragePostgres implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger('LimiteIntentos');
  private readonly enBase: boolean;

  /** El de la librería, para cuando el de base está apagado. */
  private readonly memoria = new Map<string, { hits: number; expira: number; bloqueadoHasta: number | null }>();

  private limpieza?: ReturnType<typeof setInterval>;

  constructor(private readonly db: DbService) {
    this.enBase = loadEnv().RATE_LIMIT_EN_BASE;

    if (this.enBase) {
      // Barrido periódico de lo vencido. Sin esto la tabla crece con cada IP
      // que pasó alguna vez: no rompe nada, pero es basura acumulándose para
      // siempre en la base que se respalda todas las noches.
      this.limpieza = setInterval(() => void this.limpiar(), 10 * 60_000);
      this.limpieza.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.limpieza) clearInterval(this.limpieza);
  }

  async increment(
    clave: string,
    ttl: number,
    limite: number,
    duracionBloqueo: number,
    nombre?: string,
  ): Promise<ThrottlerStorageRecord> {
    // El contador general va SIEMPRE en memoria, aunque el resto vaya a la
    // base. Corre en cada request de la app: mandarlo a Postgres sería una
    // escritura extra por request para proteger de algo que no la necesita
    // exacta. Con N réplicas el techo efectivo es N × 300 por minuto, que sigue
    // siendo un techo —y es el orden de magnitud lo que importa acá, no el
    // número—. Los de credenciales sí van a la base: ahí el conteo compartido
    // ES el control.
    if (nombre === GENERAL || nombre === POR_INMOBILIARIA) {
      return this.incrementarEnMemoria(clave, ttl, limite, duracionBloqueo);
    }

    return this.enBase
      ? this.incrementarEnBase(clave, ttl, limite, duracionBloqueo)
      : this.incrementarEnMemoria(clave, ttl, limite, duracionBloqueo);
  }

  /**
   * Todo en UNA sentencia.
   *
   * Leer y después escribir sería una condición de carrera con nombre y
   * apellido: dos intentos simultáneos leen el mismo contador y los dos
   * escriben el mismo número. Con `ON CONFLICT DO UPDATE` la fila queda
   * bloqueada mientras se decide, y el conteo no se pierde.
   */
  private async incrementarEnBase(
    clave: string,
    ttl: number,
    limite: number,
    duracionBloqueo: number,
  ): Promise<ThrottlerStorageRecord> {
    const filas = await this.db.query<{
      hits: number;
      ms_para_expirar: string;
      ms_para_desbloquear: string | null;
    }>(
      `INSERT INTO limite_intento AS l (clave, hits, expira_el, bloqueado_hasta)
       VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'), NULL)
       ON CONFLICT (clave) DO UPDATE SET
         -- Ventana vencida: la cuenta arranca de nuevo, y el bloqueo también.
         hits = CASE WHEN l.expira_el <= now() THEN 1 ELSE l.hits + 1 END,
         expira_el = CASE WHEN l.expira_el <= now()
                          THEN now() + ($2::bigint * interval '1 millisecond')
                          ELSE l.expira_el END,
         bloqueado_hasta = CASE
           WHEN l.expira_el <= now() THEN NULL
           -- Ya bloqueado: NO se extiende. Si cada intento corriera el bloqueo,
           -- alguien que reintenta solo se castigaría para siempre.
           WHEN l.bloqueado_hasta IS NOT NULL AND l.bloqueado_hasta > now()
             THEN l.bloqueado_hasta
           WHEN l.hits + 1 > $3::int
             THEN now() + ($4::bigint * interval '1 millisecond')
           ELSE NULL
         END
       RETURNING
         hits,
         (extract(epoch FROM (expira_el - now())) * 1000)::bigint::text AS ms_para_expirar,
         CASE WHEN bloqueado_hasta IS NULL OR bloqueado_hasta <= now() THEN NULL
              ELSE (extract(epoch FROM (bloqueado_hasta - now())) * 1000)::bigint::text
         END AS ms_para_desbloquear`,
      [clave, ttl, limite, duracionBloqueo],
    );

    const f = filas[0];
    const msBloqueo = f.ms_para_desbloquear === null ? 0 : Number(f.ms_para_desbloquear);

    return {
      totalHits: Number(f.hits),
      // La librería espera SEGUNDOS. Devolver milisegundos hace que el
      // `Retry-After` diga 900.000 y el usuario lea "en 15000 minutos".
      timeToExpire: Math.ceil(Math.max(0, Number(f.ms_para_expirar)) / 1000),
      isBlocked: msBloqueo > 0,
      timeToBlockExpire: Math.ceil(msBloqueo / 1000),
    };
  }

  /** El mismo comportamiento, en memoria. Es el camino de dev y de tests. */
  private incrementarEnMemoria(
    clave: string,
    ttl: number,
    limite: number,
    duracionBloqueo: number,
  ): ThrottlerStorageRecord {
    const ahora = Date.now();
    let r = this.memoria.get(clave);

    if (!r || r.expira <= ahora) {
      r = { hits: 0, expira: ahora + ttl, bloqueadoHasta: null };
      this.memoria.set(clave, r);
    }

    r.hits += 1;

    if (r.bloqueadoHasta !== null && r.bloqueadoHasta <= ahora) r.bloqueadoHasta = null;
    if (r.bloqueadoHasta === null && r.hits > limite) {
      r.bloqueadoHasta = ahora + duracionBloqueo;
    }

    const msBloqueo = r.bloqueadoHasta === null ? 0 : r.bloqueadoHasta - ahora;

    return {
      totalHits: r.hits,
      timeToExpire: Math.ceil(Math.max(0, r.expira - ahora) / 1000),
      isBlocked: msBloqueo > 0,
      timeToBlockExpire: Math.ceil(msBloqueo / 1000),
    };
  }

  private async limpiar(): Promise<void> {
    try {
      // Con una hora de gracia: borrar apenas vence no aporta nada y hace que
      // el barrido corra sobre filas que se van a reusar en el próximo intento.
      await this.db.query(
        `DELETE FROM limite_intento
          WHERE expira_el < now() - interval '1 hour'
            AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now())`,
      );
    } catch (err) {
      // Que falle la limpieza no puede tumbar la app: es mantenimiento.
      this.logger.warn(
        `No se pudo limpiar el contador de intentos: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
