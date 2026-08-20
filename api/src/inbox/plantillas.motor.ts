/**
 * Las variables de una respuesta rápida.
 *
 * ── Cuándo se reemplazan ──
 *
 * **Al insertarla en el cuadro de respuesta, no al enviar.** La diferencia es
 * todo: así el asesor VE el texto final antes de mandarlo y lo puede corregir.
 * Reemplazando al enviar, un `{nombre}` que no se pudo resolver sale tal cual
 * hacia el cliente y nadie se entera hasta que contesta «¿quién es nombre?».
 *
 * ── Qué pasa con lo que no se puede resolver ──
 *
 * Se deja el `{marcador}` puesto y se avisa cuáles quedaron. No se borra ni se
 * reemplaza por vacío: «Hola , ¿cómo estás?» con el hueco en el medio se manda
 * sin que nadie lo note, y el marcador a la vista no.
 */

export interface Variable {
  clave: string;
  etiqueta: string;
  ejemplo: string;
}

export const VARIABLES: Variable[] = [
  { clave: 'nombre', etiqueta: 'Nombre del contacto', ejemplo: 'Lucía' },
  { clave: 'inmobiliaria', etiqueta: 'Nombre de la inmobiliaria', ejemplo: 'Inmobiliaria Andes' },
  { clave: 'agente', etiqueta: 'Quien está respondiendo', ejemplo: 'Ana Torres' },
];

const CLAVES = new Set(VARIABLES.map((v) => v.clave));

export interface Aplicado {
  texto: string;
  /** Las que no se pudieron resolver. La pantalla las muestra como advertencia. */
  faltantes: string[];
  /** Las que están escritas en la plantilla y no existen. Es un typo. */
  desconocidas: string[];
}

/**
 * Reemplaza `{clave}` por su valor.
 *
 * Sólo minúsculas y letras: sin esto, `{ nombre }` con espacios o `{Nombre}`
 * fallarían en silencio y la plantilla saldría con el marcador puesto sin que
 * nadie entienda por qué.
 */
export function aplicarVariables(
  cuerpo: string,
  datos: Record<string, string | null | undefined>,
): Aplicado {
  const faltantes = new Set<string>();
  const desconocidas = new Set<string>();

  const texto = cuerpo.replace(/\{\s*([a-zA-Z]+)\s*\}/g, (original, cruda: string) => {
    const clave = cruda.toLowerCase();

    if (!CLAVES.has(clave)) {
      desconocidas.add(cruda);
      return original;
    }

    const valor = datos[clave];
    if (valor === null || valor === undefined || valor.trim() === '') {
      faltantes.add(clave);
      // Se deja el marcador: que se vea es la única forma de que se corrija.
      return original;
    }

    return valor;
  });

  return { texto, faltantes: [...faltantes], desconocidas: [...desconocidas] };
}

/**
 * El texto de ejemplo, para la vista previa mientras se escribe la plantilla.
 *
 * Con valores de muestra y no con los de un cliente real: quien edita una
 * plantilla no tiene una conversación abierta, y mostrarle datos de alguien
 * cualquiera para «que se vea cómo queda» es exponer a un tercero sin motivo.
 */
export function previsualizar(cuerpo: string): Aplicado {
  const ejemplos = Object.fromEntries(VARIABLES.map((v) => [v.clave, v.ejemplo]));
  return aplicarVariables(cuerpo, ejemplos);
}
