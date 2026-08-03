import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { loadEnv } from '../config/env';
import { AppError, ErrorCode } from '../common/app-error';

/** Errores transitorios de Postgres que vale la pena reintentar. */
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';
const REINTENTOS = 3;

export type Ejecutor = Pick<PoolClient, 'query'>;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Db');
  private readonly pool: Pool;

  constructor() {
    const env = loadEnv();
    // Conexión con el rol RESTRINGIDO. No es dueño de ninguna tabla, así que
    // las policies de RLS le aplican de verdad.
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
    this.pool.on('error', (err) => this.logger.error('Error en el pool', err.stack));
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.logger.log('Pool conectado');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Consulta sin contexto de tenant. Sólo para health y operaciones globales. */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const { rows } = await this.pool.query<T>(sql, params);
    return rows;
  }

  /**
   * Corre `fn` dentro de una transacción con el tenant fijado.
   *
   * Por qué `set_config(..., true)` y no `SET LOCAL`:
   * `SET LOCAL` no acepta bind parameters, así que la única forma de usarlo sería
   * interpolar el id en el SQL — una inyección esperando pasar. `set_config` con el
   * tercer argumento en `true` hace exactamente lo mismo (alcance transaccional) y
   * sí acepta parámetro.
   *
   * El `true` es crítico. Con `false` el valor queda pegado a la CONEXIÓN, no a la
   * transacción: vuelve al pool contaminada y el próximo request hereda el tenant del
   * anterior. Es la peor fuga posible porque es silenciosa y sólo aparece bajo carga.
   * Hay un test que lo cubre.
   *
   * Todo el trabajo tiene que usar el `ejecutor` que recibe el callback. Una consulta
   * hecha por fuera sale por otra conexión del pool, sin contexto, y no ve nada.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (ejecutor: Ejecutor) => Promise<T>,
  ): Promise<T> {
    if (!tenantId) throw AppError.tenantContextMissing();

    let ultimoError: unknown;

    for (let intento = 1; intento <= REINTENTOS; intento++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
          tenantId,
        ]);
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        ultimoError = err;

        if (!esTransitorio(err) || intento === REINTENTOS) throw err;

        this.logger.warn(
          `Error transitorio (${codigoPg(err)}), reintento ${intento}/${REINTENTOS - 1}`,
        );
        // Espera creciente con jitter: dos transacciones que colisionaron no
        // deberían reintentar en el mismo instante y volver a colisionar.
        await esperar(20 * intento + Math.floor(Math.random() * 20));
      } finally {
        client.release();
      }
    }

    throw ultimoError;
  }

  async estaViva(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.error('Base no disponible', err instanceof Error ? err.stack : err);
      return false;
    }
  }

  /** Para el health endpoint: distingue "no hay base" de "hay base pero falla". */
  async verificar(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new AppError(
        503,
        ErrorCode.DB_UNAVAILABLE,
        'La base de datos no está disponible.',
        'Service Unavailable',
      );
    }
  }
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function esTransitorio(err: unknown): boolean {
  const code = codigoPg(err);
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
