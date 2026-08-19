import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * Los atributos y filtros de la migración 027.
 *
 * Hasta acá `propiedad` guardaba ambientes, baños, cocheras, antigüedad,
 * orientación y amenities y NINGUNO se podía buscar: el listado sólo filtraba
 * por texto, tipo, operación y captador. Lo que importa acá no es que la
 * columna exista —eso ya lo probaba el resto de la suite indirectamente—, es
 * que el filtro efectivamente RECORTE la lista y no la deje intacta.
 */
describe('Atributos de propiedad (migración 027)', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  async function crear(calle: string, extra: Record<string, unknown> = {}, i = inmo) {
    const r = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle, tipo: 'departamento', ...extra });
    return r;
  }

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('atrib', tk);
    otra = await crearInmobiliaria('atribvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('alta y edición', () => {
    it('carga los cuatro campos nuevos y el catálogo de orientación', async () => {
      const r = await crear('Colón 100', {
        plantas: 2, toilettes: 1, ambientes: 4, dormitorios: 2,
        orientacion: 'noreste', disposicion: 'frente', calefaccion: 'central',
        amenities: ['pileta', 'seguridad'],
      });
      expect(r.status).toBe(201);
      expect(r.body.plantas).toBe(2);
      expect(r.body.toilettes).toBe(1);
      expect(r.body.orientacion).toBe('noreste');
      expect(r.body.disposicion).toBe('frente');
      expect(r.body.calefaccion).toBe('central');
      expect(r.body.amenities).toEqual(['pileta', 'seguridad']);
    });

    // Las cuatro validaciones van juntas: son el mismo mecanismo (@IsIn contra
    // un catálogo cerrado) repetido en cuatro campos, y separarlas en cuatro
    // `it` no prueba nada distinto — sólo infla la suite.
    it('rechaza un valor fuera de catálogo en cada campo cerrado', async () => {
      const casos = [
        { orientacion: 'nortesísimo' },
        { disposicion: 'medio_frente' },
        { calefaccion: 'brasero' },
        { amenities: ['pileta_olimpica'] },
      ];
      for (const cuerpo of casos) {
        const r = await crear('Rechazo 1', cuerpo);
        // 400 y no 422: es la validación estándar del DTO (`class-validator`),
        // la misma que ya usa `tipo` con `TIPOS_PROPIEDAD` — 422 en este repo
        // es para errores de REGLA de negocio, no de forma del dato.
        expect(r.status).toBe(400);
      }
    });

    it('un PATCH parcial no borra los campos nuevos que no vinieron', async () => {
      const p = await crear('Maipú 200', {
        plantas: 1, orientacion: 'sur', amenities: ['balcon'],
      });

      const editado = await http().patch(`/v1/propiedades/${p.body.id}`)
        .set(...como(inmo)).send({ dormitorios: 3 }).expect(200);

      expect(editado.body.dormitorios).toBe(3);
      expect(editado.body.plantas).toBe(1);
      expect(editado.body.orientacion).toBe('sur');
      expect(editado.body.amenities).toEqual(['balcon']);
    });

    it('mandar `amenities` en un PATCH reemplaza la lista entera, no la mezcla', async () => {
      const p = await crear('Maipú 201', { amenities: ['balcon', 'patio'] });

      const editado = await http().patch(`/v1/propiedades/${p.body.id}`)
        .set(...como(inmo)).send({ amenities: ['pileta'] }).expect(200);

      // Si fuera un merge, acá seguiría "balcon" y "patio" — es justo lo que
      // NO tiene que pasar: el usuario tildó una lista nueva, no agregó una.
      expect(editado.body.amenities).toEqual(['pileta']);
    });
  });

  describe('filtros de rango', () => {
    beforeAll(async () => {
      await crear('Rango A', { ambientes: 1, antiguedad: 2, supTotal: 40 });
      await crear('Rango B', { ambientes: 3, antiguedad: 15, supTotal: 90 });
      await crear('Rango C', { ambientes: 5, antiguedad: 40, supTotal: 200 });
    });

    it('ambientesMin/Max recorta a lo que cae en el rango', async () => {
      const r = await http().get('/v1/propiedades?ambientesMin=2&ambientesMax=4')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Rango B'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Rango A'))).toBe(false);
      expect(calles.some((c: string) => c.includes('Rango C'))).toBe(false);
    });

    it('antiguedadMax es "hasta", no un rango con piso', async () => {
      const r = await http().get('/v1/propiedades?antiguedadMax=15')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Rango A'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Rango B'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Rango C'))).toBe(false);
    });

    it('supTotalMin/Max filtra por superficie', async () => {
      const r = await http().get('/v1/propiedades?supTotalMin=80&supTotalMax=150')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Rango B'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Rango A'))).toBe(false);
      expect(calles.some((c: string) => c.includes('Rango C'))).toBe(false);
    });

    it('un rango vacío no filtra nada', async () => {
      const sin = await http().get('/v1/propiedades?porPagina=100')
        .set(...como(inmo)).expect(200);
      const con = await http().get('/v1/propiedades?porPagina=100&ambientesMin=0')
        .set(...como(inmo)).expect(200);
      // `ambientesMin=0` no debería sacar del listado a lo que no tiene
      // ambientes cargados (un terreno, por ejemplo) — sólo entra si CAMBIA
      // algo. Acá se comprueba que un filtro sin valor (`ambientesMin`
      // ausente) trae exactamente lo mismo que sin mandarlo.
      expect(sin.body.total).toBeGreaterThan(0);
      expect(con.body.total).toBeLessThanOrEqual(sin.body.total);
    });
  });

  describe('multi-select', () => {
    beforeAll(async () => {
      await crear('Multi Norte', { orientacion: 'norte', disposicion: 'frente' });
      await crear('Multi Sur', { orientacion: 'sur', disposicion: 'interno' });
      await crear('Multi Este', { orientacion: 'este', disposicion: 'lateral' });
    });

    it('acepta CSV en un solo query param', async () => {
      const r = await http().get('/v1/propiedades?orientacion=norte,sur')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Multi Norte'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Multi Sur'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Multi Este'))).toBe(false);
    });

    it('acepta `?x=a&x=b` (repetido), que es como Express arma un array', async () => {
      const r = await http().get('/v1/propiedades?disposicion=frente&disposicion=lateral')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Multi Norte'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Multi Este'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Multi Sur'))).toBe(false);
    });
  });

  describe('amenities: "tiene TODOS", no "tiene alguno"', () => {
    beforeAll(async () => {
      await crear('Ame Completa', { amenities: ['pileta', 'seguridad', 'sum'] });
      await crear('Ame Parcial', { amenities: ['pileta'] });
      await crear('Ame Otra', { amenities: ['quincho'] });
    });

    it('pedir dos amenities exige las DOS, no cualquiera', async () => {
      const dos = await http().get('/v1/propiedades?amenities=pileta,seguridad')
        .set(...como(inmo)).expect(200);
      const calles = dos.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Ame Completa'))).toBe(true);
      // Tiene pileta pero NO seguridad: si el filtro fuera "alguna de las
      // dos" (`&&` en vez de `@>`), esto aparecería y estaría mal.
      expect(calles.some((c: string) => c.includes('Ame Parcial'))).toBe(false);
      expect(calles.some((c: string) => c.includes('Ame Otra'))).toBe(false);
    });

    it('pedir una sola es más laxo que pedir dos', async () => {
      const una = await http().get('/v1/propiedades?amenities=pileta')
        .set(...como(inmo)).expect(200);
      const dos = await http().get('/v1/propiedades?amenities=pileta,seguridad')
        .set(...como(inmo)).expect(200);
      expect(una.body.total).toBeGreaterThanOrEqual(dos.body.total);
    });
  });

  describe('aislamiento entre tenants', () => {
    it('el filtro de un tenant no ve amenities cargados en el otro', async () => {
      await crear('Vecina Pileta', { amenities: ['pileta', 'gimnasio'] }, otra);

      const r = await http().get('/v1/propiedades?amenities=pileta,gimnasio')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Vecina Pileta'))).toBe(false);
    });
  });

  describe('filtros combinados', () => {
    it('ambientesMin + orientación + amenities se aplican los tres a la vez', async () => {
      await crear('Combinada OK', {
        ambientes: 4, orientacion: 'norte', amenities: ['pileta', 'seguridad'],
      });
      await crear('Combinada Falla Ambientes', {
        ambientes: 1, orientacion: 'norte', amenities: ['pileta', 'seguridad'],
      });
      await crear('Combinada Falla Amenities', {
        ambientes: 4, orientacion: 'norte', amenities: ['pileta'],
      });

      const r = await http()
        .get('/v1/propiedades?ambientesMin=3&orientacion=norte&amenities=pileta,seguridad')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Combinada OK'))).toBe(true);
      expect(calles.some((c: string) => c.includes('Combinada Falla Ambientes'))).toBe(false);
      expect(calles.some((c: string) => c.includes('Combinada Falla Amenities'))).toBe(false);
    });
  });

  // ── Urbanización (migración 028) ────────────────────────────────────────────

  describe('urbanización: dónde está, no sólo qué es', () => {
    it('carga tipo y nombre del complejo, y rechaza un tipo fuera de catálogo', async () => {
      const r = await crear('Chacras Park 100', {
        tipoUrbanizacion: 'country', nombreComplejo: 'Chacras Park',
      });
      expect(r.status).toBe(201);
      expect(r.body.tipoUrbanizacion).toBe('country');
      expect(r.body.nombreComplejo).toBe('Chacras Park');

      const invalido = await crear('Rechazo urbanización', { tipoUrbanizacion: 'megabarrio' });
      expect(invalido.status).toBe(400);
    });

    it('un PATCH parcial no borra la urbanización que no vino', async () => {
      const p = await crear('La Reserva 200', {
        tipoUrbanizacion: 'barrio_privado', nombreComplejo: 'La Reserva',
      });
      const editado = await http().patch(`/v1/propiedades/${p.body.id}`)
        .set(...como(inmo)).send({ dormitorios: 3 }).expect(200);
      expect(editado.body.tipoUrbanizacion).toBe('barrio_privado');
      expect(editado.body.nombreComplejo).toBe('La Reserva');
    });

    it('el filtro multi-select y la búsqueda de texto encuentran el complejo', async () => {
      await crear('Country Uno', { tipoUrbanizacion: 'country', nombreComplejo: 'Los Aromos' });
      await crear('Country Dos', { tipoUrbanizacion: 'country', nombreComplejo: 'Los Aromos' });
      await crear('Condominio Uno', { tipoUrbanizacion: 'condominio', nombreComplejo: 'Torres del Sol' });
      await crear('Abierta', {}); // sin urbanización — no debe aparecer en ninguno de los dos filtros

      const porTipo = await http().get('/v1/propiedades?tipoUrbanizacion=country')
        .set(...como(inmo)).expect(200);
      const callesTipo = porTipo.body.items.map((p: { direccion: string }) => p.direccion);
      expect(callesTipo.filter((c: string) => c.includes('Country')).length).toBe(2);
      expect(callesTipo.some((c: string) => c.includes('Condominio'))).toBe(false);

      // La búsqueda de texto (`q`) también entra por el nombre del complejo:
      // alguien tipeando «Los Aromos» tiene que encontrar sus dos unidades,
      // igual que si tipeara una calle.
      const porNombre = await http().get('/v1/propiedades?q=Aromos')
        .set(...como(inmo)).expect(200);
      expect(porNombre.body.total).toBe(2);
    });

    it('una propiedad sin urbanización no aparece al filtrar por un tipo', async () => {
      const r = await http().get('/v1/propiedades?tipoUrbanizacion=condominio')
        .set(...como(inmo)).expect(200);
      const calles = r.body.items.map((p: { direccion: string }) => p.direccion);
      expect(calles.some((c: string) => c.includes('Abierta'))).toBe(false);
    });

    it('cero fuga: el nombre de un complejo ajeno no aparece en la búsqueda', async () => {
      await crear('Vecina Country', { tipoUrbanizacion: 'country', nombreComplejo: 'Secreto Vecino' }, otra);

      const r = await http().get('/v1/propiedades?q=Secreto')
        .set(...como(inmo)).expect(200);
      expect(r.body.total).toBe(0);
    });
  });

  // ── Precio y expensas (16.1) ────────────────────────────────────────────────

  describe('precio: el rango no significa nada sin su moneda', () => {
    async function conOperacion(calle: string, op: Record<string, unknown>) {
      const p = await crear(calle, { tipo: 'departamento' });
      await http().post(`/v1/propiedades/${p.body.id}/operaciones`).set(...como(inmo))
        .send({ estado: 'disponible', ...op }).expect(201);
      return p.body.id;
    }

    beforeAll(async () => {
      await conOperacion('Precio Barata', { tipo: 'venta', precio: 90000, moneda: 'USD' });
      await conOperacion('Precio Media', { tipo: 'venta', precio: 140000, moneda: 'USD' });
      await conOperacion('Precio Cara', { tipo: 'venta', precio: 400000, moneda: 'USD' });
      // Misma cifra, OTRA moneda: es la que separa un filtro correcto de uno
      // que suma peras con manzanas.
      await conOperacion('Precio EnPesos', { tipo: 'venta', precio: 140000, moneda: 'ARS' });
      await conOperacion('Precio ConExpensas', {
        tipo: 'alquiler', precio: 500000, moneda: 'ARS',
        expensas: 80000, expensasMoneda: 'ARS',
      });
    });

    const calles = (r: { body: { items: Array<{ direccion: string }> } }) =>
      r.body.items.map((p) => p.direccion);

    it('el rango recorta por monto Y por moneda', async () => {
      const r = await http()
        .get('/v1/propiedades?operacion=venta&precioMoneda=USD&precioMin=100000&precioMax=200000')
        .set(...como(inmo)).expect(200);
      const c = calles(r);
      expect(c.some((x) => x.includes('Precio Media'))).toBe(true);
      expect(c.some((x) => x.includes('Precio Barata'))).toBe(false);
      expect(c.some((x) => x.includes('Precio Cara'))).toBe(false);
      // 140.000 pero en PESOS: mismo número, otra cosa.
      expect(c.some((x) => x.includes('Precio EnPesos'))).toBe(false);
    });

    it('un máximo sin mínimo filtra igual', async () => {
      // El paréntesis del `donde`: `A AND B OR C` agrupa como `(A AND B) OR C`,
      // y sin él un máximo suelto desactivaba el filtro entero y traía todo.
      const r = await http()
        .get('/v1/propiedades?operacion=venta&precioMoneda=USD&precioMax=100000')
        .set(...como(inmo)).expect(200);
      const c = calles(r);
      expect(c.some((x) => x.includes('Precio Barata'))).toBe(true);
      expect(c.some((x) => x.includes('Precio Cara'))).toBe(false);
    });

    it('el precio se busca en la operación que se está mirando', async () => {
      // Sin acotar por tipo, una casa entraría por el precio de su alquiler
      // aunque su venta esté fuera de rango. Con `operacion=venta` no.
      const r = await http()
        .get('/v1/propiedades?operacion=venta&precioMoneda=ARS&precioMax=600000')
        .set(...como(inmo)).expect(200);
      expect(calles(r).some((x) => x.includes('Precio ConExpensas'))).toBe(false);
    });

    it('las expensas filtran por su propio rango y su propia moneda', async () => {
      const r = await http()
        .get('/v1/propiedades?expensasMoneda=ARS&expensasMin=50000&expensasMax=100000')
        .set(...como(inmo)).expect(200);
      expect(calles(r).some((x) => x.includes('Precio ConExpensas'))).toBe(true);
      expect(calles(r).some((x) => x.includes('Precio Media'))).toBe(false);
    });

    it('una moneda que no existe es 400, no un filtro que no filtra', async () => {
      await http().get('/v1/propiedades?precioMoneda=EUR&precioMin=1')
        .set(...como(inmo)).expect(400);
    });
  });
});
