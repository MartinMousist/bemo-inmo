import { Injectable, Logger } from '@nestjs/common';
import { candidatos, evaluar, type Veredicto } from './situacion.motor';

/**
 * Central de Deudores del BCRA.
 *
 * Contrato verificado el 2026-08-06 contra la API real:
 *
 *   GET /CentralDeDeudores/v1.0/Deudas/{cuit}
 *     200 → { status, results: { identificacion, denominacion,
 *                                periodos: [{ periodo, entidades: [
 *                                  { entidad, situacion, monto, diasAtrasoPago,
 *                                    refinanciaciones, situacionJuridica,
 *                                    procesoJud, enRevision, … } ] }] } }
 *     404 → { status: 404, errorMessages: ["No se encontró datos para la
 *             identificación ingresada."] }
 *
 * **El 404 no es un error: es una respuesta.** Significa que ninguna entidad
 * informó a esa persona, o sea que no tiene deuda bancaria registrada. Tratarlo
 * como falla dejaría sin consultar justo al garante que está limpio.
 *
 * Esto es lo contrario del IPC. Ahí la decisión fue NO integrar porque INDEC no
 * tiene API estable y raspar un HTML pondría un número equivocado en un aviso de
 * aumento. Acá hay API pública, versionada y con un contrato explícito, así que
 * se integra — y por las mismas razones: lo que no se puede es adivinar.
 */

const BASE = 'https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas';
const TIMEOUT_MS = 15_000;

export interface ConsultaBcra extends Veredicto {
  /** El CUIT/CUIL con el que se encontró la información. */
  cuit: string;
  denominacion: string | null;
  /** Período informado, AAAAMM. */
  periodo: string | null;
  consultadoEl: string;
  /** Los CUIL que se probaron. La UI lo muestra cuando no encontró ninguno. */
  probados: string[];
}

interface RespuestaBcra {
  results?: {
    identificacion?: number;
    denominacion?: string;
    periodos?: Array<{ periodo?: string; entidades?: unknown[] }>;
  };
}

@Injectable()
export class DeudoresService {
  private readonly logger = new Logger('BCRA/Deudores');

  /**
   * Consulta a una persona por su documento.
   *
   * Devuelve `null` —y NO lanza— si la fuente falla: que el BCRA esté caído no
   * puede voltear la carga de un contrato, y mucho menos hacer que el sistema
   * dé por bueno a un garante que no pudo verificar. Sin respuesta no hay
   * veredicto, y la pantalla lo dice.
   */
  async consultar(documento: string): Promise<ConsultaBcra | null> {
    const probados = candidatos(documento);
    if (!probados.length) return null;

    // Se prueban los CUIL candidatos en orden y gana el primero con datos. Un
    // 404 en todos no es un fallo: es "no tiene deuda informada", y entonces el
    // veredicto se arma con el candidato más probable.
    for (const cuit of probados) {
      const r = await this.pedir(cuit);
      if (r === 'error') return null;
      if (r === 'sin-datos') continue;

      const periodo = r.results?.periodos?.[0];
      return {
        cuit,
        denominacion: r.results?.denominacion?.trim() ?? null,
        periodo: periodo?.periodo ?? null,
        consultadoEl: new Date().toISOString(),
        probados,
        ...evaluar((periodo?.entidades ?? []) as Parameters<typeof evaluar>[0]),
      };
    }

    return {
      cuit: probados[0],
      denominacion: null,
      periodo: null,
      consultadoEl: new Date().toISOString(),
      probados,
      ...evaluar([]),
    };
  }

  private async pedir(cuit: string): Promise<RespuestaBcra | 'sin-datos' | 'error'> {
    try {
      const res = await fetch(`${BASE}/${cuit}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status === 404) return 'sin-datos';
      if (!res.ok) {
        this.logger.error(`La Central de Deudores devolvió ${res.status}`);
        return 'error';
      }

      return (await res.json()) as RespuestaBcra;
    } catch (err) {
      this.logger.error(
        `No se pudo consultar la Central de Deudores: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'error';
    }
  }
}
