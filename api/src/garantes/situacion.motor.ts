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

// ── Cheques rechazados ───────────────────────────────────────────────────────
//
// La otra mitad del riesgo. Un garante puede estar en situación 1 —no debe
// nada al banco— y tener cuatro cheques rechazados sin fondos sin levantar. La
// Central de Deudores no lo dice; `Deudas/ChequesRechazados/{cuit}` sí.
//
// ⚠️⚠️ **ACÁ EL MONTO NO VIENE EN MILES.** En `Deudas` el BCRA informa saldos
// en miles de pesos y por eso `evaluar()` multiplica por MILES. En
// `ChequesRechazados` el campo `monto` es el importe del cheque, en pesos
// (el ejemplo del manual del BCRA: 115000.00). Reusar esa constante convierte
// un cheque de $115.000 en $115.000.000 y hace rechazar a alguien por mil veces
// lo que debe. Es la misma trampa que la 018 documenta al revés, y por eso este
// bloque no toca MILES ni de casualidad.
//
// La otra diferencia con `Deudas` es la forma: acá el anidamiento es de TRES
// niveles —causales → entidades → detalle— contra los dos de deudas
// —periodos → entidades—. Y `entidad` es un NÚMERO de agrupamiento por banco,
// no el nombre: del cheque no se puede decir en qué banco fue, así que la
// pantalla no lo promete.

/** Un cheque rechazado, aplanado desde los tres niveles de la respuesta. */
export interface ChequeRechazado {
  /** 'SIN FONDOS' o 'DEFECTOS FORMALES', según lo informa el BCRA. */
  causal: string;
  nroCheque: number | null;
  fechaRechazo: string | null;
  /** EN PESOS. El BCRA informa acá el importe del cheque, no miles. */
  monto: number;
  /** El día que se pagó. `null` = sigue impago, que es lo que importa. */
  fechaPago: string | null;
  fechaPagoMulta: string | null;
  estadoMulta: string | null;
  enRevision: boolean;
  procesoJud: boolean;
}

export interface VeredictoCheques {
  cantidad: number;
  /** Los que todavía no se levantaron. Un rechazo pagado ya no es un problema. */
  sinPagar: number;
  /** Total rechazado, en pesos. */
  montoTotal: number;
  /** Lo que sigue sin levantarse, en pesos. */
  montoSinPagar: number;
  porCausal: Array<{ causal: string; cantidad: number; monto: number }>;
  cheques: ChequeRechazado[];
  /** Frase corta para leer en voz alta. */
  resumen: string;
  /**
   * Los cheques NO cambian el veredicto de apto/no apto: la regla del dueño es
   * la situación de la Central de Deudores y un cheque no es una situación. Van
   * como advertencia —la misma categoría que «proceso judicial en curso»— y la
   * decisión de si tumban a un garante es de él, no del código.
   */
  advertencias: string[];
}

interface ChequeCrudo {
  nroCheque?: number;
  fechaRechazo?: string;
  monto?: number;
  fechaPago?: string | null;
  fechaPagoMulta?: string | null;
  estadoMulta?: string | null;
  ctaPersonal?: boolean;
  denomJuridica?: string | null;
  enRevision?: boolean;
  procesoJud?: boolean;
}

export interface CausalCruda {
  causal?: string;
  entidades?: Array<{ entidad?: number; detalle?: ChequeCrudo[] }>;
}

/**
 * El veredicto de los cheques rechazados.
 *
 * Sin cheques informados devuelve una estructura vacía y un resumen que lo
 * dice: «no tiene cheques rechazados informados» no es lo mismo que «no se
 * consultó», y la diferencia se pierde si los dos casos devuelven `null`.
 */
export function evaluarCheques(crudas: CausalCruda[]): VeredictoCheques {
  const cheques: ChequeRechazado[] = [];

  for (const c of crudas ?? []) {
    const causal = (c.causal ?? 'Sin causal informada').trim();
    for (const e of c.entidades ?? []) {
      for (const d of e.detalle ?? []) {
        cheques.push({
          causal,
          nroCheque: d.nroCheque ?? null,
          // `date` sin zona: se recorta el texto. Pasarlo por `Date` le
          // inventaría una medianoche UTC y correría el día, que es la trampa
          // ya anotada en docs/CONTINUAR.md.
          fechaRechazo: d.fechaRechazo ? String(d.fechaRechazo).slice(0, 10) : null,
          monto: redondear2(Number(d.monto ?? 0)),
          fechaPago: d.fechaPago ? String(d.fechaPago).slice(0, 10) : null,
          fechaPagoMulta: d.fechaPagoMulta ? String(d.fechaPagoMulta).slice(0, 10) : null,
          estadoMulta: d.estadoMulta ?? null,
          enRevision: Boolean(d.enRevision),
          procesoJud: Boolean(d.procesoJud),
        });
      }
    }
  }

  cheques.sort((a, b) => (b.fechaRechazo ?? '').localeCompare(a.fechaRechazo ?? ''));

  const impagos = cheques.filter((c) => !c.fechaPago);
  const montoTotal = redondear2(cheques.reduce((a, c) => a + c.monto, 0));
  const montoSinPagar = redondear2(impagos.reduce((a, c) => a + c.monto, 0));

  const porCausal = [...new Set(cheques.map((c) => c.causal))].map((causal) => {
    const suyos = cheques.filter((c) => c.causal === causal);
    return {
      causal,
      cantidad: suyos.length,
      monto: redondear2(suyos.reduce((a, c) => a + c.monto, 0)),
    };
  });

  const advertencias: string[] = [];
  if (impagos.length) {
    advertencias.push(
      `${impagos.length} ${impagos.length === 1 ? 'cheque rechazado sigue' : 'cheques rechazados siguen'} ` +
        `sin levantar por ${pesos(montoSinPagar)}.`,
    );
  }
  for (const c of cheques) {
    if (c.procesoJud) {
      advertencias.push(
        `Cheque ${c.nroCheque ?? 's/n'} del ${c.fechaRechazo ? ddmmaaaa(c.fechaRechazo) : 's/f'}: proceso judicial en curso.`,
      );
    }
    if (c.enRevision) {
      advertencias.push(
        `Cheque ${c.nroCheque ?? 's/n'} del ${c.fechaRechazo ? ddmmaaaa(c.fechaRechazo) : 's/f'}: el rechazo está en revisión.`,
      );
    }
  }

  const resumen = !cheques.length
    ? 'No tiene cheques rechazados informados en el BCRA.'
    : `${cheques.length} ${cheques.length === 1 ? 'cheque rechazado' : 'cheques rechazados'} ` +
      `por ${pesos(montoTotal)}` +
      (impagos.length
        ? `, de los cuales ${impagos.length} ${impagos.length === 1 ? 'sigue' : 'siguen'} sin levantar (${pesos(montoSinPagar)}).`
        : ', todos levantados.');

  return {
    cantidad: cheques.length,
    sinPagar: impagos.length,
    montoTotal,
    montoSinPagar,
    porCausal,
    cheques,
    resumen,
    advertencias,
  };
}

function redondear2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Ningún monto sin su moneda: es la regla del proyecto, también en un texto. */
function pesos(n: number): string {
  return `ARS ${n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Cada cuánto se vuelve a mirar ────────────────────────────────────────────
//
// Un garante aprobado en enero puede estar en situación 3 en junio, y un
// contrato de alquiler dura tres años. El veredicto de la 018 se congela —eso
// no se toca, es lo que explica por qué se aceptó— pero además hay que volver a
// preguntar cada tanto y guardar la respuesta nueva al lado, no encima.
//
// Los tres números son elegibles y están acá, juntos y con nombre, para que
// cambiarlos sea una línea y no una arqueología.

/** Debajo de este largo de contrato no se programa revisión: se firma y listo. */
export const MESES_CONTRATO_PARA_REVISAR = 24;

/** Cada cuánto se vuelve a consultar mientras el contrato siga vivo. */
export const MESES_ENTRE_REVISIONES = 6;

export interface EntradaRevision {
  /** El día de la consulta que se acaba de hacer, AAAA-MM-DD. */
  consultadoEl: string;
  /**
   * Sólo se re-revisa al que HOY da apto. El que ya dio mal está en la lista de
   * pendientes del contrato desde el minuto uno y no necesita que le pongan una
   * fecha para volver a confirmarlo.
   */
  apto: boolean;
  contratoDesde: string;
  contratoHasta: string;
  /** Si la garantía vence antes que el contrato, manda la garantía. */
  garantiaVenceEl?: string | null;
}

export interface Revision {
  /** AAAA-MM-DD, o `null` si no corresponde programar ninguna. */
  fecha: string | null;
  /** Por qué esa fecha, o por qué ninguna. Se muestra tal cual en la pantalla. */
  memoria: string;
}

/**
 * Cuándo hay que volver a consultar el BCRA por este garante.
 *
 * PURO y con su memoria de cálculo, como todo cálculo del sistema: una fecha
 * que aparece sola en una pantalla y que nadie puede explicar es exactamente el
 * tipo de número que este proyecto no acepta.
 */
export function proximaRevision(e: EntradaRevision): Revision {
  const meses = mesesEntre(e.contratoDesde, e.contratoHasta);
  const largo = `El contrato va del ${ddmmaaaa(e.contratoDesde)} al ${ddmmaaaa(e.contratoHasta)} (${meses} meses)`;

  if (!e.apto) {
    return {
      fecha: null,
      memoria:
        'Hoy no da apto: ya figura entre los pendientes del contrato, así que no ' +
        'se programa una revisión para volver a confirmar lo mismo.',
    };
  }

  if (meses < MESES_CONTRATO_PARA_REVISAR) {
    return {
      fecha: null,
      memoria:
        `${largo} y el piso para volver a revisar son ${MESES_CONTRATO_PARA_REVISAR}: ` +
        'no se programa revisión.',
    };
  }

  const propuesta = sumarMesesIso(e.consultadoEl, MESES_ENTRE_REVISIONES);

  // El tope es lo primero que ocurra: que termine el contrato o que venza la
  // garantía. Revisar a un garante de un contrato que ya terminó es pedirle el
  // dato bancario a alguien que no garantiza nada — y es un tercero.
  const venceGarantia = e.garantiaVenceEl ? String(e.garantiaVenceEl).slice(0, 10) : null;
  const topeGarantia = venceGarantia && venceGarantia < e.contratoHasta;
  const tope = topeGarantia ? venceGarantia! : e.contratoHasta;

  if (propuesta > tope) {
    return {
      fecha: null,
      memoria:
        `${largo}. La próxima revisión caería el ${ddmmaaaa(propuesta)}, después de que ` +
        `${topeGarantia ? 'venza la garantía' : 'termine el contrato'} el ${ddmmaaaa(tope)}: ` +
        'no se programa.',
    };
  }

  return {
    fecha: propuesta,
    memoria:
      `${largo}: a partir de ${MESES_CONTRATO_PARA_REVISAR} se vuelve a consultar cada ` +
      `${MESES_ENTRE_REVISIONES} meses. Consultado el ${ddmmaaaa(e.consultadoEl)} ⇒ ` +
      `próxima revisión el ${ddmmaaaa(propuesta)}` +
      `${topeGarantia ? ` (la garantía vence el ${ddmmaaaa(tope)})` : ''}.`,
  };
}

/**
 * Suma meses a una fecha AAAA-MM-DD sin pasar por `Date`.
 *
 * Aritmética sobre los números y no sobre un objeto con zona horaria: una
 * columna `date` de Postgres no tiene zona, y convertirla le inventa una
 * medianoche UTC que corre el día. Es la trampa que ya hizo mostrar un contrato
 * del 01/01 como del 31/12.
 *
 * El día se recorta al último del mes destino: 31/08 + 6 meses es el 28/02, no
 * el 3 de marzo.
 */
export function sumarMesesIso(iso: string, meses: number): string {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const total = (a * 12 + (m - 1)) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const dia = Math.min(d, diasDelMes(anio, mes));
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Meses completos entre dos fechas AAAA-MM-DD. */
export function mesesEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = String(desde).slice(0, 10).split('-').map(Number);
  const [a2, m2, d2] = String(hasta).slice(0, 10).split('-').map(Number);
  const brutos = (a2 - a1) * 12 + (m2 - m1);
  return d2 >= d1 ? brutos : brutos - 1;
}

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** Fechas en dd/mm/aaaa. Nunca formato US: es regla del proyecto. */
function ddmmaaaa(iso: string): string {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
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
