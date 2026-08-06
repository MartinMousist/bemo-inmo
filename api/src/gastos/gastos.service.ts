import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type {
  CrearGastoDto, CrearProveedorDto, EditarGastoDto, EditarProveedorDto,
  FiltroGastosDto, FiltroProveedoresDto,
} from './gastos.dto';

/**
 * Gastos y proveedores.
 *
 * Hasta la migración 016 un gasto sólo existía como `liquidacion_linea`: nacía
 * adentro de la rendición del mes. **La liquidación ahora lo TOMA, no lo
 * contiene**, y esa diferencia es toda la feature:
 *
 * - Se puede cargar una reparación en marzo y liquidarla en abril.
 * - Tiene proveedor, comprobante, quién lo paga y en qué estado está.
 * - **Rearmar la liquidación no puede destruirlo.** El bug del `DELETE` sin
 *   filtro que le transfería de más al propietario tenía este modelo como causa
 *   de raíz, no como coincidencia.
 *
 * Dos reglas que no se negocian:
 *
 * 1. **Sólo los gastos a cargo del propietario entran en su liquidación.** Un
 *    arreglo que paga el inquilino se le cobra a él; ponerlo en la rendición del
 *    dueño es descontarle plata que no debe.
 * 2. **Un gasto rendido es inmutable**, igual que un ajuste confirmado. Lo hace
 *    cumplir un trigger, no este servicio: el día que alguien corra un script,
 *    el trigger sigue estando.
 */

export interface Proveedor {
  id: string;
  nombre: string;
  rubro: string | null;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  /** Cuántos gastos tiene: es lo que dice si se puede desactivar sin dudar. */
  gastos: number;
}

export interface Gasto {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  contratoId: string | null;
  proveedor: { id: string; nombre: string } | null;
  reclamoId: string | null;
  concepto: string;
  tipo: string;
  monto: number;
  moneda: string;
  fecha: string;
  aCargoDe: string;
  estado: string;
  comprobante: string | null;
  docUrl: string | null;
  notas: string | null;
  liquidacionId: string | null;
  registradoPor: string | null;
  creadoEl: string;
}

@Injectable()
export class GastosService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── Proveedores ────────────────────────────────────────────────────────────

  async listarProveedores(
    tenantId: string,
    f: FiltroProveedoresDto,
  ): Promise<Pagina<Proveedor>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.rubro ?? null, f.incluirInactivos ?? false];

      const desde = `
        FROM proveedor p
       WHERE ($1::text IS NULL OR p.nombre ILIKE $1 OR p.rubro ILIKE $1)
         AND ($2::text IS NULL OR p.rubro = $2)
         AND ($3::boolean OR p.activo)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        params,
      );

      const { rows } = await ej.query<FilaProveedor>(
        `SELECT p.id, p.nombre, p.rubro, p.cuit, p.telefono, p.email, p.notas, p.activo,
                (SELECT count(*) FROM gasto g WHERE g.proveedor_id = p.id)::text AS gastos
         ${desde}
          ORDER BY p.activo DESC, p.nombre
          LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aProveedor), Number(conteo[0].total), f);
    });
  }

  async crearProveedor(tenantId: string, dto: CrearProveedorDto): Promise<Proveedor> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaProveedor>(
        `INSERT INTO proveedor (tenant_id, nombre, rubro, cuit, telefono, email, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, nombre, rubro, cuit, telefono, email, notas, activo, '0' AS gastos`,
        [
          tenantId, dto.nombre.trim(), dto.rubro ?? null, dto.cuit ?? null,
          dto.telefono ?? null, dto.email ?? null, dto.notas ?? null,
        ],
      );
      return aProveedor(rows[0]);
    });
  }

  async editarProveedor(
    tenantId: string,
    id: string,
    dto: EditarProveedorDto,
  ): Promise<Proveedor> {
    return this.db.withTenant(tenantId, async (ej) => {
      // `COALESCE($n, columna)`: un PATCH que no manda un campo no lo pisa con
      // NULL. Ya pasó una vez —cargar titulares borraba número, ambientes y
      // metros— y está anotado en `docs/CONTINUAR.md`.
      const { rows } = await ej.query<FilaProveedor>(
        `UPDATE proveedor SET
           nombre   = COALESCE($2, nombre),
           rubro    = COALESCE($3, rubro),
           cuit     = COALESCE($4, cuit),
           telefono = COALESCE($5, telefono),
           email    = COALESCE($6, email),
           notas    = COALESCE($7, notas),
           activo   = COALESCE($8, activo)
         WHERE id = $1
         RETURNING id, nombre, rubro, cuit, telefono, email, notas, activo,
                   (SELECT count(*) FROM gasto g WHERE g.proveedor_id = proveedor.id)::text AS gastos`,
        [
          id, dto.nombre?.trim() ?? null, dto.rubro ?? null, dto.cuit ?? null,
          dto.telefono ?? null, dto.email ?? null, dto.notas ?? null,
          dto.activo ?? null,
        ],
      );
      if (!rows.length) throw AppError.notFound('No existe ese proveedor.');
      return aProveedor(rows[0]);
    });
  }

  // ── Gastos ─────────────────────────────────────────────────────────────────

  async listar(tenantId: string, f: FiltroGastosDto): Promise<Pagina<Gasto>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [
        f.propiedadId ?? null, f.contratoId ?? null, f.estado ?? null,
        f.aCargoDe ?? null, f.tipo ?? null, f.desde ?? null, f.hasta ?? null, q,
      ];

      const desde = `
        FROM gasto g
        JOIN propiedad pr ON pr.id = g.propiedad_id
        LEFT JOIN proveedor pv ON pv.id = g.proveedor_id
        LEFT JOIN usuario u ON u.id = g.registrado_por
       WHERE ($1::uuid IS NULL OR g.propiedad_id = $1)
         AND ($2::uuid IS NULL OR g.contrato_id = $2)
         AND ($3::text IS NULL OR g.estado = $3)
         AND ($4::text IS NULL OR g.a_cargo_de = $4)
         AND ($5::text IS NULL OR g.tipo = $5)
         AND ($6::date IS NULL OR g.fecha >= $6)
         AND ($7::date IS NULL OR g.fecha <= $7)
         AND ($8::text IS NULL OR g.concepto ILIKE $8 OR pv.nombre ILIKE $8)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        params,
      );

      const { rows } = await ej.query<FilaGasto>(
        `SELECT g.id, g.contrato_id, g.reclamo_id, g.concepto, g.tipo, g.monto,
                g.moneda, g.fecha, g.a_cargo_de, g.estado, g.comprobante,
                g.doc_url, g.notas, g.liquidacion_id, g.created_at,
                pr.id AS propiedad_id, pr.codigo, pr.calle, pr.numero,
                pv.id AS proveedor_id, pv.nombre AS proveedor_nombre,
                u.nombre AS registrado_por
         ${desde}
          ORDER BY g.fecha DESC, g.created_at DESC
          LIMIT $9 OFFSET $10`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aGasto), Number(conteo[0].total), f);
    });
  }

  async crear(
    tenantId: string,
    dto: CrearGastoDto,
    usuarioId: string,
    ip: string | null,
  ): Promise<Gasto> {
    return this.db.withTenant(tenantId, async (ej) => {
      // La propiedad se verifica acá y no se confía en la FK: sin contexto de
      // tenant la policy devuelve cero filas, así que una FK a una propiedad
      // ajena falla igual — pero con un error de base, no con un 404 explicable.
      const { rows: prop } = await ej.query<{ id: string }>(
        `SELECT id FROM propiedad WHERE id = $1`,
        [dto.propiedadId],
      );
      if (!prop.length) throw AppError.notFound('No existe esa propiedad.');

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO gasto (
           tenant_id, propiedad_id, contrato_id, proveedor_id, reclamo_id,
           concepto, tipo, monto, moneda, fecha, a_cargo_de,
           comprobante, doc_url, notas, registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date, CURRENT_DATE),$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          tenantId, dto.propiedadId, dto.contratoId ?? null, dto.proveedorId ?? null,
          dto.reclamoId ?? null, dto.concepto.trim(), dto.tipo, dto.monto, dto.moneda,
          dto.fecha ?? null, dto.aCargoDe ?? 'propietario',
          dto.comprobante ?? null, dto.docUrl ?? null, dto.notas ?? null, usuarioId,
        ],
      );

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'gasto_agregado',
        usuarioId,
        entidadTipo: 'gasto',
        entidadId: rows[0].id,
        monto: dto.monto,
        moneda: dto.moneda,
        detalle: { concepto: dto.concepto, aCargoDe: dto.aCargoDe ?? 'propietario' },
        ip,
      });

      return this.obtenerEn(ej, rows[0].id);
    });
  }

  async editar(tenantId: string, id: string, dto: EditarGastoDto): Promise<Gasto> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE gasto SET
           concepto     = COALESCE($2, concepto),
           tipo         = COALESCE($3, tipo),
           monto        = COALESCE($4, monto),
           moneda       = COALESCE($5, moneda),
           fecha        = COALESCE($6::date, fecha),
           a_cargo_de   = COALESCE($7, a_cargo_de),
           proveedor_id = COALESCE($8, proveedor_id),
           comprobante  = COALESCE($9, comprobante),
           doc_url      = COALESCE($10, doc_url),
           notas        = COALESCE($11, notas)
         WHERE id = $1`,
        [
          id, dto.concepto?.trim() ?? null, dto.tipo ?? null, dto.monto ?? null,
          dto.moneda ?? null, dto.fecha ?? null, dto.aCargoDe ?? null,
          dto.proveedorId ?? null, dto.comprobante ?? null, dto.docUrl ?? null,
          dto.notas ?? null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No existe ese gasto.');
      return this.obtenerEn(ej, id);
    });
  }

  /**
   * Anular en vez de borrar.
   *
   * Un gasto rendido no se borra —lo impide un trigger— porque dejaría a una
   * liquidación cerrada apuntando a la nada. Y uno sin rendir tampoco se borra
   * de verdad: que quede el rastro de que existió y se anuló es la diferencia
   * entre un error corregido y un número que apareció y desapareció.
   */
  async anular(
    tenantId: string,
    id: string,
    usuarioId: string,
    ip: string | null,
  ): Promise<Gasto> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ monto: string; moneda: string; estado: string }>(
        `SELECT monto, moneda, estado FROM gasto WHERE id = $1`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No existe ese gasto.');

      if (rows[0].estado === 'rendido') {
        throw new AppError(
          409,
          ErrorCode.YA_RENDIDO,
          'El gasto ya se rindió en una liquidación. Para corregirlo, cargá uno nuevo.',
          'Conflict',
        );
      }

      await ej.query(`UPDATE gasto SET estado = 'anulado' WHERE id = $1`, [id]);

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'gasto_anulado',
        usuarioId,
        entidadTipo: 'gasto',
        entidadId: id,
        monto: Number(rows[0].monto),
        moneda: rows[0].moneda,
        ip,
      });

      return this.obtenerEn(ej, id);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Gasto> {
    return this.db.withTenant(tenantId, (ej) => this.obtenerEn(ej, id));
  }

  private async obtenerEn(ej: Ejecutor, id: string): Promise<Gasto> {
    const { rows } = await ej.query<FilaGasto>(
      `SELECT g.id, g.contrato_id, g.reclamo_id, g.concepto, g.tipo, g.monto,
              g.moneda, g.fecha, g.a_cargo_de, g.estado, g.comprobante,
              g.doc_url, g.notas, g.liquidacion_id, g.created_at,
              pr.id AS propiedad_id, pr.codigo, pr.calle, pr.numero,
              pv.id AS proveedor_id, pv.nombre AS proveedor_nombre,
              u.nombre AS registrado_por
         FROM gasto g
         JOIN propiedad pr ON pr.id = g.propiedad_id
         LEFT JOIN proveedor pv ON pv.id = g.proveedor_id
         LEFT JOIN usuario u ON u.id = g.registrado_por
        WHERE g.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No existe ese gasto.');
    return aGasto(rows[0]);
  }
}

// ── Mapeo ────────────────────────────────────────────────────────────────────

interface FilaProveedor {
  id: string; nombre: string; rubro: string | null; cuit: string | null;
  telefono: string | null; email: string | null; notas: string | null;
  activo: boolean; gastos: string;
}

function aProveedor(f: FilaProveedor): Proveedor {
  return {
    id: f.id,
    nombre: f.nombre,
    rubro: f.rubro,
    cuit: f.cuit,
    telefono: f.telefono,
    email: f.email,
    notas: f.notas,
    activo: f.activo,
    gastos: Number(f.gastos),
  };
}

interface FilaGasto {
  id: string; contrato_id: string | null; reclamo_id: string | null;
  concepto: string; tipo: string; monto: string; moneda: string;
  fecha: string | Date; a_cargo_de: string; estado: string;
  comprobante: string | null; doc_url: string | null; notas: string | null;
  liquidacion_id: string | null; created_at: string | Date;
  propiedad_id: string; codigo: number; calle: string; numero: string | null;
  proveedor_id: string | null; proveedor_nombre: string | null;
  registrado_por: string | null;
}

function aGasto(f: FilaGasto): Gasto {
  return {
    id: f.id,
    propiedad: {
      id: f.propiedad_id,
      etiqueta: `PROP-${String(f.codigo).padStart(4, '0')}`,
      direccion: [f.calle, f.numero].filter(Boolean).join(' '),
    },
    contratoId: f.contrato_id,
    proveedor: f.proveedor_id
      ? { id: f.proveedor_id, nombre: f.proveedor_nombre ?? '' }
      : null,
    reclamoId: f.reclamo_id,
    concepto: f.concepto,
    tipo: f.tipo,
    monto: Number(f.monto),
    moneda: f.moneda,
    fecha: iso(f.fecha),
    aCargoDe: f.a_cargo_de,
    estado: f.estado,
    comprobante: f.comprobante,
    docUrl: f.doc_url,
    notas: f.notas,
    liquidacionId: f.liquidacion_id,
    registradoPor: f.registrado_por,
    creadoEl: new Date(f.created_at).toISOString(),
  };
}

/** Una columna `date` no tiene zona; convertirla a `Date` le inventa UTC. */
function iso(v: string | Date): string {
  return v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
}
