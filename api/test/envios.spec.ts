import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * Enviarle una selección de propiedades a un cliente.
 *
 * El enlace se abre SIN sesión, así que la mitad de esta suite es sobre el
 * borde: qué se ve, qué no, y qué pasa cuando el token no sirve.
 */
describe('Envío de propiedades a un cliente', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('envios', tk);
    otra = await crearInmobiliaria('enviosvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  async function crearPropiedad(i: Inmobiliaria, calle: string): Promise<string> {
    const p = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle, numero: '100', localidad: 'Ciudad', tipo: 'departamento', ambientes: 3 })
      .expect(201);
    await http().post(`/v1/propiedades/${p.body.id}/operaciones`).set(...como(i))
      .send({ tipo: 'venta', precio: 120000, moneda: 'USD', estado: 'disponible' })
      .expect(201);
    return p.body.id;
  }

  it('el cliente abre el enlace sin cuenta y ve las fichas en el orden elegido', async () => {
    const a = await crearPropiedad(inmo, 'Primera');
    const b = await crearPropiedad(inmo, 'Segunda');

    const envio = await http().post('/v1/envios').set(...como(inmo, 'agente'))
      .send({
        // El orden importa: la primera es la que más le cierra al cliente.
        propiedades: [b, a],
        contactoNombre: 'Familia Gómez',
        titulo: 'Tres opciones en Ciudad',
        mensaje: 'Mirá estas dos, la de Segunda me parece la mejor.',
      })
      .expect(201);

    expect(envio.body.token).toHaveLength(30); // 22 bytes en base64url
    expect(envio.body.propiedades).toBe(2);

    // Sin token de sesión: exactamente como lo abre el cliente.
    const vista = await http().get(`/v1/seleccion/${envio.body.token}`).expect(200);

    expect(vista.body.inmobiliaria).toBe(inmo.nombre);
    expect(vista.body.titulo).toBe('Tres opciones en Ciudad');
    expect(vista.body.propiedades).toHaveLength(2);
    expect(vista.body.propiedades[0].zona).toContain('Segunda');
    expect(vista.body.propiedades[1].zona).toContain('Primera');
    expect(vista.body.propiedades[0].precio).toBe(120000);
  });

  /**
   * Lo que hace que esto valga más que mandar capturas: el asesor sabe a quién
   * llamar. Sin esto es un PDF.
   */
  it('registra que lo abrió y cuántas veces', async () => {
    const a = await crearPropiedad(inmo, 'Vistas');
    const envio = await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: [a], contactoNombre: 'Curioso' }).expect(201);

    const antes = (await http().get('/v1/envios').set(...como(inmo)).expect(200))
      .body.find((e: { id: string }) => e.id === envio.body.id);
    expect(antes.vistas).toBe(0);
    expect(antes.abiertoEl).toBeNull();

    await http().get(`/v1/seleccion/${envio.body.token}`).expect(200);
    await http().get(`/v1/seleccion/${envio.body.token}`).expect(200);

    const despues = (await http().get('/v1/envios').set(...como(inmo)).expect(200))
      .body.find((e: { id: string }) => e.id === envio.body.id);
    expect(despues.vistas).toBe(2);
    // `abiertoEl` es la PRIMERA vez, no la última: es la que dice cuánto tardó
    // el cliente en mirarlo.
    expect(despues.abiertoEl).not.toBeNull();
  });

  it('la ficha pública no trae el titular ni lo que se le cobra a la inmobiliaria', async () => {
    const dueno = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Marta', apellido: 'Quiroga' }).expect(201);
    const a = await crearPropiedad(inmo, 'Reservada');
    await http().put(`/v1/propiedades/${a}`).set(...como(inmo))
      .send({ titularId: dueno.body.id })
      .expect((r) => { if (![200, 400, 404].includes(r.status)) throw new Error(String(r.status)); });

    const envio = await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: [a] }).expect(201);
    const vista = await http().get(`/v1/seleccion/${envio.body.token}`).expect(200);

    const texto = JSON.stringify(vista.body);
    expect(texto).not.toContain('Quiroga');
    expect(texto).not.toContain('comision');
    expect(texto).not.toContain('captador');
  });

  it('un token inventado y uno vencido dan el mismo error', async () => {
    const inventado = await http().get('/v1/seleccion/noexisteestetoken').expect(404);

    const a = await crearPropiedad(inmo, 'Caducada');
    const envio = await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: [a], diasValidez: 1 }).expect(201);

    // Se lo empuja al pasado por la base: es la única forma de probar el
    // vencimiento sin esperar un día.
    await http().get(`/v1/seleccion/${envio.body.token}`).expect(200);
    const { DbService } = await import('../src/database/db.service');
    const db = app.get(DbService);
    // Con `withTenant` y no con un query suelto: sin contexto de tenant, RLS no
    // deja tocar la fila y el UPDATE afecta cero filas EN SILENCIO. La primera
    // versión de este test hacía justo eso y daba un falso fallo.
    await db.withTenant(inmo.tenantId, (ej) =>
      ej.query(
        'UPDATE envio_propiedades SET vence_el = current_date - 1 WHERE token = $1',
        [envio.body.token],
      ),
    );

    const vencido = await http().get(`/v1/seleccion/${envio.body.token}`).expect(404);

    // Mismo código y mismo texto: distinguirlos le confirmaría a quien prueba
    // enlaces al azar que ése existió.
    expect(vencido.body.code).toBe(inventado.body.code);
    expect(vencido.body.detail).toBe(inventado.body.detail);
  });

  it('no se puede armar un envío con una propiedad de otra inmobiliaria', async () => {
    const ajena = await crearPropiedad(otra, 'Ajena');
    await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: [ajena] })
      .expect(404);
  });

  it('el envío no cruza inmobiliarias: la vecina no lo ve en su lista', async () => {
    const a = await crearPropiedad(inmo, 'Propia');
    const envio = await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: [a] }).expect(201);

    const lista = await http().get('/v1/envios').set(...como(otra)).expect(200);
    expect(lista.body.some((e: { id: string }) => e.id === envio.body.id)).toBe(false);

    await http().delete(`/v1/envios/${envio.body.id}`).set(...como(otra)).expect(404);
  });

  it('un envío de treinta y una fichas no es una selección: se rechaza', async () => {
    const a = await crearPropiedad(inmo, 'Tope');
    await http().post('/v1/envios').set(...como(inmo))
      .send({ propiedades: Array.from({ length: 31 }, () => a) })
      .expect(400);
  });
});
