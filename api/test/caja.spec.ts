import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * La caja del día.
 *
 * Esta suite existe por una sola cosa que se vio abriendo la pantalla: la
 * lista salía 13/08, 14/08, 08/08, 05/08, 12/08. Estaba ordenada por
 * `created_at` —cuándo se CARGÓ la fila— mientras la columna que se muestra es
 * `fecha`, cuándo entró la plata.
 *
 * Los dos datos divergen apenas alguien registra el lunes el cobro del viernes,
 * que es lo normal. Y una caja fuera de orden no sólo es incómoda: parece que
 * faltaran movimientos.
 */
describe('Caja del día', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('caja', app.get(TokensService));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const desplazar = (dias: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const enAnios = (n: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + n);
    return d.toISOString().slice(0, 10);
  };

  let periodos: Array<{ id: string }> = [];

  beforeAll(async () => {
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Caja', numero: '1', localidad: 'Ciudad', tipo: 'departamento' })
      .expect(201);
    const dueno = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Dueña', apellido: 'Caja' }).expect(201);
    const inq = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Inquilino', apellido: 'Caja' }).expect(201);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: enAnios(-1),
        fechaFin: enAnios(1),
        montoInicial: 400000,
        moneda: 'ARS',
        indice: 'ninguno',
        mesBase: `${enAnios(-1).slice(0, 7)}-01`,
        honorariosPct: 10,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inq.body.id],
      })
      .expect(201);

    await http().post(`/v1/contratos/${c.body.id}/periodos/generar`).set(...como(inmo))
      .send({ hasta: `${new Date().toISOString().slice(0, 7)}-01` }).expect(201);

    const r = await http().get(`/v1/contratos/${c.body.id}/periodos?porPagina=100`)
      .set(...como(inmo)).expect(200);
    periodos = r.body.items;
    expect(periodos.length).toBeGreaterThanOrEqual(4);
  }, 60_000);

  /**
   * El caso que motivó la suite.
   *
   * Los cobros se registran DESORDENADOS a propósito —primero el del día -2,
   * después el del -8, después el de hoy— porque así es como pasa en la vida:
   * alguien se acuerda el lunes de que el viernes entró plata. Si la lista
   * saliera en el orden en que se cargaron, esto la delata.
   */
  it('los movimientos salen por FECHA, no por cuándo se cargaron', async () => {
    const registrar = (i: number, fecha: string, monto: number) =>
      http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: periodos[i].id, monto, fecha, medio: 'efectivo' })
        .expect(201);

    await registrar(0, desplazar(-2), 1000);
    await registrar(1, desplazar(-8), 2000);
    await registrar(2, desplazar(0), 3000);
    await registrar(3, desplazar(-5), 4000);

    const r = await http().get(`/v1/caja?desde=${desplazar(-30)}&hasta=${desplazar(0)}`)
      .set(...como(inmo)).expect(200);

    const fechas = (r.body.movimientos as Array<{ fecha: string }>)
      .map((m) => String(m.fecha).slice(0, 10));

    expect(fechas).toEqual([
      desplazar(0), desplazar(-2), desplazar(-5), desplazar(-8),
    ]);

    // Y comparado consigo mismo: la lista tiene que estar ordenada, no sólo
    // coincidir con una expectativa escrita a mano.
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it('el total de lo que entró no depende del orden', async () => {
    const r = await http().get(`/v1/caja?desde=${desplazar(-30)}&hasta=${desplazar(0)}`)
      .set(...como(inmo)).expect(200);

    const ars = (r.body.totales as Array<{ moneda: string; monto: number }>)
      .find((x) => x.moneda === 'ARS');
    expect(ars?.monto).toBe(10000);
  });

  it('un asesor no ve la caja: es la cobranza de la inmobiliaria', async () => {
    await http().get('/v1/caja').set(...como(inmo, 'agente')).expect(403);
  });
});
