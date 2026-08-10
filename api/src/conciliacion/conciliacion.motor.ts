/**
 * El cruce entre un movimiento del banco y las cuotas pendientes. PURO: entran
 * el movimiento y los candidatos, sale una sugerencia con su puntaje y su
 * motivo.
 *
 * ── Por qué el puntaje y no un booleano ──
 *
 * Un match no es «sí» o «no». Una transferencia de $514.682 el día 10 puede ser
 * la cuota de Rossi con certeza casi total, o puede ser una de tres cuotas del
 * mismo monto que vencen el mismo día. Devolver un `boolean` obligaría a elegir
 * un umbral acá adentro y a esconder el segundo candidato — que es justamente
 * el que hay que mostrar cuando hay empate.
 *
 * ── Y por qué la sugerencia NUNCA se imputa sola ──
 *
 * Un cobro mal imputado no se descubre el día que se imputa: se descubre a fin
 * de mes, cuando la liquidación al propietario sale con el número de otro y ya
 * se pagó. El sistema propone y ordena; una persona confirma. Todo lo de acá
 * está escrito para que esa persona decida en dos segundos, no para reemplazarla.
 */

/** Lo que aporta cada señal. Suman 100 cuando todas dan. */
const PESO = {
  /** La más fuerte: identifica a la PERSONA, no al importe. */
  contraparte: 45,
  /** El monto exacto. Fuerte, pero tres inquilinos pueden pagar lo mismo. */
  montoExacto: 30,
  /**
   * Cerca del monto: un pago parcial, o el alquiler con los punitorios encima.
   *
   * Pesa 22 y no 12, y el número salió de un test que falló: con 12, un pago de
   * $510.000 contra una cuota de $514.682 **el mismo día del vencimiento**
   * sumaba 22 y no llegaba al mínimo de 30, así que no se sugería nada y había
   * que buscarlo a mano. Y el pago parcial no es un borde: es el caso común —el
   * inquilino que redondea para abajo, el que paga sin los punitorios—.
   *
   * Con 22, «monto parecido + cayó en la ventana del vencimiento» llega a 32 y
   * entra; «monto parecido» solo, en cualquier otra fecha, se queda en 22 y no
   * aparece. Que es exactamente la distinción que hay que hacer.
   */
  montoAproximado: 22,
  /** La referencia del banco menciona el código de propiedad o el apellido. */
  referencia: 15,
  /** Cae en la ventana del vencimiento. */
  fecha: 10,
} as const;

/** Debajo de esto no se muestra: es ruido que hace scrollear sin aportar. */
export const PUNTAJE_MINIMO = 30;

/**
 * Diferencia tolerada para considerar «el mismo monto».
 *
 * Un peso de diferencia es redondeo. Más que eso ya es un pago parcial, y un
 * pago parcial NO es un match aproximado: es otro caso, con su propia decisión.
 */
const TOLERANCIA_PESOS = 1;

/** Ventana alrededor del vencimiento donde la fecha suma. */
const DIAS_VENTANA = 10;

export interface MovimientoParaCruce {
  fecha: string;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia?: string | null;
  contraparte?: string | null;
}

export interface CuotaCandidata {
  id: string;
  contratoId: string;
  /** Lo que falta cobrar de esta cuota. Es contra esto que se compara. */
  saldo: number;
  moneda: string;
  venceEl: string;
  periodo: string;
  etiquetaPropiedad: string;
  inquilino: string;
  inquilinoId: string | null;
  /** Las contrapartes que este inquilino ya usó antes. Normalizadas. */
  contrapartesConocidas?: string[];
}

export interface Sugerencia {
  cuotaId: string;
  contratoId: string;
  puntaje: number;
  /** Qué señales dieron. La pantalla las muestra como chips. */
  senales: string[];
  /** Una frase corta para leer sin pensar. */
  motivo: string;
  /** El saldo queda cubierto exactamente. Si no, es un pago parcial o de más. */
  exacto: boolean;
  diferencia: number;
  cuota: CuotaCandidata;
}

export interface Cruce {
  sugerencias: Sugerencia[];
  /**
   * `true` cuando la mejor supera a la segunda con claridad.
   *
   * Es lo que la pantalla usa para pre-seleccionar. Con dos candidatas
   * empatadas NO se pre-selecciona ninguna: elegir por el usuario cuando el
   * sistema no sabe es la forma más rápida de imputarle el alquiler de uno al
   * contrato de otro.
   */
  clara: boolean;
}

/** Sin espacios ni guiones ni mayúsculas: el banco lo escribe distinto cada mes. */
export function normalizarContraparte(v: string | null | undefined): string {
  return (v ?? '').toLowerCase().replace(/[\s\-./]/g, '').trim();
}

function sinAcentos(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

/**
 * Cruza un movimiento contra las cuotas candidatas.
 *
 * Los egresos no se cruzan: un débito no puede ser el pago de un alquiler, y
 * proponerlo sería ruido en la única pantalla donde el ruido cuesta plata.
 */
export function cruzar(
  mov: MovimientoParaCruce,
  candidatas: CuotaCandidata[],
): Cruce {
  if (mov.monto <= 0) return { sugerencias: [], clara: false };

  const contraparte = normalizarContraparte(mov.contraparte);
  const texto = sinAcentos(`${mov.descripcion} ${mov.referencia ?? ''}`);

  const sugerencias: Sugerencia[] = [];

  for (const c of candidatas) {
    // La moneda no suma puntos: descarta. Un movimiento en pesos no puede pagar
    // una cuota en dólares por más que el número se parezca.
    if (c.moneda !== mov.moneda) continue;

    let puntaje = 0;
    const senales: string[] = [];

    if (contraparte && (c.contrapartesConocidas ?? []).includes(contraparte)) {
      puntaje += PESO.contraparte;
      senales.push('Ya pagó desde esta cuenta');
    }

    const diferencia = Math.round((mov.monto - c.saldo + Number.EPSILON) * 100) / 100;
    const exacto = Math.abs(diferencia) <= TOLERANCIA_PESOS;

    if (exacto) {
      puntaje += PESO.montoExacto;
      senales.push('Monto exacto');
    } else if (Math.abs(diferencia) <= c.saldo * 0.02) {
      puntaje += PESO.montoAproximado;
      senales.push('Monto casi exacto');
    }

    // El código de propiedad y el apellido: lo que la gente escribe de verdad
    // en el concepto de una transferencia.
    const codigo = sinAcentos(c.etiquetaPropiedad);
    const apellido = sinAcentos(c.inquilino).split(' ').filter((p) => p.length > 3).pop();
    if (texto.includes(codigo) || (apellido && texto.includes(apellido))) {
      puntaje += PESO.referencia;
      senales.push('La referencia lo nombra');
    }

    const dias = diasEntre(mov.fecha, c.venceEl);
    if (dias <= DIAS_VENTANA) {
      puntaje += PESO.fecha;
      senales.push(dias === 0 ? 'Justo el día que vencía' : `A ${dias} días del vencimiento`);
    }

    if (puntaje < PUNTAJE_MINIMO) continue;

    sugerencias.push({
      cuotaId: c.id,
      contratoId: c.contratoId,
      puntaje,
      senales,
      exacto,
      diferencia,
      motivo: motivoDe(exacto, diferencia, c),
      cuota: c,
    });
  }

  sugerencias.sort((a, b) => b.puntaje - a.puntaje || a.cuota.venceEl.localeCompare(b.cuota.venceEl));

  // «Clara» pide DOS cosas: que la primera sea buena y que le saque distancia a
  // la segunda. Con 95 y 92 el sistema no sabe cuál es, por más alto que sea el
  // número de arriba.
  const [primera, segunda] = sugerencias;
  const clara = Boolean(
    primera && primera.puntaje >= 70 && (!segunda || primera.puntaje - segunda.puntaje >= 20),
  );

  return { sugerencias: sugerencias.slice(0, 5), clara };
}

function motivoDe(exacto: boolean, diferencia: number, c: CuotaCandidata): string {
  if (exacto) return `Cubre la cuota de ${c.periodo.slice(0, 7)} de ${c.inquilino}.`;
  if (diferencia < 0) {
    return `Alcanza para parte de la cuota de ${c.inquilino}: quedarían ` +
      `${Math.abs(diferencia).toLocaleString('es-AR', { minimumFractionDigits: 2 })} sin cubrir.`;
  }
  return `Supera la cuota de ${c.inquilino} por ` +
    `${diferencia.toLocaleString('es-AR', { minimumFractionDigits: 2 })}.`;
}

// ── La huella, para no importar dos veces el mismo movimiento ────────────────

/**
 * Identifica un movimiento dentro de una cuenta.
 *
 * NO puede ser sólo la referencia: hay bancos que no la traen. Y no puede ser
 * sólo fecha+monto: dos inquilinos que pagan lo mismo el mismo día son dos
 * movimientos distintos y colapsarían en uno, perdiendo un cobro. Se combinan
 * las cuatro señales que el archivo trae.
 */
export function huellaDe(m: MovimientoParaCruce): string {
  return [
    m.fecha,
    m.monto.toFixed(2),
    m.moneda,
    sinAcentos(m.descripcion).replace(/\s+/g, ' ').trim(),
    (m.referencia ?? '').trim(),
  ].join('|');
}

// ── Qué NO es un cobro ───────────────────────────────────────────────────────

/**
 * Movimientos que casi nunca son el pago de un alquiler.
 *
 * Se usa para PRE-MARCAR como ignorables, no para descartarlos: el que decide
 * sigue siendo el usuario, y un banco puede llamar «transferencia recibida» a
 * cualquier cosa. Esconderlos automáticamente haría que un cobro real
 * desaparezca sin dejar rastro.
 */
const RUIDO = [
  'impuesto', 'iva', 'percepcion', 'retencion', 'comision', 'mantenimiento',
  'sellado', 'debito automatico', 'seguro de cuenta', 'ley 25413', 'sircreb',
];

export function pareceRuido(m: MovimientoParaCruce): boolean {
  if (m.monto <= 0) return true;
  const t = sinAcentos(m.descripcion);
  return RUIDO.some((r) => t.includes(r));
}
