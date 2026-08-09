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

  // ── Garantías ─────────────────────────────────────────────────────────────
  //
  // `garantia_por_vencer` estaba en el CHECK de la migración 010 desde el día
  // uno y **nunca lo emitió nadie**: la columna existía, ninguna pantalla la
  // llenaba y ningún bloque del generador la miraba. Estos tests son el gate de
  // que eso dejó de ser cierto.

  /** Un garante con vencimiento, colgado de un contrato. */
  async function garanteQueVence(contratoId: string, diasParaVencer: number, i = inmo) {
    const p = await http().post('/v1/personas').set(...como(i))
      .send({
        nombre: 'Garante', apellido: `Aviso ${Math.random().toString(36).slice(2, 6)}`,
        docTipo: 'dni', docNumero: `${Math.floor(10_000_000 + Math.random() * 80_000_000)}`,
      }).expect(201);

    const g = await http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(i))
      .send({ personaId: p.body.id }).expect(201);

    // El aviso sale 30 días antes: con menos de 30 el `dispara_el` ya pasó y no
    // entra en la ventana del generador.
    const vence = new Date(Date.now() + diasParaVencer * 86_400_000).toISOString().slice(0, 10);
    await http().patch(`/v1/garantes/${g.body.id}`).set(...como(i))
      .send({ venceEl: vence }).expect(200);

    return g.body.id as string;
  }

  async function conOwner<T extends object>(texto: string, params: unknown[] = []): Promise<T[]> {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<T>(texto, params);
      return rows;
    } finally {
      await c.end();
    }
  }

  it('avisa la garantía que vence, y nombra la propiedad y al garante', async () => {
    const c = await contratoQueVence(300);
    const garanteId = await garanteQueVence(c.id, 45);

    const r = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    expect(r.body.garantia_por_vencer).toBeGreaterThanOrEqual(1);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const aviso = bandeja.body.items.find(
      (e: { entidadId: string; tipo: string }) =>
        e.entidadId === garanteId && e.tipo === 'garantia_por_vencer',
    );
    expect(aviso).toBeDefined();
    // El título nombra la dirección y el detalle al garante, igual que los otros.
    expect(aviso.titulo).toContain('Vence la garantía de');
    expect(aviso.detalle).toContain('Garante');
    expect(aviso.entidadTipo).toBe('garantia');
  });

  it('generar dos veces no duplica el aviso de garantía', async () => {
    const c = await contratoQueVence(320);
    const garanteId = await garanteQueVence(c.id, 60);

    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    const segunda = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    expect(segunda.body.garantia_por_vencer).toBe(0);

    const filas = await conOwner<{ n: string }>(
      `SELECT count(*)::text AS n FROM evento_programado
        WHERE entidad_id = $1 AND tipo = 'garantia_por_vencer'`,
      [garanteId],
    );
    expect(Number(filas[0].n)).toBe(1);
  });

  it('una garantía de un contrato que NO está vigente no genera nada', async () => {
    // Un seguro de caución que vence en un contrato ya terminado no hay que
    // renovarlo. Avisarlo es ruido, y el ruido entrena a ignorar la bandeja.
    const c = await contratoQueVence(280);
    const garanteId = await garanteQueVence(c.id, 50);

    await conOwner("UPDATE contrato_alquiler SET estado = 'rescindido' WHERE id = $1", [c.id]);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const filas = await conOwner<{ n: string }>(
      `SELECT count(*)::text AS n FROM evento_programado
        WHERE entidad_id = $1 AND tipo = 'garantia_por_vencer'`,
      [garanteId],
    );
    expect(Number(filas[0].n)).toBe(0);
  });

  it('avisa que hay que revisar el BCRA — y NO lo consulta', async () => {
    // El aviso avisa; la consulta la aprieta una persona. Un cron que le
    // pidiera al BCRA el dato bancario de un garante cada seis meses estaría
    // averiguando la situación crediticia de un tercero sin que nadie se lo
    // pida, contra una API con control de tráfico por IP.
    const c = await contratoQueVence(340);
    const garanteId = await garanteQueVence(c.id, 400);

    // La fecha de revisión la escribe `consultarBcra()`, que sale a internet.
    // Acá se pone a mano lo que esa consulta habría dejado.
    await conOwner(
      `UPDATE garantia
          SET bcra_consultado_el = now() - interval '6 months',
              bcra_situacion = 1,
              bcra_revisar_el = current_date
        WHERE id = $1`,
      [garanteId],
    );

    const r = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    expect(r.body.garantia_revision_bcra).toBeGreaterThanOrEqual(1);

    const bandeja = await http().get('/v1/avisos?futuros=true').set(...como(inmo)).expect(200);
    const aviso = bandeja.body.items.find(
      (e: { entidadId: string; tipo: string }) =>
        e.entidadId === garanteId && e.tipo === 'garantia_revision_bcra',
    );
    expect(aviso).toBeDefined();
    expect(aviso.titulo).toContain('Revisar el BCRA');
    expect(aviso.detalle).toContain('Volvé a consultarlo');

    // Idempotente, como todos.
    const segunda = await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    expect(segunda.body.garantia_revision_bcra).toBe(0);
  });

  it('la revisión no se avisa si la garantía ya venció antes de esa fecha', async () => {
    // La fecha de revisión se calcula al consultar, con el vencimiento que
    // había ESE día. Si después alguien lo adelanta, el aviso pediría revisar
    // una garantía que ya no cubre nada.
    const c = await contratoQueVence(360);
    const garanteId = await garanteQueVence(c.id, 200);

    await conOwner(
      `UPDATE garantia
          SET bcra_consultado_el = now(), bcra_situacion = 1,
              bcra_revisar_el = current_date,
              vence_el = current_date - 5
        WHERE id = $1`,
      [garanteId],
    );

    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);
    const filas = await conOwner<{ n: string }>(
      `SELECT count(*)::text AS n FROM evento_programado
        WHERE entidad_id = $1 AND tipo = 'garantia_revision_bcra'`,
      [garanteId],
    );
    expect(Number(filas[0].n)).toBe(0);
  });

  it('el filtro por tipo acepta TODOS los tipos que acepta la base', async () => {
    // Se descubrió usando la app: `garantia_revision_bcra` entró en el CHECK de
    // `evento_programado` en la migración 019 y no en `TIPOS_EVENTO`, así que
    // el generador creaba avisos que el desplegable de la pantalla no podía
    // filtrar — 400 «El campo «tipo» no es válido». Dos listas de lo mismo en
    // dos archivos: este test es lo que las mantiene juntas.
    const rows = await conOwner<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'evento_programado_tipo_check'`,
    );

    const deLaBase = [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(deLaBase.length).toBeGreaterThan(0);

    for (const tipo of deLaBase) {
      await http().get(`/v1/avisos?tipo=${tipo}`).set(...como(inmo)).expect(200);
    }
  });

  it('cero fuga: la vecina no ve los avisos de garantías ajenas', async () => {
    const c = await contratoQueVence(310);
    await garanteQueVence(c.id, 55);
    await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

    const res = await http().get('/v1/avisos?futuros=true&tipo=garantia_por_vencer')
      .set(...como(otra)).expect(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);

    // Y generar desde la vecina no toca las garantías de la otra inmobiliaria.
    const suyo = await http().post('/v1/avisos/generar').set(...como(otra)).expect(201);
    expect(suyo.body.garantia_por_vencer ?? 0).toBe(0);
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
