/**
 * La comparación entre el acta de entrega y la de devolución. PURO: entran las
 * dos listas de ambientes, sale qué cambió.
 *
 * Es el corazón de la feature. Guardar fotos es fácil y ya se sabe hacer —lo
 * mismo que los documentos del garante—; lo que resuelve la discusión del
 * depósito es poder poner **el mismo ambiente al lado del mismo ambiente** y
 * decir «estaba bueno, volvió malo».
 *
 * ── Por qué el ambiente es texto y la comparación normaliza ──
 *
 * Un enum de ambientes parece prolijo y se rompe con la primera unidad real:
 * «lavadero», «altillo», «quincho», «patio del fondo», «cochera 2». Pero
 * entonces «Cocina», «cocina» y «COCINA " son tres ambientes distintos para el
 * `find()`, y el comparativo mostraría la cocina dos veces, cada una con la
 * mitad de la información. Se normaliza: minúsculas, sin acentos, sin espacios
 * de más.
 *
 * ── Y por qué no alcanza con comparar el estado ──
 *
 * Un ambiente que estaba `regular` y volvió `regular` no empeoró, pero puede
 * tener una observación nueva. Y uno que aparece SÓLO en la devolución —un
 * ambiente que nadie cargó al entregar— no es «empeoró»: es que no hay con qué
 * comparar, y decirlo así es lo honesto. Reclamarle a alguien por el estado de
 * algo que nunca se documentó es exactamente lo que esta feature viene a evitar.
 */

/** De mejor a peor. El orden ES la escala: se compara por índice. */
export const ESTADOS = ['excelente', 'bueno', 'regular', 'malo'] as const;
export type EstadoItem = (typeof ESTADOS)[number];

export const ETIQUETA_ESTADO: Record<EstadoItem, string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Malo',
};

export interface ItemActa {
  ambiente: string;
  estado: EstadoItem;
  detalle?: string | null;
  fotos?: number;
}

export type Veredicto = 'igual' | 'empeoro' | 'mejoro' | 'sin-comparacion' | 'no-devuelto';

export interface Comparacion {
  ambiente: string;
  entrega: ItemActa | null;
  devolucion: ItemActa | null;
  veredicto: Veredicto;
  /** Cuántos escalones se movió. Negativo es que mejoró. */
  escalones: number;
  /** Una frase que se puede leer en voz alta frente al inquilino. */
  resumen: string;
}

export interface ResultadoComparacion {
  items: Comparacion[];
  empeoraron: number;
  sinComparacion: number;
  /** El titular: lo primero que alguien quiere saber al abrir esto. */
  titular: string;
}

/**
 * La llave con la que se cruzan los dos ambientes.
 *
 * `NFD` + quitar diacríticos: «Baño» y «Bano» los escribe la misma persona en
 * dos visitas distintas, y con teclados distintos.
 */
export function normalizar(ambiente: string): string {
  return (ambiente ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nivel(e: EstadoItem): number {
  const i = ESTADOS.indexOf(e);
  // Un estado que no está en la escala no se inventa: se trata como el peor
  // conocido para que nunca pase por «igual» sin que nadie lo mire.
  return i === -1 ? ESTADOS.length - 1 : i;
}

export function comparar(
  entrega: ItemActa[],
  devolucion: ItemActa[],
): ResultadoComparacion {
  const porClave = new Map<string, { e?: ItemActa; d?: ItemActa }>();

  // El orden de salida es el del acta de ENTREGA, que es como se recorrió la
  // casa la primera vez. Los que sólo aparecen en la devolución van al final.
  for (const it of entrega) {
    const k = normalizar(it.ambiente);
    porClave.set(k, { ...(porClave.get(k) ?? {}), e: it });
  }
  for (const it of devolucion) {
    const k = normalizar(it.ambiente);
    porClave.set(k, { ...(porClave.get(k) ?? {}), d: it });
  }

  const items: Comparacion[] = [];
  for (const [, par] of porClave) {
    const e = par.e ?? null;
    const d = par.d ?? null;
    const ambiente = e?.ambiente ?? d?.ambiente ?? '';

    if (e && !d) {
      items.push({
        ambiente, entrega: e, devolucion: null,
        veredicto: 'no-devuelto', escalones: 0,
        resumen: 'No se revisó en la devolución.',
      });
      continue;
    }
    if (!e && d) {
      items.push({
        ambiente, entrega: null, devolucion: d,
        veredicto: 'sin-comparacion', escalones: 0,
        resumen:
          `No estaba en el acta de entrega: quedó en ${ETIQUETA_ESTADO[d.estado].toLowerCase()}, ` +
          'pero no hay con qué compararlo.',
      });
      continue;
    }

    const escalones = nivel(d!.estado) - nivel(e!.estado);
    items.push({
      ambiente,
      entrega: e,
      devolucion: d,
      veredicto: escalones > 0 ? 'empeoro' : escalones < 0 ? 'mejoro' : 'igual',
      escalones,
      resumen:
        escalones === 0
          ? `Igual que a la entrega: ${ETIQUETA_ESTADO[e!.estado].toLowerCase()}.`
          : `${ETIQUETA_ESTADO[e!.estado]} → ${ETIQUETA_ESTADO[d!.estado]}.`,
    });
  }

  const empeoraron = items.filter((i) => i.veredicto === 'empeoro').length;
  const sinComparacion = items.filter((i) => i.veredicto === 'sin-comparacion').length;

  return {
    items,
    empeoraron,
    sinComparacion,
    titular: titularDe(items.length, empeoraron, sinComparacion),
  };
}

function titularDe(total: number, empeoraron: number, sinComparacion: number): string {
  if (!total) return 'Todavía no hay ambientes cargados.';
  if (!empeoraron) {
    return sinComparacion
      ? `La unidad volvió como se entregó. ${sinComparacion} ` +
        `${sinComparacion === 1 ? 'ambiente no estaba' : 'ambientes no estaban'} en el acta de entrega.`
      : 'La unidad volvió como se entregó.';
  }
  return empeoraron === 1
    ? '1 ambiente volvió peor de como se entregó.'
    : `${empeoraron} ambientes volvieron peor de como se entregaron.`;
}

/**
 * Los ambientes con los que arranca un acta nueva.
 *
 * No es una lista cerrada: es lo que evita la hoja en blanco. Se agregan y se
 * sacan a mano, y el acta de DEVOLUCIÓN no usa esto — copia los ambientes de la
 * de entrega, que es lo único que hace comparable a las dos.
 */
export const AMBIENTES_SUGERIDOS = [
  'Living comedor',
  'Cocina',
  'Dormitorio principal',
  'Baño',
  'Lavadero',
  'Balcón',
  'Instalación eléctrica',
  'Instalación de gas',
  'Carpintería y aberturas',
  'Pintura general',
];
