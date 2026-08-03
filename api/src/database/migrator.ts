import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Migrador. Corre con el rol OWNER, nunca con el de la app.
 *
 * Las mismas migraciones corren en dev, en los tests y en producción. Un schema
 * armado a mano para los tests prueba otra cosa que la que se despliega.
 *
 * Cada archivo se aplica una vez, dentro de su propia transacción, en orden de
 * nombre. Se guarda el hash: si un archivo ya aplicado cambia, el migrador falla
 * en vez de seguir — una migración editada después de haberse aplicado significa
 * que dev y producción tienen schemas distintos.
 */
export interface ResultadoMigracion {
  aplicadas: string[];
  yaEstaban: number;
}

export async function migrar(
  ownerUrl: string,
  dir: string,
  log: (msg: string) => void = () => undefined,
): Promise<ResultadoMigracion> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre      text PRIMARY KEY,
        hash        text NOT NULL,
        aplicada_el timestamptz NOT NULL DEFAULT now()
      )
    `);

    const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    const { rows: previas } = await client.query<{ nombre: string; hash: string }>(
      'SELECT nombre, hash FROM schema_migrations',
    );
    const aplicadasPreviamente = new Map(previas.map((r) => [r.nombre, r.hash]));

    const aplicadas: string[] = [];

    for (const archivo of archivos) {
      const sql = await readFile(join(dir, archivo), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const hashPrevio = aplicadasPreviamente.get(archivo);

      if (hashPrevio) {
        if (hashPrevio !== hash) {
          throw new Error(
            `La migración ${archivo} cambió después de haberse aplicado.\n` +
              `Una migración aplicada es inmutable: creá una nueva en vez de editarla.`,
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (nombre, hash) VALUES ($1, $2)',
          [archivo, hash],
        );
        await client.query('COMMIT');
        aplicadas.push(archivo);
        log(`  aplicada  ${archivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Falló la migración ${archivo}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { aplicadas, yaEstaban: archivos.length - aplicadas.length };
  } finally {
    await client.end();
  }
}

/** Corre un archivo SQL suelto (seeds). Idempotente es responsabilidad del archivo. */
export async function correrSql(ownerUrl: string, ruta: string): Promise<void> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(await readFile(ruta, 'utf8'));
  } finally {
    await client.end();
  }
}
