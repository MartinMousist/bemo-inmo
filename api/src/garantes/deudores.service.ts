import { Injectable, Logger } from '@nestjs/common';
import {
  candidatos, evaluar, evaluarCheques,
  type CausalCruda, type Veredicto, type VeredictoCheques,
} from './situacion.motor';

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
 *   GET /CentralDeDeudores/v1.0/Deudas/ChequesRechazados/{cuit}
 *     200 → { status, results: { identificacion, denominacion,
 *                                causales: [{ causal, entidades: [
 *                                  { entidad, detalle: [
 *                                    { nroCheque, fechaRechazo, monto,
 *                                      fechaPago, fechaPagoMulta, estadoMulta,
 *                                      ctaPersonal, denomJuridica,
 *                                      enRevision, procesoJud } ] }] }] } }
 *     404 → mismo cuerpo que arriba = NO tiene cheques rechazados
 *     400 → "Parámetro erróneo: Ingresar 11 dígitos para realizar la consulta."
 *     429 → "Rate limit exceeded. Try again later." (control de tráfico por IP)
 *
 * **El 404 no es un error: es una respuesta.** Significa que ninguna entidad
 * informó a esa persona, o sea que no tiene deuda bancaria registrada. Tratarlo
 * como falla dejaría sin consultar justo al garante que está limpio.
 *
 * El 429 sí es un error y existe: el control de tráfico es POR IP, así que
 * cuenta la oficina entera y no cada usuario. Es la razón técnica —además de la
 * de fondo, que es el consentimiento— por la que la re-consulta periódica la
 * aprieta una persona y no un cron.
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

export interface ConsultaCheques extends VeredictoCheques {
  cuit: string;
  denominacion: string | null;
  consultadoEl: string;
}

interface RespuestaBcra {
  results?: {
    identificacion?: number;
    denominacion?: string;
    periodos?: Array<{ periodo?: string; entidades?: unknown[] }>;
  };
}

interface RespuestaCheques {
  results?: {
    identificacion?: number;
    denominacion?: string;
    causales?: CausalCruda[];
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

  /**
   * Los cheques rechazados de un CUIT que **ya se resolvió** en `consultar()`.
   *
   * Toma el CUIT y no el documento a propósito: la búsqueda del CUIL correcto
   * ya la hizo la consulta de deudas, y repetirla acá sería pegarle hasta
   * cuatro veces más a una API con control de tráfico por IP para llegar al
   * mismo número.
   *
   * Devuelve `null` **sólo** cuando no se pudo consultar. Que no tenga cheques
   * devuelve un veredicto vacío, que es un dato: «no tiene cheques rechazados»
   * y «no sabemos» no se pueden ver igual, igual que apto y sin verificar.
   */
  async consultarCheques(cuit: string): Promise<ConsultaCheques | null> {
    const limpio = (cuit ?? '').replace(/\D/g, '');
    if (limpio.length !== 11) return null;

    const r = await this.pedir(`ChequesRechazados/${limpio}`);
    if (r === 'error') return null;

    const cuerpo = r === 'sin-datos' ? null : (r as RespuestaCheques);
    return {
      cuit: limpio,
      denominacion: cuerpo?.results?.denominacion?.trim() ?? null,
      consultadoEl: new Date().toISOString(),
      ...evaluarCheques(cuerpo?.results?.causales ?? []),
    };
  }

  private async pedir(ruta: string): Promise<RespuestaBcra | 'sin-datos' | 'error'> {
    try {
      const res = await fetch(`${BASE}/${ruta}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status === 404) return 'sin-datos';
      if (!res.ok) {
        this.logger.error(`La Central de Deudores devolvió ${res.status} en ${ruta}`);
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
