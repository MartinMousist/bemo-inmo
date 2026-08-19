import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * La agenda de visitas y su recordatorio (migración 034).
 *
 * `visita` existe desde la 006 y agendar ya funcionaba: lo que faltaba era
 * poder PREGUNTAR qué hay por delante, y el aviso —cuyo tipo estaba declarado
 * en el CHECK de la 010 y no emitía nadie—.
 */
describe('Agenda de visitas', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let oportunidadId = '';

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Una fecha a N días de hoy, a las 16:00. */
  const enDias = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(16, 0, 0, 0);
    return d.toISOString();
  };

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('agenda', tk);
    otra = await crearInmobiliaria('agendavecina', tk);

    const persona = (await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Visitante', apellido: 'Agenda' }).expect(201)).body.id;

    oportunidadId = (await http().post('/v1/oportunidades').set(...como(inmo))
      .send({ personaId: persona, origen: 'web', interes: 'alquiler' })
      .expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const agenda = (q = '', i = inmo, rol: 'owner' | 'agente' = 'owner') =>
    http().get(`/v1/oportunidades/agenda${q}`).set(...como(i, rol));

  it('la ruta literal no la captura `:id`', async () => {
    // `@Get('agenda')` va declarado ANTES de `@Get(':id')`: Nest resuelve en
    // orden, y al revés «agenda» entra como id y el ParseUUIDPipe contesta
    // «uuid is expected». Pasó, y por eso hay test.
    await agenda().expect(200);
  });

  it('trae lo agendado hacia adelante, ordenado por fecha', async () => {
    await http().post(`/v1/oportunidades/${oportunidadId}/visitas`).set(...como(inmo))
      .send({ fechaHora: enDias(3) }).expect(201);
    await http().post(`/v1/oportunidades/${oportunidadId}/visitas`).set(...como(inmo))
      .send({ fechaHora: enDias(1) }).expect(201);

    const r = await agenda().expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].fechaHora < r.body[1].fechaHora).toBe(true);
    expect(r.body[0].persona).toContain('Visitante');
  });

  it('lo que ya pasó NO es agenda', async () => {
    await http().post(`/v1/oportunidades/${oportunidadId}/visitas`).set(...como(inmo))
      .send({ fechaHora: enDias(-5) }).expect(201);

    const r = await agenda().expect(200);
    // Sigue habiendo dos: la de hace cinco días no entra.
    expect(r.body).toHaveLength(2);
  });

  it('una visita cancelada o realizada sale de la agenda', async () => {
    const v = await http().post(`/v1/oportunidades/${oportunidadId}/visitas`)
      .set(...como(inmo)).send({ fechaHora: enDias(2) }).expect(201);

    const antes = (await agenda().expect(200)).body.length;

    // La visita nueva es la última del array de la oportunidad.
    const visitas = v.body.visitas as Array<{ id: string; fechaHora: string }>;
    const nueva = visitas.reduce((a, b) => (a.fechaHora > b.fechaHora ? a : b));

    await http().patch(`/v1/oportunidades/${oportunidadId}/visitas/${nueva.id}`)
      .set(...como(inmo)).send({ estado: 'cancelada' }).expect(200);

    const despues = (await agenda().expect(200)).body.length;
    expect(despues).toBe(antes - 1);
  });

  it('el rango se puede acotar con `dias`', async () => {
    const corta = await agenda('?dias=2').expect(200);
    const larga = await agenda('?dias=30').expect(200);
    expect(corta.body.length).toBeLessThan(larga.body.length);
  });

  it('cero fuga: la vecina no ve las visitas ajenas', async () => {
    const r = await agenda('', otra).expect(200);
    expect(r.body).toEqual([]);
  });

  it('el asesor la ve: es su pantalla de trabajo', async () => {
    await agenda('', inmo, 'agente').expect(200);
  });

  describe('el recordatorio', () => {
    it('se emite para las visitas agendadas y aparece en la bandeja', async () => {
      // El tipo estaba en el CHECK desde la 010 y no lo emitía nadie.
      const gen = await http().post('/v1/avisos/generar').set(...como(inmo))
        .send({}).expect(201);
      expect(gen.body.visita_agendada).toBeGreaterThan(0);

      const bandeja = await http().get('/v1/avisos?porPagina=60')
        .set(...como(inmo)).expect(200);
      const visitas = bandeja.body.items.filter(
        (a: { tipo: string }) => a.tipo === 'visita_agendada',
      );
      expect(visitas.length).toBeGreaterThan(0);
    });

    it('generar dos veces no duplica: la clave es idempotente', async () => {
      // Un cron se reintenta, y un aviso duplicado le llega dos veces a alguien.
      const antes = (await http().get('/v1/avisos?porPagina=60')
        .set(...como(inmo)).expect(200)).body.total;

      await http().post('/v1/avisos/generar').set(...como(inmo)).send({}).expect(201);

      const despues = (await http().get('/v1/avisos?porPagina=60')
        .set(...como(inmo)).expect(200)).body.total;
      expect(despues).toBe(antes);
    });
  });
});
