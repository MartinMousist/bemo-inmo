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
 * Paginación de las listas que antes devolvían todo.
 *
 * `ventas`, `liquidaciones`, `publicaciones`, `avisos` e `indices` respondían el
 * conjunto entero. El plan Medio vende **500 propiedades**, así que la lista se
 * rompía dentro del límite que cobramos.
 *
 * Lo que se prueba acá es el contrato, no cada filtro (eso vive en la suite de
 * cada módulo):
 *  - la respuesta tiene forma de página, no de array;
 *  - `total` cuenta TODO, no lo que entró en la página;
 *  - `total` respeta RLS y los filtros — si contara de más, el paginador de una
 *    inmobiliaria revelaría el volumen de otra;
 *  - las páginas no se pisan ni se saltean filas.
 */

const LISTAS = [
  { ruta: '/v1/ventas', rol: 'owner' as const },
  { ruta: '/v1/liquidaciones', rol: 'contable' as const },
  { ruta: '/v1/publicaciones', rol: 'owner' as const },
  { ruta: '/v1/avisos', rol: 'owner' as const },
  { ruta: '/v1/indices', rol: 'owner' as const },
  // Segunda tanda. `vencimientos` era un UNION ALL de tres tablas sobre TODA la
  // cartera sin ningún LIMIT; los otros dos crecen con el TIEMPO —un contrato de
  // diez años son 120 cuotas— y no con la cantidad de propiedades.
  { ruta: '/v1/contratos/vencimientos', rol: 'owner' as const },
  { ruta: '/v1/auditoria', rol: 'contable' as const },
];

/**
 * Lo que queda SIN paginar, a propósito, y por qué.
 *
 * Está acá para que sea una decisión y no un olvido: si mañana uno de estos deja
 * de estar acotado por lo que dice el comentario, el lugar donde se discute es
 * este test.
 *
 *  · `/v1/equipo` — la cantidad de gente que trabaja en la inmobiliaria.
 *  · `/v1/plantillas` — las ocho base más las que alguien escriba.
 *  · `/v1/ventas/comisiones/por-agente` — es un AGREGADO, no una lista: una fila
 *    por (agente × moneda × estado). Paginarlo sería partir un total en pedazos.
 */
const SIN_PAGINAR = [
  '/v1/equipo',
  '/v1/plantillas',
  '/v1/ventas/comisiones/por-agente',
];

describe('Paginación de las listas', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('pag', app.get(TokensService));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (rol: 'owner' | 'contable' = 'owner') => auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  it.each(LISTAS)('$ruta devuelve una página, no un array', async ({ ruta, rol }) => {
    const res = await http().get(ruta).set(...como(rol)).expect(200);

    expect(Array.isArray(res.body)).toBe(false);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.pagina).toBe(1);
    expect(res.body.paginas).toBeGreaterThanOrEqual(1);
    // Nunca vienen más filas que las pedidas: es lo único que impide que una
    // cartera grande vuelva a devolverse entera.
    expect(res.body.items.length).toBeLessThanOrEqual(res.body.porPagina);
  });

  it.each(LISTAS)('$ruta acota porPagina y rechaza lo absurdo', async ({ ruta, rol }) => {
    const uno = await http().get(`${ruta}?porPagina=1`).set(...como(rol)).expect(200);
    expect(uno.body.items.length).toBeLessThanOrEqual(1);
    expect(uno.body.porPagina).toBe(1);

    // El tope de 100 es lo que impide que un cliente pida `porPagina=999999` y
    // vuelva a traerse todo por la puerta de atrás.
    await http().get(`${ruta}?porPagina=500`).set(...como(rol)).expect(400);
    await http().get(`${ruta}?pagina=0`).set(...como(rol)).expect(400);
    await http().get(`${ruta}?pagina=-3`).set(...como(rol)).expect(400);
  });

  it.each(LISTAS)('$ruta: una página vacía no miente sobre el total', async ({ ruta, rol }) => {
    const primera = await http().get(`${ruta}?porPagina=1`).set(...como(rol)).expect(200);

    // Una página muy lejos: sin filas, pero el total sigue siendo el real.
    const lejos = await http()
      .get(`${ruta}?porPagina=1&pagina=9999`)
      .set(...como(rol))
      .expect(200);

    expect(lejos.body.items).toHaveLength(0);
    expect(lejos.body.total).toBe(primera.body.total);
  });

  /**
   * Los índices son la única lista con datos garantizados: son globales y no se
   * limpian entre corridas. Sirve para probar el recorrido de verdad.
   *
   * ⚠️ Justamente por ser globales, lo que se cargue acá lo ven las demás suites
   * y no se puede borrar (un valor cargado es inmutable a propósito). Por eso se
   * usa una **ventana de años que ningún otro test toca** y todas las consultas
   * la acotan con `desde`+`hasta`. Cargar `icp` "porque estaba vacío" rompió el
   * test que afirma que `icp` no tiene valores.
   */
  const VENTANA = 'tipo=ipc&desde=2011-01-01&hasta=2011-12-31';

  describe('índices — el recorrido no pisa ni saltea filas', () => {
    beforeAll(async () => {
      for (let mes = 1; mes <= 6; mes++) {
        await http()
          .post('/v1/indices')
          .set(...como())
          .send({ tipo: 'ipc', periodo: `2011-0${mes}-01`, valor: 100 + mes });
        // Sin .expect(): si una corrida anterior ya los cargó, devuelve
        // INDICE_YA_CARGADO y está bien — un valor no se pisa, por diseño.
      }
    }, 30_000);

    it('dos páginas de 3 dan las mismas 6 filas que una de 6', async () => {
      const entera = await http()
        .get(`/v1/indices?${VENTANA}&porPagina=6&pagina=1`)
        .set(...como())
        .expect(200);

      const p1 = await http()
        .get(`/v1/indices?${VENTANA}&porPagina=3&pagina=1`)
        .set(...como())
        .expect(200);
      const p2 = await http()
        .get(`/v1/indices?${VENTANA}&porPagina=3&pagina=2`)
        .set(...como())
        .expect(200);

      expect(entera.body.items).toHaveLength(6);
      expect(p1.body.items).toHaveLength(3);
      expect(p2.body.items).toHaveLength(3);
      expect([...p1.body.items, ...p2.body.items]).toEqual(entera.body.items);

      // Ninguna fila aparece en las dos páginas.
      const periodos = [...p1.body.items, ...p2.body.items].map(
        (v: { periodo: string }) => v.periodo,
      );
      expect(new Set(periodos).size).toBe(periodos.length);
    });

    it('el total cuenta con el filtro puesto, no la tabla entera', async () => {
      const filtrado = await http()
        .get(`/v1/indices?${VENTANA}&porPagina=1`)
        .set(...como())
        .expect(200);
      const sinVentana = await http()
        .get('/v1/indices?tipo=ipc&porPagina=1')
        .set(...como())
        .expect(200);

      expect(filtrado.body.total).toBe(6);
      // Las demás suites cargan IPC de 2025/2026: fuera de la ventana hay más.
      // Si el count ignorara el WHERE, los dos totales serían iguales.
      expect(sinVentana.body.total).toBeGreaterThan(filtrado.body.total);
    });

    it('`hasta` cierra la ventana por arriba', async () => {
      const hastaMarzo = await http()
        .get('/v1/indices?tipo=ipc&desde=2011-01-01&hasta=2011-03-31&porPagina=100')
        .set(...como())
        .expect(200);

      expect(hastaMarzo.body.total).toBe(3);
      expect(
        hastaMarzo.body.items.every((v: { periodo: string }) => v.periodo <= '2011-03-31'),
      ).toBe(true);
    });
  });

  it.each(SIN_PAGINAR)('%s sigue devolviendo un array, y está bien', async (ruta) => {
    // No es un olvido: cada uno está acotado por algo real. Ver el comentario de
    // SIN_PAGINAR. Si alguno deja de estarlo, este test es el lugar de la
    // discusión — no una lista que un día devuelve 8.000 filas en silencio.
    const res = await http().get(ruta).set(...como()).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('las listas siguen respetando los roles', async () => {
    // Paginar no puede haber aflojado un permiso de paso.
    await http().get('/v1/liquidaciones').set(...auth(inmo.tokens.agente)).expect(403);
    await http().get('/v1/liquidaciones').set(...auth(inmo.tokens.contable)).expect(200);
  });
});
