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
 * Etapa 4 — el ciclo completo de un contrato de alquiler, contra Postgres real.
 *
 * El caso está armado con números redondos a propósito: si algo no cuadra, se
 * ve dónde sin tener que abrir una calculadora.
 */
describe('Alquileres: contrato, ajustes, cuotas, cobros y liquidación', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('alq', tk);
    otra = await crearInmobiliaria('alqvecina', tk);
    await cargarIndices();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** IPC ficticio pero con la forma real: base 100 y subas mensuales. */
  async function cargarIndices() {
    const valores = [
      { tipo: 'ipc', periodo: '2025-12-01', valor: 100 },
      { tipo: 'ipc', periodo: '2026-01-01', valor: 102 },
      { tipo: 'ipc', periodo: '2026-02-01', valor: 104.04 },
      { tipo: 'ipc', periodo: '2026-03-01', valor: 106.12 },
      { tipo: 'ipc', periodo: '2026-04-01', valor: 108.24 },
      { tipo: 'ipc', periodo: '2026-05-01', valor: 110.41 },
      { tipo: 'ipc', periodo: '2026-06-01', valor: 112.62 },
    ];
    await http()
      .post('/v1/indices/lote')
      .set(...como(inmo))
      .send({ valores })
      .expect(201);
  }

  async function crearPropiedadYContrato(extra: Record<string, unknown> = {}) {
    const prop = await http()
      .post('/v1/propiedades')
      .set(...como(inmo))
      .send({ calle: `Contrato ${Math.random().toString(36).slice(2, 8)}`, tipo: 'departamento' })
      .expect(201);

    const dueno = await http()
      .post('/v1/personas')
      .set(...como(inmo))
      .send({ nombre: 'Dueña', apellido: 'Del Inmueble' })
      .expect(201);

    const inquilino = await http()
      .post('/v1/personas')
      .set(...como(inmo))
      .send({ nombre: 'Inquilino', apellido: 'Puntual' })
      .expect(201);

    const contrato = await http()
      .post('/v1/contratos')
      .set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01',
        fechaFin: '2028-12-31',
        montoInicial: 400000,
        moneda: 'ARS',
        indice: 'ipc',
        periodicidadMeses: 3,
        mesBase: '2025-12-01',
        honorariosPct: 10,
        administrado: true,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inquilino.body.id],
        ...extra,
      })
      .expect(201);

    return { prop: prop.body, dueno: dueno.body, inquilino: inquilino.body, contrato: contrato.body };
  }

  // ── Índices ────────────────────────────────────────────────────────────────

  it('un índice cargado no se puede pisar', async () => {
    const res = await http()
      .post('/v1/indices')
      .set(...como(inmo))
      .send({ tipo: 'ipc', periodo: '2026-01-01', valor: 999 })
      .expect(409);

    expect(res.body.code).toBe('INDICE_YA_CARGADO');
    // Y sigue valiendo el original: los índices son compartidos.
    expect(res.body.detail).toContain('102');
  });

  it('los índices son globales: la inmobiliaria vecina ve los mismos', async () => {
    const mios = await http().get('/v1/indices?tipo=ipc').set(...como(inmo)).expect(200);
    const suyos = await http().get('/v1/indices?tipo=ipc').set(...como(otra)).expect(200);
    expect(suyos.body).toEqual(mios.body);
  });

  it('la cobertura dice hasta qué mes hay datos', async () => {
    // Los índices son GLOBALES y no se limpian entre corridas: son dato público
    // compartido por todas las inmobiliarias. Por eso este test afirma la
    // INVARIANTE (hay al menos lo que cargué) y no un valor exacto, que
    // cualquier otra carga podría mover.
    const res = await http().get('/v1/indices/cobertura').set(...como(inmo)).expect(200);

    const ipc = res.body.find((c: { tipo: string }) => c.tipo === 'ipc');
    expect(ipc.ultimo >= '2026-06-01').toBe(true);
    expect(ipc.valores).toBeGreaterThanOrEqual(7);

    // Un índice sin datos lo dice; no aparece en cero, que se leería como
    // "el IPC de ese mes fue 0".
    const icp = res.body.find((c: { tipo: string }) => c.tipo === 'icp');
    expect(icp.valores).toBe(0);
    expect(icp.ultimo).toBeNull();
  });

  // ── Contratos ──────────────────────────────────────────────────────────────

  it('una propiedad no puede tener dos contratos vigentes solapados', async () => {
    const { prop } = await crearPropiedadYContrato();

    const res = await http()
      .post('/v1/contratos')
      .set(...como(inmo))
      .send({
        propiedadId: prop.id,
        fechaInicio: '2027-06-01',   // cae dentro del anterior
        fechaFin: '2029-05-31',
        montoInicial: 500000,
        moneda: 'ARS',
      })
      .expect(409);

    expect(res.body.code).toBe('CONTRATO_SOLAPADO');
  });

  it('N contratos simultáneos sobre la misma propiedad: entra uno, ningún 5xx', async () => {
    // El EXCLUDE es de base y hay advisory lock antes de tocarlo. Sin el lock,
    // las transacciones se traban entre sí y Postgres mata alguna con deadlock,
    // que el cliente vería como 500 en vez de 409.
    const prop = await http()
      .post('/v1/propiedades')
      .set(...como(inmo))
      .send({ calle: 'Disputada', tipo: 'casa' })
      .expect(201);

    const cuerpo = {
      propiedadId: prop.body.id,
      fechaInicio: '2026-01-01',
      fechaFin: '2027-12-31',
      montoInicial: 300000,
      moneda: 'ARS',
    };

    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        http().post('/v1/contratos').set(...como(inmo)).send(cuerpo),
      ),
    );

    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
  });

  it('si no se cargan locadores, se toman los titulares de la propiedad', async () => {
    const prop = await http()
      .post('/v1/propiedades')
      .set(...como(inmo))
      .send({ calle: 'Con Titulares', tipo: 'ph' })
      .expect(201);

    const a = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Hermano', apellido: 'Uno' }).expect(201);
    const b = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Hermana', apellido: 'Dos' }).expect(201);

    await http()
      .patch(`/v1/propiedades/${prop.body.id}`)
      .set(...como(inmo))
      .send({ titulares: [
        { personaId: a.body.id, porcentaje: 60 },
        { personaId: b.body.id, porcentaje: 40 },
      ] })
      .expect(200);

    const c = await http()
      .post('/v1/contratos')
      .set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 200000, moneda: 'ARS',
      })
      .expect(201);

    expect(c.body.locadores).toHaveLength(2);
    expect(c.body.locadores.map((l: { porcentaje: number }) => l.porcentaje).sort())
      .toEqual([40, 60]);
  });

  // ── Ajustes ────────────────────────────────────────────────────────────────

  it('proyecta los ajustes trimestrales encadenando el monto', async () => {
    const { contrato } = await crearPropiedadYContrato();

    const r = await http()
      .post(`/v1/contratos/${contrato.id}/ajustes/proyectar`)
      .set(...como(inmo))
      .expect(201);

    expect(r.body.creados).toBeGreaterThanOrEqual(1);

    const ajustes = await http()
      .get(`/v1/contratos/${contrato.id}/ajustes`)
      .set(...como(inmo))
      .expect(200);

    const primero = ajustes.body[0];
    // Abril: base dic/25 = 100, actual mar/26 = 106,12 → coef 1,0612
    expect(primero.vigenteDesde).toBe('2026-04-01');
    expect(primero.coeficiente).toBe(1.0612);
    expect(primero.montoAnterior).toBe(400000);
    expect(primero.montoNuevo).toBe(424480);
    expect(primero.estado).toBe('proyectado');

    if (ajustes.body[1]) {
      // El segundo arranca del monto del primero, no del inicial.
      expect(ajustes.body[1].montoAnterior).toBe(424480);
    }
  });

  it('el ajuste trae la memoria de cálculo escrita', async () => {
    const { contrato } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/ajustes/proyectar`).set(...como(inmo));

    const ajustes = await http()
      .get(`/v1/contratos/${contrato.id}/ajustes`)
      .set(...como(inmo))
      .expect(200);

    // Un aumento que el usuario no puede explicarle al inquilino no sirve.
    expect(ajustes.body[0].explicacion).toContain('IPC');
    expect(ajustes.body[0].explicacion).toContain('400.000,00');
    expect(ajustes.body[0].explicacion).toContain('424.480,00');
  });

  it('un ajuste confirmado no se puede recalcular', async () => {
    const { contrato } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/ajustes/proyectar`).set(...como(inmo));

    const ajustes = await http()
      .get(`/v1/contratos/${contrato.id}/ajustes`).set(...como(inmo)).expect(200);
    const id = ajustes.body[0].id;

    await http().post(`/v1/ajustes/${id}/confirmar`).set(...como(inmo)).expect(201);

    const segunda = await http()
      .post(`/v1/ajustes/${id}/confirmar`).set(...como(inmo)).expect(409);
    expect(segunda.body.code).toBe('AJUSTE_YA_CONFIRMADO');
  });

  it('sin el índice del período no proyecta y avisa cuál falta', async () => {
    const { contrato } = await crearPropiedadYContrato({ periodicidadMeses: 1 });

    const r = await http()
      .post(`/v1/contratos/${contrato.id}/ajustes/proyectar`)
      .set(...como(inmo))
      .expect(201);

    // El IPC llega hasta jun/26; los ajustes posteriores no se pueden calcular.
    // No se estima: se informa.
    expect(r.body.sinIndice.length).toBeGreaterThan(0);
  });

  it('un contrato sin actualización no proyecta nada', async () => {
    const { contrato } = await crearPropiedadYContrato({ indice: 'ninguno' });

    const r = await http()
      .post(`/v1/contratos/${contrato.id}/ajustes/proyectar`)
      .set(...como(inmo))
      .expect(422);
    expect(r.body.code).toBe('SIN_AJUSTE');
  });

  // ── Períodos y cobros ──────────────────────────────────────────────────────

  it('generar períodos es idempotente', async () => {
    const { contrato } = await crearPropiedadYContrato();

    const a = await http()
      .post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-06-01' }).expect(201);
    expect(a.body.creados).toBe(6);   // ene a jun

    const b = await http()
      .post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-06-01' }).expect(201);
    expect(b.body.creados).toBe(0);   // correrlo dos veces no duplica

    const per = await http()
      .get(`/v1/contratos/${contrato.id}/periodos`).set(...como(inmo)).expect(200);
    expect(per.body).toHaveLength(6);
  });

  it('las cuotas usan el monto del ajuste CONFIRMADO, no del proyectado', async () => {
    const { contrato } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/ajustes/proyectar`).set(...como(inmo));

    // Todavía proyectado: abril tiene que salir al monto viejo.
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-06-01' }).expect(201);

    let per = await http()
      .get(`/v1/contratos/${contrato.id}/periodos`).set(...como(inmo)).expect(200);
    const abril = per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-04'));
    expect(abril.montoAlquiler).toBe(400000);

    // Se confirma y se regeneran: los períodos ya creados no cambian solos.
    const ajustes = await http()
      .get(`/v1/contratos/${contrato.id}/ajustes`).set(...como(inmo)).expect(200);
    await http().post(`/v1/ajustes/${ajustes.body[0].id}/confirmar`).set(...como(inmo)).expect(201);

    per = await http()
      .get(`/v1/contratos/${contrato.id}/periodos`).set(...como(inmo)).expect(200);
    // El período ya emitido sigue igual: cambiar una cuota ya emitida sería
    // reescribir lo que el inquilino ya vio.
    expect(per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-04')).montoAlquiler)
      .toBe(400000);
  });

  it('un cobro parcial deja el período en parcial y calcula el saldo', async () => {
    const { contrato } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-01-01' }).expect(201);

    const per = await http()
      .get(`/v1/contratos/${contrato.id}/periodos`).set(...como(inmo)).expect(200);
    const enero = per.body[0];

    const r1 = await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: enero.id, monto: 150000 }).expect(201);
    expect(r1.body.estadoPeriodo).toBe('parcial');
    expect(r1.body.saldo).toBe(250000);

    const r2 = await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: enero.id, monto: 250000 }).expect(201);
    expect(r2.body.estadoPeriodo).toBe('pagado');
    expect(r2.body.saldo).toBe(0);
  });

  // ── Liquidación ────────────────────────────────────────────────────────────

  it('liquida lo COBRADO y descuenta honorarios sobre eso', async () => {
    const { contrato, dueno } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-01-01' }).expect(201);

    const per = await http()
      .get(`/v1/contratos/${contrato.id}/periodos`).set(...como(inmo)).expect(200);

    // Cobra sólo 300.000 de los 400.000: al propietario le corresponde el 90%
    // de lo que ENTRÓ, no de lo que se facturó.
    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: per.body[0].id, monto: 300000 }).expect(201);

    const gen = await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-01-01' }).expect(201);
    expect(gen.body.generadas).toBeGreaterThanOrEqual(1);

    const liqs = await http()
      .get('/v1/liquidaciones?periodo=2026-01-01').set(...como(inmo)).expect(200);
    const mia = liqs.body.find(
      (l: { propietario: { id: string } }) => l.propietario.id === dueno.id,
    );

    expect(mia.totalBruto).toBe(300000);
    expect(mia.totalHonorarios).toBe(30000);   // 10% de 300.000
    expect(mia.totalNeto).toBe(270000);
    expect(mia.moneda).toBe('ARS');
  });

  it('en condominio, cada propietario recibe su liquidación por su porcentaje', async () => {
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Condominio Liquidado', tipo: 'casa' }).expect(201);

    const a = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Socio', apellido: 'Sesenta' }).expect(201);
    const b = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Socia', apellido: 'Cuarenta' }).expect(201);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-02-01', fechaFin: '2028-01-31',
        montoInicial: 500000, moneda: 'ARS', honorariosPct: 10,
        locadores: [
          { personaId: a.body.id, porcentaje: 60 },
          { personaId: b.body.id, porcentaje: 40 },
        ],
      }).expect(201);

    await http().post(`/v1/contratos/${c.body.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-02-01' }).expect(201);
    const per = await http().get(`/v1/contratos/${c.body.id}/periodos`)
      .set(...como(inmo)).expect(200);
    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: per.body[0].id, monto: 500000 }).expect(201);

    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-02-01' }).expect(201);

    const liqs = await http().get('/v1/liquidaciones?periodo=2026-02-01')
      .set(...como(inmo)).expect(200);

    const sesenta = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === a.body.id);
    const cuarenta = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === b.body.id);

    expect(sesenta.totalBruto).toBe(300000);      // 60% de 500.000
    expect(sesenta.totalHonorarios).toBe(30000);
    expect(sesenta.totalNeto).toBe(270000);

    expect(cuarenta.totalBruto).toBe(200000);     // 40%
    expect(cuarenta.totalHonorarios).toBe(20000);
    expect(cuarenta.totalNeto).toBe(180000);

    // Y la suma de las partes es el total: no se perdió ni se inventó un peso.
    expect(sesenta.totalBruto + cuarenta.totalBruto).toBe(500000);
    expect(sesenta.totalNeto + cuarenta.totalNeto).toBe(450000);
  });

  it('un gasto adelantado se descuenta del neto', async () => {
    const { contrato, dueno } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-03-01' }).expect(201);
    const per = await http().get(`/v1/contratos/${contrato.id}/periodos`)
      .set(...como(inmo)).expect(200);
    const marzo = per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-03'));

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: marzo.id, monto: 400000 }).expect(201);
    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-03-01' }).expect(201);

    const liqs = await http().get('/v1/liquidaciones?periodo=2026-03-01')
      .set(...como(inmo)).expect(200);
    const mia = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === dueno.id);

    const con = await http().post(`/v1/liquidaciones/${mia.id}/gastos`)
      .set(...como(inmo))
      .send({ concepto: 'Cambio de termotanque', tipo: 'reparacion', monto: 85000 })
      .expect(201);

    expect(con.body.totalBruto).toBe(400000);
    expect(con.body.totalHonorarios).toBe(40000);
    expect(con.body.totalGastos).toBe(85000);
    expect(con.body.totalNeto).toBe(275000);
  });

  it('una liquidación cerrada no se modifica', async () => {
    const { contrato, dueno } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-05-01' }).expect(201);
    const per = await http().get(`/v1/contratos/${contrato.id}/periodos`)
      .set(...como(inmo)).expect(200);
    const mayo = per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-05'));

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: mayo.id, monto: 400000 }).expect(201);
    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-05-01' }).expect(201);

    const liqs = await http().get('/v1/liquidaciones?periodo=2026-05-01')
      .set(...como(inmo)).expect(200);
    const mia = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === dueno.id);

    await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);

    const res = await http().post(`/v1/liquidaciones/${mia.id}/gastos`)
      .set(...como(inmo))
      .send({ concepto: 'Tarde', tipo: 'otro', monto: 1000 })
      .expect(409);
    expect(res.body.code).toBe('LIQUIDACION_CERRADA');
  });

  it('los cobros ya liquidados no vuelven a liquidarse', async () => {
    const { contrato, dueno } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-06-01' }).expect(201);
    const per = await http().get(`/v1/contratos/${contrato.id}/periodos`)
      .set(...como(inmo)).expect(200);
    const junio = per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-06'));

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: junio.id, monto: 400000 }).expect(201);
    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-06-01' }).expect(201);

    const liqs = await http().get('/v1/liquidaciones?periodo=2026-06-01')
      .set(...como(inmo)).expect(200);
    const mia = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === dueno.id);
    await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);

    // Regenerar el mismo período no puede duplicar lo ya rendido: al cerrar,
    // los cobros quedaron marcados y ya no entran en ninguna liquidación.
    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-06-01' }).expect(201);

    const luego = await http().get(`/v1/liquidaciones/${mia.id}`)
      .set(...como(inmo)).expect(200);
    expect(luego.body.totalNeto).toBe(360000);
    expect(luego.body.lineas.filter((l: { tipo: string }) => l.tipo === 'alquiler'))
      .toHaveLength(1);
  });

  it('un pago tardío sobre un mes ya cerrado no toca la liquidación cerrada', async () => {
    // El caso real: el inquilino paga en agosto el alquiler de julio, cuando la
    // liquidación de julio ya se rindió. No se puede reabrir; se informa.
    const { contrato, dueno } = await crearPropiedadYContrato();
    await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({ hasta: '2026-02-01' }).expect(201);
    const per = await http().get(`/v1/contratos/${contrato.id}/periodos`)
      .set(...como(inmo)).expect(200);
    const feb = per.body.find((p: { periodo: string }) => p.periodo.startsWith('2026-02'));

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: feb.id, monto: 200000 }).expect(201);
    await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-02-01' }).expect(201);

    const liqs = await http().get('/v1/liquidaciones?periodo=2026-02-01')
      .set(...como(inmo)).expect(200);
    const mia = liqs.body.find((l: { propietario: { id: string } }) => l.propietario.id === dueno.id);
    await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);

    const netoAlCerrar = (await http().get(`/v1/liquidaciones/${mia.id}`)
      .set(...como(inmo)).expect(200)).body.totalNeto;

    // Llega el resto, tarde.
    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: feb.id, monto: 200000 }).expect(201);

    const regen = await http().post('/v1/liquidaciones/generar')
      .set(...como(inmo)).send({ periodo: '2026-02-01' }).expect(201);

    // El sistema lo informa en vez de reabrir en silencio.
    expect(regen.body.omitidasCerradas).toBe(1);

    const luego = await http().get(`/v1/liquidaciones/${mia.id}`)
      .set(...como(inmo)).expect(200);
    expect(luego.body.totalNeto).toBe(netoAlCerrar);
  });

  it('un contrato de intermediación no genera cuotas', async () => {
    const { contrato } = await crearPropiedadYContrato({ administrado: false });

    const r = await http().post(`/v1/contratos/${contrato.id}/periodos/generar`)
      .set(...como(inmo)).send({}).expect(422);
    expect(r.body.code).toBe('NO_ADMINISTRADO');
  });

  // ── Vencimientos y aislamiento ─────────────────────────────────────────────

  it('el tablero de vencimientos junta contratos, ajustes y cuotas', async () => {
    const res = await http().get('/v1/contratos/vencimientos?dias=3650')
      .set(...como(inmo)).expect(200);

    const tipos = new Set(res.body.map((v: { tipo: string }) => v.tipo));
    expect(tipos.has('ajuste')).toBe(true);
    expect(tipos.has('cuota')).toBe(true);
    // Y viene ordenado por fecha.
    const fechas = res.body.map((v: { fecha: string }) => v.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it('cero fuga: la vecina no ve contratos, cuotas ni liquidaciones ajenas', async () => {
    for (const ruta of ['/v1/contratos', '/v1/liquidaciones']) {
      const res = await http().get(ruta).set(...como(otra)).expect(200);
      const items = Array.isArray(res.body) ? res.body : res.body.items;
      expect({ ruta, n: items.length }).toEqual({ ruta, n: 0 });
    }

    const venc = await http().get('/v1/contratos/vencimientos').set(...como(otra)).expect(200);
    expect(venc.body).toHaveLength(0);
  });

  it('el asesor no puede tocar plata', async () => {
    await http().post('/v1/cobros').set(...como(inmo, 'agente'))
      .send({ periodoId: '00000000-0000-4000-8000-000000000000', monto: 1 })
      .expect(403);

    await http().get('/v1/liquidaciones').set(...como(inmo, 'agente')).expect(403);
    // El contable sí las ve: es su trabajo.
    await http().get('/v1/liquidaciones').set(...como(inmo, 'contable')).expect(200);
  });
});
