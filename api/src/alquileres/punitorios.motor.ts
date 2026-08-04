import { round2 } from './ajustes.motor';

/**
 * El interés por mora. Sin base ni red: entra data, sale un resultado.
 *
 * Existe porque el contrato ya lo prometía. La plantilla por defecto imprime
 * «devengará un interés punitorio del {{ punitorioDiario }}% diario, sin
 * necesidad de interpelación», el campo se cargaba y se guardaba, y **ningún
 * código lo calculaba**. El sistema estaba imprimiendo una cláusula legal que
 * después no aplicaba.
 *
 * Tres reglas que mandan sobre la cuenta:
 *
 * 1. **Se calcula sobre el saldo impago, no sobre el total de la cuota.** Si el
 *    inquilino pagó la mitad, el interés corre sobre lo que falta. Cobrar el
 *    punitorio sobre el total de una cuota parcialmente saldada es cobrar de más.
 *
 * 2. **Interés simple, no compuesto.** El contrato dice «X% diario» y eso, en la
 *    práctica argentina, es simple: días × tasa × capital. Capitalizarlo daría un
 *    número más alto que el que el inquilino puede rehacer con una calculadora, y
 *    un punitorio que no se puede verificar no se cobra: se discute.
 *
 * 3. **Los días se cuentan desde el vencimiento, sin incluirlo.** Vencer hoy no
 *    es estar en mora hoy: el día de vencimiento es el último día para pagar.
 */

export interface EntradaPunitorio {
  /** Lo que falta pagar de la cuota. */
  saldo: number;
  moneda: string;
  /** `YYYY-MM-DD`. El último día para pagar sin interés. */
  venceEl: string;
  /** `YYYY-MM-DD`. Normalmente hoy; al cobrar, la fecha del cobro. */
  hasta: string;
  /** Tasa diaria en porcentaje. 0,1 = 0,1% por día. */
  tasaDiariaPct: number;
}

export interface ResultadoPunitorio {
  diasDeMora: number;
  monto: number;
  moneda: string;
  /** El renglón que se le muestra al inquilino. */
  explicacion: string;
  memoria: {
    saldo: number;
    tasaDiariaPct: number;
    diasDeMora: number;
    venceEl: string;
    hasta: string;
  };
}

/**
 * Días entre dos fechas de calendario.
 *
 * Las fechas se parten a mano y NO pasan por `Date` con zona: un `YYYY-MM-DD` es
 * una fecha de calendario, no un instante, y convertirlo le inventa medianoche
 * UTC. En este proyecto eso ya corrió un contrato un día para atrás una vez.
 * `Date.UTC` sobre las partes es seguro porque los dos extremos usan la misma
 * convención y sólo interesa la diferencia.
 */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(
    Number(desde.slice(0, 4)),
    Number(desde.slice(5, 7)) - 1,
    Number(desde.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(hasta.slice(0, 4)),
    Number(hasta.slice(5, 7)) - 1,
    Number(hasta.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

export function calcularPunitorio(e: EntradaPunitorio): ResultadoPunitorio {
  const dias = Math.max(0, diasEntre(e.venceEl, e.hasta));

  const base = {
    diasDeMora: dias,
    moneda: e.moneda,
    memoria: {
      saldo: round2(e.saldo),
      tasaDiariaPct: e.tasaDiariaPct,
      diasDeMora: dias,
      venceEl: e.venceEl,
      hasta: e.hasta,
    },
  };

  // Sin mora, sin tasa o sin saldo no hay interés. Se devuelve 0 y no se lanza:
  // el caso normal de una cartera sana es que no haya punitorio, y obligar a
  // atrapar una excepción por eso ensucia todos los llamadores.
  if (dias <= 0 || e.tasaDiariaPct <= 0 || e.saldo <= 0) {
    return {
      ...base,
      monto: 0,
      explicacion:
        dias <= 0
          ? 'Sin mora: la cuota no está vencida.'
          : e.tasaDiariaPct <= 0
            ? 'El contrato no tiene punitorio pactado.'
            : 'Sin saldo impago.',
    };
  }

  const monto = round2((e.saldo * e.tasaDiariaPct * dias) / 100);

  return {
    ...base,
    monto,
    // El formato canónico de una memoria de cálculo en este producto: la cuenta
    // completa en una línea, con los números que la rehacen. Ver DESIGN.md §5.
    explicacion:
      `${dias} día(s) de mora · ${fmt(e.tasaDiariaPct)}% diario · ` +
      `${e.moneda} ${fmt(e.saldo)} × ${fmt(e.tasaDiariaPct)}% × ${dias} = ` +
      `${e.moneda} ${fmt(monto)}`,
  };
}

/** es-AR: miles con punto, decimales con coma. Igual que en el front. */
function fmt(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
