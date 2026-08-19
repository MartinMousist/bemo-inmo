import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { AlmacenamientoService } from './almacenamiento.service';

export interface Foto {
  id: string;
  url: string;
  orden: number;
  esPortada: boolean;
}

/** Un aviso con más de 30 fotos no lo mira nadie, y el bucket no es infinito. */
const MAX_POR_PROPIEDAD = 30;

@Injectable()
export class FotosService {
  constructor(
    private readonly db: DbService,
    private readonly almacen: AlmacenamientoService,
  ) {}

  async listar(tenantId: string, propiedadId: string): Promise<Foto[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; url: string; orden: number; es_portada: boolean;
      }>(
        `SELECT id, url, orden, es_portada FROM propiedad_foto
          WHERE propiedad_id = $1 ORDER BY orden, created_at`,
        [propiedadId],
      );
      return rows.map((r) => ({
        id: r.id, url: r.url, orden: r.orden, esPortada: r.es_portada,
      }));
    });
  }

  async subir(
    tenantId: string,
    propiedadId: string,
    datos: Buffer,
    nombreOriginal?: string,
  ): Promise<Foto> {
    // Se valida ANTES de subir: no tiene sentido dejar un archivo huérfano en
    // el bucket si la propiedad no existe o ya está llena.
    const { existe, cuantas } = await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('SELECT 1 FROM propiedad WHERE id = $1', [propiedadId]);
      const { rows } = await ej.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM propiedad_foto WHERE propiedad_id = $1',
        [propiedadId],
      );
      return { existe: Boolean(rowCount), cuantas: Number(rows[0].n) };
    });

    if (!existe) throw AppError.notFound('No se encontró esa propiedad.');
    if (cuantas >= MAX_POR_PROPIEDAD) {
      throw new AppError(
        409,
        ErrorCode.DEMASIADAS_FOTOS,
        `Esta propiedad ya tiene ${MAX_POR_PROPIEDAD} fotos, que es el máximo.`,
        'Conflict',
      );
    }

    const subido = await this.almacen.subirImagen(
      // Públicas: el feed XML se las entrega a los portales, que leen sin
      // credenciales. Es el único caso del sistema que TIENE que ser público.
      tenantId, `propiedades/${propiedadId}`, datos, true, nombreOriginal,
    );

    // `url` es `string | null` porque los objetos privados no tienen una URL
    // que sirva siempre. Acá se subió con `publico: true`, así que la trae — y
    // la columna es NOT NULL. El chequeo documenta esa invariante en vez de
    // taparla con un `!`: si alguien cambia el `true` de arriba, esto lo dice
    // en el momento y no con un error de Postgres tres capas más abajo.
    if (!subido.url) {
      await this.almacen.borrar(subido.clave);
      throw new Error('Una foto de propiedad tiene que subirse como pública.');
    }
    // En una const: el narrowing de arriba no cruza el closure de `withTenant`.
    const url = subido.url;

    try {
      return await this.db.withTenant(tenantId, async (ej) => {
        const { rows } = await ej.query<{ id: string; orden: number; es_portada: boolean }>(
          `INSERT INTO propiedad_foto (tenant_id, propiedad_id, url, orden, es_portada)
           VALUES ($1, $2, $3,
                   coalesce((SELECT max(orden) + 1 FROM propiedad_foto WHERE propiedad_id = $2), 0),
                   -- La primera foto es la portada sin que nadie lo pida.
                   NOT EXISTS (SELECT 1 FROM propiedad_foto WHERE propiedad_id = $2))
           RETURNING id, orden, es_portada`,
          [tenantId, propiedadId, url],
        );
        return {
          id: rows[0].id, url,
          orden: rows[0].orden, esPortada: rows[0].es_portada,
        };
      });
    } catch (err) {
      // Si la fila no entró, el archivo no puede quedar colgado en el bucket.
      await this.almacen.borrar(subido.clave);
      throw err;
    }
  }

  async borrar(tenantId: string, propiedadId: string, fotoId: string): Promise<void> {
    const url = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ url: string; es_portada: boolean }>(
        'DELETE FROM propiedad_foto WHERE id = $1 AND propiedad_id = $2 RETURNING url, es_portada',
        [fotoId, propiedadId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa foto.');

      // Si se borró la portada, la siguiente pasa a serlo: una propiedad sin
      // portada se ve vacía en los listados.
      if (rows[0].es_portada) {
        await ej.query(
          `UPDATE propiedad_foto SET es_portada = true
            WHERE id = (SELECT id FROM propiedad_foto
                         WHERE propiedad_id = $1 ORDER BY orden LIMIT 1)`,
          [propiedadId],
        );
      }
      return rows[0].url;
    });

    const clave = this.almacen.claveDeUrl(url);
    if (clave) await this.almacen.borrar(clave);
  }

  async marcarPortada(tenantId: string, propiedadId: string, fotoId: string): Promise<Foto[]> {
    await this.db.withTenant(tenantId, async (ej) => {
      // Primero se apaga la anterior: el índice único parcial no admite dos.
      await ej.query(
        'UPDATE propiedad_foto SET es_portada = false WHERE propiedad_id = $1 AND es_portada',
        [propiedadId],
      );
      const { rowCount } = await ej.query(
        'UPDATE propiedad_foto SET es_portada = true WHERE id = $1 AND propiedad_id = $2',
        [fotoId, propiedadId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa foto.');
    });
    return this.listar(tenantId, propiedadId);
  }

  /** Reordena por la lista de ids que manda el front. */
  async reordenar(tenantId: string, propiedadId: string, ids: string[]): Promise<Foto[]> {
    await this.db.withTenant(tenantId, async (ej) => {
      for (let i = 0; i < ids.length; i++) {
        await ej.query(
          'UPDATE propiedad_foto SET orden = $3 WHERE id = $1 AND propiedad_id = $2',
          [ids[i], propiedadId, i],
        );
      }
    });
    return this.listar(tenantId, propiedadId);
  }
}
