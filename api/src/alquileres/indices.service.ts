import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { BcraService } from './bcra.service';

export type TipoIndicePublicado = 'ipc' | 'icl' | 'uva' | 'icp';

export interface ValorIndice {
  tipo: TipoIndicePublicado;
  periodo: string;
  valor: number;
  fuente: string;
}

/**
 * Índices publicados: IPC (INDEC), ICL y UVA (BCRA), ICP.
 *
 * Dos reglas que mandan sobre todo lo demás:
 *
 * 1. **Nunca se inventa un valor.** Si el índice de un mes no está publicado,
 *    el ajuste queda proyectado con lo último disponible y se marca como
 *    estimado. Un aviso de aumento con un número inventado es un problema
 *    legal, no un bug.
 * 2. **Un valor cargado no se pisa.** Los índices son globales a todas las
 *    inmobiliarias; si una pudiera corregir el IPC, se lo cambiaría a todas.
 */
@Injectable()
export class IndicesService {
  private readonly logger = new Logger('Indices');

  constructor(
    private readonly db: DbService,
    private readonly bcra: BcraService,
  ) {}

  capacidades() {
    return this.bcra.capacidades();
  }

  /**
   * Trae del BCRA lo que falte de ICL y UVA.
   *
   * Idempotente: `app_indice_cargar` no pisa un valor ya cargado, así que
   * correrlo dos veces no cambia nada. Pensado para un cron.
   */
  async sincronizar(
    usuarioId: string,
    desde = '2020-07-01',
  ): Promise<Record<string, { cargados: number; yaEstaban: number; error?: string }>> {
    const hasta = new Date().toISOString().slice(0, 10);
    const salida: Record<string, { cargados: number; yaEstaban: number; error?: string }> = {};

    for (const tipo of ['icl', 'uva']) {
      const serie = await this.bcra.serie(tipo, desde, hasta);

      if (serie === null) {
        // La fuente falló. No se estima ni se rellena: se informa y se sigue.
        salida[tipo] = {
          cargados: 0,
          yaEstaban: 0,
          error: 'No se pudo consultar el BCRA. Los valores existentes no se tocaron.',
        };
        this.logger.warn(`Sincronización de ${tipo} sin datos: la fuente no respondió`);
        continue;
      }

      const mensual = this.bcra.mensual(serie);
      salida[tipo] = await this.cargarLote(
        mensual.map((m) => ({
          tipo,
          periodo: m.periodo,
          valor: m.valor,
          fuente: `BCRA v4.0 · ${tipo.toUpperCase()}`,
        })),
        usuarioId,
      );
      this.logger.log(
        `${tipo.toUpperCase()}: ${salida[tipo].cargados} nuevos, ${salida[tipo].yaEstaban} ya estaban`,
      );
    }

    return salida;
  }

  async listar(tipo?: TipoIndicePublicado, desde?: string): Promise<ValorIndice[]> {
    const filas = await this.db.query<{
      tipo: TipoIndicePublicado;
      periodo: string;
      valor: string;
      fuente: string;
    }>(
      `SELECT tipo, periodo, valor, fuente FROM indice_valor
        WHERE ($1::text IS NULL OR tipo = $1)
          AND ($2::date IS NULL OR periodo >= $2)
        ORDER BY tipo, periodo DESC`,
      [tipo ?? null, desde ?? null],
    );

    return filas.map((f) => ({
      tipo: f.tipo,
      periodo: iso(f.periodo),
      valor: Number(f.valor),
      fuente: f.fuente,
    }));
  }

  /** El último período cargado de cada índice. Es lo que la UI muestra arriba. */
  async cobertura(): Promise<Array<{ tipo: string; ultimo: string | null; valores: number }>> {
    const filas = await this.db.query<{ tipo: string; ultimo: string | null; valores: string }>(
      `SELECT t.tipo,
              (SELECT max(periodo) FROM indice_valor i WHERE i.tipo = t.tipo) AS ultimo,
              (SELECT count(*)::text FROM indice_valor i WHERE i.tipo = t.tipo) AS valores
         FROM (VALUES ('ipc'), ('icl'), ('uva'), ('icp')) AS t(tipo)`,
    );
    return filas.map((f) => ({
      tipo: f.tipo,
      ultimo: f.ultimo ?? null,
      valores: Number(f.valores),
    }));
  }

  async valor(tipo: string, periodo: string): Promise<number | null> {
    const filas = await this.db.query<{ valor: string }>(
      `SELECT valor FROM indice_valor
        WHERE tipo = $1 AND periodo = date_trunc('month', $2::date)`,
      [tipo, periodo],
    );
    return filas.length ? Number(filas[0].valor) : null;
  }

  /**
   * Carga manual. Es el camino principal hasta que las fuentes automáticas
   * estén conectadas, y el respaldo permanente para cuando fallen.
   */
  async cargar(
    v: { tipo: string; periodo: string; valor: number; fuente?: string; publicadoEl?: string },
    usuarioId: string,
  ): Promise<{ insertado: boolean; valorVigente: number }> {
    const filas = await this.db.query<{ insertado: boolean; valor_vigente: string }>(
      'SELECT * FROM app_indice_cargar($1, $2, $3, $4, $5, $6)',
      [
        v.tipo,
        v.periodo,
        v.valor,
        v.fuente ?? 'carga manual',
        usuarioId,
        v.publicadoEl ?? null,
      ],
    );

    const r = filas[0];
    if (!r.insertado) {
      throw new AppError(
        409,
        ErrorCode.INDICE_YA_CARGADO,
        `Ese período ya tiene un valor cargado (${Number(r.valor_vigente)}). ` +
          'Los índices son compartidos por todas las inmobiliarias, así que no se pisan.',
        'Conflict',
      );
    }

    this.logger.log(`Índice ${v.tipo} ${v.periodo} = ${v.valor} cargado por ${usuarioId}`);
    return { insertado: true, valorVigente: Number(r.valor_vigente) };
  }

  async cargarLote(
    valores: Array<{ tipo: string; periodo: string; valor: number; fuente?: string }>,
    usuarioId: string,
  ): Promise<{ cargados: number; yaEstaban: number }> {
    let cargados = 0;
    let yaEstaban = 0;
    for (const v of valores) {
      try {
        await this.cargar(v, usuarioId);
        cargados++;
      } catch (err) {
        if (err instanceof AppError && err.code === ErrorCode.INDICE_YA_CARGADO) {
          yaEstaban++;
        } else {
          throw err;
        }
      }
    }
    return { cargados, yaEstaban };
  }
}

function iso(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
