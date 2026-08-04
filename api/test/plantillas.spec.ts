import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { PLANTILLAS_POR_DEFECTO } from '../src/plantillas/plantillas.defecto';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

describe('Plantillas y pre-contratos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let contratoId: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('plant', tk);
    otra = await crearInmobiliaria('plantvecina', tk);
    contratoId = await armarContrato();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Un contrato completo: propiedad, locador con documento, locatario y garante. */
  async function armarContrato(): Promise<string> {
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({
        calle: 'Arístides Villanueva', numero: '345', piso: '3', depto: 'B',
        localidad: 'Ciudad', provincia: 'Mendoza', tipo: 'departamento',
      }).expect(201);

    const persona = async (nombre: string, apellido: string, doc: string, dom: string) =>
      (await http().post('/v1/personas').set(...como())
        .send({ nombre, apellido, docTipo: 'dni', docNumero: doc, domicilio: dom })
        .expect(201)).body.id;

    const locador = await persona('Marta', 'Silva', '18456789', 'San Martín 100');
    const locatario = await persona('Camila', 'Rossi', '35222111', 'Belgrano 250');
    const garante = await persona('Jorge', 'Ferreyra', '22987654', 'Rivadavia 80');

    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
        montoInicial: 485000, moneda: 'ARS', indice: 'ipc',
        periodicidadMeses: 3, honorariosPct: 8, deposito: 485000,
        diaVencimiento: 10, punitorioDiarioPct: 0.1,
        locadores: [{ personaId: locador, porcentaje: 100 }],
        locatarios: [locatario],
        garantes: [garante],
      }).expect(201);

    return c.body.id;
  }

  it('sembrar copia las plantillas base y es idempotente', async () => {
    const a = await http().post('/v1/plantillas/sembrar').set(...como()).expect(201);
    expect(a.body.creadas).toBe(PLANTILLAS_POR_DEFECTO.length);

    const b = await http().post('/v1/plantillas/sembrar').set(...como()).expect(201);
    expect(b.body.creadas).toBe(0);
    expect(b.body.yaEstaban).toBe(PLANTILLAS_POR_DEFECTO.length);
  });

  it('cada plantilla informa qué variables usa', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    expect(pre.variables).toEqual(
      expect.arrayContaining(['contrato.monto', 'locador.nombre', 'propiedad.direccion']),
    );
  });

  it('genera el pre-contrato con los datos reales del contrato', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    const t = doc.body.texto;
    expect(t).toContain('Marta Silva');
    expect(t).toContain('Camila Rossi');
    expect(t).toContain('Arístides Villanueva 345');
    // El monto va en número Y en letras, que es lo que exige un contrato.
    expect(t).toContain('ARS 485.000,00');
    expect(t).toContain('cuatrocientos ochenta y cinco mil');
    // Las fechas en texto largo, no en ISO.
    expect(t).toContain('1 de enero de 2026');
    expect(t).not.toContain('2026-01-01');
  });

  it('el bloque de garantes aparece porque hay uno', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    expect(doc.body.texto).toContain('GARANTÍA');
    expect(doc.body.texto).toContain('Jorge Ferreyra');
  });

  it('sin garantes, el bloque no aparece y no deja un hueco', async () => {
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({ calle: 'Sin Garantes', tipo: 'casa', localidad: 'Ciudad' }).expect(201);
    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 300000, moneda: 'ARS', indice: 'ninguno',
      }).expect(201);

    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId: c.body.id }).expect(201);

    expect(doc.body.texto).not.toContain('GARANTÍA');
    expect(doc.body.texto).not.toContain('{% si');
  });

  it('los datos que faltan se listan y quedan visibles en el texto', async () => {
    // Contrato sin depósito ni documento del locador: el pre-contrato se genera
    // igual —hay datos que se completan a mano— pero tiene que verse cuáles.
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({ calle: 'Incompleta', tipo: 'ph', localidad: 'Ciudad' }).expect(201);
    const p = await http().post('/v1/personas').set(...como())
      .send({ nombre: 'Sin', apellido: 'Documento' }).expect(201);
    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 200000, moneda: 'ARS', indice: 'ninguno',
        locadores: [{ personaId: p.body.id, porcentaje: 100 }],
      }).expect(201);

    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p2: { tipo: string }) => p2.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId: c.body.id }).expect(201);

    expect(doc.body.faltantes).toEqual(expect.arrayContaining(['locador.documento']));
    // Hueco visible, no un vacío silencioso.
    expect(doc.body.texto).toContain('«locador.documento»');
  });

  it('el recibo trae el monto en número y en letras', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const recibo = lista.body.find((p: { tipo: string }) => p.tipo === 'recibo');

    const doc = await http().post(`/v1/plantillas/${recibo.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    expect(doc.body.texto).toContain('ARS 485.000,00');
    expect(doc.body.texto).toContain('cuatrocientos ochenta y cinco mil');
  });

  it('la previsualización usa datos de ejemplo y no toca ningún contrato', async () => {
    const r = await http().post('/v1/plantillas/previsualizar').set(...como())
      .send({ contenido: 'Hola {{ locatario.nombre }}, debe {{ contrato.monto | moneda }}.' })
      .expect(201);

    expect(r.body.texto).toBe('Hola Camila Rossi, debe ARS 485.000,00.');
    expect(r.body.faltantes).toEqual([]);
  });

  it('se puede editar una plantilla y se refleja al generar', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const recibo = lista.body.find((p: { tipo: string }) => p.tipo === 'recibo');

    await http().put('/v1/plantillas').set(...como())
      .send({
        id: recibo.id, tipo: 'recibo', nombre: 'Recibo propio',
        contenido: 'RECIBO PROPIO — {{ locatario.nombre }} — {{ contrato.monto | moneda }}',
      }).expect(200);

    const doc = await http().post(`/v1/plantillas/${recibo.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);
    expect(doc.body.texto).toBe('RECIBO PROPIO — Camila Rossi — ARS 485.000,00');
  });

  it('las plantillas son de cada inmobiliaria, no compartidas', async () => {
    // Si fueran globales, que una edite su redacción cambiaría el contrato de
    // todas las demás.
    const suyas = await http().get('/v1/plantillas').set(...auth(otra.tokens.owner)).expect(200);
    expect(suyas.body).toHaveLength(0);
  });

  it('el asesor puede generar pero no editar plantillas', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body[0];

    await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como('agente'))
      .send({ contratoId }).expect(201);

    await http().put('/v1/plantillas').set(...como('agente'))
      .send({ tipo: 'otro', nombre: 'X', contenido: 'y' }).expect(403);
  });
});
