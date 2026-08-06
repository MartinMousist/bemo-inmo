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
 * El tablero.
 *
 * Lo que se prueba acá, en orden de importancia:
 *
 *  1. **No es una puerta de atrás a la plata.** Mismo criterio que `/inicio`:
 *     un asesor recibe 403 en `/v1/liquidaciones`, así que la cobranza y los
 *     honorarios tienen que venir en `null`. Un permiso que se puede esquivar
 *     por otra puerta no es un permiso.
 *  2. **Cero fuga entre inmobiliarias.**
 *  3. **`null` no es cero.** Es la regla del playbook que más se rompe sola: un
 *     `avg()` sobre cero filas devuelve `NULL`, y convertirlo a 0 en el camino
 *     inventa un dato justo donde importa.
 *  4. **Las monedas no se mezclan.**
 */
describe('Tablero', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('tablero', tk);
    otra = await crearInmobiliaria('tablerovecina', tk);
    await armarCartera();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());
  const mes = () => new Date().toISOString().slice(0, 8) + '01';

  /**
   * Dos contratos, uno en pesos y otro en dólares, con un año de cuotas
   * generadas y ninguna cobrada. Las dos monedas están para que se note si
   * alguien las suma; el año hacia atrás, para que haya deuda vencida sin
   * depender del día en que corra la suite.
   */
  async function armarCartera() {
    for (const [moneda, monto] of [['ARS', 500000], ['USD', 1200]] as const) {
      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: `Tablero ${moneda}`, numero: '200', tipo: 'departamento' })
        .expect(201);

      await http().post(`/v1/propiedades/${prop.body.id}/operaciones`).set(...como(inmo))
        .send({ tipo: 'alquiler', precio: monto, moneda, estado: 'disponible' })
        .expect(201);

      const dueno = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Dueño', apellido: `Tablero ${moneda}` }).expect(201);
      const inquilino = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Inquilino', apellido: `Tablero ${moneda}` }).expect(201);

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
        .send({ hasta: mes() })
        .expect(201);
    }

    // Una oportunidad perdida con motivo: es la columna que se llena desde la
    // etapa 3 y que hasta este endpoint no leía nadie.
    const persona = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Consulta', apellido: 'Perdida' }).expect(201);
    const op = await http().post('/v1/oportunidades').set(...como(inmo))
      .send({ personaId: persona.body.id, origen: 'portal', interes: 'venta' })
      .expect(201);
    await http().patch(`/v1/oportunidades/${op.body.id}`).set(...como(inmo))
      .send({ estado: 'perdida', motivoPerdida: 'precio' })
      .expect(200);
  }

  // ── Permisos ──────────────────────────────────────────────────────────────

  it('el titular ve todos los bloques', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);

    expect(res.body.vePlata).toBe(true);
    expect(res.body.cobranza).not.toBeNull();
    expect(res.body.negocio).not.toBeNull();
    expect(res.body.cartera).toBeDefined();
    expect(res.body.embudo).toBeDefined();
  });

  it('el contable también: la cobranza es su trabajo', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo, 'contable')).expect(200);
    expect(res.body.vePlata).toBe(true);
    expect(res.body.cobranza).not.toBeNull();
    expect(res.body.negocio).not.toBeNull();
  });

  it('el asesor NO ve cobranza ni honorarios, y sí ve su embudo', async () => {
    // El mismo permiso que le niega /v1/liquidaciones. Si el tablero se lo
    // mostrara igual, el 403 de allá sería decorativo.
    await http().get('/v1/liquidaciones').set(...como(inmo, 'agente')).expect(403);

    const res = await http().get('/v1/tablero').set(...como(inmo, 'agente')).expect(200);

    expect(res.body.vePlata).toBe(false);
    expect(res.body.cobranza).toBeNull();
    expect(res.body.negocio).toBeNull();

    // Y no queda vacío: lo que es su trabajo sigue estando.
    expect(res.body.embudo.etapas.length).toBeGreaterThan(0);
    expect(res.body.cartera.unidades).toBeGreaterThanOrEqual(2);
  });

  it('sin token no hay tablero', async () => {
    await http().get('/v1/tablero').expect(401);
  });

  // ── Aislamiento ───────────────────────────────────────────────────────────

  it('la inmobiliaria vecina no ve nada de esta cartera', async () => {
    const res = await http().get('/v1/tablero').set(...como(otra)).expect(200);

    expect(res.body.cartera.unidades).toBe(0);
    expect(res.body.cartera.contratosVigentes).toBe(0);
    expect(res.body.cobranza.emitido).toEqual([]);
    expect(res.body.cobranza.deudaVencida).toEqual([]);
    expect(res.body.embudo.etapas.every((e: { total: number }) => e.total === 0)).toBe(true);
  });

  // ── Las reglas del dominio ────────────────────────────────────────────────

  it('los importes van por moneda y nunca sumados', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);

    const monedas = res.body.cobranza.emitido.map((i: { moneda: string }) => i.moneda).sort();
    expect(monedas).toEqual(['ARS', 'USD']);

    // Y el aging también: una barra que mezcle 500.000 pesos con 1.200 dólares
    // no significa nada.
    for (const tramo of res.body.cobranza.aging) {
      const m = tramo.importes.map((i: { moneda: string }) => i.moneda);
      expect(new Set(m).size).toBe(m.length);
    }
  });

  it('sin ningún cobro, los días promedio vienen en null y NO en cero', async () => {
    // Es la diferencia entre "cobramos el mismo día del vencimiento" y "no
    // cobramos nada". Un cero acá sería un número inventado.
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
    expect(res.body.cobranza.diasPromedioCobro.valor).toBeNull();
  });

  it('la tasa de cobranza es 0 con cuotas emitidas y nada cobrado, no null', async () => {
    // Al revés que el caso anterior: acá SÍ hay dato —se emitió y no entró
    // nada— y el cero es verdadero. La distinción es el punto.
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
    expect(res.body.cobranza.tasa.valor).toBe(0);
  });

  it('sin unidades ni contratos, la ocupación es null y no una división por cero', async () => {
    const res = await http().get('/v1/tablero').set(...como(otra)).expect(200);
    expect(res.body.cartera.ocupacion.valor).toBeNull();
    expect(res.body.cartera.renovacion.valor).toBeNull();
    expect(res.body.cartera.vacanciaDias).toBeNull();
  });

  it('el aging trae los cuatro tramos siempre, aunque estén vacíos', async () => {
    // Una barra que desaparece cuando vale cero hace que el gráfico cambie de
    // forma entre meses y no se pueda comparar.
    const res = await http().get('/v1/tablero').set(...como(otra)).expect(200);
    expect(res.body.cobranza.aging.map((a: { tramo: string }) => a.tramo))
      .toEqual(['1-30', '31-60', '61-90', '+90']);
  });

  it('la deuda vencida aparece con las dos monedas separadas', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
    const deuda = res.body.cobranza.deudaVencida;
    expect(deuda.length).toBe(2);
    expect(deuda.map((d: { moneda: string }) => d.moneda)).toEqual(['ARS', 'USD']);
    for (const d of deuda) expect(d.monto).toBeGreaterThan(0);
  });

  it('el embudo trae las siete etapas en orden, y el motivo de pérdida que nadie leía', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);

    expect(res.body.embudo.etapas.map((e: { estado: string }) => e.estado)).toEqual([
      'nueva', 'contactada', 'calificada', 'visita', 'negociacion', 'ganada', 'perdida',
    ]);
    expect(res.body.embudo.motivosPerdida).toEqual([{ motivo: 'precio', total: 1 }]);
    expect(res.body.embudo.porOrigen.find((o: { origen: string }) => o.origen === 'portal').total)
      .toBe(1);
  });

  it('las series traen doce meses, para que el sparkline no cambie de ancho', async () => {
    const res = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
    expect(res.body.cobranza.serieTasa).toHaveLength(12);
    expect(res.body.cartera.serieVigentes).toHaveLength(12);
  });

  it('acepta un período y devuelve su base a un año exacto', async () => {
    const res = await http().get('/v1/tablero?periodo=2026-03-17').set(...como(inmo)).expect(200);
    // Se normaliza al día 1: un período es un mes, no una fecha.
    expect(res.body.periodo).toBe('2026-03-01');
    expect(res.body.periodoBase).toBe('2025-03-01');
  });

  it('un período mal formado es 400, no un tablero de otra cosa', async () => {
    await http().get('/v1/tablero?periodo=marzo').set(...como(inmo)).expect(400);
  });
});
