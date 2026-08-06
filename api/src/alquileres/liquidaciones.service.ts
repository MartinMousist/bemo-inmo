import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { round2 } from './ajustes.motor';
import { AuditoriaService } from '../auditoria/auditoria.service';
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

  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

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
        imputacion: string;
        punitorio_para: string;
      }>(
        `SELECT co.id AS cobro_id, co.monto, co.moneda,
                c.id AS contrato_id, c.honorarios_pct,
                p.id AS periodo_id, p.periodo,
                pr.codigo AS propiedad_codigo, pr.calle, pr.numero,
                cp.persona_id AS locador_id,
                trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS locador_nombre,
                cp.porcentaje,
                co.imputacion, c.punitorio_para
           FROM cobro co
           JOIN periodo_alquiler p ON p.id = co.periodo_id
           JOIN contrato_alquiler c ON c.id = p.contrato_id
           JOIN propiedad pr ON pr.id = c.propiedad_id
           JOIN contrato_parte cp ON cp.contrato_id = c.id AND cp.rol = 'locador'
           JOIN persona pe ON pe.id = cp.persona_id
          WHERE p.periodo = $1
            AND co.liquidacion_id IS NULL
            AND c.administrado = true
            -- El punitorio que queda para la inmobiliaria no se le rinde a
            -- nadie, así que no entra al circuito. Si entrara sin generar
            -- línea, quedaría sin liquidacion_id para siempre y volvería a
            -- leerse en cada rearmado, todos los meses.
            AND NOT (co.imputacion = 'punitorio' AND c.punitorio_para = 'inmobiliaria')
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

      // Propietarios que este mes tienen GASTOS aunque no hayan tenido cobros.
      //
      // Sin esto la rendición se dispara sólo con la plata que entra, y un mes
      // en que una unidad estuvo vacía y hubo que arreglarle el techo no genera
      // nada: el gasto queda cargado, esperando, y nadie se entera de que el
      // propietario debe. Pasa de verdad —una unidad vacía es justo la que hay
      // que arreglar antes de alquilarla— y se descubrió probando la pantalla,
      // no el endpoint.
      //
      // El resultado es una liquidación con bruto 0 y neto negativo. Es un
      // número incómodo y es el verdadero: al propietario se le debe cobrar.
      const { rows: soloGasto } = await ej.query<{
        propietario_id: string; moneda: string;
      }>(
        `SELECT DISTINCT t.persona_id AS propietario_id, g.moneda
           FROM gasto g
           JOIN titularidad t ON t.propiedad_id = g.propiedad_id
          WHERE g.estado = 'registrado'
            AND g.a_cargo_de = 'propietario'
            AND g.fecha < ($1::date + interval '1 month')::date`,
        [mes],
      );
      for (const s of soloGasto) {
        const k = `${s.propietario_id}|${s.moneda}`;
        if (!grupos.has(k)) grupos.set(k, []);
      }

      if (!grupos.size) return { generadas: 0, omitidasCerradas: 0 };

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
            AND tipo IN ('alquiler','honorarios','punitorio')`,
        [ids],
      );

      // Los gastos tomados en la corrida anterior se SUELTAN antes de volver a
      // tomarlos. Es lo que hace que rearmar sea idempotente sin duplicar ni
      // perder: el gasto vuelve a estar disponible y se lo vuelve a evaluar con
      // las reglas de ahora.
      //
      // El trigger `gasto_inmutable` deja pasar exactamente esta transición
      // —rendido → registrado sin tocar el monto— y ninguna otra.
      await ej.query(
        `DELETE FROM liquidacion_linea
          WHERE liquidacion_id = ANY($1::uuid[]) AND gasto_id IS NOT NULL`,
        [ids],
      );
      await ej.query(
        `UPDATE gasto SET estado = 'registrado', liquidacion_id = NULL
          WHERE liquidacion_id = ANY($1::uuid[])`,
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

          // ── Punitorio ──────────────────────────────────────────────────────
          //
          // A quién le corresponde el interés por mora lo decide el CONTRATO,
          // no una regla global: en la mayoría compensa al propietario por la
          // plata que no cobró a tiempo, pero es negociable.
          //
          // Cuando queda para la inmobiliaria simplemente no se genera línea, y
          // el cobro igual se marca como liquidado para que no vuelva a entrar
          // en el próximo rearmado.
          if (f.imputacion === 'punitorio') {
            linea.liquidacionId.push(id);
            linea.contratoId.push(f.contrato_id);
            linea.periodoId.push(f.periodo_id);
            linea.concepto.push(`Punitorio ${etiqueta} · ${dir}${sufijo}`);
            linea.tipo.push('punitorio');
            linea.signo.push(1);
            linea.monto.push(parteCobro);
            linea.detalle.push(
              JSON.stringify({
                cobroId: f.cobro_id,
                cobroTotal: Number(f.monto),
                porcentajeTitularidad: pct,
                concepto: 'interés por mora',
              }),
            );
            // Sobre el punitorio NO se cobran honorarios: los honorarios son un
            // porcentaje del alquiler pactado, no de la mora. Cobrarlos sobre el
            // interés sería cobrar dos veces por el mismo atraso.
            continue;
          }

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

      // ── 4b. TOMAR los gastos registrados ───────────────────────────────────
      //
      // Acá está toda la diferencia con el modelo anterior. El gasto vive en su
      // propia tabla desde que se carga: la liquidación **lo toma**, no lo
      // contiene. Antes el gasto nacía como línea de la rendición, y por eso
      // rearmarla podía destruirlo — un termotanque de ARS 85.000 adelantado se
      // le transfería de más al propietario. El `DELETE` filtrado tapó el
      // síntoma; esto saca la causa.
      //
      // Cuatro condiciones para que un gasto entre, y ninguna es cosmética:
      //
      //   · `a_cargo_de = 'propietario'` — lo que paga el inquilino se le cobra
      //     a él; meterlo acá es descontarle plata al dueño que no debe.
      //   · misma moneda que la liquidación — ARS y USD no se suman nunca.
      //   · `fecha <= fin del período` — un gasto de mayo no entra en la
      //     rendición de abril, aunque se haya cargado antes de cerrarla.
      //   · titularidad — en condominio, a cada dueño le toca SU porcentaje.
      await ej.query(
        `WITH objetivo AS (
           SELECT l.id, l.propietario_id, l.periodo, l.moneda
             FROM liquidacion l WHERE l.id = ANY($2::uuid[])
         ),
         elegibles AS (
           SELECT o.id AS liquidacion_id, g.id AS gasto_id, g.contrato_id,
                  g.concepto, g.tipo, g.fecha,
                  round(g.monto * coalesce(t.porcentaje, 100) / 100, 2) AS monto,
                  coalesce(t.porcentaje, 100) AS porcentaje
             FROM objetivo o
             JOIN titularidad t ON t.persona_id = o.propietario_id
             JOIN gasto g ON g.propiedad_id = t.propiedad_id
            WHERE g.estado = 'registrado'
              AND g.a_cargo_de = 'propietario'
              AND g.moneda = o.moneda
              AND g.fecha < (o.periodo + interval '1 month')::date
         ),
         insertadas AS (
           INSERT INTO liquidacion_linea
             (tenant_id, liquidacion_id, contrato_id, concepto, tipo, signo, monto,
              gasto_id, detalle)
           SELECT $1, e.liquidacion_id, e.contrato_id,
                  e.concepto || CASE WHEN e.porcentaje = 100 THEN ''
                                     ELSE ' · ' || e.porcentaje || '% de titularidad' END,
                  -- Los tipos del gasto y los de la línea no son el mismo
                  -- catálogo: 'servicio' y 'seguro' no existen en la línea y
                  -- caen en 'otro'. Mapear acá y no ensanchar el CHECK mantiene
                  -- corta la lista con la que se calculan los totales.
                  CASE e.tipo WHEN 'reparacion' THEN 'reparacion'
                              WHEN 'impuesto'   THEN 'impuesto'
                              WHEN 'expensas'   THEN 'expensas'
                              ELSE 'otro' END,
                  -1, e.monto, e.gasto_id,
                  jsonb_build_object('gastoId', e.gasto_id, 'fecha', e.fecha)
             FROM elegibles e
           RETURNING gasto_id, liquidacion_id
         )
         UPDATE gasto g
            SET estado = 'rendido', liquidacion_id = i.liquidacion_id
           FROM insertadas i
          WHERE g.id = i.gasto_id`,
        [tenantId, ids],
      );

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
                    -- El punitorio suma al bruto: es plata que se le rinde al
                    -- propietario igual que el alquiler.
                    sum(monto) FILTER (
                      WHERE tipo IN ('alquiler','punitorio') AND signo = 1
                    ) AS bruto,
                    sum(monto) FILTER (WHERE tipo = 'honorarios' AND signo = -1) AS honorarios,
                    sum(monto) FILTER (
                      WHERE tipo NOT IN ('alquiler','honorarios','punitorio')
                        AND signo = -1
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
    usuarioId: string,
    ip?: string,
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
      const liq = aLiquidacion(rows[0]);

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'gasto_agregado',
        usuarioId,
        entidadTipo: 'liquidacion',
        entidadId: id,
        monto: g.monto,
        moneda: liq.moneda,
        ip,
        detalle: { concepto: g.concepto, tipo: g.tipo, netoDespues: liq.totalNeto },
      });

      return liq;
    });
  }

  /**
   * Cerrar marca los cobros como liquidados: dejan de entrar en liquidaciones
   * futuras. A partir de acá los números no se tocan.
   */
  async cerrar(
    tenantId: string,
    id: string,
    usuarioId: string,
    ip?: string,
  ): Promise<Liquidacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      await this.exigirBorrador(ej, id);

      await ej.query(
        `UPDATE cobro SET liquidacion_id = $1
          WHERE id IN (SELECT (detalle->>'cobroId')::uuid FROM liquidacion_linea
                        WHERE liquidacion_id = $1
                          -- También los de punitorio: si sólo se marcaran los
                          -- de alquiler, el cobro del interés volvería a entrar
                          -- en la liquidación del mes siguiente. Y del siguiente.
                          AND tipo IN ('alquiler','punitorio')
                          AND detalle ? 'cobroId')`,
        [id],
      );

      await ej.query(
        `UPDATE liquidacion
            SET estado = 'cerrada', cerrada_el = now(), cerrada_por = $2
          WHERE id = $1`,
        [id, usuarioId],
      );

      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} WHERE l.id = $1`,
        [id],
      );
      const liq = aLiquidacion(rows[0]);

      // Es el acto que congela lo que se le transfiere a un propietario, y hasta
      // ahora era el único movimiento de plata sin firma.
      await this.auditoria.anotar(ej, tenantId, {
        accion: 'liquidacion_cerrada',
        usuarioId,
        entidadTipo: 'liquidacion',
        entidadId: id,
        monto: liq.totalNeto,
        moneda: liq.moneda,
        ip,
        detalle: {
          propietario: liq.propietario.nombre,
          periodo: liq.periodo,
          totalBruto: liq.totalBruto,
          totalHonorarios: liq.totalHonorarios,
          totalGastos: liq.totalGastos,
        },
      });

      return liq;
    });
  }

  /**
   * El propietario ya cobró.
   *
   * El estado `pagada` existía en el schema desde la etapa 4 y **nada lo
   * escribía**: una liquidación cerrada y una ya transferida se veían igual, que
   * es justo lo que hace que a alguien se le pague dos veces.
   */
  async marcarPagada(
    tenantId: string,
    id: string,
    usuarioId: string,
    ip?: string,
  ): Promise<Liquidacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: actual } = await ej.query<{ estado: string }>(
        'SELECT estado FROM liquidacion WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!actual.length) throw AppError.notFound('No se encontró esa liquidación.');

      if (actual[0].estado === 'pagada') {
        throw new AppError(
          409,
          ErrorCode.OPERACION_DUPLICADA,
          'Esta liquidación ya figura como pagada.',
          'Conflict',
        );
      }
      if (actual[0].estado !== 'cerrada') {
        throw new AppError(
          422,
          ErrorCode.ESTADO_INVALIDO,
          'Sólo se marca como pagada una liquidación cerrada: mientras está en ' +
            'borrador los números todavía pueden cambiar.',
          'Unprocessable Entity',
        );
      }

      await ej.query(
        `UPDATE liquidacion
            SET estado = 'pagada', pagada_el = now(), pagada_por = $2
          WHERE id = $1`,
        [id, usuarioId],
      );

      const { rows } = await ej.query<FilaLiquidacion>(
        `${SELECT_LIQUIDACION} WHERE l.id = $1`,
        [id],
      );
      const liq = aLiquidacion(rows[0]);

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'liquidacion_pagada',
        usuarioId,
        entidadTipo: 'liquidacion',
        entidadId: id,
        monto: liq.totalNeto,
        moneda: liq.moneda,
        ip,
        detalle: { propietario: liq.propietario.nombre, periodo: liq.periodo },
      });

      return liq;
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
