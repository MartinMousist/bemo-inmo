/**
 * De texto plano a HTML y de HTML a texto plano.
 *
 * PURO, como `ajustes`, `punitorios`, `comisiones`, `aviso`, `plantillas`,
 * `envio`, `situacion` y `telefono`: entra un string, sale un string. Sin base,
 * sin red y sin DOM — esto corre en la API, donde no hay `document`, y por eso
 * está escrito con un tokenizador propio en vez de con `innerHTML`.
 *
 * ── Por qué existen las dos direcciones ─────────────────────────────────────
 *
 * `textoAHtml()` es la migración: las plantillas nacieron en un textarea
 * monoespaciado y hay que llevarlas al editor con formato **sin cambiar una
 * palabra del texto legal**. Se corre una vez por plantilla (migración 023) y
 * en cada `seed`, porque `plantillas.defecto.ts` sigue siendo texto plano: una
 * sola fuente del texto legal, y el conversor queda probado contra las cuatro
 * plantillas reales cada vez que alguien siembra.
 *
 * `htmlATexto()` es la proyección: **el HTML no se puede medir con
 * `.length`**. `envio.motor.ts` decide `completo` vs `adjunto` por el largo del
 * texto; con las etiquetas adentro, un pre-contrato de 2.000 caracteres mide
 * 6.000 y TODO documento pasaría a «adjunto» con un motivo que cita un número
 * que no es. Nada falla: sólo empieza a mentir el cartel. La misma proyección
 * alimenta el `.txt`, el «Copiar» y el cuerpo del WhatsApp, y se expone en
 * `GET /documentos/:id/texto` para que el front no tenga una segunda
 * implementación de la misma regla.
 *
 * ── El contrato de serialización ────────────────────────────────────────────
 *
 *   · Variable:    <span data-var="contrato.monto" data-formato="moneda">{{ contrato.monto | moneda }}</span>
 *   · Condicional: <div data-bloque="si" data-expr="garantes">{% si garantes %}…{% fin %}</div>
 *   · Lista:       <div data-bloque="para" data-item="g" data-lista="garantes">{% para g en garantes %}…{% fin %}</div>
 *
 * **Los tokens de estructura van ADENTRO de su propio div, pegados a los
 * bordes.** No es cosmético: el motor borra el rango que va de `{% si %}` a
 * `{% fin %}` cuando la condición da falso. Si los tokens quedaran sueltos
 * entre párrafos, ese borrado se llevaría un `</p>` de un lado y dejaría un
 * `<p>` abierto del otro, y el documento saldría con la mitad del texto adentro
 * de una etiqueta rota. Con el div afuera y los tokens adentro, el rango
 * borrado es SIEMPRE HTML balanceado y lo que queda es un div vacío, que la
 * hoja de estilos esconde con `[data-bloque]:empty { display: none }`.
 *
 * ── Los espacios que no se pueden perder ────────────────────────────────────
 *
 * El bloque de firmas del pre-contrato está alineado a mano con espacios:
 *
 *     ________________________            ________________________
 *         {{ locador.nombre }}                {{ locatario.nombre }}
 *
 * En HTML una corrida de espacios colapsa a uno solo y las dos firmas se
 * pegarían. Por eso una corrida de N espacios se convierte en (N−1) espacios
 * duros más uno normal: el indentado se conserva y la línea todavía puede
 * cortar al final de la corrida. `htmlATexto()` los devuelve a espacios
 * normales, así que la vuelta es exacta.
 *
 * ⚠️ El espacio duro se agrega SÓLO fuera de los `{{ }}`. Un ` ` adentro
 * de un token hace que el regex del motor no matchee y que
 * `{{ contrato.monto }}` salga **literal adentro del contrato que se firma**.
 * Es el peor error posible de esta feature y ya pasó una vez en este repo con
 * la sintaxis de Handlebars del esqueleto de «Nueva plantilla».
 */

/** Los formatos que el motor conoce de verdad. Uno inventado se ignora en silencio. */
export const FORMATOS_VALIDOS = [
  'moneda', 'numero', 'fecha', 'fecha_larga', 'mayusculas', 'letras',
] as const;

/** El token de una variable, con el mismo regex que sustituye el motor. */
const VARIABLE = /\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g;

/** Apertura de estructura, igual que en `plantillas.motor.ts`. */
const APERTURA = /\{%\s*(si|para)\s+([\w.]+)(?:\s+en\s+([\w.]+))?\s*%\}/;
const CIERRE = /\{%\s*fin\s*%\}/;
/** Cualquiera de las dos, para tokenizar de una pasada. */
const ESTRUCTURA_G =
  /\{%\s*(?:(si|para)\s+([\w.]+)(?:\s+en\s+([\w.]+))?|fin)\s*%\}/g;

/**
 * El espacio duro (U+00A0).
 *
 * Se usa para conservar el indentado del bloque de firmas, que en el texto
 * plano está alineado con espacios. NUNCA adentro de un `{{ }}`: ahí rompe el
 * regex del motor y la variable sale literal en el contrato.
 */
export const NBSP = '\u00a0';

export function escaparHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Las cinco entidades que produce este módulo y las que trae sanitize-html. */
export function desescaparHtml(s: string): string {
  return String(s)
    .replace(/&nbsp;/gi, NBSP)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

// ── Texto plano → HTML ───────────────────────────────────────────────────────

type Nodo =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'bloque';
      clase: 'si' | 'para';
      /** El `si`: la expresión. El `para`: la lista. */
      expr: string;
      item?: string;
      hijos: Nodo[];
    };

/**
 * Convierte una plantilla en texto plano al HTML del editor.
 *
 * Es **idempotente para lo que importa**: correrlo sobre un texto ya convertido
 * no tiene sentido (le escaparía las etiquetas), así que el llamador filtra por
 * `contenido_formato = 'texto'`. Lo que sí es idempotente es el resultado: dos
 * corridas sobre el mismo texto dan byte por byte lo mismo.
 *
 * Lo que NO hace, y hay que decirlo: **no adivina títulos**. Una línea en
 * mayúsculas podría ser un `<h2>`, pero «PRIMERA — OBJETO.» es parte de una
 * cláusula y convertirla en título cambiaría el tamaño de letra de un contrato
 * ya firmado. Los títulos los pone la persona desde la barra del editor.
 */
export function textoAHtml(texto: string): string {
  const normalizado = String(texto ?? '').replace(/\r\n?/g, '\n');
  const arbol = parsearBloques(normalizado);
  const html = arbol.map(nodoAHtml).join('');
  // Una plantilla vacía no puede quedar como cadena vacía: el editor necesita
  // al menos un párrafo donde pararse el cursor.
  return html || '<p></p>';
}

/**
 * Arma el árbol de estructuras.
 *
 * Si los tokens no cierran —un `{% fin %}` de más, o un `{% si %}` sin cierre—
 * **no se rompe nada ni se pierde texto**: el token queda como texto literal,
 * exactamente donde estaba, y `tokensRotos()` lo denuncia para que la pantalla
 * lo diga. Comerse en silencio un token roto sería peor: la plantilla saldría
 * distinta de lo que su autor escribió y nadie se enteraría.
 */
function parsearBloques(texto: string): Nodo[] {
  const raiz: Nodo[] = [];
  const pila: Array<{ nodo: Extract<Nodo, { tipo: 'bloque' }>; padre: Nodo[] }> = [];
  let actual = raiz;
  let desde = 0;

  const empujarTexto = (t: string) => {
    if (!t) return;
    const ultimo = actual[actual.length - 1];
    if (ultimo && ultimo.tipo === 'texto') ultimo.texto += t;
    else actual.push({ tipo: 'texto', texto: t });
  };

  ESTRUCTURA_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ESTRUCTURA_G.exec(texto))) {
    empujarTexto(texto.slice(desde, m.index));
    desde = m.index + m[0].length;

    if (m[1] === 'si' || m[1] === 'para') {
      const nodo: Extract<Nodo, { tipo: 'bloque' }> = {
        tipo: 'bloque',
        clase: m[1],
        expr: m[1] === 'para' ? (m[3] ?? '') : m[2],
        ...(m[1] === 'para' ? { item: m[2] } : {}),
        hijos: [],
      };
      // Un `{% para x %}` sin `en lista` no lo entiende el motor: queda literal.
      if (m[1] === 'para' && !m[3]) {
        empujarTexto(m[0]);
        continue;
      }
      actual.push(nodo);
      pila.push({ nodo, padre: actual });
      actual = nodo.hijos;
    } else {
      const abierto = pila.pop();
      if (!abierto) {
        // Un `{% fin %}` que no cierra nada. Se deja tal cual y se denuncia.
        empujarTexto(m[0]);
        continue;
      }
      actual = abierto.padre;
    }
  }
  empujarTexto(texto.slice(desde));

  // Los que quedaron abiertos: se degradan a texto literal en su lugar, sin
  // perder el contenido que ya se les había colgado.
  while (pila.length) {
    const { nodo, padre } = pila.pop()!;
    const i = padre.indexOf(nodo);
    const literal: Nodo = {
      tipo: 'texto',
      texto:
        nodo.clase === 'si'
          ? `{% si ${nodo.expr} %}`
          : `{% para ${nodo.item} en ${nodo.expr} %}`,
    };
    padre.splice(i, 1, literal, ...nodo.hijos);
  }

  return raiz;
}

function nodoAHtml(n: Nodo): string {
  if (n.tipo === 'texto') return textoPlanoAParrafos(n.texto);

  const cuerpo = n.hijos.map(nodoAHtml).join('');
  if (n.clase === 'si') {
    return (
      `<div data-bloque="si" data-expr="${n.expr}">` +
      `{% si ${n.expr} %}${cuerpo}{% fin %}</div>`
    );
  }
  return (
    `<div data-bloque="para" data-item="${n.item}" data-lista="${n.expr}">` +
    `{% para ${n.item} en ${n.expr} %}${cuerpo}{% fin %}</div>`
  );
}

/** El prefijo de viñeta que usan las plantillas base: dos espacios, punto medio. */
const VINETA = /^[ \t]*·[ \t]+/;

function textoPlanoAParrafos(texto: string): string {
  const salida: string[] = [];
  // Un párrafo por corrida de líneas; una línea en blanco los separa.
  for (const trozo of texto.split(/\n[ \t]*\n/)) {
    const lineas = trozo.split('\n');
    // Un trozo que es sólo espacios entre dos bloques no genera un párrafo
    // vacío: sería una línea en blanco de más en el contrato.
    if (!lineas.some((l) => l.trim() !== '')) continue;

    let i = 0;
    let corrida: string[] = [];
    const cerrarCorrida = () => {
      if (!corrida.length) return;
      salida.push(`<p>${corrida.join('<br>')}</p>`);
      corrida = [];
    };

    while (i < lineas.length) {
      if (VINETA.test(lineas[i])) {
        cerrarCorrida();
        const items: string[] = [];
        while (i < lineas.length && VINETA.test(lineas[i])) {
          items.push(`<li>${lineaAHtml(lineas[i].replace(VINETA, ''))}</li>`);
          i++;
        }
        salida.push(`<ul>${items.join('')}</ul>`);
        continue;
      }
      // Una línea vacía al final del trozo no aporta: el `<p>` ya corta.
      if (lineas[i].trim() === '' && (i === 0 || i === lineas.length - 1)) {
        i++;
        continue;
      }
      corrida.push(lineaAHtml(lineas[i]));
      i++;
    }
    cerrarCorrida();
  }
  return salida.join('');
}

/**
 * Una línea: se escapa, se salvan los espacios de alineación y los `{{ }}` se
 * envuelven en su chip.
 *
 * El orden es el diseño. Se parte primero por los tokens de variable para que
 * el paso de espacios duros **no pueda tocar el interior de un `{{ }}`**.
 */
function lineaAHtml(linea: string): string {
  let salida = '';
  let desde = 0;
  VARIABLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VARIABLE.exec(linea))) {
    salida += textoSuelto(linea.slice(desde, m.index));
    salida += chip(m[1], m[2]);
    desde = m.index + m[0].length;
  }
  salida += textoSuelto(linea.slice(desde));
  return salida;
}

function textoSuelto(s: string): string {
  // Escapar primero: si no, un `<` del texto legal abriría una etiqueta.
  const escapado = escaparHtml(s);
  // Corrida de N espacios → (N−1) duros + 1 normal, para que la línea siga
  // pudiendo cortar ahí. Con N duros el párrafo no envuelve nunca.
  return escapado.replace(/ {2,}/g, (run) => NBSP.repeat(run.length - 1) + ' ');
}

export function chip(ruta: string, formato?: string): string {
  const f = formato && (FORMATOS_VALIDOS as readonly string[]).includes(formato)
    ? formato
    : undefined;
  const token = f ? `{{ ${ruta} | ${f} }}` : `{{ ${ruta} }}`;
  const attrFormato = f ? ` data-formato="${f}"` : '';
  return `<span data-var="${ruta}"${attrFormato}>${token}</span>`;
}

// ── HTML → texto plano ───────────────────────────────────────────────────────

/**
 * La proyección a texto plano.
 *
 * Es lo que se mide, lo que baja como `.txt`, lo que se copia y lo que viaja en
 * el cuerpo de un WhatsApp. **No es una previsualización**: es el documento
 * dicho sin formato, y por eso las viñetas vuelven a ser `  · `, que es como
 * estaban escritas antes de que existiera el editor.
 */
export function htmlATexto(html: string): string {
  let t = String(html ?? '');

  // Con su contenido: un `<script>` que se hubiera filtrado no puede aportar
  // texto al cuerpo de un mensaje.
  t = t.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');

  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<hr\s*\/?>/gi, '\n————————————————————\n');
  t = t.replace(/<li\b[^>]*>/gi, '\n  · ');
  t = t.replace(/<\/li\s*>/gi, '');
  t = t.replace(/<\/(p|h[1-6]|blockquote|ul|ol|div)\s*>/gi, '\n\n');
  t = t.replace(/<[^>]*>/g, '');

  t = desescaparHtml(t);
  t = t.replace(/\u00a0/g, ' ');

  // Espacios al final de línea: los deja el `<br>` después de un espacio duro.
  t = t.replace(/[ \t]+$/gm, '');
  // Tres saltos o más son siempre una etiqueta de cierre que se sumó a otra.
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

/**
 * Saca el andamiaje del editor de un documento YA RENDERIZADO.
 *
 * Un documento generado no tiene estructura que resolver —el motor ya la
 * resolvió— así que los `<div data-bloque>` vacíos y los `<span data-var>` con
 * el valor adentro son ruido que después se edita a mano. Se desenvuelven: el
 * contenido queda, el andamio se va.
 *
 * Va SÓLO en el camino del documento, nunca en el de la plantilla: en la
 * plantilla esos atributos son el modelo.
 */
export function aplanarDocumento(html: string): string {
  let t = String(html ?? '');
  // Los bloques que quedaron vacíos —la condición dio falso— desaparecen
  // enteros. Si quedaran, el documento tendría un hueco invisible que alguien
  // va a intentar borrar con el teclado sin conseguirlo.
  let antes = '';
  while (antes !== t) {
    antes = t;
    t = t.replace(/<div data-bloque="[^"]*"[^>]*>\s*<\/div>/g, '');
  }
  // ⚠️ Se sacan TODOS los `<div>`, no sólo los `[data-bloque]`, y el `</div>` de
  // abajo es el motivo: saca todos los cierres. Sacando sólo las aperturas de
  // bloque, un `<div>` común —que la lista blanca del sanitizador deja pasar y
  // que un PUT hecho a mano puede meter— se quedaba SIN su cierre, y el
  // documento salía con un div abierto que se tragaba el resto del papel dentro
  // suyo en el `v-html` de la vista imprimible. Un div no aporta nada a un
  // documento ya renderizado: el contenido queda, la caja se va.
  t = t.replace(/<div\b[^>]*>/gi, '').replace(/<\/div\s*>/gi, '');
  t = t.replace(/<span data-var="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, '$1');
  return t;
}

// ── Tokens rotos ─────────────────────────────────────────────────────────────

export interface TokenRoto {
  /** El texto tal cual quedó en la plantilla. Se muestra entre comillas. */
  token: string;
  motivo: string;
}

/**
 * Los tokens que el motor NO va a entender y que por lo tanto se imprimen
 * literales adentro del contrato.
 *
 * Es la red que atrapa el peor error de esta feature. Tres formas de llegar
 * acá: Word parte un `{{ contrato.monto }}` en dos spans por una marca de
 * revisión, alguien mete un `&nbsp;` entre las llaves, o un `PUT` hecho a mano
 * desde afuera de la pantalla. En los tres casos el token deja de matchear el
 * regex del motor, no figura como variable faltante y sale impreso tal cual.
 */
export function tokensRotos(contenido: string): TokenRoto[] {
  const texto = String(contenido ?? '');
  const rotos: TokenRoto[] = [];

  // Un `{{` que no cierra, o que cierra con algo que el motor no acepta.
  for (const m of texto.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const cuerpo = m[1];
    if (/^\s*[\w.]+\s*(?:\|\s*\w+\s*)?$/.test(cuerpo)) {
      const formato = /\|\s*(\w+)/.exec(cuerpo)?.[1];
      if (formato && !(FORMATOS_VALIDOS as readonly string[]).includes(formato)) {
        rotos.push({
          token: m[0],
          motivo:
            `El formato «${formato}» no existe. El motor lo ignora y el documento ` +
            `imprime el valor sin formato. Los que hay: ${FORMATOS_VALIDOS.join(', ')}.`,
        });
      }
      continue;
    }
    rotos.push({
      token: m[0],
      motivo:
        'No tiene la forma de una variable. Va a salir impreso tal cual adentro ' +
        'del documento. Borralo e insertalo de nuevo desde «Insertar variable».',
    });
  }

  // Llaves abiertas sin cerrar. Se busca sobre el texto sin los tokens buenos.
  const sinTokens = texto.replace(/\{\{[^{}]*\}\}/g, '');
  if (sinTokens.includes('{{')) {
    rotos.push({
      token: '{{',
      motivo:
        'Quedaron llaves abiertas sin su cierre. Lo que sigue se imprime tal ' +
        'cual hasta el final del documento.',
    });
  }

  // Tokens de estructura sueltos: los que NO están pegados al borde de su
  // <div data-bloque>. Sueltos entre párrafos, el borrado de un condicional en
  // falso parte el HTML al medio.
  const sinBloques = texto.replace(
    /<div data-bloque="[^"]*"[^>]*>\{%[^%]*%\}/g, '',
  ).replace(/\{%\s*fin\s*%\}<\/div>/g, '');
  for (const m of sinBloques.matchAll(/\{%[^%]*%\}/g)) {
    rotos.push({
      token: m[0],
      motivo:
        'Es un token de estructura suelto, fuera de su bloque. Insertá la ' +
        'condición o la lista desde la barra del editor: así el bloque queda ' +
        'entero y el documento no sale partido.',
    });
  }

  return rotos;
}

/** Sólo para los tests y los avisos: ¿este contenido es HTML del editor? */
export function pareceHtml(contenido: string): boolean {
  return /<(p|div|ul|ol|h[1-6]|br|span|blockquote)\b/i.test(String(contenido ?? ''));
}

export { APERTURA as APERTURA_ESTRUCTURA, CIERRE as CIERRE_ESTRUCTURA };
