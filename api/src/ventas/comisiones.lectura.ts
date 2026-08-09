import { memoria } from './comisiones.motor';

/**
 * Leer las comisiones de una operación, una sola vez para venta y alquiler.
 *
 * Vive aparte de `ventas.service.ts` porque `comision` cuelga de una venta **o**
 * de un contrato de alquiler (la CHECK de la 008 lo dice), y la ficha del
 * contrato tiene que mostrar exactamente lo mismo que la de la venta: de quién
 * es cada peso, con su memoria de cálculo. Dos copias del mismo SELECT se
 * habrían separado en el primer campo que se agregue.
 */

export interface LineaGuardada {
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
  /** La cuenta escrita: `USD 162.000 × 3 % = USD 4.860`. */
  memoria: string;
}

export interface TotalesComision {
  operacion: number;
  externas: number;
  agentes: number;
  casa: number;
}

/**
 * El `json_agg` de las comisiones que cumplen `donde`.
 *
 * `cobrada_el` es una columna `date` y sale con `::text`: pasarla por `Date` le
 * inventa medianoche UTC y una comisión cobrada el 01/01 se muestra del 31/12.
 * El parser de `pg` ya está configurado para no convertir `date`, y el `::text`
 * lo deja explícito acá adentro del `json_build_object`, donde el parser no
 * llega.
 *
 * El nombre del beneficiario sale con `coalesce(u.nombre, …)` sólo para los
 * agentes: si a alguien le corrigieron el apellido, la pantalla muestra el
 * actual. Para una inmobiliaria externa manda el nombre CONGELADO en la fila —
 * una comisión ya pagada no cambia de acreedor porque alguien editó la ficha
 * del catálogo seis meses después. Misma regla que el ajuste confirmado.
 */
export function SELECT_COMISIONES(donde: string): string {
  return `(SELECT json_agg(json_build_object(
      'id', c.id, 'nivel', c.nivel, 'punta', c.punta, 'concepto', c.concepto,
      'base', c.base_monto, 'porcentaje', c.porcentaje,
      'monto', c.monto, 'moneda', c.moneda,
      'beneficiarioTipo', c.beneficiario_tipo,
      'beneficiarioId', c.beneficiario_id,
      'beneficiarioNombre', CASE WHEN c.beneficiario_tipo = 'agente'
                                 THEN coalesce(u.nombre, c.beneficiario_nombre)
                                 ELSE c.beneficiario_nombre END,
      'externaId', c.externa_id,
      'padreId', c.padre_id,
      'estado', c.estado,
      'cobradaEl', c.cobrada_el::text) ORDER BY c.nivel, c.punta, c.created_at)
     FROM comision c LEFT JOIN usuario u ON u.id = c.beneficiario_id
    WHERE ${donde})`;
}

export function aLineas(crudas: Array<Record<string, unknown>> | null): LineaGuardada[] {
  return (crudas ?? []).map((c) => {
    const base = Number(c.base);
    const porcentaje = Number(c.porcentaje);
    const monto = Number(c.monto);
    const moneda = String(c.moneda);
    const tipo = String(c.beneficiarioTipo);

    return {
      id: String(c.id),
      nivel: Number(c.nivel),
      punta: (c.punta as string) ?? null,
      concepto: String(c.concepto),
      base,
      porcentaje,
      monto,
      moneda,
      beneficiarioTipo: tipo,
      beneficiarioId: (c.beneficiarioId as string) ?? null,
      beneficiarioNombre: (c.beneficiarioNombre as string) ?? null,
      externaId: (c.externaId as string) ?? null,
      padreId: (c.padreId as string) ?? null,
      estado: String(c.estado),
      // `date` sin pasar por Date: se recorta el texto ISO. Un 01/01 convertido
      // a Date y de vuelta se muestra 31/12.
      cobradaEl: c.cobradaEl ? String(c.cobradaEl).slice(0, 10) : null,
      // La línea de la casa es un RESTO, no un porcentaje aplicado: escribirla
      // como «× 50 % =» sería mentir sobre cómo se calculó, aunque el número dé.
      memoria:
        tipo === 'casa'
          ? `Lo que queda de la punta después de los agentes: ${moneda} ${num(monto)}`
          : memoria(moneda, base, porcentaje, monto),
    };
  });
}

export function totalesDe(lineas: LineaGuardada[]): TotalesComision {
  const suma = (tipo: string) =>
    lineas
      .filter((c) => c.beneficiarioTipo === tipo && c.estado !== 'anulada')
      .reduce((a, c) => a + c.monto, 0);

  return {
    operacion: round2(suma('operacion')),
    externas: round2(suma('inmobiliaria_externa')),
    agentes: round2(suma('agente')),
    casa: round2(suma('casa')),
  };
}

/**
 * La invariante del módulo: lo que factura la operación es exactamente lo que
 * se reparte. Se calcula también en la LECTURA y no sólo al guardar, porque los
 * datos que entran por otro camino —el seed, una importación, un arreglo a
 * mano— no pasan por `repartir()`. Diez de las once ventas del seed la violaban
 * y en pantalla no se notaba: cada número se veía razonable por separado.
 *
 * Una operación sin reparto (sólo las líneas de nivel 1) no está mal repartida:
 * está sin repartir, y eso se dice distinto.
 */
export function cuadraGuardado(lineas: LineaGuardada[]): boolean {
  const t = totalesDe(lineas);
  if (t.operacion === 0) return true;
  if (t.externas === 0 && t.agentes === 0 && t.casa === 0) return true; // sin repartir
  return round2(t.externas + t.agentes + t.casa) === t.operacion;
}

export function hayReparto(lineas: LineaGuardada[]): boolean {
  return lineas.some((l) => l.nivel > 1 && l.estado !== 'anulada');
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
