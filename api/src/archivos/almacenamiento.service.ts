import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

export interface ArchivoSubido {
  clave: string;
  url: string;
  mime: string;
  bytes: number;
}

@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger('Almacenamiento');
  private readonly env = loadEnv();
  private readonly cliente: S3Client | null;

  constructor() {
    this.cliente = this.env.S3_BUCKET
      ? new S3Client({
          region: 'us-east-1',
          endpoint: this.env.S3_ENDPOINT,
          // MinIO no soporta el estilo virtual-host de AWS: sin esto el SDK
          // arma "http://bucket.s3:9000" y el DNS de compose no lo resuelve.
          forcePathStyle: true,
          credentials: {
            accessKeyId: this.env.S3_ACCESS_KEY,
            secretAccessKey: this.env.S3_SECRET_KEY,
          },
        })
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

    // El tenant va en la clave: al mirar el bucket se sabe de quién es cada
    // archivo, y borrar una inmobiliaria es borrar un prefijo.
    const clave = `${tenantId}/${prefijo}/${Date.now()}-${randomBytes(8).toString('hex')}.${firma.ext}`;

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
      url: `${this.env.S3_PUBLIC_URL}/${clave}`,
      mime: firma.mime,
      bytes: datos.length,
    };
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
