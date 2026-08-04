import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import type { Importe } from './inicio.service';
import type { FiltroCajaDto } from './caja.dto';

/**
 * La caja del día: qué entró, por qué medio y quién lo registró.
 *
 * Los datos ya estaban en `cobro` desde la etapa 4; lo que faltaba era la
 * pregunta que se hace al cerrar el día —"¿cuánto entró hoy y cuadra con lo que
 * hay?"— que hasta ahora se contestaba abriendo contrato por contrato.
 *
 * Los totales van **por moneda y por medio**, nunca sumados: ARS y USD conviven,
 * y para arquear la caja hace falta saber cuánto fue en efectivo y cuánto por
 * transferencia. Un total único no sirve para lo único que esto tiene que servir.
 */

export interface MovimientoCaja {
  id: string;
  fecha: string;
  monto: number;
  moneda: string;
  medio: string;
  imputacion: string;
  comprobante: string | null;
  registradoPor: string | null;
  contratoId: string;
  etiquetaPropiedad: string;
  direccion: string;
  inquilino: string | null;
  periodo: string;
}

export interface Caja {
  desde: string;
  hasta: string;
  totales: Importe[];
  /** El arqueo: cuánto entró por cada medio, en cada moneda. */
  porMedio: Array<{ medio: string; moneda: string; monto: number; operaciones: number }>;
  movimientos: MovimientoCaja[];
  total: number;
}

@Injectable()
export class CajaService {
  constructor(private readonly db: DbService) {}

  async delDia(tenantId: string, f: FiltroCajaDto): Promise<Caja> {
    const desde = f.desde ?? hoyIso();
    const hasta = f.hasta ?? desde;

    return this.db.withTenant(tenantId, async (ej) => {
      // `hasta` inclusive: "del 1 al 10" incluye el 10 entero. Que un endpoint
      // de plata se coma el último día es la clase de error que aparece cuando
      // no cuadra el arqueo y nadie entiende por qué.
      const params = [desde, hasta, f.medio ?? null];

      const donde = `
        WHERE co.fecha BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL OR co.medio = $3)`;

      const { rows: totales } = await ej.query<{ moneda: string; monto: string }>(
        `SELECT co.moneda, sum(co.monto)::text AS monto
           FROM cobro co ${donde}
          GROUP BY co.moneda ORDER BY co.moneda`,
        params,
      );

      const { rows: porMedio } = await ej.query<{
        medio: string; moneda: string; monto: string; operaciones: string;
      }>(
        `SELECT co.medio, co.moneda, sum(co.monto)::text AS monto,
                count(*)::text AS operaciones
           FROM cobro co ${donde}
          GROUP BY co.medio, co.moneda
          ORDER BY co.moneda, co.medio`,
        params,
      );

      const { rows } = await ej.query<Fila>(
        `SELECT co.id, co.fecha, co.monto, co.moneda, co.medio, co.imputacion,
                co.comprobante, u.nombre AS registrado_por,
                c.id AS contrato_id, p.periodo,
                pr.codigo AS propiedad_codigo,
                trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS direccion,
                (SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
                   FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                  WHERE cp.contrato_id = c.id AND cp.rol = 'locatario'
                  ORDER BY pe.apellido LIMIT 1) AS inquilino
           FROM cobro co
           JOIN periodo_alquiler p ON p.id = co.periodo_id
           JOIN contrato_alquiler c ON c.id = p.contrato_id
           JOIN propiedad pr ON pr.id = c.propiedad_id
           LEFT JOIN usuario u ON u.id = co.registrado_por
         ${donde}
          ORDER BY co.created_at DESC
          LIMIT $4`,
        [...params, f.porPagina],
      );

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM cobro co ${donde}`,
        params,
      );

      return {
        desde,
        hasta,
        totales: totales.map((t) => ({ moneda: t.moneda, monto: Number(t.monto) })),
        porMedio: porMedio.map((m) => ({
          medio: m.medio,
          moneda: m.moneda,
          monto: Number(m.monto),
          operaciones: Number(m.operaciones),
        })),
        movimientos: rows.map(aMovimiento),
        total: Number(conteo[0].total),
      };
    });
  }
}

interface Fila {
  id: string;
  fecha: string;
  monto: string;
  moneda: string;
  medio: string;
  imputacion: string;
  comprobante: string | null;
  registrado_por: string | null;
  contrato_id: string;
  periodo: string;
  propiedad_codigo: number;
  direccion: string;
  inquilino: string | null;
}

function aMovimiento(f: Fila): MovimientoCaja {
  return {
    id: f.id,
    fecha: String(f.fecha).slice(0, 10),
    monto: Number(f.monto),
    moneda: f.moneda,
    medio: f.medio,
    imputacion: f.imputacion,
    comprobante: f.comprobante,
    registradoPor: f.registrado_por,
    contratoId: f.contrato_id,
    etiquetaPropiedad: `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`,
    direccion: f.direccion,
    inquilino: f.inquilino || null,
    periodo: String(f.periodo).slice(0, 10),
  };
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
