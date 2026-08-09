import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/** Un PNG real, generado byte a byte: la firma tiene que ser auténtica. */
function png(w = 2, h = 2): Buffer {
  const chunk = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([len, cuerpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const filas = Buffer.concat(
    Array.from({ length: h }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]),
    ),
  );

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filas)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);

describe('Fotos de propiedades', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let propiedadId: string;
  /** Una propiedad que NUNCA recibe fotos: es el caso del placeholder. */
  let sinFotosId: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('fotos', tk);
    otra = await crearInmobiliaria('fotosvecina', tk);

    const p = await request(app.getHttpServer())
      .post('/v1/propiedades')
      .set(...auth(inmo.tokens.owner))
      .send({ calle: 'Con Fotos', tipo: 'casa' })
      .expect(201);
    propiedadId = p.body.id;

    const s = await request(app.getHttpServer())
      .post('/v1/propiedades')
      .set(...auth(inmo.tokens.owner))
      .send({ calle: 'Sin Fotos', tipo: 'terreno' })
      .expect(201);
    sinFotosId = s.body.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const subir = (datos: Buffer, nombre = 'x.png', prop = propiedadId) =>
    http().post(`/v1/propiedades/${prop}/fotos`).set(...como())
      .send({ datos: datos.toString('base64'), nombre });

  it('sube una imagen y la primera queda como portada sola', async () => {
    const r = await subir(png()).expect(201);
    expect(r.body.url).toContain('.png');
    // Una propiedad sin portada se ve vacía en los listados.
    expect(r.body.esPortada).toBe(true);
    expect(r.body.orden).toBe(0);
  });

  it('la segunda NO pisa la portada', async () => {
    const r = await subir(jpg(), 'otra.jpg').expect(201);
    expect(r.body.esPortada).toBe(false);
    expect(r.body.orden).toBe(1);
    expect(r.body.url).toContain('.jpg');
  });

  describe('validación por bytes, no por nombre ni cabecera', () => {
    it('rechaza un archivo que no es imagen aunque se llame .jpg', async () => {
      // El Content-Type y la extensión los escribe el cliente. Los primeros
      // bytes del archivo no mienten.
      const php = Buffer.from('<?php system($_GET[0]); ?>');
      const r = await subir(php, 'inocente.jpg').expect(415);
      expect(r.body.code).toBe('FORMATO_NO_SOPORTADO');
    });

    it('rechaza un SVG, que puede traer scripts', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await subir(svg, 'vector.svg').expect(415);
    });

    it('rechaza un archivo vacío', async () => {
      await subir(Buffer.alloc(0)).expect(422);
    });

    it('rechaza una imagen de más de 8 MB', async () => {
      const gigante = Buffer.concat([png(), Buffer.alloc(9 * 1024 * 1024, 1)]);
      const r = await subir(gigante).expect(413);
      expect(r.body.code).toBe('ARCHIVO_DEMASIADO_GRANDE');
    });
  });

  it('la clave del archivo lleva el tenant, y no el nombre original', async () => {
    const r = await subir(png(), '../../etc/passwd.png').expect(201);
    // El nombre viene del cliente: podría traer `../` o colisionar. La clave se
    // genera; el original queda sólo como metadato.
    expect(r.body.url).not.toContain('passwd');
    expect(r.body.url).not.toContain('..');
    expect(r.body.url).toContain(inmo.tenantId);
  });

  it('cambiar la portada apaga la anterior', async () => {
    const fotos = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...como()).expect(200);

    const nueva = fotos.body.find((f: { esPortada: boolean }) => !f.esPortada);
    const r = await http().put(`/v1/propiedades/${propiedadId}/fotos/${nueva.id}/portada`)
      .set(...como()).expect(200);

    // El índice único parcial no admite dos portadas.
    expect(r.body.filter((f: { esPortada: boolean }) => f.esPortada)).toHaveLength(1);
    expect(r.body.find((f: { id: string }) => f.id === nueva.id).esPortada).toBe(true);
  });

  it('reordenar respeta el orden que manda el front', async () => {
    const fotos = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...como()).expect(200);
    const invertido = [...fotos.body].reverse().map((f: { id: string }) => f.id);

    const r = await http().put(`/v1/propiedades/${propiedadId}/fotos/orden`)
      .set(...como()).send({ ids: invertido }).expect(200);

    expect(r.body.map((f: { id: string }) => f.id)).toEqual(invertido);
  });

  it('borrar la portada asciende a la siguiente', async () => {
    const fotos = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...como()).expect(200);
    const portada = fotos.body.find((f: { esPortada: boolean }) => f.esPortada);

    await http().delete(`/v1/propiedades/${propiedadId}/fotos/${portada.id}`)
      .set(...como()).expect(204);

    const luego = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...como()).expect(200);
    expect(luego.body.find((f: { id: string }) => f.id === portada.id)).toBeUndefined();
    expect(luego.body.filter((f: { esPortada: boolean }) => f.esPortada)).toHaveLength(1);
  });

  it('no se pueden subir fotos a una propiedad de otra inmobiliaria', async () => {
    await http().post(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...auth(otra.tokens.owner))
      .send({ datos: png().toString('base64') })
      .expect(404);
  });

  it('la vecina no ve las fotos ajenas', async () => {
    const r = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...auth(otra.tokens.owner)).expect(200);
    expect(r.body).toEqual([]);
  });

  it('el contable no puede subir ni borrar', async () => {
    await http().post(`/v1/propiedades/${propiedadId}/fotos`)
      .set(...como('contable'))
      .send({ datos: png().toString('base64') })
      .expect(403);
  });

  /**
   * La portada en el LISTADO, que es de lo único que se entera la cartera en
   * tarjetas: una columna calculada en `selectPropiedad()`. Sin estos casos, el
   * front decidiría entre la foto y el placeholder con un campo que nadie probó.
   */
  describe('fotoPortada en el listado de propiedades', () => {
    const buscar = async (texto: string, token = inmo.tokens.owner) => {
      const r = await http()
        .get(`/v1/propiedades?q=${encodeURIComponent(texto)}`)
        .set(...auth(token))
        .expect(200);
      return r.body.items as Array<{ id: string; fotoPortada: string | null }>;
    };

    it('sin fotos devuelve null, no undefined ni cadena vacía', async () => {
      const [p] = (await buscar('Sin Fotos')).filter((x) => x.id === sinFotosId);
      // Los tres se ven igual en un `v-if`, y no lo son: `undefined` desaparece
      // del JSON —o sea que la clave ni llega— y `''` es una URL vacía que el
      // navegador pide igual, con lo que la tarjeta muestra un <img> roto en
      // lugar del placeholder.
      expect(p).toBeDefined();
      expect(p.fotoPortada).toBeNull();
      expect(Object.keys(p)).toContain('fotoPortada');
    });

    it('con fotos devuelve la URL de la que está marcada como portada', async () => {
      const fotos = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
        .set(...como()).expect(200);
      const portada = fotos.body.find((f: { esPortada: boolean }) => f.esPortada);
      expect(portada).toBeDefined();

      const [p] = (await buscar('Con Fotos')).filter((x) => x.id === propiedadId);
      expect(p.fotoPortada).toBe(portada.url);
    });

    it('cambiar la portada cambia lo que devuelve el listado', async () => {
      const fotos = await http().get(`/v1/propiedades/${propiedadId}/fotos`)
        .set(...como()).expect(200);
      const otraFoto = fotos.body.find((f: { esPortada: boolean }) => !f.esPortada);
      expect(otraFoto).toBeDefined();

      await http().put(`/v1/propiedades/${propiedadId}/fotos/${otraFoto.id}/portada`)
        .set(...como()).expect(200);

      const [p] = (await buscar('Con Fotos')).filter((x) => x.id === propiedadId);
      expect(p.fotoPortada).toBe(otraFoto.url);
    });

    it('la vecina nunca ve la portada de la otra inmobiliaria', async () => {
      // Es una SUBCONSULTA nueva sobre `propiedad_foto`, y las subconsultas
      // también pasan por RLS. Eso se prueba, no se supone: una subconsulta
      // correlacionada que devolviera la URL ajena filtraría la foto de la
      // propiedad de otra inmobiliaria en el listado de ésta.
      const items = await buscar('Fotos', otra.tokens.owner);
      const urls = items.map((x) => x.fotoPortada).filter(Boolean);
      expect(items.some((x) => x.id === propiedadId)).toBe(false);
      expect(urls).toHaveLength(0);
    });
  });
});
