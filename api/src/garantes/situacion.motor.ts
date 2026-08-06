/**
 * La lectura de la Central de Deudores del BCRA. PURO: entra la respuesta,
 * sale el veredicto. Sin red y sin base, que es lo que permite probar la regla
 * —la parte que decide si a alguien se le alquila— sin depender de que el BCRA
 * esté disponible ni de que exista un deudor de ejemplo.
 *
 * La regla del negocio es una sola línea y es del dueño: **sólo se aceptan
 * garantes en situación 1**. Todo lo demás de este archivo existe para poder
 * explicar por qué, con nombre de entidad y monto.
 */

/**
 * La clasificación del deudor del BCRA (Com. "A" 2216 y modificatorias). El
 * número es el que viaja en la API; el texto es el que se le muestra a alguien
 * que no trabaja en un banco.
 */
export const SITUACION: Record<number, string> = {
  1: 'Normal',
  2: 'Riesgo bajo · seguimiento especial',
  3: 'Riesgo medio · con problemas',
  4: 'Riesgo alto · alto riesgo de insolvencia',
  5: 'Irrecuperable',
  6: 'Irrecuperable por disposición técnica',
};

/** La única situación que se acepta. Lo pidió así el dueño. */
export const SITUACION_ACEPTADA = 1;

export interface EntidadInformante {
  entidad: string;
  situacion: number;
  /** Lo que informa el BCRA en MILES de pesos, ya pasado a pesos. */
  monto: number;
  diasAtrasoPago: number;
  refinanciaciones: boolean;
  situacionJuridica: boolean;
  procesoJud: boolean;
  enRevision: boolean;
}

export interface Veredicto {
  apto: boolean;
  /** La peor situación informada. `null` si no lo informó ninguna entidad. */
  peorSituacion: number | null;
  /** Una frase que se puede leer en voz alta al inquilino. */
  motivo: string;
  entidades: EntidadInformante[];
  /**
   * Banderas que NO cambian el veredicto —la regla es la situación— pero que
   * alguien tiene que ver antes de firmar. Un garante en situación 1 con un
   * juicio en curso pasa el filtro, y esconder eso sería peor que no consultar.
   */
  advertencias: string[];
}

/**
 * El BCRA informa los saldos de la Central de Deudores **en miles de pesos**.
 * Mostrarlos crudos convierte una deuda de $1.842.869 en «$1.843», que es
 * exactamente el error que hace que alguien apruebe a quien no debía.
 */
const MILES = 1000;

interface EntidadCruda {
  entidad?: string;
  situacion?: number;
  monto?: number;
  diasAtrasoPago?: number;
  refinanciaciones?: boolean;
  situacionJuridica?: boolean;
  procesoJud?: boolean;
  enRevision?: boolean;
  irrecDisposicionTecnica?: boolean;
}

/**
 * El veredicto a partir de las entidades del período más reciente.
 *
 * **Sin deudas informadas es APTO, y no es lo mismo que "sin consultar".** Que
 * ninguna entidad lo informe significa que no tiene deuda bancaria — no que sea
 * un fantasma. Se dice con todas las letras porque la diferencia importa: un
 * legajo sin consultar y uno consultado que dio limpio se ven igual si nadie
 * escribe cuál es cuál.
 */
export function evaluar(crudas: EntidadCruda[]): Veredicto {
  const entidades: EntidadInformante[] = crudas.map((e) => ({
    entidad: (e.entidad ?? 'Entidad sin nombre').trim(),
    situacion: Number(e.situacion ?? 0),
    monto: Math.round((Number(e.monto ?? 0) * MILES + Number.EPSILON) * 100) / 100,
    diasAtrasoPago: Number(e.diasAtrasoPago ?? 0),
    refinanciaciones: Boolean(e.refinanciaciones),
    situacionJuridica: Boolean(e.situacionJuridica),
    procesoJud: Boolean(e.procesoJud),
    enRevision: Boolean(e.enRevision),
  }));

  const advertencias: string[] = [];
  for (const e of entidades) {
    if (e.procesoJud) advertencias.push(`${e.entidad}: proceso judicial en curso.`);
    if (e.situacionJuridica) advertencias.push(`${e.entidad}: situación jurídica informada.`);
    if (e.refinanciaciones) advertencias.push(`${e.entidad}: deuda refinanciada.`);
    if (e.enRevision) advertencias.push(`${e.entidad}: la clasificación está en revisión.`);
    if (e.diasAtrasoPago > 0) {
      advertencias.push(`${e.entidad}: ${e.diasAtrasoPago} días de atraso informados.`);
    }
  }

  if (!entidades.length) {
    return {
      apto: true,
      peorSituacion: null,
      motivo:
        'Ninguna entidad lo informa en la Central de Deudores: no tiene deuda ' +
        'bancaria registrada.',
      entidades: [],
      advertencias,
    };
  }

  const peorSituacion = Math.max(...entidades.map((e) => e.situacion));
  const apto = peorSituacion <= SITUACION_ACEPTADA;

  if (apto) {
    return {
      apto,
      peorSituacion,
      motivo: `Situación 1 (normal) en ${
        entidades.length === 1 ? 'la entidad que lo informa' : `las ${entidades.length} entidades que lo informan`
      }.`,
      entidades,
      advertencias,
    };
  }

  // El motivo nombra a la peor entidad: «no apto» a secas no le sirve a nadie
  // que tenga que explicárselo al inquilino que trajo a ese garante.
  const peor = entidades.find((e) => e.situacion === peorSituacion)!;
  return {
    apto,
    peorSituacion,
    motivo:
      `Situación ${peorSituacion} (${SITUACION[peorSituacion] ?? 'desconocida'}) ` +
      `en ${peor.entidad}. Sólo se aceptan garantes en situación 1.`,
    entidades,
    advertencias,
  };
}

// ── Del DNI al CUIL ──────────────────────────────────────────────────────────
//
// La Central de Deudores se consulta por CUIT/CUIL de 11 dígitos, y en una
// inmobiliaria lo que hay sobre el mostrador es un DNI. El CUIL se deriva: un
// prefijo, el documento y un dígito verificador módulo 11.
//
// No se puede saber de antemano cuál de los prefijos le tocó a una persona
// —20 y 23 para varones, 27 y 23 para mujeres, 24 y 25 según la provincia—, así
// que se generan todos los válidos y se consultan en orden. Es preferible a
// pedirle el CUIL a alguien que vino a alquilar con el DNI en la mano.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIJOS = [20, 27, 23, 24];

/** Dígito verificador del CUIT/CUIL. `null` si esa combinación no existe. */
export function digitoVerificador(diezDigitos: string): number | null {
  if (!/^\d{10}$/.test(diezDigitos)) return null;

  const suma = [...diezDigitos].reduce((a, d, i) => a + Number(d) * PESOS[i], 0);
  const resto = suma % 11;

  if (resto === 0) return 0;
  // resto 1 ⇒ el verificador daría 10, que no es un dígito: esa combinación de
  // prefijo y documento no existe, y el CUIL real lleva otro prefijo.
  if (resto === 1) return null;
  return 11 - resto;
}

/** Los CUIL que podrían corresponder a un DNI, en orden de probabilidad. */
export function cuilesPosibles(dni: string): string[] {
  const limpio = dni.replace(/\D/g, '');
  if (limpio.length < 7 || limpio.length > 8) return [];

  const documento = limpio.padStart(8, '0');
  const cuiles: string[] = [];

  for (const prefijo of PREFIJOS) {
    const base = `${prefijo}${documento}`;
    const dv = digitoVerificador(base);
    if (dv !== null) cuiles.push(`${base}${dv}`);
  }

  return cuiles;
}

/**
 * Normaliza lo que se haya cargado como documento.
 *
 * Un CUIT/CUIL ya viene completo y se usa tal cual; un DNI hay que derivarlo.
 * Se distinguen por longitud, que es lo único confiable: el `doc_tipo` de una
 * persona lo carga alguien apurado y «dni: 20-34567890-1» pasa igual.
 */
export function candidatos(documento: string): string[] {
  const limpio = (documento ?? '').replace(/\D/g, '');
  if (limpio.length === 11) return [limpio];
  return cuilesPosibles(limpio);
}
