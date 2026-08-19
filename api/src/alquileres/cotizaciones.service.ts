import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { BcraService } from './bcra.service';

/**
 * El tipo de cambio: el que publica el BCRA y el que usa la inmobiliaria.
 *
 * ── Por qué son dos cosas distintas ──
 *
 * El BCRA publica el oficial —minorista y mayorista— y eso es dato público:
 * global, inmutable, igual que el IPC. Pero **en Argentina una propiedad en
 * dólares no se vende al oficial**, y el tipo que sí se usa no lo publica
 * ninguna API. Inventarlo en un sistema que liquida plata de terceros sería lo
 * peor que este producto puede hacer, así que se carga a mano y queda como
 * cotización DE esa inmobiliaria.
 *
 * La pantalla siempre dice cuál se está usando. Un número convertido sin decir
 * con qué cotización es exactamente el problema que esto vino a resolver.
 */

export type TipoCotizacion = 'oficial_minorista' | 'oficial_mayorista' | 'propia';

export const TIPOS_COTIZACION: TipoCotizacion[] = [
  'oficial_minorista',
  'oficial_mayorista',
  'propia',
];

export interface Cotizacion {
  tipo: TipoCotizacion;
  fecha: string;
  valor: number;
  fuente: string;
  /** `true` cuando la cargó la inmobiliaria y no el BCRA. */
  propia: boolean;
}

/**
 * Una conversión, con todo lo que hace falta para explicarla.
 *
 * Es la misma regla que ya cumple un ajuste por índice: no alcanza con el
 * resultado, tiene que poder reconstruirse. Sin esto, «USD 120.000 son ARS
 * 182.146.800» es un número que nadie puede defender frente al propietario.
 */
export interface Conversion {
  desde: { monto: number; moneda: string };
  hasta: { monto: number; moneda: string };
  cotizacion: Cotizacion;
  /** La cuenta, escrita. Lo que se muestra debajo del resultado. */
  formula: string;
}

@Injectable()
export class CotizacionesService {
  private readonly logger = new Logger('Cotizaciones');

  constructor(
    private readonly db: DbService,
    private readonly bcra: BcraService,
  ) {}

  /**
   * Trae del BCRA las cotizaciones oficiales que falten.
   *
   * A diferencia de los índices, **no se agrega por mes**: un tipo de cambio es
   * diario y promediarlo perdería justo el dato que se busca. Se guarda la
   * serie tal cual viene.
   *
   * Si la fuente no responde no se estima nada: se informa y los valores que ya
   * estaban quedan intactos. Es la misma regla que ya cumple la de índices.
   */
  async sincronizar(
    desde?: string,
  ): Promise<Record<string, { cargadas: number; error?: string }>> {
    const hasta = new Date().toISOString().slice(0, 10);
    // Un mes hacia atrás alcanza para el uso normal; la primera corrida en una
    // base vacía se puede pedir con `desde`.
    const inicio = desde ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const salida: Record<string, { cargadas: number; error?: string }> = {};

    for (const tipo of ['oficial_minorista', 'oficial_mayorista'] as TipoCotizacion[]) {
      const serie = await this.bcra.serie(tipo, inicio, hasta);

      if (serie === null) {
        salida[tipo] = {
          cargadas: 0,
          error: 'No se pudo consultar el BCRA. Las cotizaciones existentes no se tocaron.',
        };
        this.logger.warn(`Sincronización de ${tipo} sin datos: la fuente no respondió`);
        continue;
      }

      const nuevas = await this.guardarOficiales(
        serie.map((v) => ({
          tipo,
          fecha: v.fecha,
          valor: v.valor,
          fuente: `BCRA · variable ${tipo === 'oficial_minorista' ? 4 : 5}`,
        })),
      );
      salida[tipo] = { cargadas: nuevas };
    }
    return salida;
  }

  /**
   * Las últimas cotizaciones de cada tipo, más el histórico del tipo pedido.
   *
   * `tenant_id IS NULL OR = actual` lo resuelve la política de RLS: acá no hace
   * falta filtrar a mano, y hacerlo escondería un error si la política
   * cambiara.
   */
  async listar(
    tenantId: string,
    tipo?: TipoCotizacion,
    dias = 30,
  ): Promise<{ ultimas: Cotizacion[]; serie: Cotizacion[] }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: ultimas } = await ej.query<FilaCotizacion>(
        `SELECT DISTINCT ON (tipo) tipo, fecha, valor, fuente, tenant_id
           FROM cotizacion
          ORDER BY tipo, fecha DESC`,
      );

      const { rows: serie } = await ej.query<FilaCotizacion>(
        `SELECT tipo, fecha, valor, fuente, tenant_id
           FROM cotizacion
          WHERE ($1::text IS NULL OR tipo = $1)
            AND fecha >= current_date - $2::int
          ORDER BY fecha DESC, tipo`,
        [tipo ?? null, dias],
      );

      return { ultimas: ultimas.map(aCotizacion), serie: serie.map(aCotizacion) };
    });
  }

  /**
   * Carga la cotización propia de la inmobiliaria.
   *
   * Sólo `propia`: las oficiales entran por la sincronización con el BCRA, que
   * escribe con `SECURITY DEFINER`. Dejar que una inmobiliaria escriba una
   * oficial sería dejarle corregir el dólar de todas las demás.
   */
  async cargarPropia(
    tenantId: string,
    fecha: string,
    valor: number,
    usuarioId: string,
  ): Promise<Cotizacion> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<FilaCotizacion>(
          `INSERT INTO cotizacion (tenant_id, tipo, fecha, valor, fuente, cargado_por)
           VALUES ($1, 'propia', $2, $3, 'Carga manual', $4)
           RETURNING tipo, fecha, valor, fuente, tenant_id`,
          [tenantId, fecha, valor, usuarioId],
        );
        return aCotizacion(rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            409,
            ErrorCode.COTIZACION_YA_CARGADA,
            `Ya hay una cotización propia cargada para el ${fecha}.`,
            'Conflict',
          );
        }
        throw err;
      }
    });
  }

  /**
   * Convierte un monto, con su memoria de cálculo.
   *
   * Usa la cotización **vigente a la fecha pedida**, que es la última publicada
   * en o antes de ese día — no la de hoy. Convertir una operación de marzo con
   * el dólar de agosto da un número que no significa nada, y es el error que
   * se comete cuando la cuenta se hace a mano en el momento.
   */
  async convertir(
    tenantId: string,
    monto: number,
    desde: string,
    hasta: string,
    tipo: TipoCotizacion,
    fecha?: string,
  ): Promise<Conversion> {
    if (desde === hasta) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'Las dos monedas son la misma: no hay nada que convertir.',
        'Unprocessable Entity',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const c = await this.vigente(ej, tipo, fecha);

      // El valor es «cuántos ARS vale UN dólar», así que la dirección importa.
      const esAUsd = hasta === 'USD';
      const resultado = esAUsd ? monto / c.valor : monto * c.valor;

      return {
        desde: { monto, moneda: desde },
        hasta: { monto: Math.round(resultado * 100) / 100, moneda: hasta },
        cotizacion: c,
        formula: esAUsd
          ? `${monto} ARS ÷ ${c.valor} = ${Math.round(resultado * 100) / 100} USD`
          : `${monto} USD × ${c.valor} = ${Math.round(resultado * 100) / 100} ARS`,
      };
    });
  }

  /** La última cotización de ese tipo en o antes de la fecha. */
  private async vigente(
    ej: Ejecutor,
    tipo: TipoCotizacion,
    fecha?: string,
  ): Promise<Cotizacion> {
    const { rows } = await ej.query<FilaCotizacion>(
      `SELECT tipo, fecha, valor, fuente, tenant_id
         FROM cotizacion
        WHERE tipo = $1 AND fecha <= coalesce($2::date, current_date)
        ORDER BY fecha DESC LIMIT 1`,
      [tipo, fecha ?? null],
    );

    if (!rows.length) {
      // No se cae a otra cotización ni se estima: el sistema no adivina un
      // tipo de cambio, igual que no estima un índice que no se publicó.
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        `No hay cotización «${tipo}» cargada para esa fecha. Cargala o sincronizá con el BCRA.`,
        'Unprocessable Entity',
      );
    }
    return aCotizacion(rows[0]);
  }

  /**
   * Guarda las oficiales que trajo el BCRA. Idempotente: el día ya cargado no
   * se pisa, y la función de base lo dice devolviendo `insertado: false`.
   */
  async guardarOficiales(
    valores: Array<{ tipo: TipoCotizacion; fecha: string; valor: number; fuente: string }>,
  ): Promise<number> {
    let nuevas = 0;
    // Sin `withTenant`: `app_cotizacion_cargar` es SECURITY DEFINER y escribe
    // dato GLOBAL, que no tiene dueño. Es el mismo camino que ya usa
    // `indices.service.ts` para cargar el ICL.
    for (const v of valores) {
      const filas = await this.db.query<{ insertado: boolean }>(
        'SELECT insertado FROM app_cotizacion_cargar($1, $2, $3, $4)',
        [v.tipo, v.fecha, v.valor, v.fuente],
      );
      if (filas[0]?.insertado) nuevas += 1;
    }
    if (nuevas) this.logger.log(`Cotizaciones nuevas: ${nuevas}`);
    return nuevas;
  }
}

interface FilaCotizacion {
  tipo: string;
  fecha: string;
  valor: string;
  fuente: string;
  tenant_id: string | null;
}

function aCotizacion(f: FilaCotizacion): Cotizacion {
  return {
    tipo: f.tipo as TipoCotizacion,
    // `date` de Postgres no lleva zona: se recorta el texto en vez de pasarlo
    // por `Date`, que le inventaría medianoche UTC y correría el día.
    fecha: String(f.fecha).slice(0, 10),
    valor: Number(f.valor),
    fuente: f.fuente,
    propia: f.tenant_id !== null,
  };
}
