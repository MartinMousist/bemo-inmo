/**
 * Agrupar cuotas impagas por contrato.
 *
 * ── Por qué existe ──
 *
 * La API devuelve una fila por CUOTA. Un inquilino con cinco meses de atraso
 * ocupaba cinco renglones con el mismo nombre, la misma propiedad y el mismo
 * importe, cambiando sólo la fecha: la tarjeta de Inicio se la llevaba una sola
 * persona y el resto de los morosos no entraba.
 *
 * Y no era sólo espacio. La unidad de trabajo no es la cuota, es **a quién hay
 * que llamar**: nadie llama por la de marzo y vuelve a llamar por la de abril.
 *
 * Vive acá y no en la pantalla porque es lógica con casos —monedas mezcladas,
 * qué fecha gana— y eso se prueba en una mesa, no mirando un navegador.
 */

export interface CuotaImpaga {
  contratoId: string;
  etiquetaPropiedad: string;
  referencia: string;
  inquilino: string | null;
  saldo: number;
  moneda: string;
  diasDeMora: number;
  venceEl: string;
}

export interface Moroso {
  contratoId: string;
  etiquetaPropiedad: string;
  quien: string;
  cuotas: number;
  saldo: number;
  moneda: string;
  /** La mora de la cuota MÁS VIEJA: es la que mide qué tan grave es. */
  diasDeMora: number;
  /** La fecha de esa misma cuota. «Debe desde» es más útil que «debe hasta». */
  venceEl: string;
}

export function agruparMorosos(items: CuotaImpaga[]): Moroso[] {
  const por = new Map<string, Moroso>();

  for (const c of items) {
    // La clave lleva la MONEDA: un contrato con cuotas en pesos y en dólares no
    // se puede sumar en un solo número, y hacerlo daría un total inventado.
    const clave = `${c.contratoId}:${c.moneda}`;
    const ya = por.get(clave);

    if (!ya) {
      por.set(clave, {
        contratoId: c.contratoId,
        etiquetaPropiedad: c.etiquetaPropiedad,
        quien: c.inquilino ?? c.referencia,
        cuotas: 1,
        saldo: c.saldo,
        moneda: c.moneda,
        diasDeMora: c.diasDeMora,
        venceEl: c.venceEl,
      });
      continue;
    }

    ya.cuotas += 1;
    ya.saldo += c.saldo;
    if (c.diasDeMora > ya.diasDeMora) {
      ya.diasDeMora = c.diasDeMora;
      ya.venceEl = c.venceEl;
    }
  }

  // De mayor a menor mora: el que hace más que no paga es al que hay que llamar
  // hoy, y el orden de la lista es la única forma de decirlo sin escribirlo.
  return [...por.values()].sort((a, b) => b.diasDeMora - a.diasDeMora);
}
