import { round2 } from '../alquileres/ajustes.motor';

/**
 * La calculadora de comisiones. Sin base ni red: entra data, sale el reparto.
 *
 * Son TRES repartos encadenados, y confundirlos es lo que hace que estas cuentas
 * siempre den mal:
 *
 *   nivel 1 — cuánto cobra la OPERACIÓN. Honorarios a cada punta sobre el precio
 *             de cierre. Varía por provincia y por tipo de operación.
 *   nivel 2 — cómo se reparte ENTRE INMOBILIARIAS cuando hay una de cada lado.
 *             Típico 50/50, pero se negocia caso por caso.
 *   nivel 3 — cómo se reparte PUERTAS ADENTRO: el que captó, el que cerró, y lo
 *             que queda para la casa.
 *
 * El nivel 3 es el que nadie tiene sistematizado y el que genera discusiones
 * todos los meses.
 */

export type Punta = 'compradora' | 'vendedora' | 'locataria' | 'locadora';

export interface EntradaComision {
  /** Precio de cierre (venta) o alquiler mensual (alquiler). */
  base: number;
  moneda: string;

  /** Honorarios por punta, en % sobre la base. */
  puntas: Partial<Record<Punta, number>>;

  /**
   * Puntas donde interviene OTRA inmobiliaria y el % que se lleva.
   * `{ vendedora: 50 }` = de lo cobrado a la punta vendedora, la mitad es de
   * la otra inmobiliaria.
   *
   * `externaId` es la ficha del catálogo (`inmobiliaria_externa`), y es
   * OPCIONAL: se puede compartir con una agencia que todavía no está cargada y
   * el reparto tiene que salir igual. El `nombre` es el que manda —es el que se
   * congela en la comisión— y el id sólo sirve para poder sumar después cuánto
   * se le pagó a cada una.
   */
  externas?: Partial<Record<Punta, { nombre: string; porcentaje: number; externaId?: string }>>;

  /** Reparto puertas adentro, en % de lo que le queda a la casa. */
  repartoInterno?: {
    captador?: { usuarioId: string; nombre: string; porcentaje: number };
    cerrador?: { usuarioId: string; nombre: string; porcentaje: number };
  };
}

export interface LineaComision {
  nivel: 1 | 2 | 3;
  punta: Punta | null;
  concepto: string;
  base: number;
  porcentaje: number;
  monto: number;
  moneda: string;
  beneficiarioTipo: 'operacion' | 'casa' | 'agente' | 'inmobiliaria_externa';
  beneficiarioId?: string;
  beneficiarioNombre?: string;
  /** La ficha del catálogo, sólo en las líneas de inmobiliaria externa. */
  externaId?: string;
  /** Índice de la línea de la que sale, para encadenar padre → hijo. */
  padre?: number;
  /**
   * La cuenta escrita, para que la pantalla no la tenga que rearmar.
   *
   * «Todo cálculo lleva su memoria» es una regla del dominio, no un adorno: sin
   * esto, quien mira una comisión de USD 2.430 no puede decir de dónde salió, y
   * el día que alguien discute un pago hay que abrir la base.
   */
  memoria: string;
}

export interface ResultadoComisiones {
  lineas: LineaComision[];
  /** Lo que factura la operación entera, sumando todas las puntas. */
  totalOperacion: number;
  /** Lo que se va a otras inmobiliarias. */
  totalExternas: number;
  /** Lo que se llevan los agentes de la casa. */
  totalAgentes: number;
  /** Lo que le queda finalmente a la inmobiliaria. */
  totalCasa: number;
  moneda: string;
}

const ETIQUETA_PUNTA: Record<Punta, string> = {
  compradora: 'punta compradora',
  vendedora: 'punta vendedora',
  locataria: 'punta locataria',
  locadora: 'punta locadora',
};

export function calcularComisiones(e: EntradaComision): ResultadoComisiones {
  const lineas: LineaComision[] = [];
  let totalOperacion = 0;
  let totalExternas = 0;
  let totalAgentes = 0;
  let totalCasa = 0;

  for (const [p, pct] of Object.entries(e.puntas) as Array<[Punta, number]>) {
    if (!pct) continue;

    // ── Nivel 1: lo que cobra la operación por esta punta ──
    const montoPunta = round2((e.base * pct) / 100);
    const iNivel1 = lineas.length;
    lineas.push({
      nivel: 1,
      punta: p,
      concepto: `Honorarios ${ETIQUETA_PUNTA[p]} · ${pct}%`,
      base: e.base,
      porcentaje: pct,
      monto: montoPunta,
      moneda: e.moneda,
      beneficiarioTipo: 'operacion',
      memoria: memoria(e.moneda, e.base, pct, montoPunta),
    });
    totalOperacion = round2(totalOperacion + montoPunta);

    // ── Nivel 2: reparto con la otra inmobiliaria ──
    const externa = e.externas?.[p];
    let paraLaCasa = montoPunta;

    if (externa && externa.porcentaje > 0) {
      const montoExterna = round2((montoPunta * externa.porcentaje) / 100);
      lineas.push({
        nivel: 2,
        punta: p,
        concepto: `${externa.nombre} · ${externa.porcentaje}% de la ${ETIQUETA_PUNTA[p]}`,
        base: montoPunta,
        porcentaje: externa.porcentaje,
        monto: montoExterna,
        moneda: e.moneda,
        beneficiarioTipo: 'inmobiliaria_externa',
        beneficiarioNombre: externa.nombre,
        externaId: externa.externaId,
        padre: iNivel1,
        memoria: memoria(e.moneda, montoPunta, externa.porcentaje, montoExterna),
      });
      totalExternas = round2(totalExternas + montoExterna);
      // El resto se calcula por diferencia y NO con (100 - pct): así, si el
      // redondeo desplaza un centavo, no se pierde ni se inventa plata.
      paraLaCasa = round2(montoPunta - montoExterna);
    }

    // ── Nivel 3: reparto puertas adentro ──
    const r = e.repartoInterno;
    let restoCasa = paraLaCasa;

    for (const rol of ['captador', 'cerrador'] as const) {
      const quien = r?.[rol];
      if (!quien || !quien.porcentaje) continue;

      const montoAgente = round2((paraLaCasa * quien.porcentaje) / 100);
      lineas.push({
        nivel: 3,
        punta: p,
        concepto: `${quien.nombre} · ${rol} ${quien.porcentaje}%`,
        base: paraLaCasa,
        porcentaje: quien.porcentaje,
        monto: montoAgente,
        moneda: e.moneda,
        beneficiarioTipo: 'agente',
        beneficiarioId: quien.usuarioId,
        beneficiarioNombre: quien.nombre,
        padre: iNivel1,
        memoria: memoria(e.moneda, paraLaCasa, quien.porcentaje, montoAgente),
      });
      totalAgentes = round2(totalAgentes + montoAgente);
      restoCasa = round2(restoCasa - montoAgente);
    }

    if (restoCasa > 0) {
      lineas.push({
        nivel: 3,
        punta: p,
        concepto: `Inmobiliaria · resto de la ${ETIQUETA_PUNTA[p]}`,
        base: paraLaCasa,
        // El porcentaje sale de la división real, no de restar los otros: si
        // hubo redondeo, este número es el que cuadra.
        porcentaje: paraLaCasa > 0 ? round4((restoCasa / paraLaCasa) * 100) : 0,
        monto: restoCasa,
        moneda: e.moneda,
        beneficiarioTipo: 'casa',
        padre: iNivel1,
        memoria:
          `${plata(e.moneda, paraLaCasa)} de la ${ETIQUETA_PUNTA[p]} − lo de los agentes ` +
          `= ${plata(e.moneda, restoCasa)}`,
      });
      totalCasa = round2(totalCasa + restoCasa);
    }
  }

  return {
    lineas,
    totalOperacion,
    totalExternas,
    totalAgentes,
    totalCasa,
    moneda: e.moneda,
  };
}

/**
 * Comprueba que el reparto cierre: lo que factura la operación tiene que ser
 * exactamente lo que se reparte. Si no cuadra, hay plata perdida o inventada.
 */
export function cuadra(r: ResultadoComisiones): boolean {
  return round2(r.totalExternas + r.totalAgentes + r.totalCasa) === r.totalOperacion;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/**
 * La memoria de cálculo de una línea: `USD 162.000 × 3 % = USD 4.860`.
 *
 * Se arma acá, en el motor, y no en la pantalla: es el motor el que sabe sobre
 * qué base aplicó cada porcentaje, y ese dato se pierde apenas la línea entra
 * en la base. La pantalla que la rearmara tendría que reimplementar el
 * encadenado de los tres niveles para escribir una frase.
 *
 * Lleva la moneda pegada a cada número porque ningún monto va sin ella, ni
 * siquiera adentro de una explicación.
 */
export function memoria(moneda: string, base: number, porcentaje: number, monto: number): string {
  return `${plata(moneda, base)} × ${num(porcentaje)} % = ${plata(moneda, monto)}`;
}

function plata(moneda: string, n: number): string {
  return `${moneda} ${num(n)}`;
}

/** es-AR: miles con punto, decimales con coma. Sin centavos cuando son cero. */
function num(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
