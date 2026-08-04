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
 * La pantalla de inicio.
 *
 * Lo que se prueba acá, en orden de importancia:
 *
 *  1. **No es una puerta de atrás a la plata.** Un asesor recibe 403 en
 *     `/v1/liquidaciones`; si el inicio le mostrara el cobrado del mes y la
 *     deuda de la cartera, el permiso no serviría de nada.
 *  2. **Cero fuga entre inmobiliarias**, como cualquier otro endpoint.
 *  3. **Los importes no se mezclan entre monedas.**
 */
describe('Inicio', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('inicio', tk);
    otra = await crearInmobiliaria('iniciovecina', tk);
    await armarCartera();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /**
   * Un contrato en pesos y otro en dólares, los dos con una cuota vencida sin
   * cobrar. Dos monedas a propósito: es lo que hace visible si alguien las suma.
   */
  async function armarCartera() {
    for (const [moneda, monto] of [['ARS', 400000], ['USD', 900]] as const) {
      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: `Inicio ${moneda}`, numero: '100', tipo: 'departamento' })
        .expect(201);

      await http().post(`/v1/propiedades/${prop.body.id}/operaciones`).set(...como(inmo))
        .send({ tipo: 'alquiler', precio: monto, moneda, estado: 'disponible' })
        .expect(201);

      const dueno = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Dueña', apellido: `De ${moneda}` }).expect(201);
      const inquilino = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Inquilino', apellido: `De ${moneda}` }).expect(201);

      // Arranca hace un año: así hay cuotas ya vencidas sin depender de la fecha
      // en que corra la suite.
      const inicio = new Date();
      inicio.setFullYear(inicio.getFullYear() - 1);
      const fin = new Date();
      fin.setFullYear(fin.getFullYear() + 1);

      const contrato = await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: prop.body.id,
          fechaInicio: inicio.toISOString().slice(0, 10),
          fechaFin: fin.toISOString().slice(0, 10),
          montoInicial: monto,
          moneda,
          indice: 'ninguno',
          mesBase: inicio.toISOString().slice(0, 8) + '01',
          honorariosPct: 10,
          locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
          locatarios: [inquilino.body.id],
        })
        .expect(201);

      await http().post(`/v1/contratos/${contrato.body.id}/periodos/generar`)
        .set(...como(inmo))
        .send({ hasta: new Date().toISOString().slice(0, 8) + '01' })
        .expect(201);
    }

    // Una consulta vieja que nadie tocó: alimenta el bloque de frías.
    const persona = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Consulta', apellido: 'Olvidada' }).expect(201);
    await http().post('/v1/oportunidades').set(...como(inmo))
      .send({ personaId: persona.body.id, origen: 'portal', interes: 'alquiler' })
      .expect(201);
  }

  it('el titular ve la cartera y los bloques de plata', async () => {
    const res = await http().get('/v1/inicio').set(...como(inmo)).expect(200);

    expect(res.body.vePlata).toBe(true);
    expect(res.body.cartera.propiedades).toBeGreaterThanOrEqual(2);
    expect(res.body.cartera.contratosVigentes).toBeGreaterThanOrEqual(0);

    expect(res.body.mes).not.toBeNull();
    expect(res.body.impagas).not.toBeNull();
    expect(res.body.liquidacionesBorrador).not.toBeNull();
  });

  it('el contable también: las liquidaciones son su trabajo', async () => {
    const res = await http().get('/v1/inicio').set(...como(inmo, 'contable')).expect(200);
    expect(res.body.vePlata).toBe(true);
    expect(res.body.liquidacionesBorrador).not.toBeNull();
  });

  it('el asesor NO ve los agregados de plata de la inmobiliaria', async () => {
    // Es el mismo permiso que le niega /v1/liquidaciones. Si el inicio se lo
    // mostrara igual, el 403 de allá sería decorativo.
    await http().get('/v1/liquidaciones').set(...como(inmo, 'agente')).expect(403);

    const res = await http().get('/v1/inicio').set(...como(inmo, 'agente')).expect(200);

    expect(res.body.vePlata).toBe(false);
    expect(res.body.mes).toBeNull();
    expect(res.body.impagas).toBeNull();
    expect(res.body.liquidacionesBorrador).toBeNull();

    // Y lo que sí le corresponde sigue estando: el inicio no queda vacío.
    expect(res.body.cartera.propiedades).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.oportunidadesFrias.items)).toBe(true);

    // `null` y no cero: un cero sería un número inventado en una pantalla de
    // plata, que es exactamente lo que este producto no hace.
    expect(res.body.mes).not.toEqual({ cobrado: [], porCobrar: [] });
  });

  it('los importes van por moneda y nunca sumados', async () => {
    const res = await http().get('/v1/inicio').set(...como(inmo)).expect(200);

    for (const importe of [...res.body.mes.porCobrar, ...res.body.impagas.adeudado]) {
      expect(typeof importe.monto).toBe('number');
      expect(['ARS', 'USD']).toContain(importe.moneda);
    }

    // Con un contrato en pesos y otro en dólares impagos, tienen que venir las
    // dos monedas por separado. Un solo importe significaría que se sumaron.
    const monedas = res.body.impagas.adeudado.map((i: { moneda: string }) => i.moneda);
    expect(new Set(monedas).size).toBe(monedas.length);
    expect(monedas).toEqual(expect.arrayContaining(['ARS', 'USD']));
  });

  it('las cuotas impagas traen el saldo y los días de mora', async () => {
    const res = await http().get('/v1/inicio').set(...como(inmo)).expect(200);

    expect(res.body.impagas.total).toBeGreaterThan(0);
    for (const c of res.body.impagas.items) {
      expect(c.saldo).toBeGreaterThan(0);
      expect(c.diasDeMora).toBeGreaterThan(0);
      expect(c.etiquetaPropiedad).toMatch(/^PROP-\d{4}$/);
      // La fecha viaja como texto plano: convertirla a Date le inventa
      // medianoche UTC y corre un día. Ya pasó una vez en este proyecto.
      expect(c.venceEl).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('cero fuga: la vecina no ve nada de esta cartera', async () => {
    const res = await http().get('/v1/inicio').set(...como(otra)).expect(200);

    expect(res.body.cartera.propiedades).toBe(0);
    expect(res.body.cartera.contratosVigentes).toBe(0);
    expect(res.body.impagas.total).toBe(0);
    expect(res.body.impagas.items).toHaveLength(0);
    expect(res.body.impagas.adeudado).toHaveLength(0);
    expect(res.body.vencenEstaSemana).toHaveLength(0);
    expect(res.body.ajustesPorConfirmar.total).toBe(0);
    expect(res.body.oportunidadesFrias.total).toBe(0);
  });

  it('sin sesión no se abre', async () => {
    await http().get('/v1/inicio').expect(401);
  });
});
