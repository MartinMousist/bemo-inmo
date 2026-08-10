import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { ContratosService } from '../alquileres/contratos.service';
import { parsearCsv, numeroFlexible, fechaFlexible, normalizar } from '../importar/csv.parser';
import {
  cruzar, huellaDe, normalizarContraparte, pareceRuido,
  type Cruce, type CuotaCandidata, type MovimientoParaCruce,
} from './conciliacion.motor';

/**
 * La conciliación: del extracto del banco a los cobros.
 *
 * **El sistema propone, una persona confirma.** Está escrito en la migración
 * 026 y se hace cumplir acá: `importar()` no imputa nada, `sugerencias()` no
 * escribe, y `imputar()` sólo corre cuando alguien eligió una cuota.
 *
 * El cobro NO se inserta desde este servicio: se delega en
 * `ContratosService.registrarCobro()`, que es el que sabe recalcular el saldo,
 * mover el estado del período y auditar. Una segunda forma de crear un cobro
 * sería una segunda forma de equivocarse, y la que se olvidaría de algo es
 * siempre la copia.
 */

/** Cómo se llaman las columnas en los extractos que emiten los bancos de acá. */
const ALIAS: Record<string, string[]> = {
  fecha: ['fecha', 'fecha operacion', 'fecha mov', 'f. operacion', 'fecha valor'],
  monto: ['importe', 'monto', 'credito', 'debito', 'importe pesos'],
  descripcion: ['descripcion', 'concepto', 'detalle', 'movimiento', 'referencia operacion'],
  referencia: ['referencia', 'comprobante', 'nro operacion', 'numero', 'cod. operacion'],
  contraparte: ['cuit', 'cuil', 'cbu', 'ordenante', 'origen', 'contraparte', 'titular'],
};

export interface ResultadoImport {
  extractoId: string;
  leidas: number;
  importados: number;
  repetidos: number;
  /** Filas que el archivo trae y no se pudieron leer, con su motivo. */
  descartadas: Array<{ fila: number; motivo: string }>;
  desde: string | null;
  hasta: string | null;
}

export interface MovimientoConSugerencias {
  id: string;
  fecha: string;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia: string | null;
  contraparte: string | null;
  estado: string;
  pareceRuido: boolean;
  cruce: Cruce;
}

@Injectable()
export class ConciliacionService {
  private readonly logger = new Logger('Conciliación');

  constructor(
    private readonly db: DbService,
    private readonly contratos: ContratosService,
  ) {}

  /**
   * Importa un extracto. No imputa nada: sólo deja los movimientos para revisar.
   *
   * Idempotente por la huella: subir dos veces el archivo de marzo no duplica
   * un solo renglón, y el resultado lo dice —«28 repetidos»— en vez de callarlo,
   * que es lo que haría dudar de si funcionó.
   */
  async importar(
    tenantId: string,
    usuarioId: string,
    texto: string,
    meta: { banco?: string; cuenta?: string; nombreArchivo?: string; moneda?: string },
  ): Promise<ResultadoImport> {
    const csv = parsearCsv(texto);
    if (!csv.filas.length) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'El archivo no tiene ninguna fila de datos.', 'Unprocessable Entity',
      );
    }

    const col = mapearColumnas(csv.cabeceras);
    if (!col.fecha || !col.monto) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'No se encontraron las columnas de fecha y de importe. El extracto tiene que ' +
          `traerlas con alguno de estos nombres: ${ALIAS.fecha.concat(ALIAS.monto).join(', ')}.`,
        'Unprocessable Entity',
      );
    }

    const moneda = meta.moneda === 'USD' ? 'USD' : 'ARS';
    const listos: Array<MovimientoParaCruce & { huella: string }> = [];
    const descartadas: Array<{ fila: number; motivo: string }> = [];

    csv.filas.forEach((f, i) => {
      const fecha = fechaFlexible(f[col.fecha!]);
      const monto = numeroFlexible(f[col.monto!]);

      // Se descarta con MOTIVO y se informa. Una fila que desaparece en
      // silencio es plata que no está y que nadie sabe que falta.
      if (!fecha) return void descartadas.push({ fila: i + 2, motivo: 'La fecha no se entiende.' });
      if (monto === null || monto === 0) {
        return void descartadas.push({ fila: i + 2, motivo: 'El importe no se entiende o es cero.' });
      }

      const mov: MovimientoParaCruce = {
        fecha, monto, moneda,
        descripcion: (col.descripcion ? f[col.descripcion] : '') ?? '',
        referencia: col.referencia ? (f[col.referencia] ?? null) : null,
        contraparte: col.contraparte ? (f[col.contraparte] ?? null) : null,
      };
      listos.push({ ...mov, huella: huellaDe(mov) });
    });

    if (!listos.length) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `Ninguna de las ${csv.filas.length} filas se pudo leer. ` +
          `La primera falla: ${descartadas[0]?.motivo ?? 'desconocida'}`,
        'Unprocessable Entity',
      );
    }

    const fechas = listos.map((l) => l.fecha).sort();

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: ex } = await ej.query<{ id: string }>(
        `INSERT INTO extracto (tenant_id, banco, cuenta, nombre_archivo, desde, hasta,
                               filas, importado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          tenantId, meta.banco ?? null, meta.cuenta ?? null, meta.nombreArchivo ?? null,
          fechas[0], fechas[fechas.length - 1], listos.length, usuarioId,
        ],
      );
      const extractoId = ex[0].id;

      // Un INSERT en lote con ON CONFLICT DO NOTHING: la huella es única por
      // inmobiliaria, así que el archivo repetido no entra dos veces y el
      // RETURNING dice cuántos SÍ entraron.
      const { rows: creados } = await ej.query<{ id: string }>(
        `INSERT INTO movimiento_bancario
           (tenant_id, extracto_id, fecha, monto, moneda, descripcion, referencia,
            contraparte, huella)
         SELECT $1, $2, x.fecha::date, x.monto::numeric, x.moneda, x.descripcion,
                nullif(x.referencia,''), nullif(x.contraparte,''), x.huella
           FROM unnest($3::text[], $4::numeric[], $5::text[], $6::text[], $7::text[],
                       $8::text[], $9::text[])
                AS x(fecha, monto, moneda, descripcion, referencia, contraparte, huella)
         ON CONFLICT (tenant_id, huella) DO NOTHING
         RETURNING id`,
        [
          tenantId, extractoId,
          listos.map((l) => l.fecha),
          listos.map((l) => l.monto),
          listos.map((l) => l.moneda),
          listos.map((l) => l.descripcion),
          listos.map((l) => l.referencia ?? ''),
          listos.map((l) => l.contraparte ?? ''),
          listos.map((l) => l.huella),
        ],
      );

      return {
        extractoId,
        leidas: csv.filas.length,
        importados: creados.length,
        repetidos: listos.length - creados.length,
        descartadas,
        desde: fechas[0] ?? null,
        hasta: fechas[fechas.length - 1] ?? null,
      };
    });
  }

  /**
   * Los movimientos pendientes, cada uno con sus sugerencias.
   *
   * Las candidatas se traen UNA vez para todos los movimientos y el cruce se
   * hace en memoria: son las cuotas con saldo de la inmobiliaria, que es una
   * lista chica y acotada. Consultar por movimiento serían treinta viajes para
   * mirar siempre lo mismo.
   */
  async pendientes(tenantId: string, limite = 100): Promise<MovimientoConSugerencias[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: movs } = await ej.query<FilaMovimiento>(
        `SELECT id, fecha, monto, moneda, descripcion, referencia, contraparte, estado
           FROM movimiento_bancario
          WHERE estado = 'pendiente'
          ORDER BY fecha DESC, created_at DESC
          LIMIT $1`,
        [limite],
      );
      if (!movs.length) return [];

      const candidatas = await this.candidatas(ej);

      return movs.map((m) => {
        const mov: MovimientoParaCruce = {
          fecha: String(m.fecha).slice(0, 10),
          monto: Number(m.monto),
          moneda: m.moneda,
          descripcion: m.descripcion,
          referencia: m.referencia,
          contraparte: m.contraparte,
        };
        return {
          id: m.id,
          ...mov,
          // Explícitos y no por spread: `MovimientoParaCruce` los declara
          // opcionales —al motor le da igual que falten— y la respuesta de la
          // API no puede tener campos que a veces están y a veces no.
          referencia: mov.referencia ?? null,
          contraparte: mov.contraparte ?? null,
          estado: m.estado,
          pareceRuido: pareceRuido(mov),
          cruce: cruzar(mov, candidatas),
        };
      });
    });
  }

  /**
   * Imputa un movimiento a una cuota: crea el cobro y aprende la contraparte.
   *
   * El monto que se cobra es el del MOVIMIENTO, no el de la cuota. Si alguien
   * transfirió de menos, se registra lo que transfirió y la cuota queda parcial
   * — que es la verdad. Registrar el total de la cuota porque «era esa cuota»
   * sería dar por cobrado lo que no entró.
   */
  async imputar(
    tenantId: string,
    movimientoId: string,
    periodoId: string,
    usuarioId: string,
    ip?: string,
  ): Promise<{ cobroId: string; saldo: number; estadoPeriodo: string }> {
    const mov = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaMovimiento & { estado: string }>(
        `SELECT id, fecha, monto, moneda, descripcion, referencia, contraparte, estado
           FROM movimiento_bancario WHERE id = $1`,
        [movimientoId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese movimiento.');
      if (rows[0].estado !== 'pendiente') {
        throw new AppError(
          409, ErrorCode.ESTADO_INVALIDO,
          rows[0].estado === 'imputado'
            ? 'Ese movimiento ya se imputó a una cuota.'
            : 'Ese movimiento está marcado como que no es un cobro.',
          'Conflict',
        );
      }
      return rows[0];
    });

    // Fuera del withTenant: `registrarCobro` abre el suyo, y anidarlos tomaría
    // dos conexiones del pool para el mismo request.
    const cobro = await this.contratos.registrarCobro(
      tenantId,
      {
        periodoId,
        monto: Number(mov.monto),
        fecha: String(mov.fecha).slice(0, 10),
        medio: 'transferencia',
        comprobante: mov.referencia ?? undefined,
      },
      usuarioId,
      ip,
    );

    await this.db.withTenant(tenantId, async (ej) => {
      await ej.query(
        `UPDATE movimiento_bancario
            SET estado = 'imputado', cobro_id = $2, resuelto_el = now(), resuelto_por = $3
          WHERE id = $1`,
        [movimientoId, cobro.id, usuarioId],
      );

      // Se APRENDE la contraparte: es lo que hace que la próxima transferencia
      // de esta persona se reconozca sola. Sin esto, la conciliación es igual
      // de trabajosa todos los meses.
      const cp = normalizarContraparte(mov.contraparte);
      if (cp) await this.aprender(ej, tenantId, periodoId, cp);
    });

    return { cobroId: cobro.id, saldo: cobro.saldo, estadoPeriodo: cobro.estadoPeriodo };
  }

  /** No es un cobro: una comisión del banco, un impuesto, una transferencia propia. */
  async ignorar(
    tenantId: string,
    movimientoId: string,
    usuarioId: string,
    motivo?: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE movimiento_bancario
            SET estado = 'ignorado', motivo_ignorado = $2,
                resuelto_el = now(), resuelto_por = $3
          WHERE id = $1 AND estado = 'pendiente'`,
        [movimientoId, motivo ?? null, usuarioId],
      );
      if (!rowCount) {
        throw AppError.notFound('No se encontró ese movimiento pendiente.');
      }
    });
  }

  /** Volver atrás: el movimiento queda pendiente otra vez. El cobro NO se toca. */
  async reabrir(tenantId: string, movimientoId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ cobro_id: string | null }>(
        `SELECT cobro_id FROM movimiento_bancario WHERE id = $1`,
        [movimientoId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese movimiento.');
      if (rows[0].cobro_id) {
        throw new AppError(
          409, ErrorCode.ESTADO_INVALIDO,
          'Ese movimiento ya generó un cobro. Anulá el cobro desde la cuota: ' +
            'volver el movimiento a pendiente dejaría la plata contada dos veces.',
          'Conflict',
        );
      }
      await ej.query(
        `UPDATE movimiento_bancario
            SET estado = 'pendiente', motivo_ignorado = NULL,
                resuelto_el = NULL, resuelto_por = NULL
          WHERE id = $1`,
        [movimientoId],
      );
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  /** Las cuotas con saldo, con las contrapartes que ya usó cada inquilino. */
  private async candidatas(ej: Ejecutor): Promise<CuotaCandidata[]> {
    const { rows } = await ej.query<{
      id: string; contrato_id: string; saldo: string; moneda: string;
      vence_el: string; periodo: string; codigo: number;
      inquilino: string | null; inquilino_id: string | null;
      contrapartes: string[] | null;
    }>(
      `SELECT p.id, p.contrato_id,
              (p.total - coalesce((SELECT sum(x.monto) FROM cobro x
                                    WHERE x.periodo_id = p.id AND x.imputacion = 'alquiler'), 0))
                AS saldo,
              p.moneda, p.vence_el, p.periodo, pr.codigo,
              per.id AS inquilino_id,
              trim(coalesce(per.nombre,'') || ' ' || coalesce(per.apellido,'')) AS inquilino,
              (SELECT array_agg(cc.contraparte) FROM contraparte_conocida cc
                WHERE cc.persona_id = per.id) AS contrapartes
         FROM periodo_alquiler p
         JOIN contrato_alquiler c ON c.id = p.contrato_id
         JOIN propiedad pr ON pr.id = c.propiedad_id
         LEFT JOIN contrato_parte cp ON cp.contrato_id = c.id AND cp.rol = 'locatario'
         LEFT JOIN persona per ON per.id = cp.persona_id
        WHERE p.estado IN ('pendiente', 'parcial', 'vencido')
        ORDER BY p.vence_el DESC
        LIMIT 400`,
    );

    return rows.map((r) => ({
      id: r.id,
      contratoId: r.contrato_id,
      saldo: Number(r.saldo),
      moneda: r.moneda,
      venceEl: String(r.vence_el).slice(0, 10),
      periodo: String(r.periodo).slice(0, 10),
      etiquetaPropiedad: `PROP-${String(r.codigo).padStart(4, '0')}`,
      inquilino: r.inquilino?.trim() || 'Sin inquilino cargado',
      inquilinoId: r.inquilino_id,
      contrapartesConocidas: r.contrapartes ?? [],
    }));
  }

  private async aprender(
    ej: Ejecutor,
    tenantId: string,
    periodoId: string,
    contraparte: string,
  ): Promise<void> {
    const { rows } = await ej.query<{ persona_id: string }>(
      `SELECT cp.persona_id
         FROM periodo_alquiler p
         JOIN contrato_parte cp ON cp.contrato_id = p.contrato_id AND cp.rol = 'locatario'
        WHERE p.id = $1 LIMIT 1`,
      [periodoId],
    );
    if (!rows.length) return;

    await ej.query(
      `INSERT INTO contraparte_conocida (tenant_id, persona_id, contraparte)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, contraparte)
         DO UPDATE SET veces = contraparte_conocida.veces + 1, ultima_el = now()`,
      [tenantId, rows[0].persona_id, contraparte],
    );
  }
}

interface FilaMovimiento {
  id: string;
  fecha: string;
  monto: string;
  moneda: string;
  descripcion: string;
  referencia: string | null;
  contraparte: string | null;
  estado: string;
}

/**
 * Encuentra cada columna por sus alias, tolerando cómo la llame cada banco.
 *
 * Devuelve el NOMBRE de la cabecera y no su índice: `parsearCsv` entrega cada
 * fila como `Record<string, string>` indexado por cabecera. Leer por índice
 * numérico devuelve `undefined` en todas las filas y el import termina
 * descartando el archivo entero con «la fecha no se entiende» — que fue
 * exactamente lo que pasó, y por eso está escrito acá.
 *
 * Primero busca coincidencia exacta y recién después parcial: con `includes`
 * primero, «referencia operacion» de la descripción le ganaría a «referencia».
 */
function mapearColumnas(cabeceras: string[]): Record<string, string | undefined> {
  const buscar = (alias: string[]) => {
    const exacta = cabeceras.find((c) => alias.some((a) => normalizar(c) === normalizar(a)));
    if (exacta) return exacta;
    return cabeceras.find((c) => alias.some((a) => normalizar(c).includes(normalizar(a))));
  };

  const col: Record<string, string | undefined> = {};
  for (const [campo, alias] of Object.entries(ALIAS)) col[campo] = buscar(alias);
  return col;
}
