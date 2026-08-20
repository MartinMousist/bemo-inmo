import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { aplicarVariables, previsualizar, VARIABLES } from './plantillas.motor';

/** Una respuesta rápida, como la ve la pantalla. */
export interface RespuestaRapida {
  id: string;
  nombre: string;
  cuerpo: string;
  canal: string | null;
  atajo: string | null;
  activa: boolean;
  usos: number;
  /** El texto con valores de ejemplo, para ver cómo queda. */
  vistaPrevia: string;
  /** Variables mal escritas en la plantilla. Es un typo, y hay que avisarlo. */
  desconocidas: string[];
}

@Injectable()
export class PlantillasChatService {
  constructor(private readonly db: DbService) {}

  /** El catálogo de variables, para que la pantalla no las tenga duplicadas. */
  variables() {
    return VARIABLES;
  }

  async listar(tenantId: string, canal?: string): Promise<RespuestaRapida[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `SELECT id, nombre, cuerpo, canal, atajo, activa, usos
           FROM respuesta_rapida
          -- Las del canal pedido MÁS las que sirven para todos (canal NULL).
          -- Filtrar sólo por canal exacto dejaría afuera justo las genéricas,
          -- que son la mayoría.
          WHERE activa AND ($1::text IS NULL OR canal IS NULL OR canal = $1)
          ORDER BY usos DESC, nombre`,
        [canal ?? null],
      );
      return rows.map(aVista);
    });
  }

  /** Todas, incluidas las apagadas: es la pantalla de administración. */
  async listarTodas(tenantId: string): Promise<RespuestaRapida[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `SELECT id, nombre, cuerpo, canal, atajo, activa, usos
           FROM respuesta_rapida ORDER BY nombre`,
      );
      return rows.map(aVista);
    });
  }

  async crear(
    tenantId: string,
    usuarioId: string,
    dto: { nombre: string; cuerpo: string; canal?: string | null; atajo?: string | null },
  ): Promise<RespuestaRapida> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<Fila>(
          `INSERT INTO respuesta_rapida (tenant_id, nombre, cuerpo, canal, atajo, creada_por)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, nombre, cuerpo, canal, atajo, activa, usos`,
          [tenantId, dto.nombre, dto.cuerpo, dto.canal ?? null, dto.atajo ?? null, usuarioId],
        );
        return aVista(rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            409, ErrorCode.EN_USO,
            `Ya hay una respuesta rápida que se llama «${dto.nombre}».`, 'Conflict',
          );
        }
        throw err;
      }
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: {
      nombre?: string; cuerpo?: string; canal?: string | null;
      atajo?: string | null; activa?: boolean;
    },
  ): Promise<RespuestaRapida> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `UPDATE respuesta_rapida SET
           nombre = coalesce($2, nombre),
           cuerpo = coalesce($3, cuerpo),
           canal  = CASE WHEN $4::boolean THEN $5 ELSE canal END,
           atajo  = coalesce($6, atajo),
           activa = coalesce($7, activa)
         WHERE id = $1
         RETURNING id, nombre, cuerpo, canal, atajo, activa, usos`,
        [
          id, dto.nombre ?? null, dto.cuerpo ?? null,
          // `canal` se toca sólo si viene en el cuerpo: `null` es un valor
          // válido —«sirve para todos»— y con `coalesce` sería indistinguible
          // de «no lo mandes».
          dto.canal !== undefined, dto.canal ?? null,
          dto.atajo ?? null, dto.activa ?? null,
        ],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa respuesta rápida.');
      return aVista(rows[0]);
    });
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM respuesta_rapida WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró esa respuesta rápida.');
    });
  }

  /**
   * La plantilla resuelta para UNA conversación.
   *
   * Se resuelve acá y no en el navegador porque los datos del contacto salen de
   * la base, y porque el contador de usos tiene que subir cuando se usa de
   * verdad — no cada vez que alguien abre el desplegable a mirar.
   */
  async aplicar(
    tenantId: string,
    id: string,
    conversacionId: string,
    usuarioId: string,
  ): Promise<{ texto: string; faltantes: string[] }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: p } = await ej.query<{ cuerpo: string }>(
        'SELECT cuerpo FROM respuesta_rapida WHERE id = $1', [id],
      );
      if (!p.length) throw AppError.notFound('No se encontró esa respuesta rápida.');

      const { rows: c } = await ej.query<{ contacto: string | null; inmobiliaria: string }>(
        `SELECT c.contacto_nombre AS contacto, t.nombre AS inmobiliaria
           FROM conversacion c JOIN tenant t ON t.id = c.tenant_id
          WHERE c.id = $1`,
        [conversacionId],
      );
      if (!c.length) throw AppError.notFound('No se encontró esa conversación.');

      // El nombre del agente sale de la base y no del token: el JWT no lo
      // lleva, y meterlo ahí sería agrandar cada request de la app para una
      // variable que se usa al insertar una plantilla.
      const { rows: u } = await ej.query<{ nombre: string }>(
        'SELECT nombre FROM usuario WHERE id = $1', [usuarioId],
      );

      const r = aplicarVariables(p[0].cuerpo, {
        nombre: c[0].contacto,
        inmobiliaria: c[0].inmobiliaria,
        agente: u[0]?.nombre,
      });

      await ej.query('UPDATE respuesta_rapida SET usos = usos + 1 WHERE id = $1', [id]);

      return { texto: r.texto, faltantes: r.faltantes };
    });
  }
}

interface Fila {
  id: string;
  nombre: string;
  cuerpo: string;
  canal: string | null;
  atajo: string | null;
  activa: boolean;
  usos: number;
}

function aVista(f: Fila): RespuestaRapida {
  const p = previsualizar(f.cuerpo);
  return { ...f, vistaPrevia: p.texto, desconocidas: p.desconocidas };
}
