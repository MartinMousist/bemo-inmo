import type { TipoCuenta } from './roles';

/**
 * Cómo se llama a sí mismo el negocio, según qué negocio sea.
 *
 * ── Por qué existe ──
 *
 * La etapa 13 preguntó en el alta si sos inmobiliaria o gestión de alquileres,
 * y a partir de ahí la app siguió diciendo «la inmobiliaria» en todas sus
 * pantallas. A quien administra veinte departamentos y no vende nada, eso le
 * recuerda en cada cartel que el producto fue pensado para otro.
 *
 * ── Qué NO está acá ──
 *
 * Las cadenas de Comisiones, Ventas, Reparto y Publicaciones. Un gestor no ve
 * esas pantallas: traducirlas sería trabajo que nadie lee, y cada término con
 * dos versiones es una forma más de que las dos se desincronicen. Se traduce lo
 * que efectivamente alcanza a las dos clases de cuenta — que son seis frases.
 *
 * Tampoco el nombre propio: donde entra el nombre del tenant se usa el nombre
 * del tenant, que siempre es mejor que cualquier genérico.
 */

/** «la inmobiliaria» · «la administración». En minúscula, para el medio de una frase. */
export function laCasa(tipo: TipoCuenta | null | undefined): string {
  return tipo === 'gestor' ? 'la administración' : 'la inmobiliaria';
}

/** Igual, para arrancar una oración. */
export function LaCasa(tipo: TipoCuenta | null | undefined): string {
  return tipo === 'gestor' ? 'La administración' : 'La inmobiliaria';
}

/**
 * El «todos» de un filtro por persona del equipo.
 *
 * «Toda la inmobiliaria» es la etiqueta que más se ve de las seis: está en el
 * filtro por agente de Propiedades, Contratos y Personas.
 */
export function todoElEquipo(tipo: TipoCuenta | null | undefined): string {
  return tipo === 'gestor' ? 'Todo el equipo' : 'Toda la inmobiliaria';
}
