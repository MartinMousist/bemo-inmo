/**
 * De qué propiedad habla un mensaje.
 *
 * ── La regla que ordena esto: falso positivo > falso negativo, al revés ──
 *
 * Enganchar la propiedad EQUIVOCADA es peor que no enganchar ninguna. Si no
 * detecta, el asesor lo vincula a mano y ya. Si detecta mal, la consulta se le
 * asigna al captador de otra unidad, que contesta sobre algo que el cliente no
 * preguntó — y nadie revisa un dato que el sistema puso con seguridad.
 *
 * Por eso NO se detecta un número suelto. «Busco algo de 34 metros» tiene un
 * 34 y no habla de PROP-0034; «tengo 2 nenes» tampoco es la propiedad 2. El
 * código tiene que venir con su prefijo o dentro de un enlace nuestro.
 */

export interface Deteccion {
  /** El número de código, si vino como `PROP-0034`. */
  codigo: number | null;
  /** El uuid, si vino dentro de un enlace a la ficha o a la publicación. */
  id: string | null;
}

/**
 * `PROP-0034`, `PROP 34`, `prop0034`.
 *
 * El separador es opcional porque la gente copia y pega de cualquier lado, y
 * los ceros a la izquierda también: `PROP-34` y `PROP-0034` son la misma.
 */
const CODIGO = /\bprop[\s._-]*0*(\d{1,6})\b/i;

/**
 * Un enlace a la ficha o a la publicación.
 *
 * Se exige que el uuid venga precedido de un segmento conocido: un uuid suelto
 * en un mensaje puede ser cualquier cosa, y `propiedades/<uuid>` es nuestro.
 */
const ENLACE = /\/(?:propiedades|publicaciones|p)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

export function detectarPropiedad(texto: string): Deteccion {
  if (!texto) return { codigo: null, id: null };

  const enlace = ENLACE.exec(texto);
  // El enlace gana: es exacto, no depende de que el código esté bien tipeado.
  if (enlace) return { codigo: null, id: enlace[1].toLowerCase() };

  const codigo = CODIGO.exec(texto);
  if (codigo) {
    const n = Number(codigo[1]);
    // `PROP-0` no existe: los códigos arrancan en 1. Sin esto, un «prop 0»
    // buscaría una propiedad que no puede haber y devolvería vacío igual, pero
    // dejando la duda de si el detector anda.
    if (n > 0) return { codigo: n, id: null };
  }

  return { codigo: null, id: null };
}
