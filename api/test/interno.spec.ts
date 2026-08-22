import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * Mensajes entre la gente de la oficina.
 *
 * Lo que se prueba: que un hilo se reuse en vez de multiplicarse, que el no
 * leído sea POR PERSONA, y que nadie lea un hilo del que no participa.
 */
describe('Mensajes internos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('interno', tk);
    otra = await crearInmobiliaria('internovecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const abrirCon = async (rol: 'admin' | 'agente') => {
    const r = await http().post('/v1/interno/hilos').set(...como(inmo))
      .send({ conQuienes: [inmo.usuarios[rol]] }).expect(201);
    return r.body.id as string;
  };

  it('un hilo con la misma persona se REUSA, no se duplica', async () => {
    // Sin esto, escribirle tres veces a la misma persona deja tres hilos con la
    // misma cara en la lista y la conversación partida en pedazos.
    const uno = await abrirCon('agente');
    const dos = await abrirCon('agente');
    expect(dos).toBe(uno);

    const hilos = await http().get('/v1/interno/hilos').set(...como(inmo)).expect(200);
    expect(hilos.body.filter((h: { id: string }) => h.id === uno)).toHaveLength(1);
  });

  it('el mensaje lleva a qué se refiere, no una URL', async () => {
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Del Mensaje', localidad: 'Ciudad', tipo: 'casa' }).expect(201);

    const hilo = await abrirCon('agente');
    await http().post(`/v1/interno/hilos/${hilo}`).set(...como(inmo))
      .send({ texto: 'Mirá esta, la quiere el cliente del jueves.',
              refTipo: 'propiedad', refId: prop.body.id })
      .expect(201);

    const msgs = await http().get(`/v1/interno/hilos/${hilo}`).set(...como(inmo)).expect(200);
    const ultimo = msgs.body[msgs.body.length - 1];
    expect(ultimo.refTipo).toBe('propiedad');
    expect(ultimo.refId).toBe(prop.body.id);
    expect(ultimo.mio).toBe(true);
  });

  it('un tipo de referencia sin id se rechaza', async () => {
    // Un tipo sin id no lleva a ningún lado, y la base tiene el mismo CHECK.
    const hilo = await abrirCon('agente');
    await http().post(`/v1/interno/hilos/${hilo}`).set(...como(inmo))
      .send({ texto: 'Rota', refTipo: 'propiedad' })
      .expect(400);
  });

  /**
   * El no leído es POR PARTICIPANTE.
   *
   * Que un compañero abra el hilo no lo marca leído para el resto — que es lo
   * que pasaría con un solo `leido_el` en el hilo.
   */
  it('el sin-leer es de cada persona, no del hilo', async () => {
    const hilo = await abrirCon('agente');
    await http().post(`/v1/interno/hilos/${hilo}`).set(...como(inmo))
      .send({ texto: 'Che, ¿lo llamaste?' }).expect(201);

    // Quien escribió no tiene nada sin leer.
    const mio = await http().get('/v1/interno/sin-leer').set(...como(inmo)).expect(200);
    expect(mio.body.total).toBe(0);

    // El otro sí.
    const suyo = await http().get('/v1/interno/sin-leer').set(...como(inmo, 'agente')).expect(200);
    expect(suyo.body.total).toBeGreaterThan(0);

    // Y leerlo lo baja: leer ES marcar leído, sin un botón aparte que nadie
    // toca y un contador que nunca baja.
    await http().get(`/v1/interno/hilos/${hilo}`).set(...como(inmo, 'agente')).expect(200);
    const despues = await http().get('/v1/interno/sin-leer').set(...como(inmo, 'agente')).expect(200);
    expect(despues.body.total).toBe(0);
  });

  it('un hilo del que no participás da 404, no 403', async () => {
    // Que exista o no tampoco te corresponde saberlo.
    const hilo = await abrirCon('agente');
    await http().get(`/v1/interno/hilos/${hilo}`).set(...como(inmo, 'contable')).expect(404);
    await http().post(`/v1/interno/hilos/${hilo}`).set(...como(inmo, 'contable'))
      .send({ texto: 'Hola' }).expect(404);
  });

  it('cero fuga: la inmobiliaria vecina no ve ni un hilo', async () => {
    await abrirCon('agente');
    const suyos = await http().get('/v1/interno/hilos').set(...como(otra)).expect(200);
    expect(suyos.body).toEqual([]);
  });

  it('un hilo con nadie más que vos no tiene sentido', async () => {
    const r = await http().post('/v1/interno/hilos').set(...como(inmo))
      .send({ conQuienes: [inmo.usuarios.owner] }).expect(400);
    expect(r.body.detail).toContain('con quién');
  });
});
