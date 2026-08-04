import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import type { FilaCartera } from '../src/alquileres/cartera.service';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * La cartera de alquileres en formato de gestión.
 *
 * Lo que importa acá es que las cuatro columnas derivadas —próximo aumento,
 * última cuota, saldo y estado de cobranza— digan lo mismo que diría entrar a la
 * ficha de cada contrato. Si el listado dice "al día" y la ficha muestra una
 * cuota vencida, la pantalla es peor que no tenerla.
 */
describe('Cartera de alquileres', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('cartera', tk);
    otra = await crearInmobiliaria('carteravecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Un contrato que arrancó hace un año: tiene cuotas ya vencidas. */
  async function crearContrato(
    calle: string,
    extra: Record<string, unknown> = {},
    i = inmo,
  ) {
    const prop = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle, numero: '10', localidad: 'Godoy Cruz', tipo: 'departamento' })
      .expect(201);

    const dueno = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Dueña', apellido: calle }).expect(201);
    const inquilino = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Inquilino', apellido: calle }).expect(201);

    const inicio = new Date();
    inicio.setFullYear(inicio.getFullYear() - 1);
    const fin = new Date();
    fin.setFullYear(fin.getFullYear() + 1);

    const c = await http().post('/v1/contratos').set(...como(i))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: inicio.toISOString().slice(0, 10),
        fechaFin: fin.toISOString().slice(0, 10),
        montoInicial: 400000,
        moneda: 'ARS',
        indice: 'ninguno',
        mesBase: `${inicio.toISOString().slice(0, 8)}01`,
        honorariosPct: 10,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inquilino.body.id],
        ...extra,
      })
      .expect(201);

    return { contrato: c.body, dueno: dueno.body, inquilino: inquilino.body };
  }

  async function generarCuotas(contratoId: string) {
    await http().post(`/v1/contratos/${contratoId}/periodos/generar`)
      .set(...como(inmo))
      .send({ hasta: new Date().toISOString().slice(0, 8) + '01' })
      .expect(201);

    const per = await http().get(`/v1/contratos/${contratoId}/periodos?porPagina=100`)
      .set(...como(inmo)).expect(200);
    return per.body.items as Array<{ id: string; total: number; venceEl: string; periodo: string }>;
  }

  /** El tipo real del endpoint: si la forma cambia, estos tests dejan de compilar. */
  function fila(body: { items: FilaCartera[] }, contratoId: string): FilaCartera {
    const f = body.items.find((x) => x.id === contratoId);
    if (!f) throw new Error(`el contrato ${contratoId} no está en la cartera`);
    return f;
  }

  it('sin cuotas generadas el estado es "sin_cuotas", no "al día"', async () => {
    // La diferencia importa: "al día" dice que no hay nada que cobrar, y acá lo
    // que pasa es que todavía no se generó nada para cobrar.
    const { contrato } = await crearContrato('Sin Cuotas');

    const r = await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200);
    const f = fila(r.body, contrato.id);

    expect(f.cobranza.estado).toBe('sin_cuotas');
    expect(f.cobranza.adeudado).toBe(0);
    expect(f.ultimaCuota).toBeNull();
  });

  it('con cuotas vencidas sin cobrar el estado es "en_mora" y trae el saldo', async () => {
    const { contrato } = await crearContrato('En Mora');
    const cuotas = await generarCuotas(contrato.id);

    const r = await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200);
    const f = fila(r.body, contrato.id);

    expect(f.cobranza.estado).toBe('en_mora');
    expect(f.cobranza.cuotasEnMora).toBeGreaterThan(0);
    // El adeudado es la suma de los saldos, no el de la última cuota.
    expect(f.cobranza.adeudado).toBeGreaterThan(400000);
    expect(f.cobranza.moraDesde).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // La última cuota es la MÁS RECIENTE, no la más vieja.
    const ultimoPeriodo = cuotas.map((c) => c.periodo).sort().at(-1);
    expect(f.ultimaCuota?.periodo).toBe(ultimoPeriodo);
  });

  it('una cuota vencida a medio pagar es mora, no "parcial"', async () => {
    // Si se mostrara como "parcial", se perdería entre las que están en camino
    // y nadie la reclamaría.
    const { contrato } = await crearContrato('Media Paga');
    const cuotas = await generarCuotas(contrato.id);
    const vieja = cuotas.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: vieja.id, monto: 100000 }).expect(201);

    const r = await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200);
    const f = fila(r.body, contrato.id);

    expect(f.cobranza.estado).toBe('en_mora');
  });

  it('el saldo del contrato descuenta lo ya cobrado', async () => {
    const { contrato } = await crearContrato('Con Cobro');
    const cuotas = await generarCuotas(contrato.id);

    const antes = fila(
      (await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200)).body,
      contrato.id,
    );

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: cuotas[0].id, monto: 150000 }).expect(201);

    const despues = fila(
      (await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200)).body,
      contrato.id,
    );

    expect(despues.cobranza.adeudado).toBe(antes.cobranza.adeudado - 150000);
  });

  /**
   * Carga IPC **mes a mes** para un año.
   *
   * Mes a mes y no salteado porque el motor usa el índice del mes ANTERIOR al
   * ajuste: el IPC de un mes se publica a mediados del siguiente, así que el de
   * "este mes" nunca está a tiempo. Cargar sólo los meses del ajuste hace que la
   * proyección no cree nada y el test falle por el motivo equivocado.
   *
   * Cada test usa un año propio: los índices son globales y no se limpian entre
   * corridas, así que apoyarse en los que dejó otra suite es una dependencia
   * invisible que rompe el día que esa suite cambia.
   */
  async function cargarIpcDeUnAnio(anio: number) {
    const valores = Array.from({ length: 12 }, (_, i) => ({
      tipo: 'ipc',
      periodo: `${anio}-${String(i + 1).padStart(2, '0')}-01`,
      valor: 100 + i * 2,
    }));
    // Sin `.expect()`: si una corrida anterior ya los cargó, devuelve
    // INDICE_YA_CARGADO y está bien — un valor cargado no se pisa, por diseño.
    await http().post('/v1/indices/lote').set(...como(inmo)).send({ valores });
  }

  it('trae el próximo aumento pendiente y marca el que ya rige sin confirmar', async () => {
    await cargarIpcDeUnAnio(2014);

    const { contrato } = await crearContrato('Con Ajuste', {
      fechaInicio: '2014-01-01',
      fechaFin: '2016-12-31',
      indice: 'ipc',
      periodicidadMeses: 3,
      mesBase: '2014-01-01',
    });

    await http().post(`/v1/contratos/${contrato.id}/ajustes/proyectar`)
      .set(...como(inmo)).expect(201);

    const r = await http().get('/v1/contratos/cartera').set(...como(inmo)).expect(200);
    const f = fila(r.body, contrato.id);

    expect(f.proximoAjuste).not.toBeNull();
    expect(f.proximoAjuste?.estado).toBe('proyectado');
    expect(f.proximoAjuste?.montoNuevo).toBeGreaterThan(400000);
    // Rige desde 2011 y sigue proyectado: es plata que se está perdiendo.
    expect(f.proximoAjuste?.vencido).toBe(true);
  });

  it('un aumento ya confirmado y en vigencia NO es el "próximo aumento"', async () => {
    // Ése es el alquiler de hoy, no algo por resolver. Mostrarlo en la columna
    // hacía que dijera "01/04" cuando lo que faltaba confirmar era el de julio,
    // y el aumento pendiente quedaba invisible en la lista.
    await cargarIpcDeUnAnio(2015);

    const { contrato } = await crearContrato('Ya Aplicado', {
      fechaInicio: '2015-01-01',
      fechaFin: '2017-12-31',
      indice: 'ipc',
      periodicidadMeses: 3,
      mesBase: '2015-01-01',
    });

    await http().post(`/v1/contratos/${contrato.id}/ajustes/proyectar`)
      .set(...como(inmo)).expect(201);

    const ajustes = await http().get(`/v1/contratos/${contrato.id}/ajustes?porPagina=100`)
      .set(...como(inmo)).expect(200);
    const porFecha = (ajustes.body.items as Array<{ id: string; vigenteDesde: string }>)
      .sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));

    // Confirmo el más viejo: rige desde 2012, o sea que ya está aplicado.
    await http().post(`/v1/ajustes/${porFecha[0].id}/confirmar`)
      .set(...como(inmo)).expect(201);

    const r = await http().get('/v1/contratos/cartera?porPagina=100')
      .set(...como(inmo)).expect(200);
    const f = fila(r.body, contrato.id);

    expect(f.proximoAjuste).not.toBeNull();
    expect(f.proximoAjuste?.id).not.toBe(porFecha[0].id);
    expect(f.proximoAjuste?.estado).toBe('proyectado');
  });

  // ── Filtros ───────────────────────────────────────────────────────────────

  it('filtra por estado de cobranza, y el total cuenta con el filtro', async () => {
    const conFiltro = await http()
      .get('/v1/contratos/cartera?cobranza=sin_cuotas&porPagina=100')
      .set(...como(inmo)).expect(200);
    const sinFiltro = await http()
      .get('/v1/contratos/cartera?porPagina=100')
      .set(...como(inmo)).expect(200);

    expect(conFiltro.body.items.length).toBeGreaterThan(0);
    expect(
      conFiltro.body.items.every(
        (f: { cobranza: { estado: string } }) => f.cobranza.estado === 'sin_cuotas',
      ),
    ).toBe(true);
    // Si el count ignorara el WHERE, el paginador diría 8 y mostraría 2.
    expect(conFiltro.body.total).toBe(conFiltro.body.items.length);
    expect(sinFiltro.body.total).toBeGreaterThan(conFiltro.body.total);
  });

  it('filtra por índice', async () => {
    const r = await http().get('/v1/contratos/cartera?indice=ipc&porPagina=100')
      .set(...como(inmo)).expect(200);

    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((f: { indice: string }) => f.indice === 'ipc')).toBe(true);
  });

  it('filtra por mes de vencimiento del contrato', async () => {
    const r = await http().get('/v1/contratos/cartera?venceEn=2016-12&porPagina=100')
      .set(...como(inmo)).expect(200);

    expect(r.body.items.length).toBeGreaterThan(0);
    expect(
      r.body.items.every((f: { fechaFin: string }) => f.fechaFin.startsWith('2016-12')),
    ).toBe(true);
  });

  it('un mes inválido es 400, no una lista vacía', async () => {
    // Vacío sin explicación hace pensar que no hay contratos, cuando lo que hay
    // es un filtro mal escrito.
    await http().get('/v1/contratos/cartera?venceEn=2026-13').set(...como(inmo)).expect(400);
    await http().get('/v1/contratos/cartera?venceEn=diciembre').set(...como(inmo)).expect(400);
    await http().get('/v1/contratos/cartera?cobranza=inventado').set(...como(inmo)).expect(400);
  });

  it('busca por nombre del inquilino', async () => {
    const r = await http().get('/v1/contratos/cartera?q=En Mora&porPagina=100')
      .set(...como(inmo)).expect(200);

    expect(r.body.items.length).toBeGreaterThan(0);
    expect(
      r.body.items.some((f: { inquilino: string }) => f.inquilino?.includes('En Mora')),
    ).toBe(true);
  });

  // ── Lote ──────────────────────────────────────────────────────────────────

  it('el lote devuelve un parte por contrato: uno que falla no tira a los demás', async () => {
    const { contrato: bueno } = await crearContrato('Lote Bueno');
    // Intermediación: no genera cuotas y devuelve 422 en la ficha.
    const { contrato: intermediado } = await crearContrato('Lote Intermediado', {
      administrado: false,
    });

    const r = await http().post('/v1/contratos/lote/periodos').set(...como(inmo))
      .send({ ids: [bueno.id, intermediado.id], hasta: new Date().toISOString().slice(0, 10) })
      .expect(201);

    expect(r.body.total).toBe(2);
    expect(r.body.exitosos).toBe(1);

    const ok = r.body.resultados.find((x: { contratoId: string }) => x.contratoId === bueno.id);
    const falla = r.body.resultados.find(
      (x: { contratoId: string }) => x.contratoId === intermediado.id,
    );

    expect(ok.ok).toBe(true);
    expect(falla.ok).toBe(false);
    // Con el motivo, no un "algunos fallaron" que obliga a revisarlos a mano.
    expect(falla.detalle).toMatch(/intermediaci/i);
  });

  it('el lote acota la cantidad de ids y valida su formato', async () => {
    await http().post('/v1/contratos/lote/periodos').set(...como(inmo))
      .send({ ids: Array.from({ length: 201 }, () => crypto.randomUUID()) })
      .expect(400);

    await http().post('/v1/contratos/lote/periodos').set(...como(inmo))
      .send({ ids: ['no-es-un-uuid'] })
      .expect(400);
  });

  it('el asesor no puede correr acciones en lote', async () => {
    // Generar cuotas es tocar plata: mismo criterio que la acción individual.
    await http().post('/v1/contratos/lote/periodos').set(...como(inmo, 'agente'))
      .send({ ids: [] }).expect(403);
    await http().post('/v1/contratos/lote/ajustes/proyectar').set(...como(inmo, 'agente'))
      .send({ ids: [] }).expect(403);
  });

  // ── Aislamiento ───────────────────────────────────────────────────────────

  it('cero fuga: la vecina no ve la cartera ajena', async () => {
    const r = await http().get('/v1/contratos/cartera?porPagina=100')
      .set(...como(otra)).expect(200);

    expect(r.body.items).toHaveLength(0);
    expect(r.body.total).toBe(0);
  });

  it('un contrato ajeno en el lote no se toca', async () => {
    const { contrato: ajeno } = await crearContrato('Ajeno', {}, otra);

    const r = await http().post('/v1/contratos/lote/periodos').set(...como(inmo))
      .send({ ids: [ajeno.id] })
      .expect(201);

    // RLS lo hace invisible: el contrato "no existe" para esta inmobiliaria.
    expect(r.body.exitosos).toBe(0);
    expect(r.body.resultados[0].ok).toBe(false);

    // Y del otro lado no se generó nada.
    const per = await http().get(`/v1/contratos/${ajeno.id}/periodos?porPagina=100`)
      .set(...como(otra)).expect(200);
    expect(per.body.items).toHaveLength(0);
  });
});
