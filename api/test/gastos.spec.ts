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
 * Gastos, proveedores y reclamos.
 *
 * El test que justifica la feature entera es **«rearmar la liquidación no
 * destruye el gasto»**. Todo lo demás es andamio alrededor de eso.
 *
 * El bug original: el `DELETE` de líneas no filtraba por tipo, borraba los
 * gastos cargados a mano y después sumaba desde la tabla recién vaciada, así
 * que `total_gastos` daba 0. Con un termotanque de ARS 85.000 adelantado por la
 * inmobiliaria, rearmar el período le transfería esos 85.000 de más al
 * propietario.
 *
 * Aquel bug se parcheó filtrando el `DELETE`. El parche era correcto y no
 * alcanzaba: mientras el gasto viviera DENTRO de la liquidación, rearmarla
 * podía destruirlo. Acá el gasto vive por su cuenta y se prueba desde los dos
 * lados — que sobreviva al rearmado, y que no se duplique.
 */
describe('Gastos y reclamos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  let propiedadId: string;
  let contratoId: string;
  let propietarioId: string;
  let inquilinoId: string;
  let proveedorId: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('gastos', tk);
    otra = await crearInmobiliaria('gastosvecina', tk);
    await armarCartera();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());
  const mesActual = () => new Date().toISOString().slice(0, 8) + '01';

  async function armarCartera() {
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Gastos', numero: '100', tipo: 'departamento' }).expect(201);
    propiedadId = prop.body.id;

    await http().post(`/v1/propiedades/${propiedadId}/operaciones`).set(...como(inmo))
      .send({ tipo: 'alquiler', precio: 400000, moneda: 'ARS', estado: 'disponible' })
      .expect(201);

    const dueno = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Dueña', apellido: 'Del Gasto' }).expect(201);
    propietarioId = dueno.body.id;

    const inq = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Inquilino', apellido: 'Del Gasto' }).expect(201);
    inquilinoId = inq.body.id;

    // La titularidad es la que ata el gasto de la propiedad a la liquidación
    // del propietario. Sin ella el gasto existe y no lo toma nadie.
    await http().patch(`/v1/propiedades/${propiedadId}`).set(...como(inmo))
      .send({ titulares: [{ personaId: propietarioId, porcentaje: 100 }] })
      .expect(200);

    const inicio = new Date();
    inicio.setFullYear(inicio.getFullYear() - 1);
    const fin = new Date();
    fin.setFullYear(fin.getFullYear() + 1);

    const contrato = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId,
        fechaInicio: inicio.toISOString().slice(0, 10),
        fechaFin: fin.toISOString().slice(0, 10),
        montoInicial: 400000,
        moneda: 'ARS',
        indice: 'ninguno',
        mesBase: inicio.toISOString().slice(0, 8) + '01',
        honorariosPct: 10,
        locadores: [{ personaId: propietarioId, porcentaje: 100 }],
        locatarios: [inq.body.id],
      })
      .expect(201);
    contratoId = contrato.body.id;

    await http().post(`/v1/contratos/${contratoId}/periodos/generar`).set(...como(inmo))
      .send({ hasta: mesActual() }).expect(201);

    const prov = await http().post('/v1/proveedores').set(...como(inmo))
      .send({ nombre: 'Gasista Pérez', rubro: 'gas', telefono: '261 400-1122' })
      .expect(201);
    proveedorId = prov.body.id;
  }

  /** Cobra la cuota del mes: sin cobro no hay liquidación que armar. */
  async function cobrarElMes(): Promise<void> {
    const periodos = await http().get(`/v1/contratos/${contratoId}/periodos`)
      .set(...como(inmo)).expect(200);
    const delMes = periodos.body.items.find(
      (p: { periodo: string }) => p.periodo.slice(0, 10) === mesActual(),
    );
    if (!delMes || delMes.saldo <= 0) return;
    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: delMes.id, monto: delMes.saldo, medio: 'transferencia' })
      .expect(201);
  }

  // ── Permisos ──────────────────────────────────────────────────────────────

  it('el asesor no ve ni carga gastos: es plata del propietario', async () => {
    await http().get('/v1/gastos').set(...como(inmo, 'agente')).expect(403);
    await http().post('/v1/gastos').set(...como(inmo, 'agente'))
      .send({ propiedadId, concepto: 'X', tipo: 'reparacion', monto: 1, moneda: 'ARS' })
      .expect(403);
  });

  it('el contable lee gastos pero no los carga: su trabajo es rendir', async () => {
    await http().get('/v1/gastos').set(...como(inmo, 'contable')).expect(200);
    await http().post('/v1/gastos').set(...como(inmo, 'contable'))
      .send({ propiedadId, concepto: 'X', tipo: 'reparacion', monto: 1, moneda: 'ARS' })
      .expect(403);
  });

  it('el asesor SÍ abre reclamos: es quien atiende el teléfono', async () => {
    const r = await http().post('/v1/reclamos').set(...como(inmo, 'agente'))
      .send({ propiedadId, categoria: 'plomeria', descripcion: 'Pierde la canilla' })
      .expect(201);
    expect(r.body.estado).toBe('abierto');

    // Pero resolver puede generar un gasto, y eso ya es plata.
    await http().post(`/v1/reclamos/${r.body.id}/resolver`).set(...como(inmo, 'agente'))
      .send({ resolucion: 'Listo', monto: 1000 })
      .expect(403);
  });

  it('sin token no hay nada', async () => {
    await http().get('/v1/gastos').expect(401);
    await http().get('/v1/reclamos').expect(401);
    await http().get('/v1/proveedores').expect(401);
  });

  // ── Aislamiento ───────────────────────────────────────────────────────────

  it('la inmobiliaria vecina no ve estos gastos ni este proveedor', async () => {
    // `aCargoDe: 'inmobiliaria'` a propósito: si fuera del propietario, este
    // gasto entraría en la liquidación del test de más abajo y le cambiaría el
    // total. Los fixtures de un test no pueden ensuciar la aritmética de otro.
    await http().post('/v1/gastos').set(...como(inmo))
      .send({
        propiedadId, concepto: 'Aislado', tipo: 'reparacion',
        monto: 5000, moneda: 'ARS', aCargoDe: 'inmobiliaria',
      })
      .expect(201);

    const g = await http().get('/v1/gastos').set(...como(otra)).expect(200);
    expect(g.body.items).toEqual([]);

    const p = await http().get('/v1/proveedores').set(...como(otra)).expect(200);
    expect(p.body.items).toEqual([]);
  });

  it('no se puede cargar un gasto contra una propiedad ajena', async () => {
    await http().post('/v1/gastos').set(...como(otra))
      .send({ propiedadId, concepto: 'Robado', tipo: 'reparacion', monto: 1, moneda: 'ARS' })
      .expect(404);
  });

  // ── El corazón de la feature ──────────────────────────────────────────────

  it('rearmar la liquidación NO destruye el gasto ni lo duplica', async () => {
    await cobrarElMes();

    const gasto = await http().post('/v1/gastos').set(...como(inmo))
      .send({
        propiedadId, contratoId, proveedorId,
        concepto: 'Termotanque', tipo: 'reparacion',
        monto: 85000, moneda: 'ARS', comprobante: 'FC-A-0001',
      })
      .expect(201);
    expect(gasto.body.estado).toBe('registrado');

    // Primera generación: la liquidación TOMA el gasto.
    await http().post('/v1/liquidaciones/generar').set(...como(inmo))
      .send({ periodo: mesActual() }).expect(201);

    const uno = await http().get(`/v1/liquidaciones?periodo=${mesActual()}`)
      .set(...como(inmo)).expect(200);
    const liq = uno.body.items.find(
      (l: { propietario: { id: string } }) => l.propietario.id === propietarioId,
    );
    expect(liq).toBeDefined();
    expect(liq.totalGastos).toBe(85000);

    const tomado = await http().get(`/v1/gastos/${gasto.body.id}`).set(...como(inmo)).expect(200);
    expect(tomado.body.estado).toBe('rendido');
    expect(tomado.body.liquidacionId).toBe(liq.id);

    // Segunda generación sobre el MISMO período: es donde el modelo viejo
    // perdía el gasto y `total_gastos` volvía a 0.
    await http().post('/v1/liquidaciones/generar').set(...como(inmo))
      .send({ periodo: mesActual() }).expect(201);

    const dos = await http().get(`/v1/liquidaciones?periodo=${mesActual()}`)
      .set(...como(inmo)).expect(200);
    const liq2 = dos.body.items.find(
      (l: { propietario: { id: string } }) => l.propietario.id === propietarioId,
    );

    // Sigue estando, y **una sola vez**: 170.000 sería haberlo tomado dos veces.
    expect(liq2.totalGastos).toBe(85000);
    expect(liq2.lineas.filter((l: { tipo: string }) => l.tipo === 'reparacion')).toHaveLength(1);

    // Y el neto refleja el descuento: sin esto el propietario cobra de más.
    expect(liq2.totalNeto).toBe(liq2.totalBruto - liq2.totalHonorarios - 85000);
  });

  it('un gasto a cargo del inquilino NO entra en la liquidación del propietario', async () => {
    const g = await http().post('/v1/gastos').set(...como(inmo))
      .send({
        propiedadId, concepto: 'Vidrio roto por el inquilino', tipo: 'reparacion',
        monto: 40000, moneda: 'ARS', aCargoDe: 'inquilino',
      })
      .expect(201);

    await http().post('/v1/liquidaciones/generar').set(...como(inmo))
      .send({ periodo: mesActual() }).expect(201);

    const g2 = await http().get(`/v1/gastos/${g.body.id}`).set(...como(inmo)).expect(200);
    // Descontárselo al dueño sería cobrarle un arreglo que no le corresponde.
    expect(g2.body.estado).toBe('registrado');
    expect(g2.body.liquidacionId).toBeNull();
  });

  it('un gasto en dólares abre SU liquidación y no se mezcla con la de pesos', async () => {
    const g = await http().post('/v1/gastos').set(...como(inmo))
      .send({
        propiedadId, concepto: 'Repuesto importado', tipo: 'reparacion',
        monto: 120, moneda: 'USD',
      })
      .expect(201);

    await http().post('/v1/liquidaciones/generar').set(...como(inmo))
      .send({ periodo: mesActual() }).expect(201);

    const lista = await http().get(`/v1/liquidaciones?periodo=${mesActual()}&porPagina=50`)
      .set(...como(inmo)).expect(200);

    const enUsd = lista.body.items.find(
      (l: { propietario: { id: string }; moneda: string }) =>
        l.propietario.id === propietarioId && l.moneda === 'USD',
    );
    const enArs = lista.body.items.find(
      (l: { propietario: { id: string }; moneda: string }) =>
        l.propietario.id === propietarioId && l.moneda === 'ARS',
    );

    // Dos liquidaciones para el mismo propietario, una por moneda. Sumar 120
    // dólares a una rendición en pesos daría un número que no significa nada.
    expect(enUsd).toBeDefined();
    expect(enUsd.totalGastos).toBe(120);
    // Y con bruto 0: ese mes no entró plata de este propietario en dólares, y
    // el neto negativo dice la verdad — se le debe cobrar.
    expect(enUsd.totalBruto).toBe(0);
    expect(enUsd.totalNeto).toBe(-120);

    expect(enArs.totalGastos).toBe(85000);

    const g2 = await http().get(`/v1/gastos/${g.body.id}`).set(...como(inmo)).expect(200);
    expect(g2.body.estado).toBe('rendido');
    expect(g2.body.liquidacionId).toBe(enUsd.id);
  });

  // ── Inmutabilidad ─────────────────────────────────────────────────────────

  it('un gasto ya rendido no se puede editar ni anular', async () => {
    const lista = await http().get('/v1/gastos?estado=rendido').set(...como(inmo)).expect(200);
    const rendido = lista.body.items[0];
    expect(rendido).toBeDefined();

    // 409 y no 500: el usuario pidió algo coherente sobre una fila que ya no
    // admite cambios. El trigger lo levanta con SQLSTATE 'BE002'.
    const r = await http().patch(`/v1/gastos/${rendido.id}`).set(...como(inmo))
      .send({ monto: 1 })
      .expect(409);
    expect(r.body.code).toBe('YA_RENDIDO');

    const a = await http().post(`/v1/gastos/${rendido.id}/anular`).set(...como(inmo))
      .expect(409);
    expect(a.body.code).toBe('YA_RENDIDO');
  });

  it('un gasto sin rendir se anula, no se borra', async () => {
    const g = await http().post('/v1/gastos').set(...como(inmo))
      .send({
        propiedadId, concepto: 'Cargado mal', tipo: 'otro',
        monto: 999, moneda: 'ARS', aCargoDe: 'inmobiliaria',
      })
      .expect(201);

    const a = await http().post(`/v1/gastos/${g.body.id}/anular`).set(...como(inmo)).expect(201);
    expect(a.body.estado).toBe('anulado');

    // Sigue existiendo: que quede el rastro es la diferencia entre un error
    // corregido y un número que apareció y desapareció.
    await http().get(`/v1/gastos/${g.body.id}`).set(...como(inmo)).expect(200);
  });

  // ── Reclamos ──────────────────────────────────────────────────────────────

  it('resolver un reclamo con costo crea su gasto en el mismo movimiento', async () => {
    const r = await http().post('/v1/reclamos').set(...como(inmo))
      .send({
        propiedadId, contratoId, categoria: 'climatizacion',
        descripcion: 'No enfría el split del living', prioridad: 'alta',
        proveedorId, reportadoPor: inquilinoId,
      })
      .expect(201);
    expect(r.body.gasto).toBeNull();

    const res = await http().post(`/v1/reclamos/${r.body.id}/resolver`).set(...como(inmo))
      .send({ resolucion: 'Se cargó gas y se cambió el capacitor', monto: 62000, moneda: 'ARS' })
      .expect(201);

    expect(res.body.estado).toBe('resuelto');
    expect(res.body.resueltoEl).not.toBeNull();
    expect(res.body.gasto.monto).toBe(62000);

    // El gasto hereda del reclamo lo que el reclamo ya sabía.
    const g = await http().get(`/v1/gastos/${res.body.gasto.id}`).set(...como(inmo)).expect(200);
    expect(g.body.reclamoId).toBe(r.body.id);
    expect(g.body.propiedad.id).toBe(propiedadId);
    expect(g.body.proveedor.id).toBe(proveedorId);
  });

  it('un reclamo resuelto no se reabre por un PATCH', async () => {
    const lista = await http().get('/v1/reclamos?estado=resuelto').set(...como(inmo)).expect(200);
    const resuelto = lista.body.items[0];
    expect(resuelto).toBeDefined();

    await http().patch(`/v1/reclamos/${resuelto.id}`).set(...como(inmo))
      .send({ estado: 'abierto' })
      .expect(409);
  });

  it('resolver sin costo no crea gasto: no todo arreglo cuesta plata', async () => {
    const r = await http().post('/v1/reclamos').set(...como(inmo))
      .send({ propiedadId, categoria: 'otro', descripcion: 'Se trabó la persiana' })
      .expect(201);

    const res = await http().post(`/v1/reclamos/${r.body.id}/resolver`).set(...como(inmo))
      .send({ resolucion: 'Lo destrabó el encargado' })
      .expect(201);

    expect(res.body.estado).toBe('resuelto');
    expect(res.body.gasto).toBeNull();
  });

  it('los pendientes salen ordenados por prioridad y antigüedad', async () => {
    await http().post('/v1/reclamos').set(...como(inmo))
      .send({ propiedadId, categoria: 'gas', descripcion: 'Olor a gas', prioridad: 'urgente' })
      .expect(201);

    const l = await http().get('/v1/reclamos?soloPendientes=true').set(...como(inmo)).expect(200);
    expect(l.body.items.length).toBeGreaterThan(0);
    // Un olor a gas no puede quedar debajo de una persiana trabada.
    expect(l.body.items[0].prioridad).toBe('urgente');
    expect(l.body.items.every((r: { estado: string }) =>
      ['abierto', 'en_curso'].includes(r.estado))).toBe(true);
  });

  it('el reclamo trae los días abiertos: es lo que dice cuál está podrido', async () => {
    const l = await http().get('/v1/reclamos?soloPendientes=true').set(...como(inmo)).expect(200);
    for (const r of l.body.items) expect(typeof r.diasAbierto).toBe('number');
  });

  // ── Proveedores ───────────────────────────────────────────────────────────

  it('el proveedor cuenta sus gastos, que es lo que dice si se puede desactivar', async () => {
    const l = await http().get('/v1/proveedores').set(...como(inmo)).expect(200);
    const p = l.body.items.find((x: { id: string }) => x.id === proveedorId);
    expect(p.gastos).toBeGreaterThan(0);
  });

  it('un proveedor se desactiva y desaparece de la lista, sin borrarse', async () => {
    const nuevo = await http().post('/v1/proveedores').set(...como(inmo))
      .send({ nombre: 'Pintor que se mudó', rubro: 'pintura' }).expect(201);

    await http().patch(`/v1/proveedores/${nuevo.body.id}`).set(...como(inmo))
      .send({ activo: false }).expect(200);

    const activos = await http().get('/v1/proveedores').set(...como(inmo)).expect(200);
    expect(activos.body.items.find((x: { id: string }) => x.id === nuevo.body.id))
      .toBeUndefined();

    const todos = await http().get('/v1/proveedores?incluirInactivos=true')
      .set(...como(inmo)).expect(200);
    expect(todos.body.items.find((x: { id: string }) => x.id === nuevo.body.id))
      .toBeDefined();
  });

  it('el agente lee proveedores: es la agenda de a quién llamar', async () => {
    await http().get('/v1/proveedores').set(...como(inmo, 'agente')).expect(200);
    await http().post('/v1/proveedores').set(...como(inmo, 'agente'))
      .send({ nombre: 'X' }).expect(403);
  });
});
