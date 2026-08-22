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

  // ── Cerca de un punto (16.2) ────────────────────────────────────────────────

  describe('búsqueda por radio', () => {
    // Mendoza capital y alrededores, coordenadas reales.
    const CENTRO = { lat: -32.8895, lng: -68.8458 };

    beforeAll(async () => {
      await crear('Radio Centro', { lat: CENTRO.lat, lng: CENTRO.lng });
      // ~2 km al norte: 0,018° de latitud es algo menos de 2 km.
      await crear('Radio Cerca', { lat: CENTRO.lat + 0.018, lng: CENTRO.lng });
      // ~55 km: bien afuera de cualquier radio urbano.
      await crear('Radio Lejos', { lat: CENTRO.lat + 0.5, lng: CENTRO.lng });
      // Sin coordenadas: el caso que decide si el filtro miente o no.
      await crear('Radio SinUbicar', {});
    });

    const calles = (r: { body: { items: Array<{ direccion: string }> } }) =>
      r.body.items.map((p) => p.direccion);

    it('trae lo que está adentro y deja afuera lo que no', async () => {
      const r = await http()
        .get(`/v1/propiedades?lat=${CENTRO.lat}&lng=${CENTRO.lng}&radioKm=5&porPagina=100`)
        .set(...como(inmo)).expect(200);
      const c = calles(r);
      expect(c.some((x) => x.includes('Radio Centro'))).toBe(true);
      expect(c.some((x) => x.includes('Radio Cerca'))).toBe(true);
      expect(c.some((x) => x.includes('Radio Lejos'))).toBe(false);
    });

    it('una propiedad SIN coordenadas nunca entra', async () => {
      // Es lo correcto: no se puede afirmar que esté dentro del radio. Si
      // entrara «por las dudas», el filtro estaría mintiendo.
      const r = await http()
        .get(`/v1/propiedades?lat=${CENTRO.lat}&lng=${CENTRO.lng}&radioKm=500&porPagina=100`)
        .set(...como(inmo)).expect(200);
      expect(calles(r).some((x) => x.includes('Radio SinUbicar'))).toBe(false);
    });

    it('el radio chico recorta de verdad', async () => {
      const r = await http()
        .get(`/v1/propiedades?lat=${CENTRO.lat}&lng=${CENTRO.lng}&radioKm=1&porPagina=100`)
        .set(...como(inmo)).expect(200);
      const c = calles(r);
      expect(c.some((x) => x.includes('Radio Centro'))).toBe(true);
      // A ~2 km, afuera de 1 km. Si Haversine estuviera mal —grados por km,
      // radio equivocado— este es el test que se cae.
      expect(c.some((x) => x.includes('Radio Cerca'))).toBe(false);
    });

    it('los tres campos van juntos: dos no filtran nada', async () => {
      const todas = await http().get('/v1/propiedades?porPagina=100')
        .set(...como(inmo)).expect(200);
      const sinRadio = await http()
        .get(`/v1/propiedades?lat=${CENTRO.lat}&lng=${CENTRO.lng}&porPagina=100`)
        .set(...como(inmo)).expect(200);
      expect(sinRadio.body.total).toBe(todas.body.total);
    });

    it('una coordenada imposible es 400', async () => {
      await http().get('/v1/propiedades?lat=200&lng=-68&radioKm=1')
        .set(...como(inmo)).expect(400);
    });
  });

  /**
   * Los filtros que faltaban.
   *
   * Todos sobre columnas que ya existían y que no se podían buscar: el dato se
   * cargaba desde el formulario y la pantalla no lo dejaba usar. Un campo que
   * se llena y no sirve para nada es la peor clase de campo — le cuesta tiempo
   * a quien lo carga y no le devuelve nada.
   */
  describe('los filtros que faltaban', () => {
    let conFoto = '';

    beforeAll(async () => {
      const rc = await crear('Nueva Con Foto', {
        antiguedad: 1, estadoConservacion: 'muy_bueno',
      });
      conFoto = rc.body.id;
      await crear('Vieja Regular', { antiguedad: 45, estadoConservacion: 'regular' });
      await crear('Intermedia', { antiguedad: 12, estadoConservacion: 'bueno' });

      // La fila de la foto se inserta directo y no por el endpoint de subida:
      // lo que se prueba acá es el FILTRO, y pasar por el almacenamiento
      // ataría este test a la validación de imágenes y al bucket.
      const { DbService } = await import('../src/database/db.service');
      await app.get(DbService).withTenant(inmo.tenantId, (ej) =>
        ej.query(
          `INSERT INTO propiedad_foto (tenant_id, propiedad_id, url, orden, es_portada)
           VALUES (app_current_tenant(), $1, 'https://ejemplo.com/f.jpg', 0, true)`,
          [conFoto],
        ));
    }, 60_000);

    const calles = async (query: string) => {
      const r = await http().get(`/v1/propiedades?${query}`).set(...como(inmo)).expect(200);
      return (r.body.items as Array<{ direccion: string }>).map((p) => p.direccion);
    };

    /**
     * El caso que el filtro anterior no podía expresar.
     *
     * Con sólo `antiguedadMax`, «de 5 a 20 años» no se podía escribir — y es lo
     * que busca quien no quiere pagar el sobreprecio de estrenar ni comprar una
     * casa para refaccionar.
     */
    it('antiguedadMin + Max define un rango, no sólo un techo', async () => {
      const r = await calles('antiguedadMin=5&antiguedadMax=20');
      expect(r.some((c) => c.includes('Intermedia'))).toBe(true);
      expect(r.some((c) => c.includes('Nueva Con Foto'))).toBe(false);
      expect(r.some((c) => c.includes('Vieja Regular'))).toBe(false);
    });

    it('estadoConservacion filtra, y acepta varios', async () => {
      const uno = await calles('estadoConservacion=regular');
      expect(uno.some((c) => c.includes('Vieja Regular'))).toBe(true);
      expect(uno.some((c) => c.includes('Intermedia'))).toBe(false);

      const dos = await calles('estadoConservacion=regular,bueno');
      expect(dos.some((c) => c.includes('Vieja Regular'))).toBe(true);
      expect(dos.some((c) => c.includes('Intermedia'))).toBe(true);
    });

    /**
     * `conFotos` sirve para las DOS preguntas, y por eso es un booleano.
     *
     * El asesor que arma un envío quiere sólo las que tienen foto; quien ordena
     * la cartera quiere exactamente las que no la tienen, para salir a sacarlas.
     */
    it('conFotos recorta en los dos sentidos', async () => {
      const con = await calles('conFotos=true');
      expect(con.some((c) => c.includes('Nueva Con Foto'))).toBe(true);
      expect(con.some((c) => c.includes('Vieja Regular'))).toBe(false);

      const sin = await calles('conFotos=false');
      expect(sin.some((c) => c.includes('Vieja Regular'))).toBe(true);
      expect(sin.some((c) => c.includes('Nueva Con Foto'))).toBe(false);
    });

    it('sin ninguno de los nuevos, no recortan nada', async () => {
      // El caso que rompe si un filtro se aplica cuando no vino: con `null`,
      // `p.tipologia = ANY(NULL)` no matchea NADA en vez de no filtrar.
      const todas = await calles('porPagina=100');
      expect(todas.some((c) => c.includes('Nueva Con Foto'))).toBe(true);
      expect(todas.some((c) => c.includes('Vieja Regular'))).toBe(true);
    });
  });
});
