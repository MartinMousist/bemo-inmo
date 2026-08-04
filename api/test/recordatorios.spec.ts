import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Etapa 7 — recordatorios.
 *
 * Lo importante de estos tests es la IDEMPOTENCIA: el generador va a correr en
 * un cron, los crons se reintentan, y un aviso duplicado le llega dos veces al
 * inquilino.
 */
describe('Recordatorios', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('rec', tk);
    otra = await crearInmobiliaria('recvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Un contrato que vence en 60 días, para que caiga en la ventana de avisos. */
  async function contratoQueVence(diasParaVencer: number, i = inmo) {
    const hoy = new Date();
    const fin = new Date(hoy.getTime() + diasParaVencer * 86_400_000);
    const inicio = new Date(fin.getTime() - 730 * 86_400_000);

    const prop = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle: `Vence ${Math.random().toString(36).slice(2, 8)}`, numero: '10', tipo: 'casa' })
      .expect(201);

    const c = await http().post('/v1/contratos').set(...como(i))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: inicio.toISOString().slice(0, 10),
        fechaFin: fin.toISOString().slice(0, 10),
        montoInicial: 300000, moneda: 'ARS', indice: 'ninguno', honorariosPct: 8,
      })
      .expect(201);

    return c.body;
  }

  it('genera el aviso de un contrato por vencer', async () => {
    await contratoQueVence(60);

    const r = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    expect(r.body.contrato_por_vencer).toBeGreaterThanOrEqual(1);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const aviso = bandeja.body.items.find((e: { tipo: string }) => e.tipo === 'contrato_por_vencer');
    expect(aviso).toBeDefined();
    expect(aviso.titulo).toContain('Vence el contrato');
  });

  it('generar dos veces NO duplica avisos', async () => {
    await contratoQueVence(45);

    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    const antes = (await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200))
      .body.total;

    // El cron se reintenta: correrlo otra vez no puede mandar el aviso de nuevo.
    const segunda = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    const despues = (await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200))
      .body.total;

    expect(despues).toBe(antes);
    expect(Object.values(segunda.body).every((n) => n === 0)).toBe(true);
  });

  it('un contrato con 90/60/30 genera los tres avisos, en fechas distintas', async () => {
    const c = await contratoQueVence(95);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const suyos = bandeja.body.items.filter(
      (e: { entidadId: string; tipo: string }) =>
        e.entidadId === c.id && e.tipo === 'contrato_por_vencer',
    );

    expect(suyos).toHaveLength(3);
    const fechas = suyos.map((e: { disparaEl: string }) => e.disparaEl);
    expect(new Set(fechas).size).toBe(3);
  });

  it('la bandeja por defecto muestra sólo lo que ya llegó', async () => {
    await contratoQueVence(200);   // ningún aviso cae hoy
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const hoy = await http().get('/v1/avisos').set(...como(inmo)).expect(200);
    const futuros = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);

    expect(futuros.body.total).toBeGreaterThan(hoy.body.total);
    // Nada de la bandeja de hoy tiene fecha futura.
    const hoyIso = new Date().toISOString().slice(0, 10);
    expect(hoy.body.items.every((e: { disparaEl: string }) => e.disparaEl <= hoyIso)).toBe(true);
  });

  it('marcar visto lo saca de la bandeja', async () => {
    await contratoQueVence(30);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const uno = bandeja.body.items[0];

    await http().post(`/v1/avisos/${uno.id}/visto`).set(...como(inmo)).expect(201);
    await http().post(`/v1/avisos/${uno.id}/visto`).set(...como(inmo)).expect(404);

    const luego = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    expect(luego.body.items.find((e: { id: string }) => e.id === uno.id)).toBeUndefined();
  });

  it('avisa las cuotas impagas el día que vencen y en la mora', async () => {
    const c = await contratoQueVence(300);
    await http().post(`/v1/contratos/${c.id}/periodos/generar`)
      .set(...como(inmo)).send({}).expect(201);

    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const impagas = bandeja.body.items.filter((e: { tipo: string }) => e.tipo === 'cuota_impaga');
    expect(impagas.length).toBeGreaterThan(0);
    expect(impagas[0].detalle).toMatch(/ARS/);
  });

  it('los canales dicen la verdad sobre lo que se puede enviar hoy', async () => {
    const res = await http().get('/v1/avisos/canales').set(...como(inmo)).expect(200);

    const app_ = res.body.find((c: { canal: string }) => c.canal === 'app');
    const wa = res.body.find((c: { canal: string }) => c.canal === 'whatsapp');

    expect(app_.disponible).toBe(true);
    // WhatsApp NO está disponible y la razón es un trámite, no código.
    expect(wa.disponible).toBe(false);
    expect(wa.detalle).toContain('verificación de negocio');
  });

  it('cero fuga: la vecina no ve avisos ajenos', async () => {
    await contratoQueVence(50, inmo);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const res = await http().get('/v1/avisos?futuros=true').set(...como(otra)).expect(200);
    expect(res.body.items).toHaveLength(0);
    // El total también tiene que ser cero: si contara sobre todos los tenants,
    // la vecina vería una lista vacía pero sabría cuántos avisos tenemos.
    expect(res.body.total).toBe(0);
  });

  it('la clave única impide un duplicado incluso por SQL directo', async () => {
    await contratoQueVence(40);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (
           SELECT tipo, entidad_id, dispara_el, canal, count(*)
             FROM evento_programado
            GROUP BY 1,2,3,4 HAVING count(*) > 1) d`,
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await c.end();
    }
  });
});
