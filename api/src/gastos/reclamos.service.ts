import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type {
  CrearReclamoDto, EditarReclamoDto, FiltroReclamosDto, ResolverReclamoDto,
} from './gastos.dto';

/**
 * Reclamos de mantenimiento.
 *
 * Es la carga operativa número uno de un alquiler administrado y hasta acá no
 * existía: se rompió el termotanque, quién avisó, qué proveedor fue, cuánto
 * salió y quién lo paga. Todo eso vivía en WhatsApp — que es exactamente de
 * donde este producto vino a sacar las cosas.
 *
 * `nota` se le parece y no alcanza: una nota no tiene estado, ni proveedor, ni
 * monto, ni fecha de resolución, así que no se puede contestar "¿qué tengo
 * abierto?" ni "¿cuánto gastamos en plomería este año?".
 *
 * **Resolver un reclamo puede generar su gasto en el mismo movimiento**, y ésa
 * es la razón por la que las dos features van juntas: el reclamo es el motivo y
 * el gasto es la plata. Cargarlos por separado hace que la mitad de los gastos
 * queden sin explicación y la mitad de los reclamos sin costo.
 */

export interface Reclamo {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  contratoId: string | null;
  categoria: string;
  descripcion: string;
  prioridad: string;
  estado: string;
  aCargoDe: string | null;
  proveedor: { id: string; nombre: string } | null;
  reportadoPor: string | null;
  abiertoPor: string | null;
  resolucion: string | null;
  resueltoEl: string | null;
  /** El gasto que salió de resolverlo, si tuvo costo. */
  gasto: { id: string; monto: number; moneda: string } | null;
  /** Días desde que se abrió. Es lo que ordena la lista de pendientes. */
  diasAbierto: number;
  creadoEl: string;
}

@Injectable()
export class ReclamosService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(tenantId: string, f: FiltroReclamosDto): Promise<Pagina<Reclamo>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [
        f.propiedadId ?? null, f.contratoId ?? null, f.estado ?? null,
        f.prioridad ?? null, f.categoria ?? null, f.soloPendientes ?? false,
        f.diasSinMover ?? null, q,
      ];

      const desde = `
        FROM reclamo r
        JOIN propiedad pr ON pr.id = r.propiedad_id
        LEFT JOIN proveedor pv ON pv.id = r.proveedor_id
        LEFT JOIN persona pe ON pe.id = r.reportado_por
        LEFT JOIN usuario u ON u.id = r.abierto_por
        LEFT JOIN gasto g ON g.reclamo_id = r.id AND g.estado <> 'anulado'
       WHERE ($1::uuid IS NULL OR r.propiedad_id = $1)
         AND ($2::uuid IS NULL OR r.contrato_id = $2)
         AND ($3::text IS NULL OR r.estado = $3)
         AND ($4::text IS NULL OR r.prioridad = $4)
         AND ($5::text IS NULL OR r.categoria = $5)
         AND (NOT $6::boolean OR r.estado IN ('abierto','en_curso'))
         AND ($7::int IS NULL OR r.updated_at < current_date - $7::int)
         AND ($8::text IS NULL OR r.descripcion ILIKE $8 OR pv.nombre ILIKE $8)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        params,
      );

      const { rows } = await ej.query<Fila>(
        `SELECT r.id, r.contrato_id, r.categoria, r.descripcion, r.prioridad,
                r.estado, r.a_cargo_de, r.resolucion, r.resuelto_el, r.created_at,
                (current_date - r.created_at::date)::int AS dias_abierto,
                pr.id AS propiedad_id, pr.codigo, pr.calle, pr.numero,
                pv.id AS proveedor_id, pv.nombre AS proveedor_nombre,
                trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS reportado_por,
                u.nombre AS abierto_por,
                g.id AS gasto_id, g.monto AS gasto_monto, g.moneda AS gasto_moneda
         ${desde}
          -- Urgentes primero, y dentro de cada prioridad los más viejos: un
          -- reclamo abierto hace tres semanas es peor que uno de ayer.
          ORDER BY (r.estado IN ('abierto','en_curso')) DESC,
                   CASE r.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                                    WHEN 'normal' THEN 2 ELSE 3 END,
                   r.created_at ASC
          LIMIT $9 OFFSET $10`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aReclamo), Number(conteo[0].total), f);
    });
  }

  async crear(
    tenantId: string,
    dto: CrearReclamoDto,
    usuarioId: string,
  ): Promise<Reclamo> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: prop } = await ej.query<{ id: string }>(
        `SELECT id FROM propiedad WHERE id = $1`,
        [dto.propiedadId],
      );
      if (!prop.length) throw AppError.notFound('No existe esa propiedad.');

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO reclamo (
           tenant_id, propiedad_id, contrato_id, categoria, descripcion,
           prioridad, a_cargo_de, proveedor_id, reportado_por, abierto_por)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'normal'),$7,$8,$9,$10)
         RETURNING id`,
        [
          tenantId, dto.propiedadId, dto.contratoId ?? null, dto.categoria,
          dto.descripcion.trim(), dto.prioridad ?? null, dto.aCargoDe ?? null,
          dto.proveedorId ?? null, dto.reportadoPor ?? null, usuarioId,
        ],
      );
      return this.obtenerEn(ej, rows[0].id);
    });
  }

  async editar(tenantId: string, id: string, dto: EditarReclamoDto): Promise<Reclamo> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE reclamo SET
           categoria    = COALESCE($2, categoria),
           descripcion  = COALESCE($3, descripcion),
           prioridad    = COALESCE($4, prioridad),
           estado       = COALESCE($5, estado),
           a_cargo_de   = COALESCE($6, a_cargo_de),
           proveedor_id = COALESCE($7, proveedor_id)
         WHERE id = $1
           -- Un resuelto no vuelve atrás por un PATCH: el constraint de la base
           -- lo rechazaría igual, pero acá el mensaje es entendible.
           AND estado <> 'resuelto'`,
        [
          id, dto.categoria ?? null, dto.descripcion?.trim() ?? null,
          dto.prioridad ?? null, dto.estado ?? null, dto.aCargoDe ?? null,
          dto.proveedorId ?? null,
        ],
      );
      if (!rowCount) {
        const existe = await ej.query(`SELECT 1 FROM reclamo WHERE id = $1`, [id]);
        throw existe.rowCount
          ? new AppError(409, ErrorCode.ESTADO_INVALIDO, 'El reclamo ya está resuelto.', 'Conflict')
          : AppError.notFound('No existe ese reclamo.');
      }
      return this.obtenerEn(ej, id);
    });
  }

  /**
   * Resolver, y de paso cargar el gasto.
   *
   * Las dos cosas van en la MISMA transacción a propósito. Si el reclamo se
   * cierra y el gasto no se guarda, el arreglo queda sin costo y el propietario
   * nunca lo ve descontado; si el gasto entra y el reclamo queda abierto,
   * alguien lo vuelve a mandar a arreglar. Van juntos o no van.
   */
  async resolver(
    tenantId: string,
    id: string,
    dto: ResolverReclamoDto,
    usuarioId: string,
    ip: string | null,
  ): Promise<Reclamo> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: r } = await ej.query<{
        estado: string; propiedad_id: string; contrato_id: string | null;
        a_cargo_de: string | null; proveedor_id: string | null; categoria: string;
      }>(
        `SELECT estado, propiedad_id, contrato_id, a_cargo_de, proveedor_id, categoria
           FROM reclamo WHERE id = $1`,
        [id],
      );
      if (!r.length) throw AppError.notFound('No existe ese reclamo.');
      if (r[0].estado === 'resuelto') {
        throw new AppError(409, ErrorCode.ESTADO_INVALIDO, 'El reclamo ya está resuelto.', 'Conflict');
      }

      await ej.query(
        `UPDATE reclamo
            SET estado = 'resuelto', resuelto_el = now(), resuelto_por = $2,
                resolucion = $3,
                a_cargo_de   = COALESCE($4, a_cargo_de),
                proveedor_id = COALESCE($5, proveedor_id)
          WHERE id = $1`,
        [id, usuarioId, dto.resolucion.trim(), dto.aCargoDe ?? null, dto.proveedorId ?? null],
      );

      if (dto.monto) {
        // El gasto hereda del reclamo lo que el reclamo ya sabe: propiedad,
        // contrato, proveedor y a cargo de quién. Volver a pedirlos sería pedir
        // dos veces el mismo dato y dar dos oportunidades de que difieran.
        const aCargo = dto.aCargoDe ?? r[0].a_cargo_de ?? 'propietario';
        const { rows: g } = await ej.query<{ id: string }>(
          `INSERT INTO gasto (
             tenant_id, propiedad_id, contrato_id, proveedor_id, reclamo_id,
             concepto, tipo, monto, moneda, a_cargo_de, comprobante, registrado_por)
           VALUES ($1,$2,$3,$4,$5,$6,'reparacion',$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            tenantId, r[0].propiedad_id, r[0].contrato_id,
            dto.proveedorId ?? r[0].proveedor_id, id,
            `${etiquetaCategoria(r[0].categoria)} · ${dto.resolucion.trim().slice(0, 120)}`,
            dto.monto, dto.moneda ?? 'ARS', aCargo, dto.comprobante ?? null, usuarioId,
          ],
        );

        await this.auditoria.anotar(ej, tenantId, {
          accion: 'gasto_agregado',
          usuarioId,
          entidadTipo: 'gasto',
          entidadId: g[0].id,
          monto: dto.monto,
          moneda: dto.moneda ?? 'ARS',
          detalle: { origen: 'reclamo', reclamoId: id, aCargoDe: aCargo },
          ip,
        });
      }

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'reclamo_resuelto',
        usuarioId,
        entidadTipo: 'reclamo',
        entidadId: id,
        monto: dto.monto ?? null,
        moneda: dto.monto ? (dto.moneda ?? 'ARS') : null,
        ip,
      });

      return this.obtenerEn(ej, id);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Reclamo> {
    return this.db.withTenant(tenantId, (ej) => this.obtenerEn(ej, id));
  }

  private async obtenerEn(ej: Ejecutor, id: string): Promise<Reclamo> {
    const { rows } = await ej.query<Fila>(
      `SELECT r.id, r.contrato_id, r.categoria, r.descripcion, r.prioridad,
              r.estado, r.a_cargo_de, r.resolucion, r.resuelto_el, r.created_at,
              (current_date - r.created_at::date)::int AS dias_abierto,
              pr.id AS propiedad_id, pr.codigo, pr.calle, pr.numero,
              pv.id AS proveedor_id, pv.nombre AS proveedor_nombre,
              trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS reportado_por,
              u.nombre AS abierto_por,
              g.id AS gasto_id, g.monto AS gasto_monto, g.moneda AS gasto_moneda
         FROM reclamo r
         JOIN propiedad pr ON pr.id = r.propiedad_id
         LEFT JOIN proveedor pv ON pv.id = r.proveedor_id
         LEFT JOIN persona pe ON pe.id = r.reportado_por
         LEFT JOIN usuario u ON u.id = r.abierto_por
         LEFT JOIN gasto g ON g.reclamo_id = r.id AND g.estado <> 'anulado'
        WHERE r.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No existe ese reclamo.');
    return aReclamo(rows[0]);
  }
}

const ETIQUETAS: Record<string, string> = {
  plomeria: 'Plomería', electricidad: 'Electricidad', gas: 'Gas',
  humedad: 'Humedad', cerrajeria: 'Cerrajería', climatizacion: 'Climatización',
  estructura: 'Estructura', artefactos: 'Artefactos', limpieza: 'Limpieza',
  otro: 'Otro',
};
function etiquetaCategoria(c: string): string {
  return ETIQUETAS[c] ?? c;
}

interface Fila {
  id: string; contrato_id: string | null; categoria: string; descripcion: string;
  prioridad: string; estado: string; a_cargo_de: string | null;
  resolucion: string | null; resuelto_el: string | Date | null;
  created_at: string | Date; dias_abierto: number;
  propiedad_id: string; codigo: number; calle: string; numero: string | null;
  proveedor_id: string | null; proveedor_nombre: string | null;
  reportado_por: string | null; abierto_por: string | null;
  gasto_id: string | null; gasto_monto: string | null; gasto_moneda: string | null;
}

function aReclamo(f: Fila): Reclamo {
  return {
    id: f.id,
    propiedad: {
      id: f.propiedad_id,
      etiqueta: `PROP-${String(f.codigo).padStart(4, '0')}`,
      direccion: [f.calle, f.numero].filter(Boolean).join(' '),
    },
    contratoId: f.contrato_id,
    categoria: f.categoria,
    descripcion: f.descripcion,
    prioridad: f.prioridad,
    estado: f.estado,
    aCargoDe: f.a_cargo_de,
    proveedor: f.proveedor_id
      ? { id: f.proveedor_id, nombre: f.proveedor_nombre ?? '' }
      : null,
    reportadoPor: f.reportado_por?.trim() || null,
    abiertoPor: f.abierto_por,
    resolucion: f.resolucion,
    resueltoEl: f.resuelto_el ? new Date(f.resuelto_el).toISOString() : null,
    gasto: f.gasto_id
      ? { id: f.gasto_id, monto: Number(f.gasto_monto), moneda: f.gasto_moneda ?? 'ARS' }
      : null,
    diasAbierto: Number(f.dias_abierto),
    creadoEl: new Date(f.created_at).toISOString(),
  };
}
