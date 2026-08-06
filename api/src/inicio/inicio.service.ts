import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import type { Rol } from '../auth/tokens.service';

/**
 * La pantalla de inicio.
 *
 * Hasta ahora se entraba a Propiedades, que es un archivo: contesta "qué tengo"
 * y no "qué tengo que hacer hoy". Un administrador abre el sistema a la mañana
 * con la segunda pregunta.
 *
 * Tres decisiones que mandan sobre el resto:
 *
 * 1. **Un solo endpoint, una sola vuelta.** Ocho consultas en paralelo desde el
 *    front serían ocho round-trips y ocho estados de carga en la pantalla que
 *    más rápido tiene que aparecer.
 *
 * 2. **Los importes van agrupados por moneda, nunca sumados.** ARS y USD conviven
 *    en la misma cartera; un total que los mezcle es un número que no significa
 *    nada. Por eso todo lo que es plata sale como `[{moneda, monto}]` y no como
 *    un `number`.
 *
 * 3. **Cada lista es accionable y corta.** No es un resumen para mirar: son las
 *    cinco cosas que hay que resolver, cada una con su link. Lo que no entra se
 *    ve completo en su pantalla, y por eso cada bloque trae su total aparte.
 *
 * 4. **Los bloques de plata respetan el rol.** Un asesor recibe 403 en
 *    `/v1/liquidaciones`: un inicio que le mostrara el cobrado del mes y la
 *    deuda de la cartera sería la misma información por otra puerta. Los bloques
 *    que no le corresponden vienen en `null` —no en cero— y la pantalla dice por
 *    qué. Un cero es un número falso, y acá los números son el producto.
 */

/** Quién ve los agregados de plata de toda la inmobiliaria. */
const ROLES_PLATA: Rol[] = ['owner', 'admin', 'contable'];

/** Un importe siempre viaja con su moneda. Ver DESIGN.md §5. */
export interface Importe {
  moneda: string;
  monto: number;
}

export interface Inicio {
  /** Qué puede ver quien pregunta. La pantalla lo usa para explicar los huecos. */
  vePlata: boolean;

  /** Los números de arriba. */
  cartera: {
    propiedades: number;
    disponibles: number;
    contratosVigentes: number;
  };
  /** `null` para quien no ve plata. Nunca ceros: un cero es un número falso. */
  mes: {
    periodo: string;
    cobrado: Importe[];
    porCobrar: Importe[];
  } | null;
  vencenEstaSemana: Array<{
    tipo: 'contrato' | 'cuota';
    entidadId: string;
    contratoId: string;
    fecha: string;
    etiquetaPropiedad: string;
    referencia: string;
    monto: number | null;
    moneda: string;
  }>;
  ajustesPorConfirmar: {
    total: number;
    items: Array<{
      id: string;
      contratoId: string;
      vigenteDesde: string;
      etiquetaPropiedad: string;
      referencia: string;
      montoAnterior: number;
      montoNuevo: number;
      moneda: string;
      indiceTipo: string;
      vencido: boolean;
    }>;
  };
  impagas: {
    total: number;
    adeudado: Importe[];
    items: Array<{
      id: string;
      contratoId: string;
      venceEl: string;
      diasDeMora: number;
      etiquetaPropiedad: string;
      referencia: string;
      saldo: number;
      moneda: string;
      inquilino: string | null;
    }>;
  } | null;
  liquidacionesBorrador: {
    total: number;
    neto: Importe[];
    /**
     * El período del borrador más viejo, para que el enlace de la pantalla
     * lleve hasta él.
     *
     * Sin esto el contador decía "2" y el link caía en Liquidaciones, que abre
     * en el mes corriente: "Sin liquidaciones para ago/26", con los dos
     * borradores en enero. Un contador no puede llevar a una pantalla que
     * muestre menos de lo que el contador prometió.
     */
    periodoMasViejo: string | null;
  } | null;
  oportunidadesFrias: {
    total: number;
    dias: number;
    items: Array<{
      id: string;
      nombre: string;
      desdeHace: number;
      estado: string;
      origen: string;
    }>;
  };
}

/** Cuántos ítems trae cada lista. Lo demás se ve en su pantalla. */
const TOPE = 6;

/** Una oportunidad sin tocar hace más de esto ya se está enfriando. */
const DIAS_FRIA = 7;

@Injectable()
export class InicioService {
  constructor(private readonly db: DbService) {}

  async resumen(tenantId: string, rol: Rol): Promise<Inicio> {
    const vePlata = ROLES_PLATA.includes(rol);

    return this.db.withTenant(tenantId, async (ej) => {
      // Las consultas no dependen entre sí, pero comparten la MISMA conexión
      // —es la que tiene fijado el tenant para RLS— así que van en serie. Son
      // consultas indexadas contra una sola inmobiliaria, no un problema.
      //
      // Las de plata NO se ejecutan para quien no las puede ver: filtrar después
      // funcionaría igual, pero deja el dato viajando por un lugar donde no
      // tenía que estar.
      return {
        vePlata,
        cartera: await this.cartera(ej),
        mes: vePlata ? await this.mes(ej) : null,
        vencenEstaSemana: await this.vencenEstaSemana(ej),
        ajustesPorConfirmar: await this.ajustesPorConfirmar(ej),
        impagas: vePlata ? await this.impagas(ej) : null,
        liquidacionesBorrador: vePlata ? await this.liquidacionesBorrador(ej) : null,
        oportunidadesFrias: await this.oportunidadesFrias(ej),
      };
    });
  }

  private async cartera(ej: Ejecutor): Promise<Inicio['cartera']> {
    const { rows } = await ej.query<{
      propiedades: string; disponibles: string; contratos: string;
    }>(
      `SELECT
         (SELECT count(*) FROM propiedad)::text AS propiedades,
         (SELECT count(DISTINCT o.propiedad_id) FROM operacion o
           WHERE o.estado = 'disponible')::text AS disponibles,
         (SELECT count(*) FROM contrato_alquiler
           WHERE estado = 'vigente')::text AS contratos`,
    );

    return {
      propiedades: Number(rows[0].propiedades),
      disponibles: Number(rows[0].disponibles),
      contratosVigentes: Number(rows[0].contratos),
    };
  }

  /**
   * Cobrado y por cobrar del mes en curso, **por moneda**.
   *
   * "Por cobrar" es el saldo real (total menos lo ya cobrado), no el total de la
   * cuota: si entró un pago parcial, lo que falta es la diferencia.
   */
  private async mes(ej: Ejecutor): Promise<NonNullable<Inicio['mes']>> {
    const { rows: cobrado } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT co.moneda, sum(co.monto)::text AS monto
         FROM cobro co
        WHERE co.fecha >= date_trunc('month', current_date)
          AND co.fecha <  date_trunc('month', current_date) + interval '1 month'
        GROUP BY co.moneda
        ORDER BY co.moneda`,
    );

    const { rows: porCobrar } = await ej.query<{ moneda: string; monto: string }>(
      `SELECT p.moneda, sum(p.total - coalesce(c.pagado, 0))::text AS monto
         FROM periodo_alquiler p
         LEFT JOIN (
           SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id
         ) c ON c.periodo_id = p.id
        WHERE p.periodo = date_trunc('month', current_date)
          AND p.estado IN ('pendiente','parcial','vencido')
        GROUP BY p.moneda
        HAVING sum(p.total - coalesce(c.pagado, 0)) > 0
        ORDER BY p.moneda`,
    );

    return {
      periodo: new Date().toISOString().slice(0, 7) + '-01',
      cobrado: aImportes(cobrado),
      porCobrar: aImportes(porCobrar),
    };
  }

  /**
   * Lo que vence en los próximos siete días: fin de contrato y cuotas.
   *
   * Los ajustes NO entran acá: tienen su propio bloque porque la acción es otra
   * —confirmar un número— y mezclarlos hace que se pierdan entre las cuotas.
   */
  private async vencenEstaSemana(ej: Ejecutor): Promise<Inicio['vencenEstaSemana']> {
    const { rows } = await ej.query<{
      tipo: string; entidad_id: string; contrato_id: string; fecha: string;
      codigo: number; referencia: string; monto: string | null; moneda: string;
    }>(
      `SELECT 'contrato' AS tipo, c.id AS entidad_id, c.id AS contrato_id,
              c.fecha_fin AS fecha, pr.codigo,
              trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS referencia,
              NULL::numeric AS monto, c.moneda
         FROM contrato_alquiler c
         JOIN propiedad pr ON pr.id = c.propiedad_id
        WHERE c.estado = 'vigente'
          AND c.fecha_fin BETWEEN current_date AND current_date + 7

        UNION ALL

       SELECT 'cuota', p.id, c.id, p.vence_el, pr.codigo,
              trim(pr.calle || ' ' || coalesce(pr.numero,'')),
              p.total, p.moneda
         FROM periodo_alquiler p
         JOIN contrato_alquiler c ON c.id = p.contrato_id
         JOIN propiedad pr ON pr.id = c.propiedad_id
        WHERE p.estado IN ('pendiente','parcial')
          AND p.vence_el BETWEEN current_date AND current_date + 7

        ORDER BY fecha
        LIMIT $1`,
      [TOPE],
    );

    return rows.map((r) => ({
      tipo: r.tipo as 'contrato' | 'cuota',
      entidadId: r.entidad_id,
      contratoId: r.contrato_id,
      fecha: iso(r.fecha),
      etiquetaPropiedad: etiqueta(r.codigo),
      referencia: r.referencia,
      monto: r.monto === null ? null : Number(r.monto),
      moneda: r.moneda,
    }));
  }

  /**
   * Aumentos proyectados esperando confirmación.
   *
   * Sin piso hacia atrás y ordenados por el más viejo primero: un ajuste cuya
   * vigencia ya pasó y sigue sin confirmar es plata que se está perdiendo todos
   * los meses, y es lo primero que hay que ver.
   */
  private async ajustesPorConfirmar(ej: Ejecutor): Promise<Inicio['ajustesPorConfirmar']> {
    const { rows: conteo } = await ej.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM contrato_ajuste WHERE estado = 'proyectado'`,
    );

    const { rows } = await ej.query<{
      id: string; contrato_id: string; vigente_desde: string; codigo: number;
      referencia: string; monto_anterior: string; monto_nuevo: string;
      moneda: string; indice_tipo: string; vencido: boolean;
    }>(
      `SELECT a.id, a.contrato_id, a.vigente_desde, pr.codigo,
              trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS referencia,
              a.monto_anterior, a.monto_nuevo, a.moneda, a.indice_tipo,
              (a.vigente_desde <= current_date) AS vencido
         FROM contrato_ajuste a
         JOIN contrato_alquiler c ON c.id = a.contrato_id
         JOIN propiedad pr ON pr.id = c.propiedad_id
        WHERE a.estado = 'proyectado'
        ORDER BY a.vigente_desde
        LIMIT $1`,
      [TOPE],
    );

    return {
      total: Number(conteo[0].total),
      items: rows.map((r) => ({
        id: r.id,
        contratoId: r.contrato_id,
        vigenteDesde: iso(r.vigente_desde),
        etiquetaPropiedad: etiqueta(r.codigo),
        referencia: r.referencia,
        montoAnterior: Number(r.monto_anterior),
        montoNuevo: Number(r.monto_nuevo),
        moneda: r.moneda,
        indiceTipo: r.indice_tipo,
        vencido: r.vencido,
      })),
    };
  }

  /** Cuotas vencidas y no cobradas, con el saldo real y los días de mora. */
  private async impagas(ej: Ejecutor): Promise<NonNullable<Inicio['impagas']>> {
    const saldo = `p.total - coalesce(c.pagado, 0)`;
    const desde = `
      FROM periodo_alquiler p
      JOIN contrato_alquiler ca ON ca.id = p.contrato_id
      JOIN propiedad pr ON pr.id = ca.propiedad_id
      LEFT JOIN (
        SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id
      ) c ON c.periodo_id = p.id
     WHERE p.estado IN ('pendiente','parcial','vencido')
       AND p.vence_el < current_date
       AND ${saldo} > 0`;

    const { rows: resumen } = await ej.query<{
      total: string; moneda: string; adeudado: string;
    }>(
      `SELECT count(*)::text AS total, p.moneda, sum(${saldo})::text AS adeudado
       ${desde}
       GROUP BY p.moneda
       ORDER BY p.moneda`,
    );

    const { rows } = await ej.query<{
      id: string; contrato_id: string; vence_el: string; mora: number;
      codigo: number; referencia: string; saldo: string; moneda: string;
      inquilino: string | null;
    }>(
      `SELECT p.id, ca.id AS contrato_id, p.vence_el,
              (current_date - p.vence_el)::int AS mora,
              pr.codigo,
              trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS referencia,
              ${saldo} AS saldo, p.moneda,
              (SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
                 FROM contrato_parte cp
                 JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = ca.id AND cp.rol = 'locatario'
                ORDER BY pe.apellido LIMIT 1) AS inquilino
       ${desde}
       ORDER BY p.vence_el
       LIMIT $1`,
      [TOPE],
    );

    return {
      // Las filas del resumen vienen agrupadas por moneda: el total de cuotas es
      // la suma de los conteos, no el de una moneda sola.
      total: resumen.reduce((a, r) => a + Number(r.total), 0),
      adeudado: aImportes(resumen.map((r) => ({ moneda: r.moneda, monto: r.adeudado }))),
      items: rows.map((r) => ({
        id: r.id,
        contratoId: r.contrato_id,
        venceEl: iso(r.vence_el),
        diasDeMora: Number(r.mora),
        etiquetaPropiedad: etiqueta(r.codigo),
        referencia: r.referencia,
        saldo: Number(r.saldo),
        moneda: r.moneda,
        inquilino: r.inquilino || null,
      })),
    };
  }

  private async liquidacionesBorrador(
    ej: Ejecutor,
  ): Promise<NonNullable<Inicio['liquidacionesBorrador']>> {
    const { rows } = await ej.query<{
      total: string; moneda: string; neto: string; mas_viejo: string | null;
    }>(
      `SELECT count(*)::text AS total, moneda, sum(total_neto)::text AS neto,
              min(periodo) AS mas_viejo
         FROM liquidacion
        WHERE estado = 'borrador'
        GROUP BY moneda
        ORDER BY moneda`,
    );

    // El mínimo de los mínimos: el `min(periodo)` viene por moneda y el enlace
    // es uno solo.
    const periodos = rows.map((r) => r.mas_viejo).filter((p): p is string => !!p).map(iso);

    return {
      total: rows.reduce((a, r) => a + Number(r.total), 0),
      neto: aImportes(rows.map((r) => ({ moneda: r.moneda, monto: r.neto }))),
      periodoMasViejo: periodos.length ? periodos.sort()[0] : null,
    };
  }

  /**
   * Consultas que entraron y nadie movió.
   *
   * Se mide por `updated_at`, no por `created_at`: una oportunidad que se tocó
   * ayer no está fría aunque haya entrado hace un mes.
   */
  private async oportunidadesFrias(ej: Ejecutor): Promise<Inicio['oportunidadesFrias']> {
    const donde = `
      WHERE o.estado IN ('nueva','contactada','calificada','visita','negociacion')
        AND o.updated_at < current_date - $1::int`;

    const { rows: conteo } = await ej.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM oportunidad o ${donde}`,
      [DIAS_FRIA],
    );

    const { rows } = await ej.query<{
      id: string; nombre: string; dias: number; estado: string; origen: string;
    }>(
      `SELECT o.id,
              trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS nombre,
              (current_date - o.updated_at::date)::int AS dias,
              o.estado, o.origen
         FROM oportunidad o
         JOIN persona pe ON pe.id = o.persona_id
       ${donde}
        ORDER BY o.updated_at
        LIMIT $2`,
      [DIAS_FRIA, TOPE],
    );

    return {
      total: Number(conteo[0].total),
      dias: DIAS_FRIA,
      items: rows.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        desdeHace: Number(r.dias),
        estado: r.estado,
        origen: r.origen,
      })),
    };
  }
}

function aImportes(filas: Array<{ moneda: string; monto: string }>): Importe[] {
  return filas.map((f) => ({ moneda: f.moneda, monto: Number(f.monto) }));
}

function etiqueta(codigo: number): string {
  return `PROP-${String(codigo).padStart(4, '0')}`;
}

/**
 * Una columna `date` de Postgres no tiene zona. Convertirla a `Date` le inventa
 * medianoche UTC y un contrato del 01/01 se muestra del 31/12. Ya pasó una vez.
 */
function iso(v: string | Date): string {
  return v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
}
