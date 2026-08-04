import { Client } from 'pg';
import { LimiteStoragePostgres } from '../src/auth/limite-storage';
import { DbService } from '../src/database/db.service';
import { loadEnv, resetEnvCache } from '../src/config/env';

/**
 * El contador del límite de intentos en la base.
 *
 * Existe porque el storage en memoria funciona hasta que hay dos réplicas: ahí
 * cada una lleva su propia cuenta y el límite efectivo se duplica **en
 * silencio**, que es la peor forma de que un control de seguridad falle.
 *
 * Estos tests instancian DOS storages contra la MISMA base a propósito: es la
 * simulación de las dos réplicas, y es lo único que prueba que el contador de
 * verdad se comparte.
 */
describe('Contador del límite en Postgres', () => {
  let db: DbService;
  let a: LimiteStoragePostgres;
  let b: LimiteStoragePostgres;
  let owner: Client;
  const previo = { ...process.env };

  const clave = (n: string) => `test:${n}:${Date.now()}:${Math.random()}`;

  beforeAll(async () => {
    process.env.RATE_LIMIT_EN_BASE = 'true';
    resetEnvCache();

    db = new DbService();
    await db.onModuleInit();

    // Dos instancias contra la misma base: las dos réplicas.
    a = new LimiteStoragePostgres(db);
    b = new LimiteStoragePostgres(db);

    owner = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await owner.connect();
  }, 60_000);

  afterAll(async () => {
    a?.onModuleDestroy();
    b?.onModuleDestroy();
    await owner?.query("DELETE FROM limite_intento WHERE clave LIKE 'test:%'");
    await owner?.end();
    await db?.onModuleDestroy();
    process.env = previo;
    resetEnvCache();
  });

  it('cuenta los intentos', async () => {
    const k = clave('cuenta');
    expect((await a.increment(k, 60_000, 3, 60_000, 'ip')).totalHits).toBe(1);
    expect((await a.increment(k, 60_000, 3, 60_000, 'ip')).totalHits).toBe(2);
    expect((await a.increment(k, 60_000, 3, 60_000, 'ip')).totalHits).toBe(3);
  });

  it('DOS instancias comparten la cuenta: es el punto de todo esto', async () => {
    const k = clave('compartido');

    // Alternadas, como dos réplicas atendiendo requests del mismo atacante.
    expect((await a.increment(k, 60_000, 4, 60_000, 'ip')).totalHits).toBe(1);
    expect((await b.increment(k, 60_000, 4, 60_000, 'ip')).totalHits).toBe(2);
    expect((await a.increment(k, 60_000, 4, 60_000, 'ip')).totalHits).toBe(3);
    expect((await b.increment(k, 60_000, 4, 60_000, 'ip')).totalHits).toBe(4);

    // Con el storage en memoria, cada una iría por 2 y ninguna bloquearía.
    const quinto = await b.increment(k, 60_000, 4, 60_000, 'ip');
    expect(quinto.totalHits).toBe(5);
    expect(quinto.isBlocked).toBe(true);
  });

  it('bloquea al pasarse del tope, y no antes', async () => {
    const k = clave('bloqueo');
    for (let i = 0; i < 3; i++) {
      expect((await a.increment(k, 60_000, 3, 60_000, 'ip')).isBlocked).toBe(false);
    }
    const r = await a.increment(k, 60_000, 3, 60_000, 'ip');
    expect(r.isBlocked).toBe(true);
    expect(r.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('el bloqueo NO se estira con cada reintento', async () => {
    // Si cada intento corriera el bloqueo, alguien que reintenta solo se
    // castigaría para siempre y nunca se destrabaría.
    const k = clave('no-estira');
    for (let i = 0; i < 4; i++) await a.increment(k, 60_000, 3, 30_000, 'ip');

    const primero = await a.increment(k, 60_000, 3, 30_000, 'ip');
    await new Promise((r) => setTimeout(r, 1100));
    const despues = await a.increment(k, 60_000, 3, 30_000, 'ip');

    expect(primero.isBlocked).toBe(true);
    expect(despues.isBlocked).toBe(true);
    // El tiempo que falta BAJÓ: el bloqueo sigue corriendo hacia su fin.
    expect(despues.timeToBlockExpire).toBeLessThan(primero.timeToBlockExpire);
  });

  it('la ventana vencida reinicia la cuenta y suelta el bloqueo', async () => {
    const k = clave('reinicia');
    // Ventana de 1 segundo para no dormir medio minuto en un test.
    for (let i = 0; i < 3; i++) await a.increment(k, 1_000, 2, 1_000, 'ip');
    expect((await a.increment(k, 1_000, 2, 1_000, 'ip')).isBlocked).toBe(true);

    await new Promise((r) => setTimeout(r, 1200));

    const nuevo = await a.increment(k, 1_000, 2, 1_000, 'ip');
    expect(nuevo.totalHits).toBe(1);
    expect(nuevo.isBlocked).toBe(false);
  });

  it('devuelve SEGUNDOS, no milisegundos', async () => {
    // La librería usa estos valores para el `Retry-After`. En milisegundos, el
    // usuario lee "probá de nuevo en 15000 minutos".
    const k = clave('unidades');
    const r = await a.increment(k, 60_000, 10, 60_000, 'ip');
    expect(r.timeToExpire).toBeGreaterThan(50);
    expect(r.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('cuenta bien con intentos en paralelo', async () => {
    // Leer y después escribir sería una condición de carrera: dos intentos
    // simultáneos leen el mismo número y escriben el mismo número. Va todo en
    // una sentencia justamente para que no pase.
    const k = clave('carrera');
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => a.increment(k, 60_000, 100, 60_000, 'ip')),
    );

    const vistos = resultados.map((r) => r.totalHits).sort((x, y) => x - y);
    expect(vistos).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('claves distintas no se pisan', async () => {
    const uno = clave('a');
    const dos = clave('b');
    await a.increment(uno, 60_000, 5, 60_000, 'ip');
    await a.increment(uno, 60_000, 5, 60_000, 'ip');
    expect((await a.increment(dos, 60_000, 5, 60_000, 'ip')).totalHits).toBe(1);
  });
});
