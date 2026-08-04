import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import type { CrearNotaDto, FiltroNotasDto } from './notas.dto';

/**
 * Notas de seguimiento.
 *
 * Es lo que hoy vive en WhatsApp — que es exactamente de donde este producto
 * viene a sacarlo. Cuando la persona que manejaba ese contrato se va, la
 * conversación se va con ella y la inmobiliaria queda sin saber qué se habló.
 *
 * Una nota con `recordarEl` es un pendiente, no un apunte: aparece en el inicio
 * el día que corresponde. Es la diferencia entre un cuaderno y un seguimiento.
 */

export interface Nota {
  id: string;
  entidadTipo: string;
  entidadId: string;
  texto: string;
  tipo: string;
  recordarEl: string | null;
  resueltaEl: string | null;
  autor: string | null;
  creadaEl: string;
}

@Injectable()
export class NotasService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, f: FiltroNotasDto): Promise<Pagina<Nota>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [
        f.entidadTipo ?? null,
        f.entidadId ?? null,
        f.tipo ?? null,
        q,
        f.soloPendientes ?? false,
      ];

      const desde = `
        FROM nota n
        LEFT JOIN usuario u ON u.id = n.autor_id
       WHERE ($1::text IS NULL OR n.entidad_tipo = $1)
         AND ($2::uuid IS NULL OR n.entidad_id = $2)
         AND ($3::text IS NULL OR n.tipo = $3)
         AND ($4::text IS NULL OR n.texto ILIKE $4)
         AND (NOT $5::boolean
              OR (n.recordar_el IS NOT NULL AND n.resuelta_el IS NULL))`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        params,
      );

      const { rows } = await ej.query<Fila>(
        `SELECT n.id, n.entidad_tipo, n.entidad_id, n.texto, n.tipo,
                n.recordar_el, n.resuelta_el, n.created_at, u.nombre AS autor
         ${desde}
          -- Las pendientes con fecha más vieja primero; después, lo más nuevo.
          ORDER BY (n.recordar_el IS NOT NULL AND n.resuelta_el IS NULL) DESC,
                   n.recordar_el ASC NULLS LAST,
                   n.created_at DESC
          LIMIT $6 OFFSET $7`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aNota), Number(conteo[0].total), f);
    });
  }

  async crear(
    tenantId: string,
    dto: CrearNotaDto,
    usuarioId: string,
  ): Promise<Nota> {
    return this.db.withTenant(tenantId, async (ej) => {
      // La entidad tiene que existir Y ser de esta inmobiliaria. La tabla es
      // polimórfica y no tiene FK —una FK polimórfica no se puede hacer
      // cumplir— así que sin este chequeo se podría dejar una nota colgando de
      // un id inventado, o peor, de uno ajeno.
      //
      // El `SELECT` va bajo RLS: si la entidad es de otro tenant, no aparece.
      const tablas: Record<string, string> = {
        contrato_alquiler: 'contrato_alquiler',
        propiedad: 'propiedad',
        persona: 'persona',
        oportunidad: 'oportunidad',
      };
      const tabla = tablas[dto.entidadTipo];

      const { rowCount } = await ej.query(
        `SELECT 1 FROM ${tabla} WHERE id = $1`,
        [dto.entidadId],
      );
      if (!rowCount) {
        throw AppError.notFound(
          'No se encontró aquello sobre lo que querés dejar la nota.',
        );
      }

      const { rows } = await ej.query<Fila>(
        `INSERT INTO nota (tenant_id, entidad_tipo, entidad_id, texto, tipo,
                           recordar_el, autor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, entidad_tipo, entidad_id, texto, tipo,
                   recordar_el, resuelta_el, created_at,
                   (SELECT nombre FROM usuario WHERE id = $7) AS autor`,
        [
          tenantId,
          dto.entidadTipo,
          dto.entidadId,
          dto.texto.trim(),
          dto.tipo ?? 'nota',
          dto.recordarEl ?? null,
          usuarioId,
        ],
      );

      return aNota(rows[0]);
    });
  }

  /** Marca el pendiente como resuelto. Idempotente: resolver dos veces no rompe. */
  async resolver(tenantId: string, id: string): Promise<Nota> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `UPDATE nota SET resuelta_el = coalesce(resuelta_el, now())
          WHERE id = $1
         RETURNING id, entidad_tipo, entidad_id, texto, tipo,
                   recordar_el, resuelta_el, created_at,
                   (SELECT nombre FROM usuario WHERE id = autor_id) AS autor`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa nota.');
      return aNota(rows[0]);
    });
  }

  /**
   * Borrar es de owner y admin.
   *
   * Una nota es el registro de algo que pasó; que cualquiera pueda hacerlo
   * desaparecer vacía el sentido de tenerlas.
   */
  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM nota WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró esa nota.');
    });
  }
}

interface Fila {
  id: string;
  entidad_tipo: string;
  entidad_id: string;
  texto: string;
  tipo: string;
  recordar_el: string | null;
  resuelta_el: Date | null;
  created_at: Date;
  autor: string | null;
}

function aNota(f: Fila): Nota {
  return {
    id: f.id,
    entidadTipo: f.entidad_tipo,
    entidadId: f.entidad_id,
    texto: f.texto,
    tipo: f.tipo,
    // `recordar_el` es `date`: viaja como texto y no pasa por Date.
    recordarEl: f.recordar_el ? String(f.recordar_el).slice(0, 10) : null,
    // `resuelta_el` y `created_at` son timestamptz: eso SÍ es un instante.
    resueltaEl: f.resuelta_el ? f.resuelta_el.toISOString() : null,
    autor: f.autor,
    creadaEl: f.created_at.toISOString(),
  };
}
