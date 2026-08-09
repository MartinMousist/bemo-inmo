import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Los dos nodos propios del editor de plantillas.
 *
 * ── Por qué TipTap y no un contenteditable propio ───────────────────────────
 *
 * La razón NO es que pegar y deshacer sean difíciles —que lo son—. Es que **el
 * chip de variable tiene que ser un átomo indivisible**, y `contenteditable` no
 * da ninguna garantía de eso: en un `<span>` pelado el navegador parte el nodo
 * cuando alguien escribe en el medio, el corrector ortográfico inserta marcas
 * adentro, y `document.execCommand` está deprecado con comportamientos
 * distintos por navegador. Un `{{ contrato.monto }}` partido al medio deja de
 * matchear el regex del motor y **sale literal adentro del contrato que se
 * firma**. Ese error ya pasó en este repo: el esqueleto de «Nueva plantilla»
 * enseñaba `{{#if}}` de Handlebars, el motor no lo entendía, y se imprimía
 * literal (está en la tabla de trampas de `docs/CONTINUAR.md`).
 *
 * ProseMirror valida **cada transacción contra un schema**: un documento que no
 * cumple el schema no puede existir en el editor. No es comodidad, es la misma
 * clase de garantía que un CHECK en Postgres.
 */

export const FORMATOS_VALIDOS = [
  'moneda', 'numero', 'fecha', 'fecha_larga', 'mayusculas', 'letras',
] as const;

/** El texto que el motor sustituye. Es lo que se serializa adentro del chip. */
export function tokenDe(ruta: string, formato?: string | null): string {
  return formato ? `{{ ${ruta} | ${formato} }}` : `{{ ${ruta} }}`;
}

/**
 * El diccionario ruta → etiqueta legible, para lo que el chip MUESTRA.
 *
 * Es un módulo con estado, y hay un motivo: un node view de ProseMirror se
 * construye por nodo, desde adentro de la extensión, y no recibe props de Vue.
 * La alternativa era guardar la etiqueta en un atributo del nodo, pero entonces
 * viajaría a la base y al sanitizador —que la tira— y una plantilla vieja, que
 * nunca la tuvo, seguiría mostrando la ruta pelada.
 *
 * Lo llena la pantalla apenas llega `GET /plantillas/variables`. Si no llegó,
 * el chip muestra la ruta: menos legible, pero verdad. No se inventa etiqueta.
 */
const ETIQUETAS = new Map<string, string>();

export function registrarEtiquetas(mapa: Record<string, string>): void {
  for (const [ruta, etiqueta] of Object.entries(mapa)) ETIQUETAS.set(ruta, etiqueta);
}

export function etiquetaDeRuta(ruta: string): string {
  return ETIQUETAS.get(ruta) ?? ruta;
}

/**
 * La variable, como átomo.
 *
 * `atom: true` es la línea que importa: para ProseMirror el chip no tiene
 * interior editable, así que el cursor no puede pararse adentro, Backspace lo
 * borra entero y ninguna transacción puede dejarlo partido por la mitad.
 *
 * El `{{ }}` se serializa como TEXTO adentro del span, no sólo en los
 * atributos: el motor sustituye texto, y el backend re-deriva los atributos
 * leyendo ese texto. El atributo es un caché del parser; la verdad es el token.
 */
export const VariableChip = Node.create({
  name: 'variableChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      ruta: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-var') ?? '',
        renderHTML: (attrs) => ({ 'data-var': attrs.ruta }),
      },
      formato: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-formato'),
        renderHTML: (attrs) => (attrs.formato ? { 'data-formato': attrs.formato } : {}),
      },
      /** Lo que se lee en pantalla: «Precio mensual» en vez de la ruta. */
      etiqueta: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-etiqueta'),
        // NO se serializa: es cosmética del editor y no tiene por qué viajar a
        // la base ni sobrevivir al sanitizador, que la tiraría igual.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-var]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'chip-var' }),
      tokenDe(node.attrs.ruta as string, node.attrs.formato as string | null),
    ];
  },

  /** Para copiar como texto plano y para los lectores de pantalla. */
  renderText({ node }) {
    return tokenDe(node.attrs.ruta as string, node.attrs.formato as string | null);
  },

  /**
   * Lo que se VE mientras se escribe.
   *
   * El node view manda sólo en el DOM del editor; `renderHTML()` sigue siendo
   * lo que se serializa. Gracias a eso el chip puede mostrar «Precio mensual»
   * y guardar `{{ contrato.monto }}`: quien redacta un contrato no tiene por
   * qué leer cómo se llama una columna, y el motor no tiene por qué entender
   * castellano.
   *
   * `contenteditable="false"` acompaña al `atom: true` del schema: el schema
   * impide que una transacción parta el nodo, y esto impide que el navegador
   * ponga el cursor adentro antes de que haya transacción.
   */
  addNodeView() {
    return ({ node }) => {
      const ruta = node.attrs.ruta as string;
      const formato = node.attrs.formato as string | null;
      const etiqueta = (node.attrs.etiqueta as string | null) ?? etiquetaDeRuta(ruta);

      const dom = document.createElement('span');
      dom.className = 'chip-var';
      dom.setAttribute('data-var', ruta);
      if (formato) dom.setAttribute('data-formato', formato);
      dom.setAttribute('contenteditable', 'false');
      // El lector de pantalla dice qué es y qué va a imprimir, no el token.
      dom.setAttribute(
        'aria-label',
        `Variable ${etiqueta}${formato ? `, con formato ${formato}` : ''}. ` +
        `Imprime ${tokenDe(ruta, formato)}.`,
      );
      dom.title = tokenDe(ruta, formato);
      dom.textContent = formato ? `${etiqueta} · ${formato}` : etiqueta;
      return { dom };
    };
  },
});

/**
 * El bloque de condición o de lista.
 *
 * ⚠️ Los tokens `{% si %}` y `{% fin %}` **no se serializan acá**, y eso es una
 * decisión con motivo: son un PAR que tiene que quedar balanceado a través de
 * varios párrafos, y ProseMirror no puede tener texto suelto adentro de un nodo
 * cuyo contenido es `block+` —lo envolvería en un párrafo—. Los escribe el
 * backend, en `plantillas.sanitizar.ts`, que es el único punto por donde entra
 * HTML al sistema y por lo tanto el único lugar donde el par se puede garantizar.
 *
 * Es la dirección OPUESTA a la del chip, y a propósito: en el chip manda el
 * texto, en el bloque mandan los atributos. Está escrito en los dos lados.
 */
export const BloqueEstructura = Node.create({
  name: 'bloqueEstructura',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: false,

  addAttributes() {
    return {
      bloque: {
        default: 'si',
        parseHTML: (el) => el.getAttribute('data-bloque') ?? 'si',
        renderHTML: (attrs) => ({ 'data-bloque': attrs.bloque }),
      },
      expr: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-expr'),
        renderHTML: (attrs) => (attrs.expr ? { 'data-expr': attrs.expr } : {}),
      },
      item: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-item'),
        renderHTML: (attrs) => (attrs.item ? { 'data-item': attrs.item } : {}),
      },
      lista: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-lista'),
        renderHTML: (attrs) => (attrs.lista ? { 'data-lista': attrs.lista } : {}),
      },
      etiqueta: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-etiqueta'),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bloque]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'bloque-estructura' }), 0];
  },
});

/**
 * Los tokens de estructura, fuera del HTML que va al editor.
 *
 * El backend los guarda pegados a los bordes del div; ProseMirror los leería
 * como texto suelto adentro de un nodo `block+` y los envolvería en un párrafo,
 * dejando un renglón con «{% si garantes %}» a la vista. Se sacan al cargar y
 * los vuelve a poner el backend al guardar.
 */
export function paraEditor(html: string): string {
  return String(html ?? '').replace(
    /\{%\s*(?:si\s+[\w.]+|para\s+[\w.]+\s+en\s+[\w.]+|fin)\s*%\}/g,
    '',
  );
}
