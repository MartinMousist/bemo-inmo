import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '../config/env';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Tipos de imagen permitidos, con su firma (magic bytes).
 *
 * **La validación va por los bytes, no por el `Content-Type` del request.**
 * La cabecera la escribe el cliente y se falsifica en un segundo: un `.php`
 * declarado como `image/jpeg` pasaría cualquier chequeo de cabecera. Los
 * primeros bytes del archivo no mienten.
 */
const FIRMAS: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  },
];

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Los dos prefijos que deciden quién puede leer un objeto.
 *
 * ── Por qué existe esta división ──
 *
 * Había UN bucket con `mc anonymous set download` sobre la raíz, y adentro
 * convivían las fotos de propiedades con las dos caras del DNI de cada garante,
 * sus tres recibos de sueldo y las fotos de las actas. La clave lleva 8 bytes
 * aleatorios, así que la URL no se adivina por fuerza bruta — pero era lectura
 * pública, `inline` y `immutable`: cualquiera con esa URL (un log, un historial,
 * una captura reenviada) leía un DNI para siempre y sin dejar rastro.
 *
 * **Las fotos de propiedades tienen que seguir siendo públicas**: van en el feed
 * XML que consumen los portales, y un portal no manda cabecera de autorización.
 * Por eso no alcanzaba con cerrar el bucket entero: hay que separar.
 *
 * El prefijo va ADELANTE del tenant y no al revés (`publico/{tenant}/…` y no
 * `{tenant}/publico/…`) porque la política del bucket se aplica por prefijo, y
 * un prefijo por tenant obligaría a tocarla en cada alta de inmobiliaria.
 */
export const PREFIJO_PUBLICO = 'publico';
export const PREFIJO_PRIVADO = 'privado';

/** Cuánto vive una URL firmada. */
const FIRMA_SEGUNDOS = 300;

export interface ArchivoSubido {
  clave: string;
  /**
   * La URL directa, **sólo para los objetos públicos**. En los privados es
   * `null`: no existe una URL que sirva siempre, y devolver uno que el bucket
   * va a rechazar sería peor que devolver nada. Para esos se pide
   * `urlFirmada()` en el momento de mostrarlos.
   */
  url: string | null;
  mime: string;
  bytes: number;
}

@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger('Almacenamiento');
  private readonly env = loadEnv();
  private readonly cliente: S3Client | null;
  /**
   * Un segundo cliente, **sólo para firmar**, apuntado al endpoint PÚBLICO.
   *
   * `this.cliente` usa `S3_ENDPOINT`, que dentro de compose es `http://s3:9000`
   * — un nombre que resuelve el DNS de la red de contenedores y **no** el
   * navegador de nadie. Una URL firmada contra ese host se ve linda en el JSON
   * y da `ERR_NAME_NOT_RESOLVED` al abrirla.
   *
   * No alcanza con reemplazar el host en el string: SigV4 firma el `Host` como
   * parte del cálculo, así que cambiarlo después invalida la firma y MinIO
   * contesta `SignatureDoesNotMatch`. Hay que firmar contra el host correcto
   * desde el principio, y eso es un cliente con otro endpoint.
   *
   * Es la misma distinción que el compose ya documenta para `S3_PUBLIC_URL`:
   * «URL con la que el NAVEGADOR ve los archivos, distinta del endpoint
   * interno».
   */
  private readonly firmador: S3Client | null;

  constructor() {
    const credenciales = {
      accessKeyId: this.env.S3_ACCESS_KEY,
      secretAccessKey: this.env.S3_SECRET_KEY,
    };
    // MinIO no soporta el estilo virtual-host de AWS: sin `forcePathStyle` el
    // SDK arma "http://bucket.s3:9000" y el DNS de compose no lo resuelve.
    const comun = { region: 'us-east-1', forcePathStyle: true, credentials: credenciales };

    this.cliente = this.env.S3_BUCKET
      ? new S3Client({ ...comun, endpoint: this.env.S3_ENDPOINT })
      : null;

    this.firmador = this.env.S3_BUCKET
      ? new S3Client({ ...comun, endpoint: endpointPublico(this.env.S3_PUBLIC_URL) })
      : null;
  }

  get configurado(): boolean {
    return this.cliente !== null;
  }

  /**
   * Valida y sube. Devuelve la clave y la URL pública.
   *
   * El nombre original del archivo NO se usa como clave: viene del cliente y
   * puede traer `../`, caracteres raros o colisionar con otro. Se genera una
   * clave aleatoria y el nombre original queda sólo como metadato.
   */
  async subirImagen(
    tenantId: string,
    prefijo: string,
    datos: Buffer,
    /**
     * Sin default a propósito, y ANTES del opcional para que TypeScript lo
     * exija: cada llamada declara si lo que sube es publicable. Un default
     * —cualquiera de los dos— convierte «me olvidé de pensarlo» en una decisión
     * de seguridad tomada por descuido, y es exactamente así como el DNI de un
     * garante terminó en un bucket de lectura abierta.
     */
    publico: boolean,
    nombreOriginal?: string,
  ): Promise<ArchivoSubido> {
    if (!this.cliente) {
      throw new AppError(
        503,
        ErrorCode.ALMACENAMIENTO_NO_CONFIGURADO,
        'El almacenamiento de archivos no está configurado.',
        'Service Unavailable',
      );
    }

    if (datos.length === 0) {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'El archivo está vacío.', 'Unprocessable Entity');
    }
    if (datos.length > MAX_BYTES) {
      throw new AppError(
        413,
        ErrorCode.ARCHIVO_DEMASIADO_GRANDE,
        `La imagen pesa ${(datos.length / 1024 / 1024).toFixed(1)} MB. El máximo es 8 MB.`,
        'Payload Too Large',
      );
    }

    const firma = FIRMAS.find((f) => f.test(datos));
    if (!firma) {
      throw new AppError(
        415,
        ErrorCode.FORMATO_NO_SOPORTADO,
        'Sólo se aceptan imágenes JPG, PNG o WebP.',
        'Unsupported Media Type',
      );
    }

    // La visibilidad primero, después el tenant: al mirar el bucket se sabe de
    // quién es cada archivo, y borrar una inmobiliaria sigue siendo borrar dos
    // prefijos. Ver el comentario de PREFIJO_PUBLICO para por qué va en ese orden.
    const visibilidad = publico ? PREFIJO_PUBLICO : PREFIJO_PRIVADO;
    const clave = `${visibilidad}/${tenantId}/${prefijo}/${Date.now()}-${randomBytes(8).toString('hex')}.${firma.ext}`;

    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: clave,
        Body: datos,
        // El Content-Type lo fijamos NOSOTROS a partir de la firma, no de lo
        // que dijo el cliente: servir un archivo con un tipo controlado por el
        // usuario es una vía de XSS almacenado.
        ContentType: firma.mime,
        ContentDisposition: 'inline',
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: nombreOriginal
          ? { original: encodeURIComponent(nombreOriginal).slice(0, 200) }
          : undefined,
      }),
    );

    return {
      clave,
      url: publico ? `${this.env.S3_PUBLIC_URL}/${clave}` : null,
      mime: firma.mime,
      bytes: datos.length,
    };
  }

  /**
   * Una URL de lectura que caduca, para lo que NO es público.
   *
   * Se genera en el momento de mostrar y contra un endpoint que ya validó el
   * tenant y el rol: la autorización la hace la app, no la URL. Los cinco
   * minutos son para que abrir la ficha funcione y reenviar el enlace mañana
   * no.
   *
   * Devuelve `null` sin almacenamiento configurado en vez de tirar: una ficha
   * de garante tiene que poder abrirse aunque las imágenes no carguen — es lo
   * mismo que ya hace `borrar()`.
   */
  async urlFirmada(clave: string, segundos = FIRMA_SEGUNDOS): Promise<string | null> {
    if (!this.firmador) return null;
    try {
      return await getSignedUrl(
        this.firmador,
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: clave }),
        { expiresIn: segundos },
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo firmar ${clave}`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /** Borrar no puede tumbar la operación: la fila ya se fue de la base. */
  async borrar(clave: string): Promise<void> {
    if (!this.cliente) return;
    try {
      await this.cliente.send(
        new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: clave }),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo borrar ${clave} del almacenamiento`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** La clave a partir de una URL pública, para poder borrarla. */
  claveDeUrl(url: string): string | null {
    const base = `${this.env.S3_PUBLIC_URL}/`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }
}

/**
 * El endpoint que ve el navegador, a partir de `S3_PUBLIC_URL`.
 *
 * `S3_PUBLIC_URL` incluye el bucket (`http://localhost:9000/bemo-inmo`) porque
 * es la base de las URLs públicas. El cliente de S3 quiere el endpoint SIN el
 * bucket: con `forcePathStyle` lo agrega él, y dejárselo puesto produce
 * `…/bemo-inmo/bemo-inmo/clave`.
 */
function endpointPublico(publica: string): string {
  const url = new URL(publica);
  // El último tramo del path es el bucket; el endpoint es todo lo de antes.
  url.pathname = url.pathname.replace(/\/[^/]+\/?$/, '');
  return url.toString().replace(/\/$/, '');
}
