import { numero, plural } from './formato';

/**
 * Qué atributos tiene sentido mostrar de cada tipo de propiedad, y cómo se
 * muestra un dato que no está.
 *
 * ── El problema, con un ejemplo ─────────────────────────────────────────────
 *
 * Un terreno no tiene dormitorios y una cochera no tiene baños. Si la tarjeta
 * imprime lo que viene de la base, esos casos salen como **0**, y un cero es un
 * número: dice «tiene cero baños», que en una cochera es ruido y en un
 * departamento sería un dato de compra. Es la misma regla del playbook —«un
 * cero es un número»— aplicada a la cartera en vez de a la plata.
 *
 * Y hay un segundo cero, peor: `NULL`. «No tiene cochera» y «nadie cargó
 * cuántas cocheras tiene» son cosas distintas, y las dos se ven igual si se
 * imprime el valor crudo. La primera es una respuesta; la segunda es una tarea
 * pendiente.
 *
 * ── Por qué es un módulo y no unos `v-if` en el template ────────────────────
 *
 * Porque es una regla de dominio con tres ramas por atributo, y repartida en el
 * template diverge en cuanto haya una segunda pantalla que la use — que es
 * exactamente lo que le pasó a la etiqueta de la situación, que terminó
 * escrita de tres formas distintas. Acá es una función pura y tiene tests de
 * papel, uno por cada tipo que existe en la base.
 */

export type Atributo = 'ambientes' | 'dormitorios' | 'banos' | 'cocheras';

/**
 * Qué aplica a cada tipo.
 *
 * Un atributo que NO está en la lista de su tipo no se muestra de ninguna
 * manera: ni con 0, ni con un guión, ni con «s/d». No es un dato que falte, es
 * un dato que no existe para esa cosa.
 */
export const ATRIBUTOS_POR_TIPO: Record<string, readonly Atributo[]> = {
  departamento: ['ambientes', 'dormitorios', 'banos', 'cocheras'],
  casa: ['ambientes', 'dormitorios', 'banos', 'cocheras'],
  ph: ['ambientes', 'dormitorios', 'banos', 'cocheras'],
  // Una oficina se mide en ambientes y baños; «dormitorios» no significa nada.
  oficina: ['ambientes', 'banos', 'cocheras'],
  // Un local y un galpón tampoco tienen ambientes en el sentido del rubro: se
  // miden en metros, que van aparte y siempre.
  local: ['banos', 'cocheras'],
  galpon: ['banos', 'cocheras'],
  cochera: ['cocheras'],
  // Un lote y un campo no tienen nada de esto. Sólo superficie.
  terreno: [],
  campo: [],
};

interface Definicion {
  /** Nombre del ícono en `UiIcon.vue`. */
  icono: string;
  singular: string;
  plural: string;
  /** Cómo se dice que no hay ninguno. «sin cochera», no «0 cocheras». */
  cero: string;
}

const DEFINICIONES: Record<Atributo, Definicion> = {
  ambientes: { icono: 'ambientes', singular: 'ambiente', plural: 'ambientes', cero: 'sin ambientes' },
  // «sin dormitorio» y no «monoambiente»: un departamento de un ambiente sin
  // dormitorio es un monoambiente, pero eso lo dice la combinación de DOS
  // atributos y este chip habla de uno solo. Poner la palabra acá sería una
  // inferencia, y en una casa con el dato en 0 diría algo falso.
  dormitorios: { icono: 'dormitorio', singular: 'dormitorio', plural: 'dormitorios', cero: 'sin dormitorio' },
  banos: { icono: 'bano', singular: 'baño', plural: 'baños', cero: 'sin baño' },
  cocheras: { icono: 'cochera', singular: 'cochera', plural: 'cocheras', cero: 'sin cochera' },
};

export interface ChipAtributo {
  /** Para la `key` del `v-for`. */
  clave: Atributo;
  icono: string;
  /** Lo que se ve: `3`, `sin cochera`, `s/d`. */
  texto: string;
  /** Lo que lee un lector de pantalla y muestra el `title`. Frase completa. */
  titulo: string;
  /**
   * `valor` ⇒ hay un número ≥ 1 · `cero` ⇒ no tiene ninguno, y es un dato ·
   * `sin_dato` ⇒ nadie lo cargó. La tarjeta los pinta distinto: el `sin_dato`
   * es el único que pide una acción.
   */
  estado: 'valor' | 'cero' | 'sin_dato';
}

/** Lo mínimo que hace falta para resolver los chips. */
export interface AtributosDePropiedad {
  tipo: string;
  ambientes?: number | null;
  dormitorios?: number | null;
  banos?: number | null;
  cocheras?: number | null;
}

export interface SuperficieDePropiedad {
  supCubierta?: number | null;
  supTotal?: number | null;
}

/**
 * Los chips de una propiedad, ya resueltos.
 *
 * Un tipo que este front todavía no conoce —porque se agregó a la base y nadie
 * tocó `ATRIBUTOS_POR_TIPO`— cae a «mostrar sólo lo que tiene valor». Es la
 * salida honesta: no inventa un «s/d» para un atributo que quizás no aplique, y
 * no esconde un dato que sí está cargado.
 */
export function atributosDe(p: AtributosDePropiedad): ChipAtributo[] {
  const conocido = Object.prototype.hasOwnProperty.call(ATRIBUTOS_POR_TIPO, p.tipo);
  const aplican: readonly Atributo[] = conocido
    ? ATRIBUTOS_POR_TIPO[p.tipo]
    : (Object.keys(DEFINICIONES) as Atributo[]).filter(
        (a) => p[a] !== null && p[a] !== undefined,
      );

  const chips: ChipAtributo[] = [];
  for (const clave of aplican) {
    const d = DEFINICIONES[clave];
    const v = p[clave];

    if (v === null || v === undefined) {
      chips.push({
        clave,
        icono: d.icono,
        texto: 's/d',
        // La frase dice qué falta y no «sin datos» a secas: el que la lee
        // tiene que poder ir a cargarlo sin adivinar de qué se trata.
        titulo: `${mayuscula(d.plural)}: sin cargar`,
        estado: 'sin_dato',
      });
      continue;
    }

    if (v === 0) {
      chips.push({
        clave,
        icono: d.icono,
        texto: d.cero,
        titulo: mayuscula(d.cero),
        estado: 'cero',
      });
      continue;
    }

    chips.push({
      clave,
      icono: d.icono,
      texto: numero(v),
      titulo: plural(v, d.singular, d.plural),
      estado: 'valor',
    });
  }
  return chips;
}

/**
 * La superficie, en una línea: `140 m² cub · 180 m² tot`.
 *
 * Cada número lleva SU palabra. Un «140 / 180 m²» obliga a saber cuál es cuál,
 * y en una propiedad los dos metrajes se negocian por separado: la cubierta es
 * lo que se habita y la total es lo que se compra.
 *
 * Se imprime sólo lo que existe. Un terreno tiene total y no cubierta y sale
 * `600 m² tot`; una propiedad sin ningún metraje devuelve `null` y la tarjeta
 * no dibuja la línea, en vez de dibujar un renglón con dos guiones.
 */
export function superficieDe(p: SuperficieDePropiedad): string | null {
  const partes: string[] = [];
  if (p.supCubierta !== null && p.supCubierta !== undefined) {
    partes.push(`${numero(p.supCubierta)} m² cub`);
  }
  if (p.supTotal !== null && p.supTotal !== undefined) {
    partes.push(`${numero(p.supTotal)} m² tot`);
  }
  return partes.length ? partes.join(' · ') : null;
}

/** Para el `title`, que es una frase y empieza en mayúscula. */
function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
