import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El historial de precio (migración 030) y las consultas por mes.
 *
 * Lo que importa acá es que el registro lo haga el TRIGGER y no el servicio:
 * el precio se escribe desde la ficha, desde la edición de la operación, desde
 * el importador CSV y desde el seed, y un registro en la capa de aplicación
 * deja tres de esos caminos afuera. Los tests escriben por la API y comprueban
 * que la historia quedó igual.
 */
describe('Historial de precio y consultas', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let propiedadId = '';
  let operacionId = '';

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('histprecio', tk);
    otra = await crearInmobiliaria('histpreciovecina', tk);

    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Historial 100', tipo: 'departamento' }).expect(201);
    propiedadId = prop.body.id;

    const op = await http().post(`/v1/propiedades/${propiedadId}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio: 100000, moneda: 'USD', estado: 'disponible' })
      .expect(201);
    operacionId = op.body.operaciones[0].id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const historial = (i = inmo, op = operacionId) =>
    http().get(`/v1/propiedades/${propiedadId}/operaciones/${op}/historial`).set(...como(i));

  it('crear la operación ya deja su precio inicial', async () => {
    const r = await historial().expect(200);
    expect(r.body.precios).toHaveLength(1);
    expect(r.body.precios[0].precio).toBe(100000);
    expect(r.body.precios[0].moneda).toBe('USD');
  });

  it('cada cambio de precio agrega una fila, en orden', async () => {
    await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}`)
      .set(...como(inmo)).send({ precio: 90000 }).expect(200);
    await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}`)
      .set(...como(inmo)).send({ precio: 85000 }).expect(200);

    const r = await historial().expect(200);
    expect(r.body.precios.map((x: { precio: number }) => x.precio)).toEqual([100000, 90000, 85000]);
  });

  it('guardar el MISMO precio no ensucia la historia', async () => {
    const antes = (await historial().expect(200)).body.precios.length;
    await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}`)
      .set(...como(inmo)).send({ precio: 85000 }).expect(200);

    // Si cada guardado dejara una fila, «bajó tres veces» sería indistinguible
    // de «alguien abrió Editar y apretó Guardar tres veces».
    const despues = (await historial().expect(200)).body.precios.length;
    expect(despues).toBe(antes);
  });

  it('cambiar la MONEDA también es un cambio de precio', async () => {
    // USD 85.000 y ARS 85.000 no son el mismo precio. Con `<>` en vez de
    // `IS DISTINCT FROM` esto se registraba igual, pero el caso de NULL no.
    const antes = (await historial().expect(200)).body.precios.length;
    await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}`)
      .set(...como(inmo)).send({ precio: 85000, moneda: 'ARS' }).expect(200);

    const r = await historial().expect(200);
    expect(r.body.precios.length).toBe(antes + 1);
    expect(r.body.precios[r.body.precios.length - 1].moneda).toBe('ARS');
  });

  describe('consultas', () => {
    it('cuenta los leads que entraron por esta operación, agrupados por mes', async () => {
      const persona = (await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Consulta', apellido: 'Uno' }).expect(201)).body.id;

      await http().post('/v1/oportunidades').set(...como(inmo))
        .send({ personaId: persona, operacionId, origen: 'web', interes: 'venta' })
        .expect(201);

      const r = await historial().expect(200);
      expect(r.body.consultas).toHaveLength(1);
      expect(r.body.consultas[0].total).toBe(1);
      // `YYYY-MM`, no una fecha: la pregunta es por mes.
      expect(r.body.consultas[0].mes).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('permisos y aislamiento', () => {
    it('el asesor la ve: es lo que necesita para sugerir una baja', async () => {
      await historial(inmo).expect(200);
      await http().get(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/historial`)
        .set(...como(inmo, 'agente')).expect(200);
    });

    it('cero fuga: la vecina no ve la historia de una operación ajena', async () => {
      await historial(otra).expect(404);
    });

    it('una operación que no es de esta propiedad da 404', async () => {
      // RLS corta entre inmobiliarias, no adentro de una: sin este chequeo,
      // acertando el uuid de una propiedad propia se leería la historia de
      // cualquier otra operación del mismo tenant.
      const otraProp = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Historial 200', tipo: 'casa' }).expect(201);

      await http()
        .get(`/v1/propiedades/${otraProp.body.id}/operaciones/${operacionId}/historial`)
        .set(...como(inmo)).expect(404);
    });
  });
});
