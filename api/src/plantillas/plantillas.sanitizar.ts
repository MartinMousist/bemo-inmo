import sanitizeHtml from 'sanitize-html';
import {
  FORMATOS_VALIDOS, NBSP, chip, desescaparHtml, escaparHtml,
} from './plantillas.html';

/**
 * El ÚNICO punto por donde entra HTML al sistema.
 *
 * ── Por qué acá y no en el editor ───────────────────────────────────────────
 *
 * Porque el editor **no es una frontera de seguridad**. `PUT /v1/plantillas`
 * acepta un body con `contenido`; nada obliga a que ese body haya pasado por
 * TipTap. Un `curl` con la sesión de un titular escribe lo que quiera, y lo que
 * quede guardado se sirve después a un `v-html` en la vista imprimible. Por eso
 * el sanitizado vive en `guardar()`, en `previsualizar()` —que también devuelve
 * HTML para un `v-html`— y en `crear()`/`actualizar()` de documentos.
 *
 * ── La lista blanca es CERRADA ──────────────────────────────────────────────
 *
 * Sin `style`, sin `class`, sin `id`, sin `href` y con `allowedSchemes: []`. La
 * tipografía de un contrato la fija `DESIGN.md`, no el que pega desde Word: si
 * se dejara pasar `style`, tres carillas pegadas de un `.docx` traerían Calibri
 * 11 y el documento saldría con la letra de otra inmobiliaria. Y sin `href` no
 * hay `javascript:` que discutir.
 *
 * `<script>` cae entero **con su texto**: está en los `nonTextTags` por defecto
 * de sanitize-html, así que no queda el código suelto como contenido.
 *
 * ── El agujero que el sanitizador NO tapa ───────────────────────────────────
 *
 * Éste es el importante y no es el `<script>` pegado. La plantilla queda
 * limpia, pero el motor sustituye `{{ locatario.nombre }}` por un valor que
 * **cargó un usuario**: una persona apellidada `<img src=x onerror=…>` inyecta
 * su etiqueta DESPUÉS del sanitizado, y el resultado termina en un `v-html`.
 * Es XSS almacenado por la puerta de al lado. Lo tapa
 * `renderizar(…, { escaparHtml: true })` en el motor, que escapa el valor ya
 * formateado. Si ese paso se saltea, la feature entra con un XSS del que nadie
 * se entera hasta que alguien carga un inquilino con el apellido raro.
 */

/**
 * Las etiquetas que sobreviven.
 *
 * Sin `<a>` y sin tablas en v1, a propósito y dicho en pantalla: una tabla
 * pegada de Word se aplana a párrafos y el editor lo avisa. Prometer una grilla
 * que no existe es lo que la regla de honestidad de este producto prohíbe.
 */
const ETIQUETAS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'span', 'div', 'sup', 'sub',
];

const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: ETIQUETAS,
  allowedAttributes: {
    span: ['data-var', 'data-formato'],
    div: ['data-bloque', 'data-expr', 'data-item', 'data-lista'],
    '*': [],
  },
  // Ni un esquema: no hay atributo que lleve URL en la lista blanca, y dejar
  // `http` habilitado sería dejar preparada la puerta para el día que alguien
  // agregue `<a>` sin acordarse de esto.
  allowedSchemes: [],
  allowedSchemesByTag: {},
  // Corta en `</html>`: sin esto, lo que viene después de un `</html>` pegado
  // se procesa igual y es un lugar clásico donde esconder carga.
  enforceHtmlBoundary: true,
  disallowedTagsMode: 'discard',
};

/**
 * Limpia y canonicaliza el HTML de una plantilla.
 *
 * Devuelve también los avisos que la pantalla tiene que mostrar: un chip que se
 * partió y quedó como texto, o un formato inventado que se cayó, son cosas que
 * el usuario tiene que ver — arreglarlas en silencio deja una plantilla
 * distinta de la que escribió sin decírselo.
 */
export interface ResultadoSanitizado {
  html: string;
  avisos: string[];
}

export function sanitizarPlantilla(sucio: string): ResultadoSanitizado {
  const limpio = sanitizeHtml(String(sucio ?? ''), OPCIONES);
  return canonicalizar(limpio);
}

/**
 * Lo mismo para un documento generado.
 *
 * Es el mismo sanitizador: un documento se edita en el mismo editor y se
 * guarda por el mismo tipo de PUT. La diferencia está afuera —el documento ya
 * viene aplanado, sin bloques ni chips— y no en la lista blanca: dos listas
 * blancas distintas es una que se olvida de actualizar.
 */
export function sanitizarDocumento(sucio: string): string {
  return sanitizarPlantilla(sucio).html;
}

// ── Canonicalización ─────────────────────────────────────────────────────────

/**
 * Después del sanitizado, los atributos del editor tienen que decir la verdad.
 *
 * **Dos direcciones distintas, y cada una tiene su motivo:**
 *
 * · En un `[data-var]` **manda el TEXTO**: `data-var` y `data-formato` se
 *   re-derivan leyendo el `{{ }}` de adentro. Es lo que hace que una plantilla
 *   vieja en texto plano, o un `PUT` escrito a mano con un `{{ x }}` suelto, se
 *   conviertan solos en chips. Si el texto de adentro no es un token que el
 *   motor entienda, se tira el span y queda el texto pelado: un chip que
 *   miente sobre lo que va a sustituir es peor que no tener chip.
 *
 * · En un `[data-bloque]` mandan los ATRIBUTOS: los `{% si %}` y `{% fin %}` se
 *   vuelven a escribir pegados a los bordes del div. Acá no puede mandar el
 *   texto porque el token es un PAR que tiene que quedar balanceado a través de
 *   varios párrafos, y no hay forma de sostener eso desde adentro del texto.
 *   El editor ni siquiera manda los tokens: los pone este paso, que es el único
 *   lugar donde el par se escribe.
 */
function canonicalizar(html: string): ResultadoSanitizado {
  const avisos: string[] = [];
  const partes = tokenizar(html);
  const salida: string[] = [];

  /** Los divs de bloque abiertos, para saber si un `{% %}` de texto es de borde. */
  const pila: Array<{ cierre: string | null }> = [];

  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];

    if (p.tipo === 'texto') {
      // Adentro de un bloque, los tokens de estructura de borde los pone este
      // paso: los que vengan en el texto se descartan para no duplicarlos.
      const sinEstructura = p.valor.replace(
        /\{%\s*(?:si\s+[\w.]+|para\s+[\w.]+\s+en\s+[\w.]+|fin)\s*%\}/g, '',
      );
      salida.push(chipsDelTexto(sinEstructura, avisos));
      continue;
    }

    if (p.tipo === 'cierre') {
      if (p.nombre === 'div') {
        const abierto = pila.pop();
        if (abierto?.cierre) salida.push(abierto.cierre);
      }
      salida.push(`</${p.nombre}>`);
      continue;
    }

    // Apertura.
    if (p.nombre === 'span') {
      const ruta = p.attrs['data-var'];
      const cerrado = buscarCierre(partes, i, 'span');
      if (ruta !== undefined && cerrado > i) {
        const interior = partes.slice(i + 1, cerrado)
          .map((x) => (x.tipo === 'texto' ? x.valor : ''))
          .join('');
        const token = normalizarToken(interior);
        const m = /^\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}$/.exec(token);
        if (!m) {
          // El chip se partió: Word mete marcas de revisión adentro del
          // `{{ }}`, o alguien escribió encima. Se tira el span y queda el
          // texto, que es exactamente lo que la persona ve en pantalla.
          avisos.push(
            `Una variable quedó partida y volvió a ser texto: «${recortar(token)}». ` +
            'Borrala e insertala de nuevo desde «Insertar variable».',
          );
          salida.push(escaparHtml(token));
          i = cerrado;
          continue;
        }
        const formato = m[2];
        if (formato && !(FORMATOS_VALIDOS as readonly string[]).includes(formato)) {
          avisos.push(avisoDeFormato(formato, m[1]));
        }
        salida.push(chip(m[1], formato));
        i = cerrado;
        continue;
      }
      // Un span sin `data-var` no aporta nada: se desenvuelve.
      if (cerrado > i) {
        // Se deja pasar el contenido; la etiqueta de cierre se saltea abajo.
        partes[cerrado] = { tipo: 'texto', valor: '' };
      }
      continue;
    }

    if (p.nombre === 'div') {
      const bloque = p.attrs['data-bloque'];
      if (bloque === 'si' && ruta(p.attrs['data-expr'])) {
        const expr = p.attrs['data-expr']!;
        salida.push(`<div data-bloque="si" data-expr="${expr}">{% si ${expr} %}`);
        pila.push({ cierre: '{% fin %}' });
        continue;
      }
      if (bloque === 'para' && ruta(p.attrs['data-item']) && ruta(p.attrs['data-lista'])) {
        const item = p.attrs['data-item']!;
        const lista = p.attrs['data-lista']!;
        salida.push(
          `<div data-bloque="para" data-item="${item}" data-lista="${lista}">` +
          `{% para ${item} en ${lista} %}`,
        );
        pila.push({ cierre: '{% fin %}' });
        continue;
      }
      if (bloque !== undefined) {
        avisos.push(
          'Un bloque de condición o de lista tenía datos que el motor no entiende ' +
          'y se convirtió en texto común. Volvé a insertarlo desde la barra.',
        );
      }
      // Un div común: se conserva la etiqueta pero sin atributos. No se
      // desenvuelve porque el cierre ya está balanceado por sanitize-html.
      salida.push('<div>');
      pila.push({ cierre: null });
      continue;
    }

    // El resto de la lista blanca no lleva atributos: sale la etiqueta pelada.
    salida.push(`<${p.nombre}>`);
  }

  return { html: salida.join(''), avisos: [...new Set(avisos)] };
}

/**
 * Un `{{ }}` escrito a mano, fuera de todo chip, se convierte solo.
 *
 * Es la mitad que falta de «el texto es la verdad»: una plantilla vieja en
 * texto plano, un `PUT` hecho con `curl` o alguien que se acuerda de la
 * sintaxis y la teclea, todos terminan con el mismo chip que si lo hubieran
 * insertado desde el menú. Lo que NO matchea se deja intacto y lo denuncia
 * `tokensRotos()`: reescribirlo a la fuerza sería adivinar qué quiso decir.
 */
function chipsDelTexto(texto: string, avisos: string[]): string {
  return texto.replace(/\{\{[^{}]*\}\}/g, (crudo) => {
    const m = /^\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}$/.exec(normalizarToken(crudo));
    if (!m) return crudo;
    if (m[2] && !(FORMATOS_VALIDOS as readonly string[]).includes(m[2])) {
      avisos.push(avisoDeFormato(m[2], m[1]));
    }
    return chip(m[1], m[2]);
  });
}

/** Un solo texto para el formato inventado: se dice igual venga por donde venga. */
function avisoDeFormato(formato: string, ruta: string): string {
  return (
    `El formato «${formato}» no existe y se sacó de «${ruta}»: el motor lo ` +
    `ignoraría en silencio e imprimiría el valor crudo. Los que hay: ` +
    `${FORMATOS_VALIDOS.join(', ')}.`
  );
}

function ruta(v: string | undefined): boolean {
  return typeof v === 'string' && /^[\w.]+$/.test(v);
}

function recortar(s: string): string {
  const t = s.trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/**
 * El interior de un chip, listo para comparar contra el regex del motor.
 *
 * Los `&nbsp;` y los espacios duros de Word adentro de las llaves son la forma
 * más común de romper un token sin que se note: en pantalla se ve
 * `{{ contrato.monto }}` idéntico, y el motor no lo matchea. Acá se normalizan
 * a espacio común ANTES de comparar, así el chip se salva en vez de perderse.
 */
function normalizarToken(interior: string): string {
  return desescaparHtml(interior)
    .replace(new RegExp(NBSP, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buscarCierre(partes: Parte[], desde: number, nombre: string): number {
  let nivel = 0;
  for (let i = desde + 1; i < partes.length; i++) {
    const p = partes[i];
    if (p.tipo === 'apertura' && p.nombre === nombre && !p.auto) nivel++;
    else if (p.tipo === 'cierre' && p.nombre === nombre) {
      if (nivel === 0) return i;
      nivel--;
    }
  }
  return -1;
}

// ── Tokenizador ──────────────────────────────────────────────────────────────

type Parte =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'apertura'; nombre: string; attrs: Record<string, string>; auto: boolean }
  | { tipo: 'cierre'; nombre: string };

/**
 * Parte el HTML en etiquetas y texto.
 *
 * Vale la pena decir por qué es seguro un tokenizador de veinte líneas acá y no
 * lo sería en cualquier otro lado: **esto corre DESPUÉS de sanitize-html**, o
 * sea sobre marcado que ya está balanceado, sin comentarios, sin CDATA y con
 * una lista blanca de diecinueve etiquetas. No es un parser de HTML de
 * internet: es un recorrido sobre una salida conocida.
 */
function tokenizar(html: string): Parte[] {
  const partes: Parte[] = [];
  const re = /<(\/?)([a-z0-9]+)((?:\s+[^<>]*?)?)\s*(\/?)>/gi;
  let desde = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    if (m.index > desde) partes.push({ tipo: 'texto', valor: html.slice(desde, m.index) });
    desde = m.index + m[0].length;

    const nombre = m[2].toLowerCase();
    if (m[1] === '/') {
      partes.push({ tipo: 'cierre', nombre });
      continue;
    }
    partes.push({
      tipo: 'apertura',
      nombre,
      attrs: atributos(m[3] ?? ''),
      auto: m[4] === '/' || nombre === 'br' || nombre === 'hr',
    });
  }
  if (desde < html.length) partes.push({ tipo: 'texto', valor: html.slice(desde) });
  return partes;
}

function atributos(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z0-9-]+)\s*=\s*"([^"]*)"/gi)) {
    out[m[1].toLowerCase()] = desescaparHtml(m[2]);
  }
  return out;
}
