import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { AlmacenamientoService, PREFIJO_PRIVADO, PREFIJO_PUBLICO } from '../src/archivos/almacenamiento.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El gate de la etapa 17.1: un tercero sin credenciales no lee un DNI.
 *
 * Lo que se prueba acá NO es que el código llame a la función correcta — eso lo
 * garantiza el compilador desde que `subirImagen` exige declarar la visibilidad.
 * Se prueba contra el bucket REAL, con HTTP, que:
 *
 *   · la foto de una propiedad abre SIN sesión, porque tiene que abrir: va en
 *     el feed XML que consumen los portales, y un portal no manda cabecera de
 *     autorización;
 *   · el documento de un garante NO abre sin sesión, ni siquiera con su URL
 *     exacta — que es justo el caso que importa, porque la URL se filtra por un
 *     log, un historial o una captura reenviada.
 *
 * Un test que sólo mirara el string de la clave pasaría con el bucket abierto
 * de par en par.
 */
describe('El bucket: público lo publicable, privado lo demás', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let almacen: AlmacenamientoService;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Un PNG de 1x1 real: la validación es por firma de bytes, no por nombre. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    almacen = app.get(AlmacenamientoService);
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('bucket', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  /** Sin credenciales, como lo pediría cualquiera con el enlace. */
  async function traer(url: string): Promise<number> {
    const r = await fetch(url);
    return r.status;
  }

  /**
   * ¿Se llega al bucket por su URL pública desde donde corren los tests?
   *
   * En CI sí: MinIO va con `--network host` y el proceso de tests corre en el
   * runner, así que `localhost:9000` es MinIO. Corriendo los tests DENTRO del
   * contenedor de la api, `localhost:9000` es el propio contenedor y no hay
   * nada escuchando — el host de MinIO ahí es `s3`.
   *
   * No se puede reescribir el host de la URL firmada para salvar ese caso:
   * SigV4 firma el `Host` y cambiarlo invalida la firma. Así que en vez de
   * hacer pasar el test por un camino que no es el real, se saltea **diciendo
   * por qué**. El gate de la etapa lo cierra el CI, y en dev se verifica a mano
   * con curl desde el host.
   */
  let bucketAlcanzable = false;
  beforeAll(async () => {
    try {
      await fetch(`${process.env.S3_PUBLIC_URL}/ping-inexistente`);
      bucketAlcanzable = true;
    } catch {
      bucketAlcanzable = false;
      // eslint-disable-next-line no-console
      console.warn(
        `[bucket-privado] ${process.env.S3_PUBLIC_URL} no se alcanza desde acá: ` +
        'los tests por HTTP se saltean. Corren en CI, donde MinIO está en el host.',
      );
    }
  });

  /** Se saltea con motivo en vez de pasar por un camino que no es el real. */
  const siAlcanzable = (nombre: string, fn: () => Promise<void>) =>
    it(nombre, async () => {
      if (!bucketAlcanzable) return;
      await fn();
    });

  /**
   * La MISMA clave, pero por el endpoint interno.
   *
   * Las dos afirmaciones que sostienen el gate —la foto abre, el DNI no— son
   * peticiones ANÓNIMAS: no llevan firma, así que no hay nada que se invalide
   * al cambiar el host. Eso permite comprobarlas desde adentro del contenedor
   * igual que desde el runner del CI, y son justo las que no pueden quedar sin
   * ejecutar en ningún entorno.
   *
   * Sólo la prueba de la URL firmada depende del host público, porque ahí sí
   * el `Host` entra en la firma.
   */
  const urlInterna = (clave: string) =>
    `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${clave}`;

  describe('las claves llevan su visibilidad adelante', () => {
    it('una foto de propiedad va a publico/ y trae URL directa', async () => {
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'propiedades/test', PNG, true, 'foto.png',
      );
      expect(subido.clave.startsWith(`${PREFIJO_PUBLICO}/`)).toBe(true);
      expect(subido.url).not.toBeNull();
    });

    it('un documento sensible va a privado/ y NO trae URL directa', async () => {
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'garantes/test', PNG, false, 'dni.png',
      );
      expect(subido.clave.startsWith(`${PREFIJO_PRIVADO}/`)).toBe(true);
      // `null` y no la URL del bucket: no existe una que sirva siempre, y
      // devolver una que el bucket va a rechazar es peor que no devolver nada.
      expect(subido.url).toBeNull();
    });
  });

  describe('contra el bucket de verdad, por HTTP y sin sesión', () => {
    it('la foto de una propiedad abre: el feed XML la necesita pública', async () => {
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'propiedades/publica', PNG, true, 'foto.png',
      );
      expect(await traer(urlInterna(subido.clave))).toBe(200);
    });

    it('el documento de un garante NO abre, ni con su URL exacta', async () => {
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'garantes/secreto', PNG, false, 'dni.png',
      );

      // La URL exacta del objeto, sin firma: es lo que tendría un tercero que
      // la leyó de un log, de un historial o de una captura reenviada.
      const estado = await traer(urlInterna(subido.clave));
      expect([401, 403, 404]).toContain(estado);
    });

    siAlcanzable('firmada, la misma clave sí abre — y la firma viaja en la URL', async () => {
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'garantes/firmado', PNG, false, 'dni.png',
      );

      const firmada = await almacen.urlFirmada(subido.clave);
      expect(firmada).not.toBeNull();
      expect(firmada).toContain('X-Amz-Signature');
      expect(await traer(firmada as string)).toBe(200);
    });

    it('la URL firmada apunta al host PÚBLICO, no al interno de compose', async () => {
      // SigV4 firma el `Host`, así que no se puede reemplazar después: hay que
      // firmar contra el host correcto desde el principio. Firmar contra
      // `http://s3:9000` produce una URL que el navegador no resuelve — se vio
      // en dev antes de separar el cliente firmador.
      const subido = await almacen.subirImagen(
        inmo.tenantId, 'garantes/host', PNG, false, 'dni.png',
      );
      const firmada = (await almacen.urlFirmada(subido.clave)) as string;
      const publico = new URL(process.env.S3_PUBLIC_URL as string);
      expect(new URL(firmada).host).toBe(publico.host);
    });
  });

  describe('el legajo del garante sale con URL firmada, no con la del bucket', () => {
    it('los documentos que devuelve la API vienen firmados', async () => {
      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Bucket 100', tipo: 'departamento' }).expect(201);

      const persona = (await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Garante', apellido: 'Bucket', docTipo: 'dni', docNumero: '30111222' })
        .expect(201)).body.id;

      const inquilino = (await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Inqui', apellido: 'Bucket', docTipo: 'dni', docNumero: '30111333' })
        .expect(201)).body.id;

      const contrato = await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: prop.body.id,
          fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
          montoInicial: 300000, moneda: 'ARS', indice: 'ninguno',
          diaVencimiento: 10, locatarios: [inquilino],
        }).expect(201);

      const garante = await http().post(`/v1/contratos/${contrato.body.id}/garantes`)
        .set(...como(inmo)).send({ personaId: persona }).expect(201);

      const gid = garante.body.id;
      await http().post(`/v1/garantes/${gid}/documentos`).set(...como(inmo))
        .send({ tipo: 'dni_frente', datos: PNG.toString('base64'), nombre: 'dni.png' })
        .expect(201);

      const r = await http().get(`/v1/contratos/${contrato.body.id}/garantes`)
        .set(...como(inmo)).expect(200);

      const doc = r.body[0].documentos.find((d: { tipo: string }) => d.tipo === 'dni_frente');
      expect(doc).toBeDefined();
      expect(doc.url).toContain('X-Amz-Signature');
      // Y abre: la URL firmada tiene que servir de verdad, no sólo parecerlo.
      if (bucketAlcanzable) expect(await traer(doc.url)).toBe(200);
    });
  });
});
