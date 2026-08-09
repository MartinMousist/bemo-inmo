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
 * El filtro por agente, en los cinco listados que lo tienen.
 *
 * Lo que se afirma acá, y que antes no afirmaba nadie:
 *
 *  1. **El filtro filtra de verdad**, y el `total` del pager sale del MISMO
 *     `WHERE` que las filas. Es el defecto que más duele en un listado: el pager
 *     dice «57» y la tabla muestra 9, y no hay forma de saber cuál es el número
 *     bueno.
 *  2. **«Las mías» es exactamente «filtrar por mi uuid»**. No hay un valor
 *     mágico `agenteId=mias` en el backend; «las mías» es el front mandando su
 *     propio uuid, y estos tests son lo que lo mantiene cierto.
 *  3. **Aislamiento**: mandar el uuid de un agente de OTRA inmobiliaria devuelve
 *     cero filas, no un 500 y no filas ajenas. RLS ya lo tapa —el filtro corre
 *     dentro de `withTenant`—, pero es justo el test que faltaría el día que
 *     alguien saque un `withTenant` de un servicio.
 *  4. **Un `agenteId` que no es uuid es 400**, no una consulta que devuelve
 *     vacío sin decir por qué.
 *  5. **El filtro NO es un permiso**: un asesor ve la cartera entera y puede
 *     acotarla. La única excepción declarada son los leads, y ahí la denegación
 *     es explícita en vez de una lista vacía.
 */
describe('Filtro por agente y «las mías»', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  /** Los dos captadores de la inmobiliaria bajo prueba. */
  let A: string;
  let B: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('agentes', tk);
    otra = await crearInmobiliaria('agentesvecina', tk);
    A = inmo.usuarios.agente;
    B = inmo.usuarios.admin;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Una propiedad con captador (o sin, con `null`). */
  async function crearPropiedad(
    captador: string | null,
    extra: Record<string, unknown> = {},
    i = inmo,
  ): Promise<string> {
    const r = await http().post('/v1/propiedades').set(...como(i))
      .send({
        calle: `Filtro ${Math.random().toString(36).slice(2, 8)}`,
        numero: '100', localidad: 'Mendoza', provincia: 'Mendoza', tipo: 'departamento',
        ...(captador ? { agenteCaptadorId: captador } : {}),
        ...extra,
      })
      .expect(201);
    return r.body.id;
  }

  async function crearOperacion(
    propiedadId: string,
    tipo: 'venta' | 'alquiler',
    i = inmo,
  ): Promise<string> {
    const r = await http().post(`/v1/propiedades/${propiedadId}/operaciones`).set(...como(i))
      .send({
        tipo,
        precio: tipo === 'venta' ? 150000 : 400000,
        moneda: tipo === 'venta' ? 'USD' : 'ARS',
        estado: 'disponible',
      })
      .expect(201);
    return r.body.operaciones.find((o: { tipo: string }) => o.tipo === tipo).id;
  }

  interface Pagina {
    items: Array<Record<string, unknown>>;
    total: number;
  }

  /** GET a un listado con los parámetros dados, como owner salvo que se diga. */
  async function listar(
    ruta: string,
    query: Record<string, string> = {},
    quien: [Inmobiliaria, 'owner' | 'admin' | 'agente' | 'contable'] = [inmo, 'owner'],
    estado = 200,
  ): Promise<Pagina> {
    const qs = new URLSearchParams({ porPagina: '100', ...query }).toString();
    const r = await http().get(`/v1/${ruta}?${qs}`).set(...como(quien[0], quien[1])).expect(estado);
    return r.body as Pagina;
  }

  // ── Propiedades ────────────────────────────────────────────────────────────

  describe('Propiedades', () => {
    let sinCaptador: string;

    beforeAll(async () => {
      await crearPropiedad(A);
      await crearPropiedad(A);
      await crearPropiedad(B);
      sinCaptador = await crearPropiedad(null);
      // La vecina también tiene lo suyo: si el aislamiento se rompe, se nota.
      await crearPropiedad(otra.usuarios.agente, {}, otra);
    }, 30_000);

    it('filtrar por un agente trae sólo lo de ese agente, y el total coincide', async () => {
      const r = await listar('propiedades', { agenteId: A });

      expect(r.items).toHaveLength(2);
      // El pager y las filas salen del mismo WHERE. Sin esto se puede filtrar
      // la página y no el conteo, y el usuario ve dos números distintos.
      expect(r.total).toBe(2);
      expect(
        r.items.every(
          (p) => (p.agenteCaptador as { id: string } | null)?.id === A,
        ),
      ).toBe(true);
    });

    it('«las mías» de A es exactamente filtrar por el uuid de A', async () => {
      // No existe `agenteId=mias`: «las mías» es el front mandando su uuid.
      // Si algún día alguien agrega un atajo en el backend, esto lo detecta.
      const mias = await listar('propiedades', { agenteId: A }, [inmo, 'agente']);
      const porUuid = await listar('propiedades', { agenteId: A });

      expect(mias.total).toBe(porUuid.total);
      expect(mias.items.map((p) => p.id).sort()).toEqual(porUuid.items.map((p) => p.id).sort());
    });

    it('un asesor ve la cartera ENTERA: el filtro no es un permiso', async () => {
      // Es la decisión de producto: `agenteId` es una herramienta para acotar,
      // no un recorte de lo que un rol puede ver. Los leads son la excepción.
      const todo = await listar('propiedades', {}, [inmo, 'agente']);
      const deB = await listar('propiedades', { agenteId: B }, [inmo, 'agente']);

      expect(todo.total).toBeGreaterThan(deB.total);
      expect(deB.total).toBe(1);
    });

    it('«sin captador» trae las que no tienen ninguno', async () => {
      // No es un caso raro: el INSERT del importador de CSV ni siquiera lista
      // la columna, así que toda propiedad importada nace así.
      const r = await listar('propiedades', { sinCaptador: 'true' });

      expect(r.items.map((p) => p.id)).toContain(sinCaptador);
      expect(r.items.every((p) => p.agenteCaptador === null)).toBe(true);
    });

    it('sinCaptador=false no filtra nada', async () => {
      // `@Type(() => Boolean)` habría hecho que `'false'` valiera `true`. Por eso
      // el DTO usa `@Transform`.
      const con = await listar('propiedades', { sinCaptador: 'false' });
      const sin = await listar('propiedades', {});
      expect(con.total).toBe(sin.total);
    });

    it('el captador se puede vaciar, y por eso «sin captador» tiene salida', async () => {
      const id = await crearPropiedad(A);

      const vaciada = await http().patch(`/v1/propiedades/${id}`).set(...como(inmo))
        .send({ agenteCaptadorId: null }).expect(200);
      expect(vaciada.body.agenteCaptador).toBeNull();

      // Y lo de siempre sigue valiendo: un PATCH que NO manda el campo no lo
      // toca. Es la regla del PATCH parcial, y el captador es la excepción sólo
      // cuando el `null` viene explícito.
      await http().patch(`/v1/propiedades/${id}`).set(...como(inmo))
        .send({ agenteCaptadorId: B }).expect(200);
      const otroCampo = await http().patch(`/v1/propiedades/${id}`).set(...como(inmo))
        .send({ ambientes: 4 }).expect(200);
      expect((otroCampo.body.agenteCaptador as { id: string }).id).toBe(B);
    });

    it('el uuid de un agente de OTRA inmobiliaria devuelve cero, no un error', async () => {
      const r = await listar('propiedades', { agenteId: otra.usuarios.agente });
      expect(r.total).toBe(0);
      expect(r.items).toHaveLength(0);
    });

    it('un agenteId que no es uuid es 400', async () => {
      await listar('propiedades', { agenteId: 'sofia' }, [inmo, 'owner'], 400);
    });
  });

  // ── Cartera de alquileres y listado de contratos ───────────────────────────

  describe('Alquileres', () => {
    beforeAll(async () => {
      for (const captador of [A, A, B]) {
        const propiedadId = await crearPropiedad(captador);
        const operacionId = await crearOperacion(propiedadId, 'alquiler');
        await http().post('/v1/contratos').set(...como(inmo))
          .send({
            propiedadId, operacionId,
            fechaInicio: '2026-01-01', fechaFin: '2028-01-01',
            montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
          })
          .expect(201);
      }
    }, 30_000);

    it('la cartera se filtra por el CAPTADOR de la propiedad', async () => {
      // `contrato_alquiler` no tiene columna de agente: lo único que la base
      // sabe es quién captó el inmueble. Por eso la pantalla dice «Captador» y
      // no «Agente» — quien coloca un inquilino puede ser otra persona.
      const r = await listar('contratos/cartera', { agenteId: A });

      expect(r.total).toBe(2);
      expect(r.items).toHaveLength(2);
      expect(r.items.every((f) => (f.captador as { id: string }).id === A)).toBe(true);
    });

    it('el listado plano de contratos usa el mismo parámetro', async () => {
      const r = await listar('contratos', { agenteId: B });
      expect(r.total).toBe(1);
    });

    it('el conteo de la cartera sale del mismo WHERE que las filas', async () => {
      // Es la trampa concreta de `cartera.service.ts`: el `DONDE` está separado
      // del `SELECT` a propósito y se puede agregar una condición en uno solo.
      const filtrada = await listar('contratos/cartera', { agenteId: A, porPagina: '1' });
      expect(filtrada.total).toBe(2);
      expect(filtrada.items).toHaveLength(1);
    });

    it('el uuid de un agente ajeno devuelve cero', async () => {
      const r = await listar('contratos/cartera', { agenteId: otra.usuarios.agente });
      expect(r.total).toBe(0);
    });

    it('un agenteId que no es uuid es 400 en las dos rutas', async () => {
      await listar('contratos/cartera', { agenteId: 'x' }, [inmo, 'owner'], 400);
      await listar('contratos', { agenteId: 'x' }, [inmo, 'owner'], 400);
    });
  });

  // ── Ventas ─────────────────────────────────────────────────────────────────

  describe('Ventas', () => {
    let ventaDeA: string;

    beforeAll(async () => {
      // Una venta de una propiedad que captó A, sin reparto todavía.
      const p1 = await crearPropiedad(A);
      const op1 = await crearOperacion(p1, 'venta');
      const v1 = await http().post('/v1/ventas').set(...como(inmo))
        .send({ operacionId: op1, precioCierre: 150000, moneda: 'USD' }).expect(201);
      ventaDeA = v1.body.id;

      // Otra que captó B y donde A cobra comisión: A la ve por la comisión, B
      // por la captación. Es el caso que hace que las dos listas se solapen.
      const p2 = await crearPropiedad(B);
      const op2 = await crearOperacion(p2, 'venta');
      const v2 = await http().post('/v1/ventas').set(...como(inmo))
        .send({ operacionId: op2, precioCierre: 200000, moneda: 'USD' }).expect(201);
      await http().post(`/v1/ventas/${v2.body.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { compradora: 3, vendedora: 3 },
          repartoInterno: { captador: { usuarioId: A, nombre: 'A', porcentaje: 25 } },
        })
        .expect(201);
    }, 30_000);

    it('«mis ventas» incluye la que capté aunque todavía no tenga reparto', async () => {
      // El criterio estricto —sólo por `comision.beneficiario_id`— dejaría esta
      // venta afuera: sin reparto no hay ni una fila de comisión. «Mis ventas»
      // aparecería vacío justo cuando la operación se acaba de cerrar, que es
      // cuando más se mira.
      const r = await listar('ventas', { agenteId: A });
      expect(r.items.map((v) => v.id)).toContain(ventaDeA);
    });

    it('«mis ventas» incluye también aquella donde cobro comisión sin haber captado', async () => {
      const r = await listar('ventas', { agenteId: A });
      expect(r.total).toBe(2);

      const deB = await listar('ventas', { agenteId: B });
      expect(deB.total).toBe(1);

      // Y esto es lo que la pantalla tiene que explicar: la suma por agente
      // puede dar MÁS que el total, porque una venta captada por uno y cobrada
      // por otro cuenta para los dos. Sin decirlo parece un error de cuentas.
      const todas = await listar('ventas', {});
      expect(r.total + deB.total).toBeGreaterThan(todas.total);
    });

    it('el uuid de un agente ajeno devuelve cero', async () => {
      const r = await listar('ventas', { agenteId: otra.usuarios.agente });
      expect(r.total).toBe(0);
    });

    it('un agenteId que no es uuid es 400', async () => {
      await listar('ventas', { agenteId: '123' }, [inmo, 'owner'], 400);
    });

    it('el desglose de comisiones por agente SIGUE siendo privado', async () => {
      // El filtro de los listados se abrió; esto no. Es plata del compañero, y
      // que un asesor pueda acotar la lista de ventas no cambia quién puede ver
      // cuánto cobró otro.
      const r = await http().get('/v1/ventas/comisiones/por-agente')
        .set(...como(inmo, 'agente')).expect(200);

      const ids = new Set((r.body as Array<{ agenteId: string }>).map((f) => f.agenteId));
      expect([...ids].every((id) => id === inmo.usuarios.agente)).toBe(true);
    });
  });

  // ── Publicaciones ──────────────────────────────────────────────────────────

  describe('Publicaciones', () => {
    beforeAll(async () => {
      for (const captador of [A, B]) {
        const propiedadId = await crearPropiedad(captador);
        const operacionId = await crearOperacion(propiedadId, 'alquiler');
        await http().post('/v1/publicaciones').set(...como(inmo))
          .send({ operacionId, portal: 'zonaprop' }).expect(201);
      }
    }, 30_000);

    it('los avisos se filtran por el captador de la propiedad', async () => {
      const r = await listar('publicaciones', { agenteId: A });

      expect(r.total).toBe(1);
      expect(r.items[0].captadorId).toBe(A);
    });

    it('la fila trae el captador aunque no haya filtro', async () => {
      // Una lista filtrada por una persona en la que no se ve el nombre obliga
      // a confiar en el filtro a ciegas.
      const r = await listar('publicaciones', {});
      expect(r.items.every((p) => 'captadorNombre' in p)).toBe(true);
    });

    it('el uuid de un agente ajeno devuelve cero', async () => {
      const r = await listar('publicaciones', { agenteId: otra.usuarios.agente });
      expect(r.total).toBe(0);
    });

    it('un agenteId que no es uuid es 400', async () => {
      await listar('publicaciones', { agenteId: 'zonaprop' }, [inmo, 'owner'], 400);
    });
  });

  // ── Leads: la excepción declarada ──────────────────────────────────────────

  describe('Leads', () => {
    beforeAll(async () => {
      for (const rol of ['owner', 'agente'] as const) {
        const persona = await http().post('/v1/personas').set(...como(inmo, rol))
          .send({ nombre: 'Interesado', apellido: rol }).expect(201);
        await http().post('/v1/oportunidades').set(...como(inmo, rol))
          .send({ personaId: persona.body.id, origen: 'whatsapp' }).expect(201);
      }
    }, 30_000);

    it('un titular filtra por cualquier agente', async () => {
      const r = await listar('oportunidades', { agenteId: inmo.usuarios.agente });
      expect(r.items.every((o) => o.agenteId === inmo.usuarios.agente)).toBe(true);
    });

    it('un asesor que filtra por un compañero recibe un 403, no una lista vacía', async () => {
      // Antes eran DOS condiciones sobre la misma columna —la pedida y la
      // forzada— y no se podían cumplir a la vez: el asesor recibía cero filas,
      // indistinguible de «ese agente no tiene leads». Un bug de datos
      // fabricado. La regla no cambió; lo que cambió es que ahora lo dice.
      await listar(
        'oportunidades',
        { agenteId: inmo.usuarios.owner },
        [inmo, 'agente'],
        403,
      );
    });

    it('un asesor filtrando por sí mismo sigue funcionando', async () => {
      const r = await listar(
        'oportunidades',
        { agenteId: inmo.usuarios.agente },
        [inmo, 'agente'],
      );
      expect(r.items.every((o) => o.agenteId === inmo.usuarios.agente)).toBe(true);
    });

    it('los leads siguen siendo privados por agente: sin filtro, ve sólo los suyos', async () => {
      // Es la única excepción al «el filtro no es un permiso», y no se tocó: la
      // razón está escrita en el servicio y abrirla no se revierte con un
      // deploy. Si algún día se decide abrirlos, este test es el que hay que
      // borrar a mano — que es justamente el punto.
      const r = await listar('oportunidades', {}, [inmo, 'agente']);
      expect(r.items.every((o) => o.agenteId === inmo.usuarios.agente)).toBe(true);
      expect(r.items.length).toBeGreaterThan(0);

      const todos = await listar('oportunidades', {});
      expect(todos.total).toBeGreaterThan(r.total);
    });
  });
});
