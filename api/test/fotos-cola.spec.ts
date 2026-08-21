import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { DbService } from '../src/database/db.service';
import { FotosColaService } from '../src/importar/fotos-cola.service';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * La cola de fotos del importador.
 *
 * Lo que se prueba acá es la parte que sale a internet. El filtro de URLs vive
 * en `url-imagen-motor.spec.ts` y se prueba en una mesa; esto comprueba que el
 * worker lo USE, que no se cuelgue con lo que no puede bajar, y que lo que
 * falla quede con su motivo escrito en vez de desaparecer.
 */
describe('Cola de fotos por bajar', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let cola: FotosColaService;
  let db: DbService;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('fotoscola', app.get(TokensService));
    cola = app.get(FotosColaService);
    db = app.get(DbService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const pendientes = (propiedadId: string) =>
    db.withTenant(inmo.tenantId, async (ej) => {
      const { rows } = await ej.query<{ url: string; estado: string; ultimo_error: string | null }>(
        'SELECT url, estado, ultimo_error FROM foto_pendiente WHERE propiedad_id = $1 ORDER BY orden',
        [propiedadId],
      );
      return rows;
    });

  async function importar(csv: string) {
    const r = await http().post('/v1/importar').set(...como(inmo))
      .send({ recurso: 'propiedades', csv }).expect(201);
    return r.body as { importadas: number };
  }

  /**
   * Deja la cola con lo de UNA sola propiedad.
   *
   * El worker toma de a cinco, y las filas que dejaron los tests anteriores
   * llenan la tanda: sin esto, `drenar()` no llega a la fila que se está
   * probando y el test falla por una razón que no tiene nada que ver.
   */
  const dejarSolo = (propiedadId: string) =>
    db.withTenant(inmo.tenantId, (ej) =>
      ej.query('DELETE FROM foto_pendiente WHERE propiedad_id <> $1', [propiedadId]));

  async function idDe(q: string): Promise<string> {
    const r = await http().get(`/v1/propiedades?q=${encodeURIComponent(q)}`)
      .set(...como(inmo)).expect(200);
    return r.body.items[0].id as string;
  }

  it('la importación encola las fotos y devuelve YA: no las baja en el request', async () => {
    const csv =
      'calle;localidad;tipo;fotos\n' +
      'Con Fotos;Ciudad;casa;https://cdn.ejemplo.com/a.jpg|https://cdn.ejemplo.com/b.jpg\n';

    const inicio = Date.now();
    const r = await importar(csv);
    // Sin la cola, esto saldría a internet dos veces antes de contestar.
    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(r.importadas).toBe(1);

    const cola = await pendientes(await idDe('Con Fotos'));
    expect(cola.map((c) => c.url)).toEqual([
      'https://cdn.ejemplo.com/a.jpg',
      'https://cdn.ejemplo.com/b.jpg',
    ]);
  });

  it('reimportar la misma planilla no duplica las fotos', async () => {
    // Reimportar es algo que la gente hace —corrigió una columna y la manda de
    // nuevo—. Sin el `ON CONFLICT`, cada vuelta agrega las mismas ocho.
    const csv =
      'calle;localidad;tipo;fotos\n' +
      'Repetida;Ciudad;casa;https://cdn.ejemplo.com/x.jpg\n';
    await importar(csv);
    const id = await idDe('Repetida');
    const antes = await pendientes(id);

    await http().post('/v1/importar').set(...como(inmo))
      .send({ recurso: 'propiedades', csv: `calle;localidad;tipo;fotos\nRepetida;Ciudad;casa;https://cdn.ejemplo.com/x.jpg\n` })
      .expect(201);

    // La segunda importación crea otra propiedad —no deduplica propiedades— así
    // que lo que se comprueba es que la PRIMERA no acumuló.
    expect(await pendientes(id)).toHaveLength(antes.length);
  });

  it('separa por barra o por espacios, no por coma', async () => {
    // La coma ya separa columnas en la planilla: una lista de URLs con comas
    // adentro de un campo entrecomillado es donde se rompen los parsers ajenos.
    await importar(
      'calle;localidad;tipo;fotos\n' +
      'Separadas;Ciudad;casa;https://cdn.ejemplo.com/1.jpg https://cdn.ejemplo.com/2.jpg\n',
    );
    expect(await pendientes(await idDe('Separadas'))).toHaveLength(2);
  });

  /**
   * El caso que justifica todo el filtro.
   *
   * `169.254.169.254` devuelve las credenciales de la instancia a quien
   * pregunte desde adentro. El worker tiene que rechazarla ANTES de conectar y
   * dejar el motivo escrito.
   */
  it('no sale a buscar una foto apuntada a la red interna', async () => {
    await importar(
      'calle;localidad;tipo;fotos\n' +
      'Maliciosa;Ciudad;casa;http://169.254.169.254/latest/meta-data/\n',
    );
    const id = await idDe('Maliciosa');
    await dejarSolo(id);

    await cola.drenar();

    const [f] = await pendientes(id);
    expect(f.ultimo_error).toContain('URL rechazada');
    expect(f.ultimo_error).toContain('ip-privada');
  });

  it('a la tercera se da por vencida y deja de reintentar', async () => {
    await importar(
      'calle;localidad;tipo;fotos\n' +
      'Insistente;Ciudad;casa;file:///etc/passwd\n',
    );
    const id = await idDe('Insistente');
    await dejarSolo(id);

    // El worker espera diez minutos entre intentos, así que se los cuenta a
    // mano en vez de esperar media hora.
    for (let i = 0; i < 3; i++) {
      await db.withTenant(inmo.tenantId, (ej) =>
        ej.query('UPDATE foto_pendiente SET intentado_el = NULL WHERE propiedad_id = $1', [id]));
      await cola.drenar();
    }

    const [f] = await pendientes(id);
    expect(f.estado).toBe('fallida');
    expect(f.ultimo_error).toContain('esquema');
  });

  it('lo que falló queda con su motivo, no desaparece', async () => {
    // «No bajó ninguna foto» sin decir por qué es peor que no intentarlo.
    const filas = await db.withTenant(inmo.tenantId, async (ej) => {
      const { rows } = await ej.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM foto_pendiente
          WHERE ultimo_error IS NOT NULL`,
      );
      return rows;
    });
    expect(Number(filas[0].n)).toBeGreaterThan(0);
  });

  it('sin columna de fotos no encola nada', async () => {
    await importar('calle;localidad;tipo\nSin Fotos;Ciudad;casa\n');
    expect(await pendientes(await idDe('Sin Fotos'))).toHaveLength(0);
  });
});
