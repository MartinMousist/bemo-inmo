import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import type { Rol } from '../auth/tokens.service';

/**
 * El tablero.
 *
 * `/inicio` contesta "qué tengo que hacer hoy". Esto contesta la otra pregunta,
 * la de fin de mes: **"¿cómo viene el negocio?"** — y hasta ahora no la
 * contestaba nadie. La app mostraba plata de terceros (lo cobrado, lo que se
 * rinde) y **el ingreso propio de la inmobiliaria no estaba en ninguna
 * pantalla**.
 *
 * Cuatro decisiones que mandan sobre el resto:
 *
 * 1. **Todo importe viaja con su moneda, agrupado, nunca sumado.** Igual que en
 *    `/inicio`. Un total que mezcle ARS y USD no significa nada.
 *
 * 2. **Todo indicador trae su base de comparación.** Un número sin contra qué
 *    medirlo no es un indicador, es un número. Cada bloque devuelve el período
 *    pedido *y* el mismo período del año anterior.
 *
 * 3. **`null` no es cero.** Si no hay dato —ningún cobro cerrado, ninguna
 *    unidad desocupada— se devuelve `null` y la pantalla dice "sin datos". Un
 *    cero inventado en una pantalla de plata es un bug, no un default.
 *
 * 4. **Los bloques respetan el rol**, igual que `/inicio`: un asesor recibe 403
 *    en `/liquidaciones`, así que tampoco puede ver la cobranza ni los
 *    honorarios por acá. Lo que sí ve es el embudo, que es su trabajo.
 */

/** Quién ve los agregados de plata. Misma lista que `inicio.service.ts`. */
const ROLES_PLATA: Rol[] = ['owner', 'admin', 'contable'];

export interface Importe {
  moneda: string;
  monto: number;
}

/** Un punto de una serie mensual. `monto` en `null` = ese mes no tuvo dato. */
export interface PuntoMes {
  periodo: string;
  monto: number | null;
}

/** Un valor con su base de comparación. La variación se calcula acá, una vez. */
export interface ConBase {
  valor: number | null;
  base: number | null;
  /** Diferencia en puntos porcentuales o en unidades, según el indicador. */
  delta: number | null;
}

export interface Tablero {
  periodo: string;
  /** Contra qué se compara: el mismo mes del año anterior. */
  periodoBase: string;
  vePlata: boolean;

  cobranza: {
    /** Cobrado ÷ emitido del período. `null` si no se emitió nada. */
    tasa: ConBase;
    emitido: Importe[];
    cobrado: Importe[];
    /** Saldo vencido por tramo. Es el aging, y es lo que decide qué se hace. */
    aging: Array<{ tramo: '1-30' | '31-60' | '61-90' | '+90'; cuotas: number; importes: Importe[] }>;
    deudaVencida: Importe[];
    /** Días promedio entre vencimiento y cobro. Mide si se cobra TARDE. */
    diasPromedioCobro: ConBase;
    serieTasa: PuntoMes[];
  } | null;

  cartera: {
    unidades: number;
    /** Contratos vigentes ÷ unidades con operación de alquiler. */
    ocupacion: ConBase;
    contratosVigentes: number;
    /** % de contratos terminados que generaron uno nuevo. */
    renovacion: ConBase;
    /** Días promedio que una unidad estuvo vacía entre contratos. */
    vacanciaDias: number | null;
    porVencer: { dias30: number; dias60: number; dias90: number; dias180: number };
    serieVigentes: PuntoMes[];
  };

  negocio: {
    /** El ingreso REAL de la inmobiliaria: honorarios de alquiler + de venta. */
    honorariosDevengados: Importe[];
    honorariosBase: Importe[];
    comisionesPorCobrar: Importe[];
    porAgente: Array<{
      agenteId: string | null;
      nombre: string;
      operaciones: number;
      importes: Importe[];
    }>;
  } | null;

  embudo: {
    etapas: Array<{ estado: string; total: number }>;
    porOrigen: Array<{ origen: string; total: number; ganadas: number }>;
    motivosPerdida: Array<{ motivo: string; total: number }>;
    /** Horas hasta el primer movimiento. El KPI que más correlaciona con cierre. */
    primeraRespuestaHoras: number | null;
  };
}

const TRAMOS = [
  { tramo: '1-30' as const, desde: 1, hasta: 30 },
  { tramo: '31-60' as const, desde: 31, hasta: 60 },
  { tramo: '61-90' as const, desde: 61, hasta: 90 },
  { tramo: '+90' as const, desde: 91, hasta: 100000 },
];

@Injectable()
export class TableroService {
  constructor(private readonly db: DbService) {}

  async resumen(tenantId: string, rol: Rol, periodo?: string): Promise<Tablero> {
    const vePlata = ROLES_PLATA.includes(rol);

    return this.db.withTenant(tenantId, async (ej) => {
      // El período pedido, o el mes en curso. Se normaliza al día 1: un
      // `periodo` es un mes, no una fecha, y compararlo contra el día 17 de
      // algo devolvería medio mes.
      const { rows: p } = await ej.query<{ periodo: string; base: string }>(
        `SELECT date_trunc('month', COALESCE($1::date, current_date))::date AS periodo,
                (date_trunc('month', COALESCE($1::date, current_date)) - interval '1 year')::date AS base`,
        [periodo ?? null],
      );
      const mes = iso(p[0].periodo);
      const base = iso(p[0].base);

      return {
        periodo: mes,
        periodoBase: base,
        vePlata,
        cobranza: vePlata ? await this.cobranza(ej, mes, base) : null,
        cartera: await this.cartera(ej, mes, base),
        negocio: vePlata ? await this.negocio(ej, mes, base) : null,
        embudo: await this.embudo(ej, mes),
      };
    });
  }

  // ── Cobranza ──────────────────────────────────────────────────────────────

  private async cobranza(
    ej: Ejecutor,
    mes: string,
    base: string,
  ): Promise<NonNullable<Tablero['cobranza']>> {
    // Emitido y cobrado del mes, por moneda. "Cobrado" se mide contra el
    // PERÍODO de la cuota, no contra la fecha del cobro: un pago de marzo que
    // entra en abril es cobranza de marzo, y mezclarlos hace que la tasa de un
    // mes cambie el mes siguiente.
    const { rows: emitido } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT moneda, sum(total)::text AS monto
         FROM periodo_alquiler WHERE periodo = $1::date
        GROUP BY moneda ORDER BY moneda`,
      [mes],
    );

    const { rows: cobrado } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT p.moneda, sum(c.monto)::text AS monto
         FROM cobro c JOIN periodo_alquiler p ON p.id = c.periodo_id
        WHERE p.periodo = $1::date
        GROUP BY p.moneda ORDER BY p.moneda`,
      [mes],
    );

    const tasa = await this.tasaDe(ej, mes);
    const tasaBase = await this.tasaDe(ej, base);

    // Aging: el saldo vencido por tramo. Sin esto, "morosidad" es un número que
    // no dice si se llama por teléfono o se manda una carta documento.
    const { rows: aging } = await ej.query<{
      tramo: string; cuotas: string; moneda: string; monto: string;
    }>(
      `WITH saldos AS (
         SELECT p.moneda,
                (current_date - p.vence_el)::int AS dias,
                p.total - coalesce(c.pagado, 0) AS saldo
           FROM periodo_alquiler p
           LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) c
                  ON c.periodo_id = p.id
          WHERE p.estado IN ('pendiente','parcial','vencido')
            AND p.vence_el < current_date
            AND p.total - coalesce(c.pagado, 0) > 0
       )
       SELECT CASE WHEN dias BETWEEN 1 AND 30  THEN '1-30'
                   WHEN dias BETWEEN 31 AND 60 THEN '31-60'
                   WHEN dias BETWEEN 61 AND 90 THEN '61-90'
                   ELSE '+90' END AS tramo,
              count(*)::text AS cuotas, moneda, sum(saldo)::text AS monto
         FROM saldos GROUP BY 1, moneda ORDER BY 1, moneda`,
    );

    // Días promedio de cobro (DSO): mide si se cobra tarde aunque se cobre
    // todo. Sale `null` —no cero— cuando no hubo ningún cobro en la ventana:
    // "no cobramos nada" y "cobramos el mismo día" no son lo mismo.
    const { rows: dso } = await ej.query<{ actual: string | null; base: string | null }>(
      `SELECT
         avg(CASE WHEN p.periodo >= $1::date - interval '2 months' AND p.periodo <= $1::date
                  THEN c.fecha - p.vence_el END)::text AS actual,
         avg(CASE WHEN p.periodo >= $2::date - interval '2 months' AND p.periodo <= $2::date
                  THEN c.fecha - p.vence_el END)::text AS base
       FROM cobro c JOIN periodo_alquiler p ON p.id = c.periodo_id`,
      [mes, base],
    );

    // La serie de doce meses de la tasa. Es lo que contesta "¿esto es normal?",
    // que un número solo no puede contestar.
    const { rows: serie } = await ej.query<{ periodo: string; tasa: string | null }>(
      `WITH meses AS (
         SELECT generate_series($1::date - interval '11 months', $1::date, interval '1 month')::date AS m
       )
       SELECT m::text AS periodo,
              CASE WHEN sum(p.total) > 0
                   THEN round(100 * coalesce(sum(c.pagado), 0) / sum(p.total), 1) END::text AS tasa
         FROM meses
         LEFT JOIN periodo_alquiler p ON p.periodo = m
         LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) c
                ON c.periodo_id = p.id
        GROUP BY m ORDER BY m`,
      [mes],
    );

    return {
      tasa: conBase(tasa, tasaBase),
      emitido: aImportes(emitido),
      cobrado: aImportes(cobrado),
      aging: TRAMOS.map((t) => {
        const filas = aging.filter((a) => a.tramo === t.tramo);
        return {
          tramo: t.tramo,
          cuotas: filas.reduce((s, f) => s + Number(f.cuotas), 0),
          importes: aImportes(filas),
        };
      }),
      deudaVencida: sumarPorMoneda(aging),
      diasPromedioCobro: conBase(numOrNull(dso[0].actual), numOrNull(dso[0].base)),
      serieTasa: serie.map((s) => ({ periodo: iso(s.periodo), monto: numOrNull(s.tasa) })),
    };
  }

  /** Cobrado ÷ emitido de un mes, en porcentaje. `null` si no se emitió nada. */
  private async tasaDe(ej: Ejecutor, mes: string): Promise<number | null> {
    const { rows } = await ej.query<{ tasa: string | null }>(
      `SELECT CASE WHEN sum(p.total) > 0
                   THEN round(100 * coalesce(sum(c.pagado), 0) / sum(p.total), 1) END::text AS tasa
         FROM periodo_alquiler p
         LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) c
                ON c.periodo_id = p.id
        WHERE p.periodo = $1::date`,
      [mes],
    );
    return numOrNull(rows[0]?.tasa ?? null);
  }

  // ── Cartera ───────────────────────────────────────────────────────────────

  private async cartera(ej: Ejecutor, mes: string, base: string): Promise<Tablero['cartera']> {
    const { rows: c } = await ej.query<{
      unidades: string; vigentes: string; vigentes_base: string;
    }>(
      `SELECT
         (SELECT count(DISTINCT propiedad_id) FROM operacion
           WHERE tipo IN ('alquiler','alquiler_temporario'))::text AS unidades,
         (SELECT count(*) FROM contrato_alquiler
           WHERE fecha_inicio <= ($1::date + interval '1 month' - interval '1 day')
             AND fecha_fin    >= $1::date
             AND estado IN ('vigente','renovado','vencido'))::text AS vigentes,
         (SELECT count(*) FROM contrato_alquiler
           WHERE fecha_inicio <= ($2::date + interval '1 month' - interval '1 day')
             AND fecha_fin    >= $2::date
             AND estado IN ('vigente','renovado','vencido'))::text AS vigentes_base`,
      [mes, base],
    );

    const unidades = Number(c[0].unidades);
    const vigentes = Number(c[0].vigentes);
    const vigentesBase = Number(c[0].vigentes_base);

    // Renovación: de los contratos que terminaron en los últimos doce meses,
    // cuántos tienen a otro apuntándolos con `contrato_anterior_id`. La cadena
    // se construyó en la etapa 10 y hasta acá nadie la agregaba.
    const { rows: r } = await ej.query<{
      terminados: string; renovados: string; terminados_base: string; renovados_base: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE c.fecha_fin BETWEEN $1::date - interval '12 months' AND $1::date)::text AS terminados,
         count(*) FILTER (WHERE c.fecha_fin BETWEEN $1::date - interval '12 months' AND $1::date
                            AND EXISTS (SELECT 1 FROM contrato_alquiler n WHERE n.contrato_anterior_id = c.id))::text AS renovados,
         count(*) FILTER (WHERE c.fecha_fin BETWEEN $2::date - interval '12 months' AND $2::date)::text AS terminados_base,
         count(*) FILTER (WHERE c.fecha_fin BETWEEN $2::date - interval '12 months' AND $2::date
                            AND EXISTS (SELECT 1 FROM contrato_alquiler n WHERE n.contrato_anterior_id = c.id))::text AS renovados_base
       FROM contrato_alquiler c`,
      [mes, base],
    );

    // Vacancia: días entre el fin de un contrato y el inicio del siguiente en
    // la MISMA propiedad. Es plata que no entró y hoy no se mide en ningún
    // lado. `null` si nunca hubo una rotación: cero días de vacancia es una
    // afirmación fuerte y falsa.
    const { rows: v } = await ej.query<{ dias: string | null }>(
      `SELECT avg(hueco)::text AS dias FROM (
         SELECT (SELECT min(n.fecha_inicio) FROM contrato_alquiler n
                  WHERE n.propiedad_id = c.propiedad_id
                    AND n.fecha_inicio >= c.fecha_fin
                    AND n.id <> c.id) - c.fecha_fin AS hueco
           FROM contrato_alquiler c
          WHERE c.estado IN ('vencido','rescindido','renovado')
       ) x WHERE hueco IS NOT NULL`,
    );

    const { rows: pv } = await ej.query<{ d30: string; d60: string; d90: string; d180: string }>(
      `SELECT
         count(*) FILTER (WHERE fecha_fin <= current_date +  30)::text AS d30,
         count(*) FILTER (WHERE fecha_fin <= current_date +  60)::text AS d60,
         count(*) FILTER (WHERE fecha_fin <= current_date +  90)::text AS d90,
         count(*) FILTER (WHERE fecha_fin <= current_date + 180)::text AS d180
       FROM contrato_alquiler
      WHERE estado = 'vigente' AND fecha_fin >= current_date`,
    );

    const { rows: serie } = await ej.query<{ periodo: string; n: string }>(
      `WITH meses AS (
         SELECT generate_series($1::date - interval '11 months', $1::date, interval '1 month')::date AS m
       )
       SELECT m::text AS periodo,
              (SELECT count(*) FROM contrato_alquiler c
                WHERE c.fecha_inicio <= (m + interval '1 month' - interval '1 day')
                  AND c.fecha_fin >= m
                  AND c.estado IN ('vigente','renovado','vencido'))::text AS n
         FROM meses ORDER BY m`,
      [mes],
    );

    return {
      unidades,
      ocupacion: conBase(pct(vigentes, unidades), pct(vigentesBase, unidades)),
      contratosVigentes: vigentes,
      renovacion: conBase(
        pct(Number(r[0].renovados), Number(r[0].terminados)),
        pct(Number(r[0].renovados_base), Number(r[0].terminados_base)),
      ),
      vacanciaDias: numOrNull(v[0].dias),
      porVencer: {
        dias30: Number(pv[0].d30),
        dias60: Number(pv[0].d60),
        dias90: Number(pv[0].d90),
        dias180: Number(pv[0].d180),
      },
      serieVigentes: serie.map((s) => ({ periodo: iso(s.periodo), monto: Number(s.n) })),
    };
  }

  // ── Negocio ───────────────────────────────────────────────────────────────

  private async negocio(
    ej: Ejecutor,
    mes: string,
    base: string,
  ): Promise<NonNullable<Tablero['negocio']>> {
    // Honorarios devengados: los de VENTA salen de `comision` nivel 1, y los de
    // ALQUILER de la liquidación, que es donde efectivamente se le descuentan
    // al propietario. Sumar los dos es el ingreso real de la inmobiliaria — el
    // único número de todo el producto que es plata PROPIA y no de terceros.
    const sql = `
      SELECT moneda, sum(monto)::text AS monto FROM (
        SELECT c.moneda, c.monto
          FROM comision c
         WHERE c.nivel = 1 AND c.estado IN ('devengada','cobrada')
           AND date_trunc('month', coalesce(c.cobrada_el, c.created_at::date))::date = $1::date
        UNION ALL
        SELECT l.moneda, l.total_honorarios
          FROM liquidacion l
         WHERE l.periodo = $1::date AND l.estado IN ('cerrada','pagada')
      ) x GROUP BY moneda ORDER BY moneda`;

    const { rows: hon } = await ej.query<{ moneda: string; monto: string }>(sql, [mes]);
    const { rows: honBase } = await ej.query<{ moneda: string; monto: string }>(sql, [base]);

    const { rows: porCobrar } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT moneda, sum(monto)::text AS monto FROM comision
        WHERE nivel = 1 AND estado = 'devengada'
        GROUP BY moneda ORDER BY moneda`,
    );

    // Ranking por asesor: el nivel 3 del motor de comisiones ya lo calcula
    // operación por operación y hasta acá nadie lo sumaba.
    const { rows: agentes } = await ej.query<{
      agente_id: string | null; nombre: string; operaciones: string; moneda: string; monto: string;
    }>(
      `SELECT c.beneficiario_id AS agente_id,
              coalesce(u.nombre, 'Sin asignar') AS nombre,
              count(DISTINCT coalesce(c.venta_id, c.contrato_id))::text AS operaciones,
              c.moneda, sum(c.monto)::text AS monto
         FROM comision c
         LEFT JOIN usuario u ON u.id = c.beneficiario_id
        WHERE c.nivel = 3 AND c.beneficiario_tipo = 'agente'
          AND c.estado IN ('devengada','cobrada')
          AND coalesce(c.cobrada_el, c.created_at::date) >= $1::date - interval '12 months'
        GROUP BY c.beneficiario_id, u.nombre, c.moneda
        ORDER BY sum(c.monto) DESC`,
      [mes],
    );

    const porAgente: NonNullable<Tablero['negocio']>['porAgente'] = [];
    for (const a of agentes) {
      const ya = porAgente.find((x) => x.agenteId === a.agente_id);
      if (ya) {
        ya.importes.push({ moneda: a.moneda, monto: Number(a.monto) });
      } else {
        porAgente.push({
          agenteId: a.agente_id,
          nombre: a.nombre,
          operaciones: Number(a.operaciones),
          importes: [{ moneda: a.moneda, monto: Number(a.monto) }],
        });
      }
    }

    return {
      honorariosDevengados: aImportes(hon),
      honorariosBase: aImportes(honBase),
      comisionesPorCobrar: aImportes(porCobrar),
      porAgente,
    };
  }

  // ── Embudo ────────────────────────────────────────────────────────────────

  private async embudo(ej: Ejecutor, mes: string): Promise<Tablero['embudo']> {
    const { rows: etapas } = await ej.query<{ estado: string; total: string }>(
      `SELECT estado, count(*)::text AS total FROM oportunidad GROUP BY estado`,
    );

    const { rows: origen } = await ej.query<{ origen: string; total: string; ganadas: string }>(
      `SELECT origen, count(*)::text AS total,
              count(*) FILTER (WHERE estado = 'ganada')::text AS ganadas
         FROM oportunidad GROUP BY origen ORDER BY count(*) DESC`,
    );

    // `motivo_perdida` existe desde la etapa 3, se llena, y no la lee nadie.
    // Es el error #3 del playbook esperando que alguien la agregue.
    const { rows: motivos } = await ej.query<{ motivo: string; total: string }>(
      `SELECT motivo_perdida AS motivo, count(*)::text AS total
         FROM oportunidad
        WHERE estado = 'perdida' AND motivo_perdida IS NOT NULL
        GROUP BY motivo_perdida ORDER BY count(*) DESC`,
    );

    // Tiempo de primera respuesta: de `created_at` a la primera nota. Es el
    // indicador que más correlaciona con cierre en el rubro, y el dato ya está.
    const { rows: resp } = await ej.query<{ horas: string | null }>(
      `SELECT avg(EXTRACT(EPOCH FROM (n.primera - o.created_at)) / 3600)::text AS horas
         FROM oportunidad o
         JOIN LATERAL (
           SELECT min(created_at) AS primera FROM nota
            WHERE entidad_tipo = 'oportunidad' AND entidad_id = o.id
         ) n ON n.primera IS NOT NULL
        WHERE o.created_at >= $1::date - interval '12 months'`,
      [mes],
    );

    const ORDEN = ['nueva', 'contactada', 'calificada', 'visita', 'negociacion', 'ganada', 'perdida'];

    return {
      etapas: ORDEN.map((e) => ({
        estado: e,
        total: Number(etapas.find((x) => x.estado === e)?.total ?? 0),
      })),
      porOrigen: origen.map((o) => ({
        origen: o.origen,
        total: Number(o.total),
        ganadas: Number(o.ganadas),
      })),
      motivosPerdida: motivos.map((m) => ({ motivo: m.motivo, total: Number(m.total) })),
      primeraRespuestaHoras: numOrNull(resp[0]?.horas ?? null),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function aImportes(filas: Array<{ moneda: string; monto: string }>): Importe[] {
  return filas.map((f) => ({ moneda: f.moneda, monto: Number(f.monto) }));
}

/** Suma por moneda una lista que puede traer varias filas de la misma. */
function sumarPorMoneda(filas: Array<{ moneda: string; monto: string }>): Importe[] {
  const m = new Map<string, number>();
  for (const f of filas) m.set(f.moneda, (m.get(f.moneda) ?? 0) + Number(f.monto));
  return [...m.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort(
    (a, b) => a.moneda.localeCompare(b.moneda),
  );
}

/**
 * `null` y no cero. Postgres devuelve `NULL` cuando no hay filas que promediar,
 * y convertirlo a 0 acá sería inventar el dato justo en el borde donde importa.
 */
function numOrNull(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** Porcentaje con un decimal. Denominador cero → `null`, no división por cero. */
function pct(parte: number, total: number): number | null {
  if (!total) return null;
  return Math.round((100 * parte) / total * 10) / 10;
}

function conBase(valor: number | null, base: number | null): ConBase {
  return {
    valor,
    base,
    delta: valor === null || base === null ? null : Math.round((valor - base) * 10) / 10,
  };
}

/** Una columna `date` no tiene zona; convertirla a `Date` le inventa UTC. */
function iso(v: string | Date): string {
  return v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
}
