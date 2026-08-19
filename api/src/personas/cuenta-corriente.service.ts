import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError } from '../common/app-error';

/**
 * La cuenta corriente de una persona: qué debe y qué se le debe.
 *
 * ── Por qué NO hay tabla nueva ──
 *
 * Todo el dato ya está: las cuotas emitidas en `periodo_alquiler`, lo cobrado
 * en `cobro`, y lo que se le liquida al dueño en `liquidacion`. Una tabla de
 * saldos sería un tercer lugar donde vive el mismo número, y el día que alguien
 * registre un cobro sin actualizarla, la pantalla mentiría con total
 * convicción. Es la misma regla que ya evitó una tabla de roles en la etapa 3:
 * **un dato derivado no se desincroniza**.
 *
 * ── Las dos preguntas, que son distintas ──
 *
 * «¿Cuánto me debe este inquilino?» y «¿cuánto le debo a este propietario?» no
 * son la misma cuenta con el signo cambiado: la primera sale de cuotas contra
 * cobros, y la segunda de liquidaciones cerradas contra pagadas. Una persona
 * puede ser las dos cosas a la vez —alquila una unidad y es dueña de otra— y
 * ahí los dos saldos conviven sin compensarse. **Netearlos sería inventar una
 * compensación que nadie acordó**, y encima entre plata propia y plata de
 * terceros.
 *
 * ── Ningún monto sin su moneda ──
 *
 * Todo sale agrupado por moneda. Un contrato en USD y otro en ARS no se suman:
 * el saldo es una lista, no un número.
 */

export interface Importe {
  moneda: string;
  monto: number;
}

export interface Movimiento {
  fecha: string;
  /** `debe` suma al saldo, `haber` lo baja. Nunca un signo suelto sin etiqueta. */
  tipo: 'debe' | 'haber';
  concepto: string;
  detalle: string | null;
  monto: number;
  moneda: string;
  /** Para que la fila lleve a algún lado. */
  contratoId: string | null;
}

export interface Lado {
  saldo: Importe[];
  movimientos: Movimiento[];
  /** Cuántos hay en total: la lista viene recortada. */
  total: number;
}

export interface CuentaCorriente {
  personaId: string;
  nombre: string;
  /** `null` cuando la persona no es inquilino de ningún contrato. */
  comoInquilino: Lado | null;
  /** `null` cuando no es titular de ninguna propiedad. */
  comoPropietario: Lado | null;
}

/** Cuántos movimientos trae cada lado. Lo demás vive en su pantalla. */
const TOPE = 50;

@Injectable()
export class CuentaCorrienteService {
  constructor(private readonly db: DbService) {}

  async leer(tenantId: string, personaId: string): Promise<CuentaCorriente> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: p } = await ej.query<{ nombre: string }>(
        `SELECT trim(coalesce(nombre,'') || ' ' || coalesce(apellido,'')) AS nombre
           FROM persona WHERE id = $1`,
        [personaId],
      );
      if (!p.length) throw AppError.notFound('No se encontró esa persona.');

      // Se pregunta primero si la persona TIENE ese rol. Sin esto, alguien que
      // nunca alquiló nada mostraría un panel de inquilino con saldo cero — y
      // un cero es un número: dice «está al día», que es distinto de «acá no
      // corresponde la pregunta».
      const { rows: roles } = await ej.query<{ inquilino: boolean; propietario: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM contrato_parte
                    WHERE persona_id = $1 AND rol = 'locatario') AS inquilino,
           EXISTS (SELECT 1 FROM titularidad WHERE persona_id = $1) AS propietario`,
        [personaId],
      );

      return {
        personaId,
        nombre: p[0].nombre,
        comoInquilino: roles[0].inquilino ? await this.inquilino(ej, personaId) : null,
        comoPropietario: roles[0].propietario ? await this.propietario(ej, personaId) : null,
      };
    });
  }

  /**
   * Lo que debe como inquilino: cuotas emitidas contra lo cobrado.
   *
   * Sólo cuenta las cuotas ya VENCIDAS o del mes en curso: una cuota de
   * diciembre emitida en agosto no es una deuda, es una previsión, y sumarla
   * haría que todo inquilino con contrato largo aparezca debiendo una fortuna.
   */
  private async inquilino(ej: Ejecutor, personaId: string): Promise<Lado> {
    const contratos = `
      SELECT contrato_id FROM contrato_parte
       WHERE persona_id = $1 AND rol = 'locatario'`;

    const { rows: saldo } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT pa.moneda,
              (sum(pa.total) - coalesce(sum(c.cobrado), 0))::text AS monto
         FROM periodo_alquiler pa
         LEFT JOIN LATERAL (
           SELECT sum(co.monto) AS cobrado FROM cobro co
            WHERE co.periodo_id = pa.id AND co.imputacion = 'alquiler'
         ) c ON true
        WHERE pa.contrato_id IN (${contratos})
          AND pa.periodo <= date_trunc('month', current_date)::date
        GROUP BY pa.moneda
       HAVING sum(pa.total) - coalesce(sum(c.cobrado), 0) <> 0
        ORDER BY pa.moneda`,
      [personaId],
    );

    // Las dos caras en una sola consulta: la cuota que se emitió y el cobro que
    // la bajó. Ordenadas juntas por fecha, que es como se lee una cuenta
    // corriente — no dos listas que el usuario tiene que cruzar a ojo.
    const movimientos = `
      SELECT pa.vence_el::text AS fecha, 'debe' AS tipo,
             'Cuota ' || to_char(pa.periodo, 'MM/YYYY') AS concepto,
             pr.calle || coalesce(' ' || pr.numero, '') AS detalle,
             pa.total::text AS monto, pa.moneda, pa.contrato_id
        FROM periodo_alquiler pa
        JOIN contrato_alquiler ca ON ca.id = pa.contrato_id
        JOIN propiedad pr ON pr.id = ca.propiedad_id
       WHERE pa.contrato_id IN (${contratos})
         AND pa.periodo <= date_trunc('month', current_date)::date
      UNION ALL
      SELECT co.fecha::text, 'haber',
             'Pago' || coalesce(' · ' || co.medio, ''),
             coalesce(co.comprobante, ''),
             co.monto::text, co.moneda, pa.contrato_id
        FROM cobro co
        JOIN periodo_alquiler pa ON pa.id = co.periodo_id
       WHERE pa.contrato_id IN (${contratos}) AND co.imputacion = 'alquiler'`;

    return this.armar(ej, saldo, movimientos, [personaId]);
  }

  /**
   * Lo que se le debe como propietario: liquidaciones cerradas y todavía no
   * pagadas.
   *
   * Un borrador NO cuenta: es un número que todavía se puede rearmar, y
   * prometerle al dueño una plata que puede cambiar es peor que no mostrarla.
   * La liquidación cerrada es la que congela lo que se le transfiere — es la
   * misma regla de inmutabilidad de la etapa 10.2.
   */
  private async propietario(ej: Ejecutor, personaId: string): Promise<Lado> {
    const { rows: saldo } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT moneda, sum(total_neto)::text AS monto
         FROM liquidacion
        WHERE propietario_id = $1 AND estado = 'cerrada'
        GROUP BY moneda
       HAVING sum(total_neto) <> 0
        ORDER BY moneda`,
      [personaId],
    );

    const movimientos = `
      SELECT l.periodo::text AS fecha, 'debe' AS tipo,
             'Liquidación ' || to_char(l.periodo, 'MM/YYYY') AS concepto,
             CASE l.estado WHEN 'pagada' THEN 'Pagada' ELSE 'Cerrada, sin pagar' END AS detalle,
             l.total_neto::text AS monto, l.moneda, NULL::uuid AS contrato_id
        FROM liquidacion l
       WHERE l.propietario_id = $1 AND l.estado IN ('cerrada', 'pagada')
      UNION ALL
      SELECT l.pagada_el::date::text, 'haber',
             'Transferencia ' || to_char(l.periodo, 'MM/YYYY'),
             NULL, l.total_neto::text, l.moneda, NULL::uuid
        FROM liquidacion l
       WHERE l.propietario_id = $1 AND l.estado = 'pagada' AND l.pagada_el IS NOT NULL`;

    return this.armar(ej, saldo, movimientos, [personaId]);
  }

  /** El conteo y la página, con el MISMO cuerpo: si difieren, el total miente. */
  private async armar(
    ej: Ejecutor,
    saldo: Array<{ moneda: string; monto: string }>,
    cuerpo: string,
    params: unknown[],
  ): Promise<Lado> {
    const { rows: conteo } = await ej.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM (${cuerpo}) m`,
      params,
    );

    const { rows } = await ej.query<{
      fecha: string; tipo: string; concepto: string; detalle: string | null;
      monto: string; moneda: string; contrato_id: string | null;
    }>(
      `SELECT * FROM (${cuerpo}) m ORDER BY m.fecha DESC, m.concepto LIMIT ${TOPE}`,
      params,
    );

    return {
      saldo: saldo.map((s) => ({ moneda: s.moneda, monto: Number(s.monto) })),
      total: Number(conteo[0].total),
      movimientos: rows.map((r) => ({
        // `date` de Postgres no lleva zona: se recorta el texto en vez de
        // pasarlo por `Date`, que le inventaría medianoche UTC y correría el día.
        fecha: String(r.fecha).slice(0, 10),
        tipo: r.tipo === 'haber' ? 'haber' : 'debe',
        concepto: r.concepto,
        detalle: r.detalle || null,
        monto: Number(r.monto),
        moneda: r.moneda,
        contratoId: r.contrato_id,
      })),
    };
  }
}
