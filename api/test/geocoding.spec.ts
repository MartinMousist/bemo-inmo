import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * La sincronización de Google Maps.
 *
 * Todo esto corre **sin API key**, que es como corre la app hoy y como va a
 * correr en cualquier instalación nueva. Lo que se prueba es que la ausencia de
 * key sea un estado explicado y no un misterio:
 *
 *  - el diagnóstico lo dice, en vez de fallar;
 *  - sincronizar da 422 con el motivo, en vez de un 500;
 *  - y sobre todo: la app **no inventa coordenadas**.
 *
 * Lo que no se prueba acá es la respuesta real de Google. Pegarle a la API en
 * cada corrida haría la suite dependiente de la red y de la facturación de una
 * cuenta, y encima se paga por consulta.
 */
describe('Geocoding: diagnóstico y sincronización', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('geo', tk);
    otra = await crearInmobiliaria('geovecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  function crearPropiedad(calle: string, extra: Record<string, unknown> = {}, i = inmo) {
    return http().post('/v1/propiedades').set(...como(i))
      .send({ calle, numero: '100', localidad: 'Mendoza', tipo: 'departamento', ...extra })
      .expect(201);
  }

  it('sin API key el diagnóstico lo dice y no revienta', async () => {
    const r = await http().get('/v1/propiedades/geocoding/diagnostico')
      .set(...como(inmo)).expect(200);

    expect(r.body.configurado).toBe(false);
    expect(r.body.funciona).toBe(false);
    expect(r.body.estado).toBe('SIN_API_KEY');
    // El detalle tiene que decir qué hacer, no "hubo un error".
    expect(r.body.detalle).toMatch(/GOOGLE_MAPS_API_KEY/);
    expect(r.body.detalle).toMatch(/a mano/);
  });

  it('sin API key NO se inventan coordenadas', async () => {
    // Es la regla dura: una propiedad mal ubicada en el mapa es peor que una
    // sin mapa. Un default "razonable" acá sería el centro de Buenos Aires.
    const p = await crearPropiedad('Sin Key');

    expect(p.body.lat).toBeNull();
    expect(p.body.lng).toBeNull();
    expect(p.body.ubicacionConocida).toBe(false);
  });

  it('las coordenadas cargadas a mano se respetan y no cuentan como pendientes', async () => {
    const p = await crearPropiedad('Con Coordenadas', { lat: -32.8908, lng: -68.8272 });

    expect(p.body.lat).toBeCloseTo(-32.8908, 4);
    expect(p.body.ubicacionConocida).toBe(true);

    const antes = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(inmo)).expect(200);
    const conCoords = await crearPropiedad('Otra Con Coords', { lat: -34.6, lng: -58.4 });
    const despues = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(inmo)).expect(200);

    expect(conCoords.body.ubicacionConocida).toBe(true);
    // Sumar una propiedad YA ubicada no puede sumar un pendiente.
    expect(despues.body.pendientes).toBe(antes.body.pendientes);
  });

  it('cuenta como pendientes sólo las que no tienen ubicación', async () => {
    const antes = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(inmo)).expect(200);

    await crearPropiedad('Pendiente Uno');
    await crearPropiedad('Pendiente Dos');

    const despues = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(inmo)).expect(200);

    expect(despues.body.pendientes).toBe(antes.body.pendientes + 2);
  });

  it('sincronizar sin key es 422 con el motivo, no un 500', async () => {
    const r = await http().post('/v1/propiedades/geocoding/sincronizar')
      .set(...como(inmo)).expect(422);

    expect(r.body.detail).toMatch(/GOOGLE_MAPS_API_KEY/);
    expect(r.body.detail).toMatch(/a mano/);
  });

  it('el conteo de pendientes es por inmobiliaria', async () => {
    await crearPropiedad('Ajena Sin Ubicar', {}, otra);

    const mios = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(inmo)).expect(200);
    const suyos = await http().get('/v1/propiedades/geocoding/pendientes')
      .set(...como(otra)).expect(200);

    // La vecina tiene exactamente una: la suya. Si el conteo se escapara de RLS,
    // vería también las nuestras.
    expect(suyos.body.pendientes).toBe(1);
    expect(mios.body.pendientes).toBeGreaterThan(1);
  });

  it('el diagnóstico y la sincronización son de titular y administración', async () => {
    for (const rol of ['agente', 'contable'] as const) {
      await http().get('/v1/propiedades/geocoding/diagnostico')
        .set(...como(inmo, rol)).expect(403);
      await http().get('/v1/propiedades/geocoding/pendientes')
        .set(...como(inmo, rol)).expect(403);
      await http().post('/v1/propiedades/geocoding/sincronizar')
        .set(...como(inmo, rol)).expect(403);
    }

    await http().get('/v1/propiedades/geocoding/diagnostico')
      .set(...como(inmo, 'admin')).expect(200);
  });

  /**
   * Marca una coordenada como venida de Google.
   *
   * No se puede llegar a ese estado sin API key, y es justo el estado que hace
   * falta para probar la otra mitad de la regla: lo que puso Google apunta a la
   * dirección VIEJA y se limpia; lo cargado a mano se respeta. Se escribe como
   * owner, igual que el resto del setup de los tests.
   */
  async function marcarComoDeGoogle(propiedadId: string): Promise<void> {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query(
        `UPDATE propiedad SET geocode_fuente = 'google', geocode_el = now() WHERE id = $1`,
        [propiedadId],
      );
    } finally {
      await c.end();
    }
  }

  /**
   * Editar una propiedad ubicada a mano no puede dejarla sin ubicación.
   *
   * Los tres casos de acá se encontraron probando la API contra la base de
   * desarrollo, no leyendo el código, y los tres perdían el dato en silencio:
   * la respuesta era 200 y la coordenada ya no estaba.
   */
  describe('Editar sin perder la ubicación', () => {
    it('cambiar la localidad NO borra las coordenadas cargadas a mano', async () => {
      // Era el peor: `PATCH { localidad }` no trae `calle`, y sin `calle` la
      // ubicación se resolvía en null y el UPDATE la escribía. Sin key ni
      // siquiera hay con qué reemplazarla.
      const p = await crearPropiedad('Manual Editada', { lat: -32.8908, lng: -68.8272 });

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ localidad: 'Godoy Cruz' }).expect(200);

      expect(r.body.lat).toBeCloseTo(-32.8908, 4);
      expect(r.body.lng).toBeCloseTo(-68.8272, 4);
      expect(r.body.geocodeFuente).toBe('manual');
      expect(r.body.localidad).toBe('Godoy Cruz');
    });

    it('guardar el formulario con la MISMA dirección no toca la ubicación', async () => {
      // El defecto que apareció en el navegador: `PropiedadFormPage` manda
      // calle, número, localidad y provincia en CADA guardado, así que «el PATCH
      // menciona la dirección» era cierto siempre. Con eso, cambiar los
      // ambientes disparaba una geocodificación, y sin key la propiedad quedaba
      // sin ubicación. Guardar un campo no puede borrar otro.
      const p = await crearPropiedad('Formulario Entero', { lat: -32.8908, lng: -68.8272 });
      await marcarComoDeGoogle(p.body.id);

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({
          calle: 'Formulario Entero', numero: '100', localidad: 'Mendoza',
          tipo: 'departamento', ambientes: 5,
        })
        .expect(200);

      expect(r.body.lat).toBeCloseTo(-32.8908, 4);
      expect(r.body.geocodeFuente).toBe('google');
      expect(r.body.ambientes).toBe(5);
    });

    it('corregir la PROVINCIA vuelve a resolver la ubicación', async () => {
      // `direccionCompleta()` usa la provincia y el disparador no la miraba:
      // arreglar una propiedad cargada en la provincia equivocada dejaba el
      // punto en la vieja. Sin key no hay coordenada nueva, así que lo que se
      // afirma es que la de Google —la que apuntaba a la provincia anterior— no
      // sobrevive al cambio.
      const p = await crearPropiedad('Provincia Mal', { lat: -32.8908, lng: -68.8272 });
      await marcarComoDeGoogle(p.body.id);

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ provincia: 'San Juan' }).expect(200);

      expect(r.body.lat).toBeNull();
      expect(r.body.ubicacionConocida).toBe(false);
      expect(r.body.provincia).toBe('San Juan');
    });

    it('media coordenada es 422, no un borrado silencioso', async () => {
      // Mandar sólo `lat` no entraba en la rama manual —pide las dos— pero sí
      // marcaba «hay que tocar la ubicación», así que borraba las dos.
      const p = await crearPropiedad('Media Coordenada', { lat: -32.8908, lng: -68.8272 });

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ lat: -32.99 }).expect(422);
      expect(r.body.detail).toMatch(/juntas/);

      await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ lng: -68.11 }).expect(422);

      const sigue = await http().get(`/v1/propiedades/${p.body.id}`).set(...como(inmo)).expect(200);
      expect(sigue.body.lat).toBeCloseTo(-32.8908, 4);
    });

    it('las dos en null explícito SÍ las borra: es la salida para corregir', async () => {
      // Si lo manual se respeta siempre, tiene que haber forma de sacarlo, o es
      // el callejón sin salida del captador con otro nombre. Vaciar los dos
      // campos del formulario manda `null` en los dos y eso es la orden.
      const p = await crearPropiedad('Se Borra', { lat: -32.8908, lng: -68.8272 });

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ lat: null, lng: null }).expect(200);

      expect(r.body.lat).toBeNull();
      expect(r.body.ubicacionConocida).toBe(false);
      expect(r.body.geocodeFuente).toBeNull();
    });

    it('un PATCH que no habla de ubicación no la toca', async () => {
      const p = await crearPropiedad('Otro Campo', { lat: -32.8908, lng: -68.8272 });

      const r = await http().patch(`/v1/propiedades/${p.body.id}`).set(...como(inmo))
        .send({ ambientes: 3 }).expect(200);

      expect(r.body.lat).toBeCloseTo(-32.8908, 4);
      expect(r.body.geocodeFuente).toBe('manual');
    });

    it('la ficha dice de dónde salió la coordenada', async () => {
      // `geocode_fuente` existía desde la 006 y no lo devolvía nadie: la ficha
      // mostraba un punto sin poder decir si lo puso una persona o Google. Las
      // dos reglas de arriba —el backfill no pisa lo manual, y al cambiar la
      // dirección lo manual se respeta— son invisibles sin este dato.
      const p = await crearPropiedad('Con Fuente', { lat: -32.8908, lng: -68.8272 });
      expect(p.body.geocodeFuente).toBe('manual');
      expect(typeof p.body.geocodeEl).toBe('string');

      const sinCoords = await crearPropiedad('Sin Fuente');
      expect(sinCoords.body.geocodeFuente).toBeNull();
      expect(sinCoords.body.geocodeEl).toBeNull();
    });
  });

  it('capacidades separa geocodificar de mostrar el mapa', async () => {
    // Son dos capacidades distintas y sólo UNA depende de la key.
    //
    // Geocodificar —de una dirección a lat/lng— lo hace el servidor contra la
    // Geocoding API: sin key, `false`, y por eso la ficha ofrece cargar las
    // coordenadas a mano.
    //
    // Mostrar el mapa de una propiedad que YA tiene coordenadas es un iframe a
    // `www.google.com/maps?…&output=embed`, que NO lleva key. Con un solo
    // booleano para las dos cosas, una propiedad con lat/lng cargadas a mano
    // mostraba «El mapa necesita la API key de Google» y escondía un mapa que
    // habría funcionado. Este test es lo que impide que se vuelvan a juntar.
    const r = await http().get('/v1/propiedades/capacidades').set(...como(inmo)).expect(200);
    expect(r.body.geocodificacion).toBe(false);
    expect(r.body.mapaEmbebido).toBe(true);
  });
});
