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
   */
  externas?: Partial<Record<Punta, { nombre: string; porcentaje: number }>>;

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
  /** Índice de la línea de la que sale, para encadenar padre → hijo. */
  padre?: number;
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
        padre: iNivel1,
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
