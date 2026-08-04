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

  it('capacidades dice que los mapas no están disponibles', async () => {
    // Es lo que hace que la ficha ofrezca cargar lat/lng a mano en vez de
    // mostrar un mapa roto.
    const r = await http().get('/v1/propiedades/capacidades').set(...como(inmo)).expect(200);
    expect(r.body.mapas).toBe(false);
  });
});
