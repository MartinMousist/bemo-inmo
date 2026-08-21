/**
 * El plan de pago de una unidad en pozo.
 *
 * Puro: sin base y sin red. Recibe el precio, el plan y la fecha de inicio, y
 * devuelve **cada línea** de lo que va a pagar el comprador, con su memoria de
 * cálculo. Es la regla del repo aplicada al caso donde más importa: nadie firma
 * un boleto por tres años de cuotas contra un número que no puede reconstruir.
 *
 * ── La invariante que sostiene todo ──
 *
 * **Los porcentajes tienen que sumar exactamente 100.** Anticipo + refuerzos +
 * cuotas + contra entrega. Si suman 98, la desarrolladora regala dos puntos sin
 * enterarse; si suman 102, el comprador paga de más y lo descubre en la cuota
 * doce. Es la clase de error que un Excel comete en silencio y que acá se
 * rechaza antes de mostrar un solo número.
 *
 * ── Lo que este motor NO hace ──
 *
 * No proyecta el ajuste. Una cuota atada al CAC vale hoy lo que vale hoy, y
 * decir «en el mes 20 va a costar tanto» sería inventar la inflación de dos
 * años y ponerla en un presupuesto que alguien puede imprimir. Se muestra el
 * valor de hoy y **se dice** que se ajusta. Es la misma decisión que ya tomó el
 * ajuste de alquileres: se guarda el índice usado, no se adivina el próximo.
 */

export interface Refuerzo {
  /** En qué número de cuota cae. */
  cuota: number;
  /** Qué porcentaje del total es. */
  pct: number;
}

export interface PlanPago {
  nombre: string;
  anticipoPct: number;
  cuotas: number;
  refuerzos: Refuerzo[];
  contraEntregaPct: number;
  indice: 'ninguno' | 'cac' | 'ipc' | 'uva' | 'icl';
  moneda: string;
}

export type Concepto = 'anticipo' | 'cuota' | 'refuerzo' | 'contra_entrega';

export interface Linea {
  concepto: Concepto;
  /** El número de cuota, para los que lo tienen. */
  numero: number | null;
  /** Cuándo vence. `null` en la entrega: depende de la obra, no del calendario. */
  vence: string | null;
  monto: number;
  pct: number;
  /** `true` si esta línea se ajusta por índice. El anticipo nunca se ajusta. */
  ajustable: boolean;
}

export interface Presupuesto {
  lineas: Linea[];
  total: number;
  moneda: string;
  /** Lo que hay que poner para entrar. Es la primera pregunta de cualquiera. */
  anticipo: number;
  /** Lo que se paga MIENTRAS se construye: anticipo + cuotas + refuerzos. */
  antesDeEntrega: number;
  contraEntrega: number;
  /** La cuota "normal", sin refuerzos. */
  cuotaTipica: number;
  /** Cómo se llegó a cada número. Se muestra debajo de la tabla. */
  formula: string;
  /** Qué se ajusta y con qué. Vacío si el plan es en moneda dura. */
  advertenciaAjuste: string;
}

export class PlanInvalido extends Error {}

/** Redondeo a dos decimales, para que la suma de las líneas dé el total. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Valida el plan antes de calcular nada.
 *
 * Devuelve la lista de problemas en vez de tirar en el primero: quien está
 * cargando un plan quiere ver los tres errores juntos, no descubrir uno por
 * vez.
 */
export function validarPlan(plan: PlanPago): string[] {
  const problemas: string[] = [];

  const refuerzosPct = plan.refuerzos.reduce((a, x) => a + x.pct, 0);
  const suma = r2(plan.anticipoPct + refuerzosPct + plan.contraEntregaPct);

  if (suma > 100) {
    problemas.push(
      `El anticipo, los refuerzos y la entrega suman ${suma}% y no dejan lugar `
      + 'para las cuotas.',
    );
  }
  if (plan.cuotas === 0 && suma !== 100) {
    problemas.push(`Sin cuotas, los porcentajes tienen que sumar 100% y suman ${suma}%.`);
  }
  if (plan.cuotas < 0) problemas.push('La cantidad de cuotas no puede ser negativa.');

  for (const ref of plan.refuerzos) {
    if (ref.cuota < 1 || ref.cuota > plan.cuotas) {
      problemas.push(
        `Hay un refuerzo en la cuota ${ref.cuota} y el plan tiene ${plan.cuotas}.`,
      );
    }
    if (ref.pct <= 0) problemas.push('Un refuerzo de 0% no es un refuerzo.');
  }

  const repetidos = plan.refuerzos.map((x) => x.cuota);
  if (new Set(repetidos).size !== repetidos.length) {
    problemas.push('Hay dos refuerzos en la misma cuota.');
  }

  return problemas;
}

/**
 * Arma el presupuesto.
 *
 * `desde` es la fecha del anticipo; las cuotas caen el mismo día de cada mes
 * siguiente.
 */
export function armarPresupuesto(
  precio: number,
  plan: PlanPago,
  desde: string,
): Presupuesto {
  const problemas = validarPlan(plan);
  if (problemas.length) throw new PlanInvalido(problemas.join(' '));
  if (precio <= 0) throw new PlanInvalido('El precio tiene que ser mayor a cero.');

  const refuerzosPct = plan.refuerzos.reduce((a, x) => a + x.pct, 0);
  const enCuotasPct = r2(100 - plan.anticipoPct - refuerzosPct - plan.contraEntregaPct);

  if (enCuotasPct < 0) {
    throw new PlanInvalido('Los porcentajes fijos superan el 100% del precio.');
  }

  const lineas: Linea[] = [];
  const ajustable = plan.indice !== 'ninguno';

  if (plan.anticipoPct > 0) {
    lineas.push({
      concepto: 'anticipo',
      numero: null,
      vence: desde,
      monto: r2(precio * plan.anticipoPct / 100),
      pct: plan.anticipoPct,
      // El anticipo se paga hoy: no hay nada que ajustar entre hoy y hoy.
      ajustable: false,
    });
  }

  const montoCuota = plan.cuotas > 0 ? r2(precio * enCuotasPct / 100 / plan.cuotas) : 0;
  const porCuota = new Map(plan.refuerzos.map((x) => [x.cuota, x.pct]));

  for (let i = 1; i <= plan.cuotas; i++) {
    lineas.push({
      concepto: 'cuota',
      numero: i,
      vence: sumarMeses(desde, i),
      monto: montoCuota,
      pct: r2(enCuotasPct / plan.cuotas),
      ajustable,
    });

    const ref = porCuota.get(i);
    if (ref) {
      lineas.push({
        concepto: 'refuerzo',
        numero: i,
        vence: sumarMeses(desde, i),
        monto: r2(precio * ref / 100),
        pct: ref,
        ajustable,
      });
    }
  }

  if (plan.contraEntregaPct > 0) {
    lineas.push({
      concepto: 'contra_entrega',
      numero: null,
      // Sin fecha a propósito: depende de la obra, no del calendario. Poner una
      // fecha acá sería prometer una entrega que nadie firmó.
      vence: null,
      monto: r2(precio * plan.contraEntregaPct / 100),
      pct: plan.contraEntregaPct,
      ajustable,
    });
  }

  const total = r2(lineas.reduce((a, l) => a + l.monto, 0));
  const contraEntrega = r2(precio * plan.contraEntregaPct / 100);
  const anticipo = r2(precio * plan.anticipoPct / 100);

  return {
    lineas,
    total,
    moneda: plan.moneda,
    anticipo,
    antesDeEntrega: r2(total - contraEntrega),
    contraEntrega,
    cuotaTipica: montoCuota,
    formula:
      `${plan.anticipoPct}% de anticipo + ${plan.cuotas} cuotas de ${enCuotasPct}% `
      + `+ ${plan.refuerzos.length} refuerzos de ${refuerzosPct}% `
      + `+ ${plan.contraEntregaPct}% contra entrega = 100% de ${plan.moneda} ${precio}`,
    advertenciaAjuste: ajustable
      ? `Las cuotas y los refuerzos se ajustan por ${plan.indice.toUpperCase()}. `
        + 'Los montos de esta tabla están a valor de hoy: el índice de cada mes '
        + 'se aplica cuando ese mes llega y no se puede proyectar.'
      : '',
  };
}

/**
 * El resumen para quien compra como inversión.
 *
 * Es la otra mitad de la pregunta: no «cuánto pago por mes» sino «cuánto me
 * cuesta el metro y cuánto tengo que poner antes de tener nada».
 */
export interface Inversion {
  precioPorM2: number | null;
  /** Qué porcentaje del total se desembolsa antes de recibir la unidad. */
  expuestoAntesDeEntregaPct: number;
  /** Cuánto vale el m² terminado para no perder plata. */
  puntoDeEquilibrioM2: number | null;
  /** La diferencia contra una unidad terminada comparable, si se pasa una. */
  ahorroVsTerminado: number | null;
  ahorroVsTerminadoPct: number | null;
}

export function analizarInversion(
  p: Presupuesto,
  supM2: number | null,
  precioTerminadoComparable: number | null,
): Inversion {
  const precioPorM2 = supM2 && supM2 > 0 ? r2(p.total / supM2) : null;

  const ahorro = precioTerminadoComparable !== null
    ? r2(precioTerminadoComparable - p.total)
    : null;

  return {
    precioPorM2,
    expuestoAntesDeEntregaPct: p.total > 0 ? r2(p.antesDeEntrega / p.total * 100) : 0,
    // Comprar en pozo sólo tiene sentido si el terminado vale más que lo pagado.
    // Este número es el piso: abajo de eso, el descuento del pozo se lo comió
    // el riesgo de obra.
    puntoDeEquilibrioM2: precioPorM2,
    ahorroVsTerminado: ahorro,
    ahorroVsTerminadoPct: ahorro !== null && precioTerminadoComparable
      ? r2(ahorro / precioTerminadoComparable * 100)
      : null,
  };
}

/**
 * Suma meses cuidando el fin de mes.
 *
 * Un anticipo el 31 de enero con cuota al mes siguiente cae el 28 de febrero, no
 * el 3 de marzo. `new Date` desborda solo y correría todas las cuotas
 * siguientes.
 */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.slice(0, 10).split('-').map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12);
  const mes = (total % 12 + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
