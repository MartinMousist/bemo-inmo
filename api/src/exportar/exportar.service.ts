import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { aCsv, numeroCsv, type ColumnaCsv } from '../common/csv';

type Fila = Record<string, unknown>;

/** Qué se puede exportar y con qué consulta. */
const RECURSOS: Record<
  string,
  { sql: string; usaPeriodo?: boolean; columnas: Array<ColumnaCsv<Fila>> }
> = {
  propiedades: {
    sql: `SELECT p.codigo, p.tipo, p.calle, p.numero, p.piso, p.depto,
                 p.localidad, p.provincia, p.sup_total, p.sup_cubierta,
                 p.ambientes, p.dormitorios, p.banos, p.cocheras,
                 p.lat, p.lng,
                 (SELECT string_agg(o.tipo || ' ' || o.moneda || ' ' ||
                                    coalesce(o.precio::text, 's/p'), ' | ')
                    FROM operacion o
                   WHERE o.propiedad_id = p.id AND o.estado <> 'cerrada') AS operaciones,
                 (SELECT string_agg(trim(coalesce(pe.nombre,'') || ' ' ||
                                         coalesce(pe.apellido,'')) ||
                                    ' (' || t.porcentaje || '%)', ' | ')
                    FROM titularidad t JOIN persona pe ON pe.id = t.persona_id
                   WHERE t.propiedad_id = p.id) AS titulares
            FROM propiedad p ORDER BY p.codigo`,
    columnas: [
      { titulo: 'Código', valor: (f) => `PROP-${String(f.codigo).padStart(4, '0')}` },
      { titulo: 'Tipo', valor: (f) => f.tipo },
      { titulo: 'Calle', valor: (f) => f.calle },
      { titulo: 'Número', valor: (f) => f.numero },
      { titulo: 'Piso', valor: (f) => f.piso },
      { titulo: 'Depto', valor: (f) => f.depto },
      { titulo: 'Localidad', valor: (f) => f.localidad },
      { titulo: 'Provincia', valor: (f) => f.provincia },
      { titulo: 'Sup. total', valor: (f) => numeroCsv(num(f.sup_total)) },
      { titulo: 'Sup. cubierta', valor: (f) => numeroCsv(num(f.sup_cubierta)) },
      { titulo: 'Ambientes', valor: (f) => f.ambientes },
      { titulo: 'Dormitorios', valor: (f) => f.dormitorios },
      { titulo: 'Baños', valor: (f) => f.banos },
      { titulo: 'Cocheras', valor: (f) => f.cocheras },
      { titulo: 'Latitud', valor: (f) => f.lat },
      { titulo: 'Longitud', valor: (f) => f.lng },
      { titulo: 'Operaciones', valor: (f) => f.operaciones },
      { titulo: 'Titulares', valor: (f) => f.titulares },
    ],
  },

  personas: {
    sql: `SELECT nombre, apellido, tipo, doc_tipo, doc_numero,
                 email::text AS email, telefono, domicilio
            FROM persona ORDER BY apellido NULLS LAST, nombre`,
    columnas: [
      { titulo: 'Nombre', valor: (f) => f.nombre },
      { titulo: 'Apellido', valor: (f) => f.apellido },
      { titulo: 'Tipo', valor: (f) => f.tipo },
      { titulo: 'Doc tipo', valor: (f) => f.doc_tipo },
      { titulo: 'Doc número', valor: (f) => f.doc_numero },
      { titulo: 'Correo', valor: (f) => f.email },
      { titulo: 'Teléfono', valor: (f) => f.telefono },
      { titulo: 'Domicilio', valor: (f) => f.domicilio },
    ],
  },

  contratos: {
    sql: `SELECT pr.codigo, trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS direccion,
                 c.fecha_inicio, c.fecha_fin, c.monto_inicial, c.moneda,
                 c.indice, c.periodicidad_meses, c.honorarios_pct, c.estado,
                 c.administrado,
                 coalesce((SELECT a.monto_nuevo FROM contrato_ajuste a
                            WHERE a.contrato_id = c.id
                              AND a.estado IN ('confirmado','notificado','aplicado')
                              AND a.vigente_desde <= current_date
                            ORDER BY a.vigente_desde DESC LIMIT 1),
                          c.monto_inicial) AS monto_vigente,
                 (SELECT string_agg(trim(coalesce(pe.nombre,'') || ' ' ||
                                         coalesce(pe.apellido,'')), ' | ')
                    FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                   WHERE cp.contrato_id = c.id AND cp.rol = 'locador') AS locadores,
                 (SELECT string_agg(trim(coalesce(pe.nombre,'') || ' ' ||
                                         coalesce(pe.apellido,'')), ' | ')
                    FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                   WHERE cp.contrato_id = c.id AND cp.rol = 'locatario') AS locatarios
            FROM contrato_alquiler c
            JOIN propiedad pr ON pr.id = c.propiedad_id
           ORDER BY c.fecha_fin`,
    columnas: [
      { titulo: 'Código', valor: (f) => `PROP-${String(f.codigo).padStart(4, '0')}` },
      { titulo: 'Dirección', valor: (f) => f.direccion },
      { titulo: 'Locador', valor: (f) => f.locadores },
      { titulo: 'Locatario', valor: (f) => f.locatarios },
      { titulo: 'Inicio', valor: (f) => f.fecha_inicio },
      { titulo: 'Fin', valor: (f) => f.fecha_fin },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Monto inicial', valor: (f) => numeroCsv(num(f.monto_inicial)) },
      { titulo: 'Monto vigente', valor: (f) => numeroCsv(num(f.monto_vigente)) },
      { titulo: 'Índice', valor: (f) => f.indice },
      { titulo: 'Cada (meses)', valor: (f) => f.periodicidad_meses },
      { titulo: 'Honorarios %', valor: (f) => numeroCsv(num(f.honorarios_pct)) },
      { titulo: 'Administrado', valor: (f) => (f.administrado ? 'sí' : 'no') },
      { titulo: 'Estado', valor: (f) => f.estado },
    ],
  },

  liquidaciones: {
    usaPeriodo: true,
    sql: `SELECT l.periodo,
                 trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS propietario,
                 l.moneda, l.total_bruto, l.total_honorarios, l.total_gastos,
                 l.total_neto, l.estado
            FROM liquidacion l JOIN persona pe ON pe.id = l.propietario_id
           WHERE ($1::date IS NULL OR l.periodo = date_trunc('month', $1::date))
           ORDER BY l.periodo DESC, propietario`,
    columnas: [
      { titulo: 'Período', valor: (f) => f.periodo },
      { titulo: 'Propietario', valor: (f) => f.propietario },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Bruto', valor: (f) => numeroCsv(num(f.total_bruto)) },
      { titulo: 'Honorarios', valor: (f) => numeroCsv(num(f.total_honorarios)) },
      { titulo: 'Gastos', valor: (f) => numeroCsv(num(f.total_gastos)) },
      { titulo: 'Neto', valor: (f) => numeroCsv(num(f.total_neto)) },
      { titulo: 'Estado', valor: (f) => f.estado },
    ],
  },

  comisiones: {
    sql: `SELECT c.nivel, c.punta, c.concepto, c.moneda, c.monto, c.estado,
                 c.cobrada_el, coalesce(u.nombre, c.beneficiario_nombre) AS beneficiario,
                 c.beneficiario_tipo, pr.codigo
            FROM comision c
            LEFT JOIN usuario u ON u.id = c.beneficiario_id
            LEFT JOIN operacion_venta v ON v.id = c.venta_id
            LEFT JOIN operacion o ON o.id = v.operacion_id
            LEFT JOIN propiedad pr ON pr.id = o.propiedad_id
           ORDER BY c.created_at DESC`,
    columnas: [
      { titulo: 'Propiedad', valor: (f) => (f.codigo ? `PROP-${String(f.codigo).padStart(4, '0')}` : '') },
      { titulo: 'Nivel', valor: (f) => f.nivel },
      { titulo: 'Punta', valor: (f) => f.punta },
      { titulo: 'Concepto', valor: (f) => f.concepto },
      { titulo: 'Beneficiario', valor: (f) => f.beneficiario },
      { titulo: 'Tipo', valor: (f) => f.beneficiario_tipo },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Monto', valor: (f) => numeroCsv(num(f.monto)) },
      { titulo: 'Estado', valor: (f) => f.estado },
      { titulo: 'Cobrada el', valor: (f) => f.cobrada_el },
    ],
  },

  cobros: {
    usaPeriodo: true,
    sql: `SELECT co.fecha, co.monto, co.moneda, co.medio, co.comprobante,
                 p.periodo, pr.codigo,
                 trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS direccion
            FROM cobro co
            JOIN periodo_alquiler p ON p.id = co.periodo_id
            JOIN contrato_alquiler c ON c.id = p.contrato_id
            JOIN propiedad pr ON pr.id = c.propiedad_id
           WHERE ($1::date IS NULL OR p.periodo = date_trunc('month', $1::date))
           ORDER BY co.fecha DESC`,
    columnas: [
      { titulo: 'Fecha', valor: (f) => f.fecha },
      { titulo: 'Período', valor: (f) => f.periodo },
      { titulo: 'Código', valor: (f) => `PROP-${String(f.codigo).padStart(4, '0')}` },
      { titulo: 'Dirección', valor: (f) => f.direccion },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Monto', valor: (f) => numeroCsv(num(f.monto)) },
      { titulo: 'Medio', valor: (f) => f.medio },
      { titulo: 'Comprobante', valor: (f) => f.comprobante },
    ],
  },
};

@Injectable()
export class ExportarService {
  constructor(private readonly db: DbService) {}

  recursos(): string[] {
    return Object.keys(RECURSOS);
  }

  async generar(tenantId: string, recurso: string, periodo?: string): Promise<string> {
    const def = RECURSOS[recurso];
    if (!def) {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        `No se puede exportar "${recurso}". Disponibles: ${this.recursos().join(', ')}.`,
        'Not Found',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        def.sql,
        def.usaPeriodo ? [periodo ?? null] : [],
      );
      return aCsv(rows, def.columnas);
    });
  }
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
