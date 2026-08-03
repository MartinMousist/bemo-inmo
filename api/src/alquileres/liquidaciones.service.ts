import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { round2 } from './ajustes.motor';

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

      // Agrupado por (propietario, moneda): un propietario con un alquiler en
      // pesos y otro en dólares recibe DOS liquidaciones, no una mezclada.
      const grupos = new Map<string, typeof cobros>();
      for (const c of cobros) {
        const k = `${c.locador_id}|${c.moneda}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k)!.push(c);
      }

      let generadas = 0;
      let omitidasCerradas = 0;

      for (const [clave, filas] of grupos) {
        const [propietarioId, moneda] = clave.split('|');

        const { rows: existente } = await ej.query<{ id: string; estado: string }>(
          `SELECT id, estado FROM liquidacion
            WHERE propietario_id = $1 AND periodo = $2 AND moneda = $3`,
          [propietarioId, mes, moneda],
        );

        if (existente.length && existente[0].estado !== 'borrador') {
          omitidasCerradas++;
          continue;
        }

        const liquidacionId = existente.length
          ? existente[0].id
          : (
              await ej.query<{ id: string }>(
                `INSERT INTO liquidacion (tenant_id, propietario_id, periodo, moneda)
                 VALUES ($1,$2,$3,$4) RETURNING id`,
                [tenantId, propietarioId, mes, moneda],
              )
            ).rows[0].id;

        // Se rehace desde cero: es más simple y más seguro que intentar
        // reconciliar líneas existentes.
        await ej.query('DELETE FROM liquidacion_linea WHERE liquidacion_id = $1', [
          liquidacionId,
        ]);

        let bruto = 0;
        let honorarios = 0;

        for (const f of filas) {
          // El porcentaje de condominio de ESTE locador. Sin porcentaje se
          // asume 100: un contrato con un solo locador es el caso normal.
          const pct = f.porcentaje === null ? 100 : Number(f.porcentaje);
          const parteCobro = round2((Number(f.monto) * pct) / 100);
          const parteHonorarios = round2((parteCobro * Number(f.honorarios_pct)) / 100);

          const etiqueta = `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`;
          const dir = [f.calle, f.numero].filter(Boolean).join(' ');
          const sufijo = pct === 100 ? '' : ` · ${pct}% de titularidad`;

          await ej.query(
            `INSERT INTO liquidacion_linea
               (tenant_id, liquidacion_id, contrato_id, periodo_id, concepto, tipo, signo, monto, detalle)
             VALUES ($1,$2,$3,$4,$5,'alquiler',1,$6,$7)`,
            [
              tenantId, liquidacionId, f.contrato_id, f.periodo_id,
              `Alquiler ${etiqueta} · ${dir}${sufijo}`,
              parteCobro,
              JSON.stringify({
                cobroId: f.cobro_id,
                cobroTotal: Number(f.monto),
                porcentajeTitularidad: pct,
              }),
            ],
          );
          bruto = round2(bruto + parteCobro);

          if (parteHonorarios > 0) {
            await ej.query(
              `INSERT INTO liquidacion_linea
                 (tenant_id, liquidacion_id, contrato_id, periodo_id, concepto, tipo, signo, monto, detalle)
               VALUES ($1,$2,$3,$4,$5,'honorarios',-1,$6,$7)`,
              [
                tenantId, liquidacionId, f.contrato_id, f.periodo_id,
                `Honorarios ${Number(f.honorarios_pct)}% · ${etiqueta}`,
                parteHonorarios,
                JSON.stringify({ base: parteCobro, pct: Number(f.honorarios_pct) }),
              ],
            );
            honorarios = round2(honorarios + parteHonorarios);
          }
        }

        // Los gastos cargados a mano sobreviven al rearmado: se vuelven a sumar
        // desde las líneas que no son ni alquiler ni honorarios.
        const { rows: gastos } = await ej.query<{ total: string }>(
          `SELECT coalesce(sum(monto),0) AS total FROM liquidacion_linea
            WHERE liquidacion_id = $1 AND tipo NOT IN ('alquiler','honorarios') AND signo = -1`,
          [liquidacionId],
        );
        const totalGastos = Number(gastos[0].total);

        await ej.query(
          `UPDATE liquidacion
              SET total_bruto = $2, total_honorarios = $3, total_gastos = $4,
                  total_neto = $5
            WHERE id = $1`,
          [
            liquidacionId, bruto, honorarios, totalGastos,
            round2(bruto - honorarios - totalGastos),
          ],
        );

        generadas++;
      }

      return { generadas, omitidasCerradas };
    });
  }

  async listar(tenantId: string, periodo?: string): Promise<Liquidacion[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION}
          WHERE ($1::date IS NULL OR l.periodo = date_trunc('month', $1::date))
          ORDER BY l.periodo DESC, pe.apellido, pe.nombre`,
        [periodo ?? null],
      );
      return rows.map(aLiquidacion);
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
