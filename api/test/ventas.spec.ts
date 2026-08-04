import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Etapa 5 — el cierre de la venta y el reparto de comisiones, contra Postgres
 * real. La venta termina; el alquiler empieza. Acá se prueba el final.
 */
describe('Ventas y comisiones', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('ventas', tk);
    otra = await crearInmobiliaria('ventasvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  async function crearOperacionVenta(precio = 200000) {
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: `Venta ${Math.random().toString(36).slice(2, 8)}`, tipo: 'casa' })
      .expect(201);

    const op = await http().post(`/v1/propiedades/${prop.body.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio, moneda: 'USD', estado: 'disponible' })
      .expect(201);

    const comprador = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Comprador', apellido: 'Decidido' }).expect(201);

    return {
      propiedadId: prop.body.id,
      operacionId: op.body.operaciones[0].id,
      compradorId: comprador.body.id,
    };
  }

  async function crearVenta(precio = 200000) {
    const { operacionId, compradorId, propiedadId } = await crearOperacionVenta(precio);
    const v = await http().post('/v1/ventas').set(...como(inmo))
      .send({ operacionId, compradorId, precioCierre: precio, moneda: 'USD' })
      .expect(201);
    return { venta: v.body, operacionId, propiedadId };
  }

  // ── Venta ──────────────────────────────────────────────────────────────────

  it('abrir una venta deja la operación reservada', async () => {
    const { propiedadId } = await crearVenta();

    const prop = await http().get(`/v1/propiedades/${propiedadId}`)
      .set(...como(inmo)).expect(200);
    expect(prop.body.operaciones[0].estado).toBe('reservada');
  });

  it('no puede haber dos ventas vivas sobre la misma operación', async () => {
    const { operacionId } = await crearOperacionVenta();

    await http().post('/v1/ventas').set(...como(inmo))
      .send({ operacionId, precioCierre: 190000, moneda: 'USD' }).expect(201);

    const res = await http().post('/v1/ventas').set(...como(inmo))
      .send({ operacionId, precioCierre: 185000, moneda: 'USD' }).expect(409);
    expect(res.body.code).toBe('OPERACION_DUPLICADA');
  });

  it('el flujo no va para atrás', async () => {
    const { venta } = await crearVenta();

    await http().patch(`/v1/ventas/${venta.id}/estado`).set(...como(inmo))
      .send({ estado: 'escriturada', fechaEscritura: '2026-08-01' }).expect(200);

    const res = await http().patch(`/v1/ventas/${venta.id}/estado`).set(...como(inmo))
      .send({ estado: 'boleto' }).expect(422);

    expect(res.body.code).toBe('ESTADO_INVALIDO');
    expect(res.body.detail).toContain('caída');
  });

  it('si la venta se cae, la propiedad vuelve al mercado y las comisiones se anulan', async () => {
    const { venta, propiedadId } = await crearVenta();

    await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 3, vendedora: 3 } }).expect(201);

    const caida = await http().patch(`/v1/ventas/${venta.id}/estado`).set(...como(inmo))
      .send({ estado: 'caida', motivoCaida: 'No salió el crédito' }).expect(200);

    expect(caida.body.comisiones.every((c: { estado: string }) => c.estado === 'anulada')).toBe(true);
    expect(caida.body.totales.operacion).toBe(0);

    const prop = await http().get(`/v1/propiedades/${propiedadId}`).set(...como(inmo)).expect(200);
    expect(prop.body.operaciones[0].estado).toBe('disponible');
  });

  // ── Comisiones ─────────────────────────────────────────────────────────────

  it('el reparto de tres niveles cuadra contra el total', async () => {
    const { venta } = await crearVenta(200000);

    const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({
        puntas: { compradora: 3, vendedora: 3 },
        externas: { vendedora: { nombre: 'Colega SRL', porcentaje: 50 } },
        repartoInterno: {
          captador: { usuarioId: inmo.usuarios.agente, nombre: 'Asesor', porcentaje: 25 },
        },
      })
      .expect(201);

    const t = r.body.totales;
    expect(t.operacion).toBe(12000);          // 3% + 3% de 200.000
    expect(t.externas).toBe(3000);            // la mitad de la punta vendedora
    // El 25% del captador se aplica sobre lo que quedó de CADA punta, no sobre
    // el bruto: 25% de 6000 (compradora) + 25% de 3000 (resto vendedora).
    expect(t.agentes).toBe(2250);
    expect(t.casa).toBe(6750);
    // La invariante: lo que factura la operación es lo que se reparte.
    expect(t.externas + t.agentes + t.casa).toBe(t.operacion);
  });

  it('rehacer el reparto reemplaza, no duplica', async () => {
    const { venta } = await crearVenta(100000);

    await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 4 } }).expect(201);

    const segunda = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 3, vendedora: 3 } }).expect(201);

    expect(segunda.body.totales.operacion).toBe(6000);
    expect(segunda.body.comisiones.filter((c: { nivel: number }) => c.nivel === 1)).toHaveLength(2);
  });

  it('con una comisión ya cobrada no se puede rehacer el reparto', async () => {
    const { venta } = await crearVenta(100000);

    const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 4 } }).expect(201);

    const comision = r.body.comisiones.find((c: { nivel: number }) => c.nivel === 3);
    await http().post(`/v1/comisiones/${comision.id}/cobrar`).set(...como(inmo))
      .send({}).expect(201);

    const res = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 3 } }).expect(409);
    expect(res.body.code).toBe('ESTADO_INVALIDO');
  });

  it('escriturar devenga las comisiones proyectadas', async () => {
    const { venta } = await crearVenta(150000);

    await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 3 } }).expect(201);

    const r = await http().patch(`/v1/ventas/${venta.id}/estado`).set(...como(inmo))
      .send({ estado: 'escriturada', fechaEscritura: '2026-08-03', escribania: 'Esc. Pérez' })
      .expect(200);

    expect(r.body.comisiones.every((c: { estado: string }) => c.estado === 'devengada')).toBe(true);
    expect(r.body.fechaEscritura).toBe('2026-08-03');
  });

  it('una comisión cobrada no se puede volver a cobrar', async () => {
    const { venta } = await crearVenta(100000);
    const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({ puntas: { compradora: 4 } }).expect(201);
    const c = r.body.comisiones.find((x: { nivel: number }) => x.nivel === 3);

    await http().post(`/v1/comisiones/${c.id}/cobrar`).set(...como(inmo)).send({}).expect(201);
    await http().post(`/v1/comisiones/${c.id}/cobrar`).set(...como(inmo)).send({}).expect(404);
  });

  it('el asesor ve sólo sus comisiones', async () => {
    const { venta } = await crearVenta(200000);
    await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
      .send({
        puntas: { compradora: 3 },
        repartoInterno: {
          captador: { usuarioId: inmo.usuarios.agente, nombre: 'Asesor', porcentaje: 20 },
          cerrador: { usuarioId: inmo.usuarios.admin, nombre: 'Admin', porcentaje: 20 },
        },
      }).expect(201);

    const delAgente = await http().get('/v1/ventas/comisiones/por-agente')
      .set(...como(inmo, 'agente')).expect(200);
    expect(delAgente.body.every((f: { agenteId: string }) => f.agenteId === inmo.usuarios.agente))
      .toBe(true);

    const delOwner = await http().get('/v1/ventas/comisiones/por-agente')
      .set(...como(inmo, 'owner')).expect(200);
    const ids = new Set(delOwner.body.map((f: { agenteId: string }) => f.agenteId));
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  it('sólo el titular y administración pueden abrir ventas y repartir', async () => {
    const { operacionId } = await crearOperacionVenta();
    await http().post('/v1/ventas').set(...como(inmo, 'agente'))
      .send({ operacionId, precioCierre: 100000, moneda: 'USD' }).expect(403);
  });

  it('cero fuga: la vecina no ve ventas ajenas', async () => {
    await crearVenta();
    const res = await http().get('/v1/ventas').set(...como(otra)).expect(200);
    expect(res.body).toHaveLength(0);
  });
});
