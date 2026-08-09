import { join } from 'node:path';
import { migrar, correrSql } from '../src/database/migrator';
import { DbService } from '../src/database/db.service';
import { loadEnv, resetEnvCache } from '../src/config/env';

/**
 * Aislamiento entre inmobiliarias.
 *
 * Este archivo es el gate de la etapa 2 y el más importante del proyecto: si
 * falla, una inmobiliaria ve los datos de otra. Se corre contra Postgres real
 * con las migraciones de producción, no contra un mock.
 */

const ANDES = '11111111-1111-4111-8111-111111111111';
const PLATA = '22222222-2222-4222-8222-222222222222';

describe('RLS — aislamiento entre inmobiliarias', () => {
  let db: DbService;

  beforeAll(async () => {
    resetEnvCache();
    const env = loadEnv();
    await migrar(env.DATABASE_OWNER_URL, join(__dirname, '..', 'migrations'));
    await correrSql(env.DATABASE_OWNER_URL, join(__dirname, '..', 'seeds', 'demo.sql'));

    db = new DbService();
    await db.onModuleInit();
  }, 30_000);

  afterAll(async () => {
    await db?.onModuleDestroy();
  });

  it('con contexto de Andes se ve Andes y nada más', async () => {
    const filas = await db.withTenant(ANDES, async (ej) => {
      const { rows } = await ej.query<{ id: string }>('SELECT id FROM tenant');
      return rows;
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe(ANDES);
  });

  it('con contexto del Plata se ve el Plata y nada más', async () => {
    const filas = await db.withTenant(PLATA, async (ej) => {
      const { rows } = await ej.query<{ id: string }>('SELECT id FROM tenant');
      return rows;
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe(PLATA);
  });

  it('SIN contexto no se ve nada — el default es cero filas, no todas', async () => {
    // Es la propiedad que hace que un olvido sea inofensivo. Si el default
    // fuera "ver todo", cualquier consulta que se escape del wrapper filtraría
    // la base entera sin que nadie lo note.
    const filas = await db.query('SELECT id FROM tenant');
    expect(filas).toHaveLength(0);
  });

  it('el pool no queda contaminado después de fijar un tenant', async () => {
    // `set_config(..., true)` es transaccional: al cerrar la transacción el valor
    // se revierte y la conexión vuelve limpia al pool. Con `false` quedaría pegado
    // a la conexión y el próximo request heredaría el tenant del anterior — la peor
    // fuga posible, porque es silenciosa y sólo aparece bajo carga.
    await db.withTenant(ANDES, async (ej) => {
      await ej.query('SELECT id FROM tenant');
    });

    const filas = await db.query('SELECT id FROM tenant');
    expect(filas).toHaveLength(0);
  });

  it('un UPDATE cruzado no afecta ninguna fila', async () => {
    const afectadas = await db.withTenant(ANDES, async (ej) => {
      const res = await ej.query('UPDATE tenant SET nombre = $1 WHERE id = $2', [
        'HACKEADO',
        PLATA,
      ]);
      return res.rowCount;
    });

    expect(afectadas).toBe(0);

    const nombre = await db.withTenant(PLATA, async (ej) => {
      const { rows } = await ej.query<{ nombre: string }>(
        'SELECT nombre FROM tenant WHERE id = $1',
        [PLATA],
      );
      return rows[0]?.nombre;
    });

    expect(nombre).toBe('Inmobiliaria del Plata');
  });

  it('el rol de la app no puede crear ni borrar inmobiliarias', async () => {
    // Defensa en profundidad: aunque el código se equivoque, el GRANT no está.
    await expect(
      db.withTenant(ANDES, async (ej) => {
        await ej.query("INSERT INTO tenant (nombre) VALUES ('Trucha')");
      }),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege

    await expect(
      db.withTenant(ANDES, async (ej) => {
        await ej.query('DELETE FROM tenant WHERE id = $1', [ANDES]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('la subconsulta de la foto de portada tampoco cruza inmobiliarias', async () => {
    // El listado de propiedades trae la portada con una subconsulta
    // CORRELACIONADA sobre `propiedad_foto`. Una subconsulta también pasa por
    // RLS, pero eso hay que probarlo: si no lo hiciera, la cartera de una
    // inmobiliaria mostraría la foto de la propiedad de otra, que es la peor
    // forma de la fuga —visible, y en la pantalla que se le muestra al cliente.
    const propiedadPlata = await db.withTenant(PLATA, async (ej) => {
      const { rows } = await ej.query<{ id: string }>('SELECT id FROM propiedad LIMIT 1');
      return rows[0].id;
    });

    const url = `http://localhost:9000/aislamiento/${Date.now()}.png`;
    await db.withTenant(PLATA, async (ej) => {
      await ej.query(
        `INSERT INTO propiedad_foto (tenant_id, propiedad_id, url, orden, es_portada)
         VALUES ($1, $2, $3, 99, false)`,
        [PLATA, propiedadPlata, url],
      );
    });

    try {
      const urls = await db.withTenant(ANDES, async (ej) => {
        const { rows } = await ej.query<{ foto_portada: string | null }>(
          `SELECT (SELECT f.url FROM propiedad_foto f
                    WHERE f.propiedad_id = p.id
                    ORDER BY f.es_portada DESC, f.orden, f.created_at
                    LIMIT 1) AS foto_portada
             FROM propiedad p`,
        );
        return rows.map((r) => r.foto_portada);
      });

      expect(urls).not.toContain(url);

      // Y por la puerta directa tampoco: con el id de la propiedad ajena en la
      // mano, la subconsulta sigue sin devolver nada.
      const directo = await db.withTenant(ANDES, async (ej) => {
        const { rows } = await ej.query<{ url: string }>(
          'SELECT url FROM propiedad_foto WHERE propiedad_id = $1',
          [propiedadPlata],
        );
        return rows;
      });
      expect(directo).toHaveLength(0);
    } finally {
      await db.withTenant(PLATA, async (ej) => {
        await ej.query('DELETE FROM propiedad_foto WHERE url = $1', [url]);
      });
    }
  });

  it('withTenant sin tenant explota en vez de correr sin contexto', async () => {
    await expect(db.withTenant('', async () => undefined)).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_MISSING',
    });
  });
});
