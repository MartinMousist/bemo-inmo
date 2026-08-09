/**
 * La forma de una comisión y cómo se agrupa para mostrarla.
 *
 * Vive acá y no adentro de un componente porque lo usan tres pantallas —el
 * detalle de una venta, la ficha de un contrato y el perfil de un agente— y
 * porque el criterio de agrupación es una decisión, no un detalle de render.
 */

export interface LineaComision {
  id: string;
  nivel: number;
  punta: string | null;
  concepto: string;
  base: number;
  porcentaje: number;
  monto: number;
  moneda: string;
  beneficiarioTipo: string;
  beneficiarioId: string | null;
  beneficiarioNombre: string | null;
  externaId: string | null;
  padreId: string | null;
  estado: string;
  cobradaEl: string | null;
  memoria: string;
}

export interface TotalesComision {
  operacion: number;
  externas: number;
  agentes: number;
  casa: number;
}

export const ETIQUETA_PUNTA: Record<string, string> = {
  compradora: 'Punta compradora',
  vendedora: 'Punta vendedora',
  locataria: 'Punta locataria',
  locadora: 'Punta locadora',
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  proyectada: 'Proyectada',
  devengada: 'Devengada',
  cobrada: 'Cobrada',
  anulada: 'Anulada',
};

export const TONO_ESTADO: Record<string, 'neutro' | 'warn' | 'ok' | 'err'> = {
  proyectada: 'neutro',
  devengada: 'warn',
  cobrada: 'ok',
  anulada: 'err',
};

export const ETIQUETA_BENEFICIARIO: Record<string, string> = {
  operacion: 'La operación',
  casa: 'La inmobiliaria',
  agente: 'Agente',
  inmobiliaria_externa: 'Otra inmobiliaria',
};

export interface GrupoPunta {
  punta: string;
  etiqueta: string;
  /** La línea de nivel 1: lo que cobra la operación por esta punta. */
  cabecera: LineaComision | null;
  /** Todo lo que sale de ella: la otra inmobiliaria, los agentes y el resto. */
  hijas: LineaComision[];
}

/**
 * Agrupa POR PUNTA y por nivel, no por parentesco estricto.
 *
 * Es a propósito: el árbol que arma el motor y el que quedó escrito a mano en
 * datos viejos no son el mismo —el nivel 3 llegó a colgar del nivel 2— y una
 * pantalla que siguiera `padreId` a rajatabla mostraría líneas huérfanas
 * dependiendo de por dónde entró el dato. La punta sí es estable: todas las
 * líneas la llevan, incluida la de nivel 1.
 */
export function agruparPorPunta(lineas: LineaComision[]): GrupoPunta[] {
  const orden = ['compradora', 'vendedora', 'locataria', 'locadora'];
  const puntas = [...new Set(lineas.map((l) => l.punta ?? '—'))].sort(
    (a, b) => orden.indexOf(a) - orden.indexOf(b),
  );

  return puntas.map((punta) => {
    const dePunta = lineas.filter((l) => (l.punta ?? '—') === punta);
    return {
      punta,
      etiqueta: ETIQUETA_PUNTA[punta] ?? punta,
      cabecera: dePunta.find((l) => l.nivel === 1) ?? null,
      // Nivel 2 antes que nivel 3: es el orden en que se descuenta la plata.
      hijas: dePunta.filter((l) => l.nivel > 1).sort((a, b) => a.nivel - b.nivel),
    };
  });
}

/** Un porcentaje como lo escribe un argentino: 1,5 % y no 1.5%. */
export function pct(n: number): string {
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}
