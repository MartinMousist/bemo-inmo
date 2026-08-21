/**
 * Qué señal ayuda a elegir una candidata, y cuál no.
 *
 * ── La idea ──
 *
 * Un motivo que tienen las cinco candidatas **no es un motivo para elegir
 * ninguna**.
 *
 * El caso normal de la conciliación es un inquilino con varios meses impagos,
 * todos por el mismo importe. Las cinco cuotas candidatas dicen «Monto exacto»
 * y «La referencia la nombra»: diez etiquetas idénticas, y la única que
 * distingue —«A 5 días del vencimiento», que aparece en una sola— queda perdida
 * entre ellas.
 *
 * Lo común sube a un renglón del grupo, dicho una vez. Abajo queda sólo lo que
 * diferencia, que es lo que hay que leer para decidir.
 */

export interface SugerenciaConSenales {
  exacto: boolean;
  senales: string[];
}

/**
 * Las señales de una candidata, con «Monto exacto» tratado como una más.
 *
 * El motor lo devuelve como un booleano aparte y la pantalla lo dibujaba como
 * chip. Para comparar candidatas entre sí tiene que estar en la misma lista que
 * el resto, o «todas coinciden en el monto» nunca se detecta.
 */
export function senalesDe(s: SugerenciaConSenales): string[] {
  return s.exacto && !s.senales.includes('Monto exacto')
    ? ['Monto exacto', ...s.senales]
    : s.senales;
}

/**
 * Lo que TODAS comparten.
 *
 * Con una sola candidata no hay nada que comparar: no hay «común» posible, y
 * mandar su única señal a un renglón de grupo dejaría la fila muda.
 */
export function senalesComunes(sugerencias: SugerenciaConSenales[]): string[] {
  if (sugerencias.length < 2) return [];
  const conjuntos = sugerencias.map((s) => new Set(senalesDe(s)));
  // Se recorre la primera para conservar el ORDEN en que el motor las emite:
  // están puestas de más fuerte a más débil, y ordenarlas de otra forma sería
  // perder ese criterio.
  return [...conjuntos[0]].filter((c) => conjuntos.every((x) => x.has(c)));
}

/** Lo que esta candidata tiene y las otras no. */
export function senalesPropias(
  sugerencias: SugerenciaConSenales[],
  s: SugerenciaConSenales,
): string[] {
  const comunes = new Set(senalesComunes(sugerencias));
  return senalesDe(s).filter((x) => !comunes.has(x));
}
