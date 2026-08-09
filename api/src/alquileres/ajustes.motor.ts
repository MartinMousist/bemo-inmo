/**
 * El cálculo del aumento. Sin dependencias de base ni de red: entra data, sale
 * un resultado. Así se puede testear con casos de papel, que es la única forma
 * de estar seguro de que la cuenta que sale en el aviso al inquilino es la
 * correcta.
 */

export type TipoIndice = 'ipc' | 'icl' | 'uva' | 'icp' | 'porcentaje_fijo' | 'ninguno';

export interface EntradaAjuste {
  montoVigente: number;
  moneda: string;
  indice: TipoIndice;
  /** Sólo si indice = 'porcentaje_fijo'. 8.5 = 8,5%. */
  indicePorcentaje?: number | null;
  /** Valor del índice en el período base. */
  valorBase?: number | null;
  /** Valor del índice en el período que se toma para actualizar. */
  valorActual?: number | null;
  periodoBase?: string | null;
  periodoActual?: string | null;
  /** Múltiplo al que se redondea el monto final. 0 = sin redondear. */
  redondeoA?: number;
}

export interface ResultadoAjuste {
  coeficiente: number;
  montoNuevo: number;
  montoSinRedondear: number;
  variacionPct: number;
  /** Texto legible que se muestra en la UI y viaja en el aviso. */
  explicacion: string;
  memoria: Record<string, unknown>;
}

export class AjusteImposible extends Error {
  constructor(
    readonly motivo: 'sin_indice' | 'sin_valores' | 'valor_invalido' | 'sin_ajuste',
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'AjusteImposible';
  }
}

/** Redondeo a un múltiplo, por defecto a la centena. Devuelve 2 decimales. */
export function redondear(monto: number, multiplo: number): number {
  if (!multiplo || multiplo <= 0) return round2(monto);
  return round2(Math.round(monto / multiplo) * multiplo);
}

/**
 * Los montos se redondean SIEMPRE a 2 decimales antes de compararse o guardarse.
 * Sin esto, 485000 * 1.0847 da 526079.49999999994 y la liquidación no cuadra
 * contra lo que la inmobiliaria calculó a mano.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularAjuste(e: EntradaAjuste): ResultadoAjuste {
  if (e.indice === 'ninguno') {
    throw new AjusteImposible(
      'sin_ajuste',
      'El contrato no tiene actualización: el monto es fijo por todo el plazo.',
    );
  }

  const redondeoA = e.redondeoA ?? 0;

  if (e.indice === 'porcentaje_fijo') {
    const pct = e.indicePorcentaje;
    if (pct === null || pct === undefined) {
      throw new AjusteImposible(
        'sin_valores',
        'El contrato actualiza por porcentaje fijo pero no tiene el porcentaje cargado.',
      );
    }
    const coeficiente = round6(1 + pct / 100);
    return armar(e, coeficiente, redondeoA, {
      metodo: 'porcentaje_fijo',
      porcentaje: pct,
    });
  }

  // Índices publicados: IPC, ICL, UVA, ICP.
  if (
    e.valorBase === null || e.valorBase === undefined ||
    e.valorActual === null || e.valorActual === undefined
  ) {
    throw new AjusteImposible(
      'sin_valores',
      `Falta el valor de ${e.indice.toUpperCase()} para alguno de los dos períodos. ` +
        'Cargalo y volvé a calcular — el sistema no estima un índice que no se publicó.',
    );
  }
  if (e.valorBase <= 0 || e.valorActual <= 0) {
    throw new AjusteImposible('valor_invalido', 'Los valores del índice tienen que ser mayores a cero.');
  }

  const coeficiente = round6(e.valorActual / e.valorBase);

  return armar(e, coeficiente, redondeoA, {
    metodo: 'indice',
    indice: e.indice,
    periodoBase: e.periodoBase,
    periodoActual: e.periodoActual,
    valorBase: e.valorBase,
    valorActual: e.valorActual,
  });
}

function armar(
  e: EntradaAjuste,
  coeficiente: number,
  redondeoA: number,
  extra: Record<string, unknown>,
): ResultadoAjuste {
  const montoSinRedondear = round2(e.montoVigente * coeficiente);
  const montoNuevo = redondear(montoSinRedondear, redondeoA);
  const variacionPct = round2((coeficiente - 1) * 100);

  const fmt = (n: number) =>
    `${e.moneda} ${n.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const cabecera =
    extra.metodo === 'indice'
      ? `${String(extra.indice).toUpperCase()} ${extra.periodoBase} → ${extra.periodoActual} · coef. ${fmtCoef(coeficiente)}`
      : `Porcentaje fijo ${extra.porcentaje}% · coef. ${fmtCoef(coeficiente)}`;

  const cuenta = `${fmt(e.montoVigente)} × ${fmtCoef(coeficiente)} = ${fmt(montoSinRedondear)}`;
  const cierre =
    montoNuevo !== montoSinRedondear
      ? `\nRedondeado a ${redondeoA}: ${fmt(montoNuevo)}`
      : '';

  return {
    coeficiente,
    montoNuevo,
    montoSinRedondear,
    variacionPct,
    explicacion: `${cabecera}\n${cuenta}${cierre}`,
    memoria: {
      ...extra,
      montoAnterior: e.montoVigente,
      moneda: e.moneda,
      coeficiente,
      montoSinRedondear,
      redondeoA,
      montoNuevo,
      variacionPct,
      // La versión del cálculo viaja en la memoria: si algún día cambia una
      // regla, se puede saber con qué versión salió cada aviso ya emitido.
      calculadoCon: 'ajustes.motor@1',
    },
  };
}

function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function fmtCoef(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

/**
 * Los períodos en los que corresponde ajustar, dado el inicio del contrato y la
 * periodicidad. Devuelve fechas al día 1.
 */
export function fechasDeAjuste(
  fechaInicio: string,
  fechaFin: string,
  periodicidadMeses: number,
): string[] {
  const inicio = new Date(`${fechaInicio}T00:00:00Z`);
  const fin = new Date(`${fechaFin}T00:00:00Z`);
  const fechas: string[] = [];

  for (let n = periodicidadMeses; ; n += periodicidadMeses) {
    const f = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + n, 1));
    if (f > fin) break;
    fechas.push(f.toISOString().slice(0, 10));
  }
  return fechas;
}

/** Suma meses a un período (día 1) y devuelve otro día 1. */
export function sumarMeses(periodo: string, meses: number): string {
  const d = new Date(`${periodo}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1))
    .toISOString()
    .slice(0, 10);
}

export interface PeriodoDeAjuste {
  /** Desde cuándo rige el aumento. Día 1 del mes. */
  vigenteDesde: string;
  /** El mes del índice contra el que se compara. */
  periodoBase: string;
  /** El mes del índice que se toma para actualizar. */
  periodoActual: string;
}

/**
 * La cadena entera de ajustes de un contrato, sin tocar la base.
 *
 * Vivía suelta adentro de `ContratosService.proyectarAjustes()`, que la usa
 * mezclada con consultas. El seed necesita la misma cadena para sembrar ajustes
 * calculados de verdad en vez de tipearlos a mano, y copiarla habría dejado dos
 * versiones de la regla: el día que se decida usar el índice de dos meses antes,
 * la demo mostraría números que la aplicación no produce.
 *
 * Las dos reglas que encapsula:
 *
 * **El índice es el del MES ANTERIOR al ajuste.** El IPC de un mes lo publica
 * INDEC a mediados del siguiente, así que el de «este mes» nunca está a tiempo.
 * Es la trampa que ya está anotada en `docs/CONTINUAR.md`: cargar el índice sólo
 * de los meses del ajuste no proyecta nada.
 *
 * **Cada ajuste arranca donde terminó el anterior.** El período base del segundo
 * aumento es el período actual del primero, no el `mes_base` del contrato. Sin
 * eso, cada ajuste mediría la inflación desde el principio del contrato y el
 * alquiler se multiplicaría.
 *
 * ⚠️ Lo que esta función NO puede saber: que un ajuste **ya exista** en la base
 * con otro período base —típicamente uno cargado a mano—. Eso re-ancla la cadena
 * y es estado, no cálculo: se resuelve en `proyectarAjustes()`, donde está
 * comentado del otro lado.
 */
export function periodosDeAjuste(
  fechaInicio: string,
  fechaFin: string,
  periodicidadMeses: number,
  mesBase: string,
  /** Hasta dónde proyectar. Más allá los índices ni siquiera existen. */
  limite: string,
): PeriodoDeAjuste[] {
  const salida: PeriodoDeAjuste[] = [];
  let periodoBase = mesBase;

  for (const vigenteDesde of fechasDeAjuste(fechaInicio, fechaFin, periodicidadMeses)) {
    if (vigenteDesde > limite) break;
    const periodoActual = sumarMeses(vigenteDesde, -1);
    salida.push({ vigenteDesde, periodoBase, periodoActual });
    periodoBase = periodoActual;
  }

  return salida;
}
