import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import type { FiltroAuditoriaDto } from './auditoria.dto';

/**
 * El registro de quién tocó la plata.
 *
 * Se apoya en la tabla `auditoria` que ya existía desde la migración 003 para
 * los eventos de permisos. **No hay una segunda tabla**: la pregunta que se hace
 * una persona no es "¿quién cerró esta liquidación?" sino "¿qué pasó el martes?",
 * y con la historia partida en dos tablas esa pregunta se contesta a mano.
 *
 * Se escribe siempre por `app_auditar_plata()`, que es SECURITY DEFINER. La app
 * tiene sólo SELECT sobre la tabla: un registro de auditoría que la aplicación
 * puede editar o borrar no sirve para lo que existe.
 */

export const ACCIONES = [
  'cobro_registrado',
  'punitorio_condonado',
  'ajuste_confirmado',
  'liquidacion_cerrada',
  'liquidacion_pagada',
  'gasto_agregado',
  'gasto_rendido',
  'gasto_anulado',
  'reclamo_resuelto',
  'comision_cobrada',
  'deposito_devuelto',
  'contrato_renovado',

  // No es plata: es dato personal. Entra en la misma lista porque la tabla es
  // una sola y la pregunta que se hace alguien tampoco cambia —«¿qué pasó el
  // martes?»—. Mirar el DNI de un garante merece el mismo registro que mover
  // su depósito, y esta es la acción que lo deja escrito (etapa 17.2).
  'dato_personal.ver',
  'dato_personal.purgado',
] as const;

export type Accion = (typeof ACCIONES)[number];

export interface Asiento {
  id: string;
  accion: Accion;
  usuario: { id: string | null; nombre: string | null };
  entidadTipo: string;
  entidadId: string;
  monto: number | null;
  moneda: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
  cuando: string;
}

export interface Anotar {
  accion: Accion;
  usuarioId: string;
  entidadTipo: string;
  entidadId: string;
  monto?: number | null;
  moneda?: string | null;
  detalle?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly db: DbService) {}

  /**
   * Anota un movimiento **dentro de la transacción que lo produjo**.
   *
   * Por eso recibe el `Ejecutor` y no abre uno propio: si el cobro se hace y el
   * asiento no, la auditoría miente; si el asiento se hace y el cobro se cae,
   * miente al revés. Van juntos o no van.
   */
  async anotar(ej: Ejecutor, tenantId: string, a: Anotar): Promise<void> {
    await ej.query(
      `SELECT app_auditar_plata($1, $2, $3, $4, $5, $6, $7, $8::inet, $9::jsonb)`,
      [
        tenantId,
        a.usuarioId,
        a.accion,
        a.entidadTipo,
        a.entidadId,
        a.monto ?? null,
        a.moneda ?? null,
        a.ip ?? null,
        JSON.stringify(a.detalle ?? {}),
      ],
    );
  }

  async listar(tenantId: string, f: FiltroAuditoriaDto): Promise<Pagina<Asiento>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [f.accion ?? null, f.desde ?? null, f.hasta ?? null, q];

      // Sólo los movimientos de plata: los eventos de permisos y de sesión que
      // también viven en esta tabla son otra historia y otra pantalla.
      const desde = `
        FROM auditoria a
        LEFT JOIN usuario u ON u.id = a.usuario_id
       WHERE a.accion = ANY($5::text[])
         AND ($1::text IS NULL OR a.accion = $1)
         AND ($2::date IS NULL OR a.created_at >= $2::date)
         -- +1 día: "hasta el 10" incluye todo el 10, no hasta su medianoche.
         AND ($3::date IS NULL OR a.created_at < $3::date + 1)
         AND ($4::text IS NULL OR u.nombre ILIKE $4 OR a.detalle::text ILIKE $4)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        [...params, ACCIONES],
      );

      const { rows } = await ej.query<Fila>(
        `SELECT a.id::text AS id, a.accion, a.usuario_id, u.nombre AS usuario_nombre,
                a.entidad_tipo, a.entidad_id, a.monto, a.moneda, a.detalle,
                host(a.ip) AS ip, a.created_at
         ${desde}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $6 OFFSET $7`,
        [...params, ACCIONES, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aAsiento), Number(conteo[0].total), f);
    });
  }

  /** La historia de una entidad concreta: "¿qué le pasó a esta liquidación?". */
  async deEntidad(tenantId: string, tipo: string, id: string): Promise<Asiento[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `SELECT a.id::text AS id, a.accion, a.usuario_id, u.nombre AS usuario_nombre,
                a.entidad_tipo, a.entidad_id, a.monto, a.moneda, a.detalle,
                host(a.ip) AS ip, a.created_at
           FROM auditoria a
           LEFT JOIN usuario u ON u.id = a.usuario_id
          WHERE a.entidad_tipo = $1 AND a.entidad_id = $2
            AND a.accion = ANY($3::text[])
          ORDER BY a.created_at`,
        [tipo, id, ACCIONES],
      );
      return rows.map(aAsiento);
    });
  }
}

interface Fila {
  id: string;
  accion: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  entidad_tipo: string;
  entidad_id: string;
  monto: string | null;
  moneda: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
}

function aAsiento(f: Fila): Asiento {
  return {
    id: f.id,
    accion: f.accion as Accion,
    // El nombre puede venir en null si el usuario se borró. El hecho no
    // desaparece porque se haya ido la persona.
    usuario: { id: f.usuario_id, nombre: f.usuario_nombre },
    entidadTipo: f.entidad_tipo,
    entidadId: f.entidad_id,
    monto: f.monto === null ? null : Number(f.monto),
    moneda: f.moneda,
    detalle: f.detalle ?? {},
    ip: f.ip,
    // `created_at` es timestamptz: eso SÍ es un instante y la zona importa.
    cuando: f.created_at.toISOString(),
  };
}
