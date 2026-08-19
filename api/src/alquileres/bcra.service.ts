import { Injectable, Logger } from '@nestjs/common';

/**
 * Ingesta de índices desde la API pública del BCRA.
 *
 * Contrato verificado el 2026-08-04 contra la v4.0:
 *
 *   GET /estadisticas/v4.0/monetarias            → catálogo de variables
 *   GET /estadisticas/v4.0/monetarias/{id}?desde&hasta
 *       → { results: [{ idVariable, detalle: [{ fecha, valor }] }] }
 *
 * Las variables que nos importan:
 *   31 — Unidad de valor adquisitivo (UVA), base 31.3.16 = 14.05
 *   40 — Índice para Contratos de Locación (ICL), base 30.6.20 = 1
 *
 * ⚠️ La v2.0 está deprecada y devuelve 410. Si esto empieza a fallar, lo primero
 * que hay que mirar es si la v4 corrió la misma suerte.
 *
 * **El IPC no está acá.** Es de INDEC, que no publica una API REST estable, así
 * que sigue siendo carga manual. Preferimos eso antes que raspar un HTML que
 * cambia sin aviso y meter un número equivocado en un aviso de aumento.
 */

const BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias';

export const VARIABLES: Record<string, number> = {
  uva: 31,
  icl: 40,
  // Tipo de cambio. Verificado contra el catálogo real el 2026-08-19:
  //    4 — Tipo de cambio minorista (promedio vendedor)
  //    5 — Tipo de cambio mayorista de referencia
  // Los dos devuelven serie diaria por el mismo endpoint que ICL y UVA.
  //
  // ⚠️ Son los OFICIALES. El tipo con el que efectivamente se vende una
  // propiedad en dólares en este país no lo publica ninguna API, y por eso el
  // sistema deja cargarlo a mano en vez de hacer pasar el oficial por él.
  oficial_minorista: 4,
  oficial_mayorista: 5,
};

export interface ValorDiario {
  fecha: string;
  valor: number;
}

@Injectable()
export class BcraService {
  private readonly logger = new Logger('BCRA');

  /**
   * Serie diaria de una variable.
   *
   * Devuelve `null` —y NO lanza— si la fuente falla: que el BCRA esté caído no
   * puede tumbar el sistema ni, mucho menos, hacer que se invente un valor.
   */
  async serie(
    tipo: string,
    desde: string,
    hasta: string,
  ): Promise<ValorDiario[] | null> {
    const id = VARIABLES[tipo];
    if (!id) return null;

    const url = `${BASE}/${id}?desde=${desde}&hasta=${hasta}&limit=3000`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        this.logger.error(`BCRA devolvió ${res.status} para ${tipo}`);
        return null;
      }

      const datos = (await res.json()) as {
        results?: Array<{ detalle?: Array<{ fecha: string; valor: number }> }>;
      };

      const detalle = datos.results?.[0]?.detalle;
      if (!Array.isArray(detalle)) {
        this.logger.error(`Respuesta inesperada del BCRA para ${tipo}`);
        return null;
      }

      return detalle
        .filter((d) => typeof d.valor === 'number' && d.valor > 0)
        .map((d) => ({ fecha: d.fecha.slice(0, 10), valor: d.valor }));
    } catch (err) {
      this.logger.error(
        `No se pudo consultar el BCRA para ${tipo}`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Convierte la serie DIARIA en un valor por mes.
   *
   * Se toma el valor del **día 1** de cada mes, no el promedio ni el cierre.
   * Es lo que usan los contratos: "el ICL del 1 de noviembre". Promediar daría
   * un número que no coincide con el que el inquilino ve publicado, y ese
   * desacuerdo se discute en una mesa, no en un log.
   *
   * Si el día 1 no tiene dato —fin de semana o feriado— se toma el primer día
   * hábil siguiente, que es lo que hace el BCRA al publicar.
   */
  mensual(serie: ValorDiario[]): Array<{ periodo: string; valor: number }> {
    const porMes = new Map<string, ValorDiario[]>();

    for (const d of serie) {
      const mes = d.fecha.slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, []);
      porMes.get(mes)!.push(d);
    }

    const salida: Array<{ periodo: string; valor: number }> = [];
    for (const [mes, dias] of porMes) {
      dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
      salida.push({ periodo: `${mes}-01`, valor: dias[0].valor });
    }

    return salida.sort((a, b) => a.periodo.localeCompare(b.periodo));
  }

  /** Qué índices puede traer solo y cuáles siguen siendo manuales. */
  capacidades() {
    return [
      { tipo: 'icl', automatico: true, fuente: 'BCRA · variable 40' },
      { tipo: 'uva', automatico: true, fuente: 'BCRA · variable 31' },
      {
        tipo: 'ipc',
        automatico: false,
        fuente: 'INDEC',
        detalle:
          'INDEC no publica una API estable. La carga es manual a propósito: ' +
          'raspar un HTML que cambia sin aviso pondría un número equivocado en un aviso de aumento.',
      },
      {
        tipo: 'icp',
        automatico: false,
        fuente: 'Ministerio',
        detalle: 'Sin fuente automática identificada.',
      },
    ];
  }
}
