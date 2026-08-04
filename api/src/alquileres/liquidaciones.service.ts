import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { round2 } from './ajustes.motor';
import type { FiltroLiquidacionesDto } from './alquileres.dto';

export interface LineaLiquidacion {
  concepto: string;
  tipo: string;
  signo: 1 | -1;
  monto: number;
  detalle: Record<string, unknown>;
}

export interface Liquidacion {
  id: string;
  propietario: { id: string; nombre: string };
  periodo: string;
  totalBruto: number;
  totalHonorarios: number;
  totalGastos: number;
  totalNeto: number;
  moneda: string;
  estado: string;
  lineas: LineaLiquidacion[];
}

/**
 * Liquidación al propietario.
 *
 *   neto = Σ cobros del período
 *        − honorarios de la inmobiliaria
 *        − gastos adelantados
 *        ± ajustes manuales
 *
 * Tres decisiones que definen si el número es el correcto:
 *
 * 1. **Se liquida lo COBRADO, no lo facturado.** Si el inquilino no pagó, al
 *    propietario no le corresponde nada de ese mes. Liquidar sobre lo emitido
 *    sería adelantarle plata que la inmobiliaria no tiene.
 * 2. **Los honorarios se calculan sobre cada cobro**, no sobre el total del
 *    período. Con un pago parcial, el porcentaje se aplica a lo que entró.
 * 3. **En condominio, cada propietario recibe SU liquidación** por su
 *    porcentaje de titularidad, y el reparto se hace sobre el neto de cada
 *    línea, no sobre el total final.
 */
@Injectable()
export class LiquidacionesService {
  private readonly logger = new Logger('Liquidaciones');

  constructor(private readonly db: DbService) {}

  /**
   * Arma (o rearma) las liquidaciones borrador de un período.
   *
   * Idempotente: se puede correr las veces que haga falta mientras estén en
   * borrador. Las cerradas no se tocan.
   */
  async generar(
    tenantId: string,
    periodo: string,
  ): Promise<{ generadas: number; omitidasCerradas: number }> {
    const mes = `${periodo.slice(0, 7)}-01`;

    return this.db.withTenant(tenantId, async (ej) => {
      // Cobros del período que todavía no fueron a ninguna liquidación, con el
      // contrato, el % de honorarios y los locadores con su porcentaje.
      const { rows: cobros } = await ej.query<{
        cobro_id: string;
        monto: string;
        moneda: string;
        contrato_id: string;
        honorarios_pct: string;
        periodo_id: string;
        periodo: Date;
        propiedad_codigo: number;
        calle: string;
        numero: string | null;
        locador_id: string;
        locador_nombre: string;
        porcentaje: string | null;
      }>(
        `SELECT co.id AS cobro_id, co.monto, co.moneda,
                c.id AS contrato_id, c.honorarios_pct,
                p.id AS periodo_id, p.periodo,
                pr.codigo AS propiedad_codigo, pr.calle, pr.numero,
                cp.persona_id AS locador_id,
                trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS locador_nombre,
                cp.porcentaje
           FROM cobro co
           JOIN periodo_alquiler p ON p.id = co.periodo_id
           JOIN contrato_alquiler c ON c.id = p.contrato_id
           JOIN propiedad pr ON pr.id = c.propiedad_id
           JOIN contrato_parte cp ON cp.contrato_id = c.id AND cp.rol = 'locador'
           JOIN persona pe ON pe.id = cp.persona_id
          WHERE p.periodo = $1
            AND co.liquidacion_id IS NULL
            AND c.administrado = true
          ORDER BY pr.codigo, p.periodo`,
        [mes],
      );

      if (!cobros.length) return { generadas: 0, omitidasCerradas: 0 };

      // Agrupado por (propietario, moneda): un propietario con un alquiler en
      // pesos y otro en dólares recibe DOS liquidaciones, no una mezclada.
      const grupos = new Map<string, typeof cobros>();
      for (const c of cobros) {
        const k = `${c.locador_id}|${c.moneda}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k)!.push(c);
      }

      // ── 1. Qué liquidaciones del período ya existen ────────────────────────
      //
      // Una sola consulta para todas. Antes se preguntaba una por grupo: cerrar
      // el mes con 200 contratos eran 200 viajes a la base sólo para esto, el
      // día del mes en que más se usa el sistema.
      const { rows: existentes } = await ej.query<{
        id: string; propietario_id: string; moneda: string; estado: string;
      }>(
        `SELECT id, propietario_id, moneda, estado
           FROM liquidacion WHERE periodo = $1`,
        [mes],
      );
      const porClave = new Map(
        existentes.map((e) => [`${e.propietario_id}|${e.moneda}`, e]),
      );

      let omitidasCerradas = 0;
      const aRearmar: Array<{ id: string; filas: typeof cobros }> = [];
      const faltantes: Array<{ clave: string; propietarioId: string; moneda: string }> = [];

      for (const [clave, filas] of grupos) {
        const [propietarioId, moneda] = clave.split('|');
        const ya = porClave.get(clave);

        if (ya && ya.estado !== 'borrador') {
          omitidasCerradas++;
          continue;
        }
        if (ya) aRearmar.push({ id: ya.id, filas });
        else faltantes.push({ clave, propietarioId, moneda });
      }

      // ── 2. Crear las que faltan, todas de una ──────────────────────────────
      if (faltantes.length) {
        const { rows: creadas } = await ej.query<{
          id: string; propietario_id: string; moneda: string;
        }>(
          `INSERT INTO liquidacion (tenant_id, propietario_id, periodo, moneda)
           SELECT $1, x.propietario_id, $2::date, x.moneda
             FROM unnest($3::uuid[], $4::text[]) AS x(propietario_id, moneda)
           RETURNING id, propietario_id, moneda`,
          [
            tenantId,
            mes,
            faltantes.map((f) => f.propietarioId),
            faltantes.map((f) => f.moneda),
          ],
        );

        for (const c of creadas) {
          const clave = `${c.propietario_id}|${c.moneda}`;
          aRearmar.push({ id: c.id, filas: grupos.get(clave)! });
        }
      }

      if (!aRearmar.length) return { generadas: 0, omitidasCerradas };
      const ids = aRearmar.map((l) => l.id);

      // ── 3. Borrar SÓLO lo que se recalcula ─────────────────────────────────
      //
      // Antes esto borraba TODAS las líneas de la liquidación y después sumaba
      // los gastos desde una tabla que acababa de vaciar: el total de gastos
      // daba siempre 0 y el gasto cargado a mano desaparecía. Con un termotanque
      // de ARS 85.000 adelantado por la inmobiliaria, rearmar el período le
      // transfería esos 85.000 de más al propietario.
      await ej.query(
        `DELETE FROM liquidacion_linea
          WHERE liquidacion_id = ANY($1::uuid[])
            AND tipo IN ('alquiler','honorarios')`,
        [ids],
      );

      // ── 4. Calcular en memoria e insertar todas las líneas de una ──────────
      const linea = {
        liquidacionId: [] as string[],
        contratoId: [] as string[],
        periodoId: [] as string[],
        concepto: [] as string[],
        tipo: [] as string[],
        signo: [] as number[],
        monto: [] as number[],
        detalle: [] as string[],
      };

      for (const { id, filas } of aRearmar) {
        for (const f of filas) {
          // El porcentaje de condominio de ESTE locador. Sin porcentaje se
          // asume 100: un contrato con un solo locador es el caso normal.
          const pct = f.porcentaje === null ? 100 : Number(f.porcentaje);
          const parteCobro = round2((Number(f.monto) * pct) / 100);
          const parteHonorarios = round2((parteCobro * Number(f.honorarios_pct)) / 100);

          const etiqueta = `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`;
          const dir = [f.calle, f.numero].filter(Boolean).join(' ');
          const sufijo = pct === 100 ? '' : ` · ${pct}% de titularidad`;

          linea.liquidacionId.push(id);
          linea.contratoId.push(f.contrato_id);
          linea.periodoId.push(f.periodo_id);
          linea.concepto.push(`Alquiler ${etiqueta} · ${dir}${sufijo}`);
          linea.tipo.push('alquiler');
          linea.signo.push(1);
          linea.monto.push(parteCobro);
          linea.detalle.push(
            JSON.stringify({
              cobroId: f.cobro_id,
              cobroTotal: Number(f.monto),
              porcentajeTitularidad: pct,
            }),
          );

          if (parteHonorarios > 0) {
            linea.liquidacionId.push(id);
            linea.contratoId.push(f.contrato_id);
            linea.periodoId.push(f.periodo_id);
            linea.concepto.push(`Honorarios ${Number(f.honorarios_pct)}% · ${etiqueta}`);
            linea.tipo.push('honorarios');
            linea.signo.push(-1);
            linea.monto.push(parteHonorarios);
            linea.detalle.push(
              JSON.stringify({ base: parteCobro, pct: Number(f.honorarios_pct) }),
            );
          }
        }
      }

      if (linea.liquidacionId.length) {
        await ej.query(
          `INSERT INTO liquidacion_linea
             (tenant_id, liquidacion_id, contrato_id, periodo_id,
              concepto, tipo, signo, monto, detalle)
           SELECT $1, x.liquidacion_id, x.contrato_id, x.periodo_id,
                  x.concepto, x.tipo, x.signo, x.monto, x.detalle
             FROM unnest(
                    $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
                    $6::text[], $7::smallint[], $8::numeric[], $9::jsonb[]
                  ) AS x(liquidacion_id, contrato_id, periodo_id, concepto,
                         tipo, signo, monto, detalle)`,
          [
            tenantId,
            linea.liquidacionId, linea.contratoId, linea.periodoId,
            linea.concepto, linea.tipo, linea.signo, linea.monto, linea.detalle,
          ],
        );
      }

      // ── 5. Recalcular los totales desde las líneas, en una sola pasada ─────
      //
      // Los totales salen de la tabla, no de un acumulador de JavaScript: así
      // los gastos que sobrevivieron al rearmado entran sin tener que volver a
      // leerlos, y el total no puede quedar desincronizado de sus líneas.
      await ej.query(
        `UPDATE liquidacion l
            SET total_bruto      = coalesce(t.bruto, 0),
                total_honorarios = coalesce(t.honorarios, 0),
                total_gastos     = coalesce(t.gastos, 0),
                total_neto       = coalesce(t.bruto, 0)
                                 - coalesce(t.honorarios, 0)
                                 - coalesce(t.gastos, 0)
           FROM unnest($1::uuid[]) AS objetivo(id)
           LEFT JOIN (
             SELECT liquidacion_id,
                    sum(monto) FILTER (WHERE tipo = 'alquiler'   AND signo =  1) AS bruto,
                    sum(monto) FILTER (WHERE tipo = 'honorarios' AND signo = -1) AS honorarios,
                    sum(monto) FILTER (
                      WHERE tipo NOT IN ('alquiler','honorarios') AND signo = -1
                    ) AS gastos
               FROM liquidacion_linea
              WHERE liquidacion_id = ANY($1::uuid[])
              GROUP BY liquidacion_id
           ) t ON t.liquidacion_id = objetivo.id
          WHERE l.id = objetivo.id`,
        [ids],
      );

      return { generadas: aRearmar.length, omitidasCerradas };
    });
  }

  async listar(tenantId: string, f: FiltroLiquidacionesDto): Promise<Pagina<Liquidacion>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [f.periodo ?? null, f.estado ?? null, q];

      const donde = `
        WHERE ($1::date IS NULL OR l.periodo = date_trunc('month', $1::date))
          AND ($2::text IS NULL OR l.estado = $2)
          AND ($3::text IS NULL
               OR trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) ILIKE $3)`;

      // Contar sin el json_agg de líneas: son las líneas de TODAS las
      // liquidaciones del tenant sólo para devolver un número.
      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM liquidacion l
           JOIN persona pe ON pe.id = l.propietario_id
          ${donde}`,
        params,
      );

      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} ${donde}
          ORDER BY l.periodo DESC, pe.apellido, pe.nombre
          LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aLiquidacion), Number(conteo[0].total), f);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Liquidacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} WHERE l.id = $1`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa liquidación.');
      return aLiquidacion(rows[0]);
    });
  }

  /** Gasto adelantado por la inmobiliaria: reparación, impuesto, etc. */
  async agregarGasto(
    tenantId: string,
    id: string,
    g: { concepto: string; tipo: string; monto: number },
  ): Promise<Liquidacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      await this.exigirBorrador(ej, id);

      await ej.query(
        `INSERT INTO liquidacion_linea
           (tenant_id, liquidacion_id, concepto, tipo, signo, monto)
         VALUES ($1,$2,$3,$4,-1,$5)`,
        [tenantId, id, g.concepto, g.tipo, g.monto],
      );

      await this.recalcular(ej, id);
      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} WHERE l.id = $1`,
        [id],
      );
      return aLiquidacion(rows[0]);
    });
  }

  /**
   * Cerrar marca los cobros como liquidados: dejan de entrar en liquidaciones
   * futuras. A partir de acá los números no se tocan.
   */
  async cerrar(tenantId: string, id: string): Promise<Liquidacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      await this.exigirBorrador(ej, id);

      await ej.query(
        `UPDATE cobro SET liquidacion_id = $1
          WHERE id IN (SELECT (detalle->>'cobroId')::uuid FROM liquidacion_linea
                        WHERE liquidacion_id = $1 AND tipo = 'alquiler'
                          AND detalle ? 'cobroId')`,
        [id],
      );

      await ej.query(
        `UPDATE liquidacion SET estado = 'cerrada', cerrada_el = now() WHERE id = $1`,
        [id],
      );

      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} WHERE l.id = $1`,
        [id],
      );
      return aLiquidacion(rows[0]);
    });
  }

  private async exigirBorrador(ej: Ejecutor, id: string): Promise<void> {
    const { rows } = await ej.query<{ estado: string }>(
      'SELECT estado FROM liquidacion WHERE id = $1',
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró esa liquidación.');
    if (rows[0].estado !== 'borrador') {
      throw new AppError(
        409,
        ErrorCode.LIQUIDACION_CERRADA,
        'La liquidación ya está cerrada. Emití una nota de ajuste en el período siguiente.',
        'Conflict',
      );
    }
  }

  private async recalcular(ej: Ejecutor, id: string): Promise<void> {
    await ej.query(
      `UPDATE liquidacion l SET
         total_bruto = t.bruto,
         total_honorarios = t.honorarios,
         total_gastos = t.gastos,
         total_neto = t.bruto - t.honorarios - t.gastos
       FROM (
         SELECT coalesce(sum(monto) FILTER (WHERE tipo = 'alquiler'), 0) AS bruto,
                coalesce(sum(monto) FILTER (WHERE tipo = 'honorarios'), 0) AS honorarios,
                coalesce(sum(monto) FILTER (WHERE signo = -1 AND tipo <> 'honorarios'), 0) AS gastos
           FROM liquidacion_linea WHERE liquidacion_id = $1
       ) t
       WHERE l.id = $1`,
      [id],
    );
  }
}

interface FilaLiquidacion {
  id: string;
  propietario_id: string;
  propietario_nombre: string;
  periodo: string;
  total_bruto: string;
  total_honorarios: string;
  total_gastos: string;
  total_neto: string;
  moneda: string;
  estado: string;
  lineas: Array<Record<string, unknown>> | null;
}

const SELECT_LIQUIDACION = `
  SELECT l.*, trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS propietario_nombre,
    (SELECT json_agg(json_build_object(
        'concepto', li.concepto, 'tipo', li.tipo, 'signo', li.signo,
        'monto', li.monto, 'detalle', li.detalle) ORDER BY li.signo DESC, li.created_at)
       FROM liquidacion_linea li WHERE li.liquidacion_id = l.id) AS lineas
  FROM liquidacion l
  JOIN persona pe ON pe.id = l.propietario_id`;

function aLiquidacion(f: FilaLiquidacion): Liquidacion {
  return {
    id: f.id,
    propietario: { id: f.propietario_id, nombre: f.propietario_nombre },
    periodo: f.periodo.slice(0, 10),
    totalBruto: Number(f.total_bruto),
    totalHonorarios: Number(f.total_honorarios),
    totalGastos: Number(f.total_gastos),
    totalNeto: Number(f.total_neto),
    moneda: f.moneda,
    estado: f.estado,
    lineas: (f.lineas ?? []).map((l) => ({
      concepto: String(l.concepto),
      tipo: String(l.tipo),
      signo: Number(l.signo) as 1 | -1,
      monto: Number(l.monto),
      detalle: (l.detalle as Record<string, unknown>) ?? {},
    })),
  };
}
