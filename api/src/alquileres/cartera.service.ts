import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { ContratosService } from './contratos.service';
import type { FiltroCarteraDto, LoteContratosDto } from './alquileres.dto';

/**
 * La cartera de alquileres en formato de gestión.
 *
 * `ContratosPage` era una tabla del CONTRATO: fechas, monto, estado. Eso
 * contesta "qué firmé". La pregunta de todos los días es otra —"¿cobré?, ¿tengo
 * que confirmar un aumento?, ¿quién debe?"— y para contestarla había que entrar
 * a la ficha de cada contrato, uno por uno.
 *
 * Acá cada fila trae las cuatro columnas de gestión ya resueltas: próximo
 * aumento, última cuota, saldo y estado de cobranza. Es **una sola consulta**
 * para toda la página: hacer una por contrato para saber si debe es exactamente
 * el N+1 que se acaba de sacar de todo lo demás.
 */

export type EstadoCobranza = 'al_dia' | 'parcial' | 'en_mora' | 'sin_cuotas';

export interface FilaCartera {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  inquilino: string | null;
  propietario: string | null;

  montoVigente: number;
  moneda: string;
  indice: string;
  indicePorcentaje: number | null;
  periodicidadMeses: number;
  administrado: boolean;

  fechaFin: string;
  diasParaVencer: number;
  estado: string;

  /** El próximo aumento pendiente, sea proyectado o ya confirmado. */
  proximoAjuste: {
    id: string;
    vigenteDesde: string;
    montoNuevo: number;
    moneda: string;
    estado: string;
    /** Ya rige y sigue sin confirmarse: es plata que se está perdiendo. */
    vencido: boolean;
  } | null;

  /** La cuota más reciente generada. `null` si nunca se generaron. */
  ultimaCuota: {
    id: string;
    periodo: string;
    venceEl: string;
    total: number;
    cobrado: number;
    saldo: number;
    moneda: string;
    estado: string;
  } | null;

  cobranza: {
    estado: EstadoCobranza;
    /** Suma de los saldos impagos del contrato, en su moneda. */
    adeudado: number;
    cuotasEnMora: number;
    /** Vencimiento de la cuota impaga más vieja. */
    moraDesde: string | null;
  };
}

@Injectable()
export class CarteraService {
  constructor(
    private readonly db: DbService,
    private readonly contratos: ContratosService,
  ) {}

  async listar(tenantId: string, f: FiltroCarteraDto): Promise<Pagina<FilaCartera>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      // `venceEn` llega como `YYYY-MM`; se compara contra el mes completo.
      const mes = f.venceEn ? `${f.venceEn}-01` : null;

      const params = [q, f.estado ?? null, f.indice ?? null, mes, f.cobranza ?? null];

      const { rows: conteo } = await ej.query<{ total: string }>(
        `${BASE} SELECT count(*)::text AS total ${DESDE} ${DONDE}`,
        params,
      );

      const { rows } = await ej.query<Fila>(
        `${BASE} ${SELECT} ${DESDE} ${DONDE}
          ORDER BY
            -- Lo urgente primero: mora, después aumento vencido sin confirmar,
            -- después por vencimiento de contrato. Ordenar por fecha de firma
            -- pone arriba lo que no requiere nada.
            (r.en_mora > 0) DESC,
            (aj.vigente_desde <= current_date AND aj.estado = 'proyectado') DESC,
            c.fecha_fin
          LIMIT $6 OFFSET $7`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aFila), Number(conteo[0].total), f);
    });
  }

  /**
   * Genera cuotas para varios contratos de una.
   *
   * Cada contrato va en su **propia transacción** —`generarPeriodos` abre la
   * suya— así que uno que falla no se lleva a los demás. Por eso el resultado es
   * un parte por contrato y no un ok/error global: cerrar el mes con 40
   * contratos y que uno sea de intermediación no puede tirar los otros 39.
   */
  async generarPeriodosEnLote(
    tenantId: string,
    dto: LoteContratosDto,
  ): Promise<ResultadoLote> {
    return this.enLote(dto, async (id) => {
      const r = await this.contratos.generarPeriodos(tenantId, id, dto.hasta);
      return `${r.creados} cuota(s)`;
    });
  }

  async proyectarAjustesEnLote(
    tenantId: string,
    dto: LoteContratosDto,
  ): Promise<ResultadoLote> {
    return this.enLote(dto, async (id) => {
      const r = await this.contratos.proyectarAjustes(tenantId, id);
      return r.sinIndice.length
        ? `${r.creados} ajuste(s); falta el índice de ${r.sinIndice.join(', ')}`
        : `${r.creados} ajuste(s)`;
    });
  }

  private async enLote(
    dto: LoteContratosDto,
    hacer: (id: string) => Promise<string>,
  ): Promise<ResultadoLote> {
    const resultados: ResultadoLote['resultados'] = [];

    // En serie y no en paralelo: cada uno abre su transacción y toma locks sobre
    // el contrato. Cuarenta a la vez contra un pool de 10 conexiones es una cola
    // con más pasos, no menos tiempo.
    for (const id of dto.ids) {
      try {
        resultados.push({ contratoId: id, ok: true, detalle: await hacer(id) });
      } catch (err) {
        resultados.push({
          contratoId: id,
          ok: false,
          // El motivo del que falló, tal como lo explicaría la ficha. Un
          // "algunos fallaron" sin decir cuáles ni por qué obliga a revisarlos
          // a mano, que es lo que el lote venía a evitar.
          detalle: err instanceof Error ? err.message : 'Error inesperado',
        });
      }
    }

    return {
      total: resultados.length,
      exitosos: resultados.filter((r) => r.ok).length,
      resultados,
    };
  }
}

export interface ResultadoLote {
  total: number;
  exitosos: number;
  resultados: Array<{ contratoId: string; ok: boolean; detalle: string }>;
}

// ── SQL ─────────────────────────────────────────────────────────────────────
//
// Se arma por partes porque el conteo y la página comparten el FROM y el WHERE.
// Duplicarlos es lo que hace que un filtro nuevo entre en uno y no en el otro, y
// que el paginador diga 40 y muestre 12.

const BASE = `
WITH cuotas AS (
  SELECT p.id, p.contrato_id, p.periodo, p.vence_el, p.total, p.moneda, p.estado,
         coalesce(co.pagado, 0) AS pagado,
         p.total - coalesce(co.pagado, 0) AS saldo
    FROM periodo_alquiler p
    LEFT JOIN (
      SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id
    ) co ON co.periodo_id = p.id
),
resumen AS (
  SELECT contrato_id,
         count(*) AS cuotas,
         coalesce(sum(saldo) FILTER (WHERE saldo > 0), 0) AS adeudado,
         count(*) FILTER (WHERE vence_el < current_date AND saldo > 0) AS en_mora,
         count(*) FILTER (WHERE pagado > 0 AND saldo > 0) AS parciales,
         min(vence_el) FILTER (WHERE vence_el < current_date AND saldo > 0) AS mora_desde
    FROM cuotas
   GROUP BY contrato_id
),
ultima AS (
  SELECT DISTINCT ON (contrato_id)
         contrato_id, id, periodo, vence_el, total, pagado, saldo, moneda, estado
    FROM cuotas
   ORDER BY contrato_id, periodo DESC
),
proximo AS (
  -- "Próximo" es el que todavía TIENE ALGO PENDIENTE: o falta confirmarlo, o
  -- ya está confirmado pero aún no rige. Un ajuste confirmado y en vigencia no
  -- es el próximo aumento: es el alquiler de hoy, y mostrarlo acá hacía que la
  -- columna dijera "01/04" cuando lo que faltaba resolver era el de julio.
  SELECT DISTINCT ON (contrato_id)
         contrato_id, id, vigente_desde, monto_nuevo, moneda, estado
    FROM contrato_ajuste
   WHERE estado = 'proyectado'
      OR (estado IN ('confirmado', 'notificado') AND vigente_desde > current_date)
   ORDER BY contrato_id, vigente_desde
)`;

/**
 * El estado de cobranza es derivado, no una columna.
 *
 * La mora gana sobre lo parcial: una cuota vencida a medio pagar es mora, no
 * "parcial". Mostrarla como parcial la esconde entre las que están en camino.
 */
const COBRANZA = `
  CASE
    WHEN coalesce(r.cuotas, 0) = 0 THEN 'sin_cuotas'
    WHEN r.en_mora > 0             THEN 'en_mora'
    WHEN r.parciales > 0           THEN 'parcial'
    ELSE 'al_dia'
  END`;

const SELECT = `
  SELECT c.id, c.moneda, c.indice, c.indice_porcentaje, c.periodicidad_meses,
         c.administrado, c.fecha_fin, c.estado,
         (c.fecha_fin - current_date)::int AS dias_para_vencer,

         pr.id AS propiedad_id, pr.codigo AS propiedad_codigo,
         trim(pr.calle || ' ' || coalesce(pr.numero, '')) AS direccion,

         coalesce(
           (SELECT a.monto_nuevo FROM contrato_ajuste a
             WHERE a.contrato_id = c.id
               AND a.estado IN ('confirmado','notificado','aplicado')
               AND a.vigente_desde <= current_date
             ORDER BY a.vigente_desde DESC LIMIT 1),
           c.monto_inicial) AS monto_vigente,

         (SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
            FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
           WHERE cp.contrato_id = c.id AND cp.rol = 'locatario'
           ORDER BY pe.apellido LIMIT 1) AS inquilino,
         (SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
            FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
           WHERE cp.contrato_id = c.id AND cp.rol = 'locador'
           ORDER BY cp.porcentaje DESC NULLS LAST, pe.apellido LIMIT 1) AS propietario,

         aj.id AS aj_id, aj.vigente_desde AS aj_desde, aj.monto_nuevo AS aj_monto,
         aj.moneda AS aj_moneda, aj.estado AS aj_estado,

         u.id AS cu_id, u.periodo AS cu_periodo, u.vence_el AS cu_vence,
         u.total AS cu_total, u.pagado AS cu_pagado, u.saldo AS cu_saldo,
         u.moneda AS cu_moneda, u.estado AS cu_estado,

         coalesce(r.adeudado, 0) AS adeudado,
         coalesce(r.en_mora, 0)::int AS en_mora,
         r.mora_desde,
         ${COBRANZA} AS cobranza`;

const DESDE = `
  FROM contrato_alquiler c
  JOIN propiedad pr ON pr.id = c.propiedad_id
  LEFT JOIN resumen r ON r.contrato_id = c.id
  LEFT JOIN ultima  u ON u.contrato_id = c.id
  LEFT JOIN proximo aj ON aj.contrato_id = c.id`;

const DONDE = `
  WHERE ($1::text IS NULL
         OR pr.calle ILIKE $1 OR pr.localidad ILIKE $1
         OR pr.codigo::text = trim(both '%' from $1)
         OR EXISTS (
           SELECT 1 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
            WHERE cp.contrato_id = c.id
              AND trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) ILIKE $1))
    AND ($2::text IS NULL OR c.estado = $2)
    AND ($3::text IS NULL OR c.indice = $3)
    AND ($4::date IS NULL OR date_trunc('month', c.fecha_fin) = date_trunc('month', $4::date))
    AND ($5::text IS NULL OR ${COBRANZA} = $5)`;

interface Fila {
  id: string; moneda: string; indice: string; indice_porcentaje: string | null;
  periodicidad_meses: number; administrado: boolean; fecha_fin: string;
  estado: string; dias_para_vencer: number;
  propiedad_id: string; propiedad_codigo: number; direccion: string;
  monto_vigente: string; inquilino: string | null; propietario: string | null;
  aj_id: string | null; aj_desde: string | null; aj_monto: string | null;
  aj_moneda: string | null; aj_estado: string | null;
  cu_id: string | null; cu_periodo: string | null; cu_vence: string | null;
  cu_total: string | null; cu_pagado: string | null; cu_saldo: string | null;
  cu_moneda: string | null; cu_estado: string | null;
  adeudado: string; en_mora: number; mora_desde: string | null; cobranza: EstadoCobranza;
}

function aFila(f: Fila): FilaCartera {
  return {
    id: f.id,
    propiedad: {
      id: f.propiedad_id,
      etiqueta: `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`,
      direccion: f.direccion,
    },
    inquilino: f.inquilino || null,
    propietario: f.propietario || null,

    montoVigente: Number(f.monto_vigente),
    moneda: f.moneda,
    indice: f.indice,
    indicePorcentaje: f.indice_porcentaje === null ? null : Number(f.indice_porcentaje),
    periodicidadMeses: f.periodicidad_meses,
    administrado: f.administrado,

    fechaFin: f.fecha_fin,
    diasParaVencer: Number(f.dias_para_vencer),
    estado: f.estado,

    proximoAjuste: f.aj_id
      ? {
          id: f.aj_id,
          vigenteDesde: f.aj_desde!,
          montoNuevo: Number(f.aj_monto),
          moneda: f.aj_moneda!,
          estado: f.aj_estado!,
          vencido: f.aj_estado === 'proyectado' && f.aj_desde! <= hoy(),
        }
      : null,

    ultimaCuota: f.cu_id
      ? {
          id: f.cu_id,
          periodo: f.cu_periodo!,
          venceEl: f.cu_vence!,
          total: Number(f.cu_total),
          cobrado: Number(f.cu_pagado),
          saldo: Number(f.cu_saldo),
          moneda: f.cu_moneda!,
          estado: f.cu_estado!,
        }
      : null,

    cobranza: {
      estado: f.cobranza,
      adeudado: Number(f.adeudado),
      cuotasEnMora: Number(f.en_mora),
      moraDesde: f.mora_desde,
    },
  };
}

/**
 * Hoy en `YYYY-MM-DD` local. Las columnas `date` viajan como texto, así que se
 * comparan como texto: pasarlas por `Date` les inventa medianoche UTC y corre un
 * día. Ver el comentario en `db.service.ts`.
 */
function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
