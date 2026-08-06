import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { generarAviso, generarFeedXml } from '../src/publicaciones/aviso.motor';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

describe('Publicaciones', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('pub', tk);
    otra = await crearInmobiliaria('pubvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  async function crearOperacion(i = inmo) {
    const prop = await http().post('/v1/propiedades').set(...como(i))
      .send({
        calle: 'Sarmiento', numero: '1450', localidad: 'Godoy Cruz', provincia: 'Mendoza',
        tipo: 'departamento', supTotal: 78, supCubierta: 72, ambientes: 3,
        dormitorios: 2, banos: 1, cocheras: 1,
        descripcion: 'Luminoso, con balcón al frente & vista abierta.',
      }).expect(201);

    const op = await http().post(`/v1/propiedades/${prop.body.id}/operaciones`)
      .set(...como(i))
      .send({ tipo: 'alquiler', precio: 485000, moneda: 'ARS', expensas: 62000, estado: 'disponible' })
      .expect(201);

    return op.body.operaciones[0].id;
  }

  // ── Motor de aviso (puro) ──────────────────────────────────────────────────

  describe('generador de aviso', () => {
    const prop = {
      tipo: 'departamento', calle: 'Sarmiento', numero: '1450',
      localidad: 'Godoy Cruz', provincia: 'Mendoza',
      supTotal: 78, ambientes: 3, dormitorios: 2,
      descripcion: 'Luminoso y silencioso.',
    };

    it('el título arranca por lo que la gente filtra', () => {
      const a = generarAviso(prop, { tipo: 'alquiler', precio: 485000, moneda: 'ARS' });
      expect(a.titulo).toBe('Departamento 3 ambientes en alquiler en Godoy Cruz');
    });

    it('un ambiente va en singular', () => {
      const a = generarAviso({ ...prop, ambientes: 1 }, { tipo: 'venta', precio: 54000, moneda: 'USD' });
      expect(a.titulo).toBe('Departamento 1 ambiente en venta en Godoy Cruz');

      // Y lo mismo cuando el título cae en los dormitorios porque la propiedad
      // no tiene cargados los ambientes.
      const b = generarAviso(
        { ...prop, ambientes: null, dormitorios: 1 },
        { tipo: 'venta', precio: 54000, moneda: 'USD' },
      );
      expect(b.titulo).toBe('Departamento 1 dormitorio en venta en Godoy Cruz');
    });

    it('el título se corta por palabra entera, no al medio', () => {
      const a = generarAviso(
        { ...prop, localidad: 'Villa Nueva de Guaymallén Provincia' },
        { tipo: 'venta', precio: 100000, moneda: 'USD' },
      );
      expect(a.titulo.length).toBeLessThanOrEqual(60);
      expect(a.titulo.endsWith(' ')).toBe(false);
      // No quedó una palabra partida al final.
      expect(/\s\S{1,2}$/.test(a.titulo)).toBe(false);
    });

    it('el precio incluye las expensas cuando las hay', () => {
      const a = generarAviso(prop, {
        tipo: 'alquiler', precio: 485000, moneda: 'ARS',
        expensas: 62000, expensasMoneda: 'ARS',
      });
      expect(a.precioTexto).toContain('ARS 485.000');
      expect(a.precioTexto).toContain('62.000 de expensas');
    });

    it('sin precio dice "Consultar", no cero', () => {
      const a = generarAviso(prop, { tipo: 'venta', precio: null, moneda: 'USD' });
      expect(a.precioTexto).toBe('Consultar precio');
      expect(a.faltantes).toContain('precio');
    });

    it('NO publica la dirección exacta, sólo la zona', () => {
      const a = generarAviso(prop, { tipo: 'alquiler', precio: 1, moneda: 'ARS' });
      // El número de puerta es para quien ya llamó, no para el portal.
      expect(a.paraPegar).not.toContain('1450');
      expect(a.descripcion).toContain('Godoy Cruz');
    });

    it('avisa qué le falta al aviso sin bloquear nada', () => {
      const a = generarAviso(
        { tipo: 'casa', calle: 'Sin Datos' },
        { tipo: 'venta', precio: null, moneda: 'USD' },
      );
      expect(a.faltantes).toEqual(
        expect.arrayContaining(['descripción', 'precio', 'superficie', 'localidad']),
      );
      // Y aun así genera algo usable.
      expect(a.titulo).toContain('Casa');
    });
  });

  describe('feed XML', () => {
    it('escapa los caracteres que romperían el XML', () => {
      const aviso = generarAviso(
        { tipo: 'casa', calle: 'X', descripcion: 'Cocina & living <grande>' },
        { tipo: 'venta', precio: 1, moneda: 'USD' },
      );
      const xml = generarFeedXml('Inmo & Cía', [
        { codigo: 'PROP-0001', operacion: 'venta', aviso, actualizado: '2026-01-01T00:00:00Z' },
      ]);

      expect(xml).toContain('Inmo &amp; Cía');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;grande&gt;');
      // Y no quedó ningún & suelto que rompa el parseo.
      expect(/&(?!(amp|lt|gt|quot|apos);)/.test(xml)).toBe(false);
    });
  });

  // ── API ────────────────────────────────────────────────────────────────────

  it('los portales dicen si tienen integración o son copiar y pegar', async () => {
    const res = await http().get('/v1/publicaciones/portales').set(...como(inmo)).expect(200);
    // Hoy ninguno tiene convenio: la UI no puede prometer lo que no existe.
    expect(res.body.every((p: { modo: string }) => p.modo === 'copiar_y_pegar')).toBe(true);
  });

  it('crear una publicación sin integración la deja "lista", no "publicada"', async () => {
    const operacionId = await crearOperacion();
    const res = await http().post('/v1/publicaciones').set(...como(inmo))
      .send({ operacionId, portal: 'zonaprop' }).expect(201);

    expect(res.body.estado).toBe('lista');
    expect(res.body.aviso.paraPegar).toContain('Departamento');
  });

  it('publicar dos veces en el mismo portal actualiza, no duplica', async () => {
    const operacionId = await crearOperacion();
    await http().post('/v1/publicaciones').set(...como(inmo))
      .send({ operacionId, portal: 'argenprop' }).expect(201);
    await http().post('/v1/publicaciones').set(...como(inmo))
      .send({ operacionId, portal: 'argenprop' }).expect(201);

    const lista = await http().get('/v1/publicaciones').set(...como(inmo)).expect(200);
    const deEsta = lista.body.items.filter(
      (p: { operacionId: string; portal: string }) =>
        p.operacionId === operacionId && p.portal === 'argenprop',
    );
    expect(deEsta).toHaveLength(1);
  });

  // ── Feed público ───────────────────────────────────────────────────────────

  it('el feed se sirve SIN sesión, con el token', async () => {
    await crearOperacion();
    const t = await http().get('/v1/publicaciones/feed/token').set(...como(inmo)).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/v1/feed/${t.body.token}.xml`)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<cartera');
    expect(res.text).toContain('<propiedad>');
  });

  it('sin token válido no hay feed', async () => {
    await request(app.getHttpServer()).get('/v1/feed/inventado.xml').expect(404);
  });

  it('el feed de una inmobiliaria no muestra propiedades de la otra', async () => {
    await crearOperacion(inmo);
    await crearOperacion(otra);

    const tA = await http().get('/v1/publicaciones/feed/token').set(...como(inmo)).expect(200);
    const tB = await http().get('/v1/publicaciones/feed/token').set(...como(otra)).expect(200);

    const feedA = await request(app.getHttpServer()).get(`/v1/feed/${tA.body.token}.xml`).expect(200);
    const feedB = await request(app.getHttpServer()).get(`/v1/feed/${tB.body.token}.xml`).expect(200);

    const codigos = (xml: string) => [...xml.matchAll(/<codigo>([^<]+)</g)].map((m) => m[1]);
    // Las dos numeran desde PROP-0001, así que se comparan los conteos y que
    // ninguna vea más de lo suyo.
    expect(codigos(feedA.text).length).toBeGreaterThan(0);
    expect(codigos(feedB.text).length).toBeGreaterThan(0);
    expect(feedA.text).not.toBe(feedB.text);
  });

  it('rotar el token invalida el anterior', async () => {
    const viejo = await http().get('/v1/publicaciones/feed/token').set(...como(inmo)).expect(200);
    await request(app.getHttpServer()).get(`/v1/feed/${viejo.body.token}.xml`).expect(200);

    const nuevo = await http().post('/v1/publicaciones/feed/rotar').set(...como(inmo)).expect(201);
    expect(nuevo.body.token).not.toBe(viejo.body.token);

    await request(app.getHttpServer()).get(`/v1/feed/${viejo.body.token}.xml`).expect(404);
    await request(app.getHttpServer()).get(`/v1/feed/${nuevo.body.token}.xml`).expect(200);
  });

  it('sólo el titular puede rotar el token del feed', async () => {
    await http().post('/v1/publicaciones/feed/rotar').set(...como(inmo, 'admin')).expect(403);
  });
});
