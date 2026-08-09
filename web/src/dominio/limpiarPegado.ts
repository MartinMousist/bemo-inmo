/**
 * Limpieza del HTML que llega del portapapeles.
 *
 * PURO y con fixtures de portapapeles real: entra el `text/html` que Word puso
 * en el clipboard, sale el HTML mínimo que el editor entiende. Se engancha en
 * `transformPastedHTML` de ProseMirror, o sea ANTES de que el schema valide.
 *
 * ── Por qué esto es una función aparte y testeada ───────────────────────────
 *
 * Porque es la parte que se rompe en los bordes y no hay forma de saberlo
 * mirando el código: lo que Word pone en el portapapeles no se parece a lo que
 * uno imagina. Tres carillas de un `.docx` son ~400 KB de HTML con una hoja de
 * estilos entera, comentarios condicionales de Office, elementos con namespace
 * `o:` y `w:`, y un `<span>` con un identificador de revisión cada dos palabras.
 *
 * ── EL ORDEN DE LOS PASOS ES EL DISEÑO ──────────────────────────────────────
 *
 * Dos dependencias que no son opinables:
 *
 * · Los `mso-list` se leen **antes** de tirar los `style`. Son el único lugar
 *   donde vive el nivel de anidado de una viñeta de Word; si se tiran los
 *   estilos primero, tres niveles de lista se aplanan a uno y no hay forma de
 *   recuperarlos.
 *
 * · Los `{{ }}` se buscan **después** de desenvolver los spans y fusionar el
 *   texto. Word parte `{{ contrato.monto }}` en varios spans por marcas de
 *   revisión y por el corrector ortográfico; si el chip se arma antes, la
 *   variable queda como texto muerto que el motor nunca sustituye y que sale
 *   **literal adentro del contrato que se firma**.
 */

export interface ResultadoPegado {
  html: string;
  /**
   * Lo que hay que decirle a la persona. No es cortesía: si alguien pega un
   * cuadro de vencimientos y nadie le avisa que se aplanó, firma un contrato al
   * que le falta la grilla.
   */
  avisos: string[];
}

const FORMATOS_VALIDOS = ['moneda', 'numero', 'fecha', 'fecha_larga', 'mayusculas', 'letras'];

export function limpiarPegado(sucio: string): ResultadoPegado {
  const avisos: string[] = [];
  let h = String(sucio ?? '');

  // ── 0 · Copiar y pegar ADENTRO del editor no se limpia ────────────────────
  //
  // ProseMirror marca su propio portapapeles con `data-pm-slice`. Ese HTML ya
  // está en el formato del schema —con los `data-bloque` y los `data-var`
  // puestos— y pasarlo por la limpieza de Word le sacaría el andamio: mover una
  // cláusula condicional de lugar la convertiría en texto suelto.
  if (h.includes('data-pm-slice')) return { html: h, avisos };

  // ── 1 · Los comentarios y el fragmento ────────────────────────────────────
  //
  // Word marca con `StartFragment`/`EndFragment` el pedazo que se seleccionó de
  // verdad. Todo lo de afuera es andamiaje del portapapeles: si no se recorta,
  // se pega el `<head>` entero del documento.
  const desde = h.indexOf('<!--StartFragment-->');
  const hasta = h.indexOf('<!--EndFragment-->');
  if (desde !== -1 && hasta > desde) {
    h = h.slice(desde + '<!--StartFragment-->'.length, hasta);
  }
  // Los condicionales de Office (`<!--[if gte mso 9]>…<![endif]-->`) traen
  // adentro un bloque `<xml>` con la configuración del documento.
  h = h.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  h = h.replace(/<!--[\s\S]*?-->/g, '');

  // ── 2 · Las hojas de estilo y los metadatos, con su contenido ─────────────
  if (/<table[\s>]/i.test(h)) {
    avisos.push(
      'Lo que pegaste traía una tabla y se pegó como párrafos: las tablas están ' +
      'en desarrollo. Hoy el editor no las tiene porque una tabla en un contrato ' +
      'necesita comportarse bien al imprimir y al cortar de página, y a medias es ' +
      'peor que no tenerla. Revisá que no falte nada del cuadro.',
    );
  }
  h = h.replace(/<(style|script|title|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  h = h.replace(/<(meta|link)\b[^>]*\/?>/gi, '');

  // ── 3 · Los elementos con namespace de Office ────────────────────────────
  h = h.replace(/<\/?[a-z]+:[^>]*>/gi, '');

  // ── 4 · Las listas de Word, ANTES de tirar los estilos ───────────────────
  const conListas = reconstruirListas(h);
  h = conListas.html;
  if (conListas.reconstruidas) {
    // No es un aviso de error: es para que quien pega entienda por qué las
    // viñetas se ven distintas de las de su Word.
    avisos.push(
      `Se rearmaron ${conListas.reconstruidas} viñeta(s) como lista de verdad. ` +
      'En Word cada viñeta es un párrafo con un dibujito adelante; acá son una ' +
      'lista, que es lo que se imprime y se numera bien.',
    );
  }

  // ── 5 · Fuera todos los atributos de presentación ────────────────────────
  //
  // Cero estilo en línea: la tipografía de un contrato la fija `DESIGN.md`. Si
  // se dejara pasar `style`, tres carillas pegadas de un `.docx` traerían
  // Calibri 11 y el documento saldría con la letra de otra inmobiliaria.
  h = h.replace(/\s(?:style|class|lang|dir|align|width|height|id|face|color|size|start|type)\s*=\s*"[^"]*"/gi, '');
  h = h.replace(/\s(?:style|class|lang|dir|align|width|height|id|face|color|size|start|type)\s*=\s*'[^']*'/gi, '');
  h = h.replace(/\s(?:style|class|lang|dir|align|width|height|id)\s*=\s*[^\s>]+/gi, '');

  // ── 6 · Desenvolver los spans que quedaron pelados ───────────────────────
  //
  // Éste es el paso que junta el texto que Word partió. Sin él, el `{{ }}` de
  // abajo no encuentra nada.
  h = h.replace(/<span\s*>/gi, '').replace(/<\/span\s*>/gi, '');
  h = h.replace(/<\/?(?:o|w|v|st1|font|div)\s*>/gi, '');

  // ── 7 · Espacios ─────────────────────────────────────────────────────────
  h = h.replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ');
  // Word cierra cada párrafo con un `<br>` de más y a veces con dos.
  h = h.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  h = h.replace(/(<\/p>)\s*(?:<br\s*\/?>\s*)+/gi, '$1');
  h = h.replace(/<p>\s*<\/p>/gi, '');

  // ── 8 · Recién ahora, los chips ──────────────────────────────────────────
  const conChips = envolverVariables(h);
  h = conChips.html;
  if (conChips.rotos) {
    avisos.push(
      `Quedaron ${conChips.rotos} llave(s) sin cerrar en lo pegado. Eso se ` +
      'imprime tal cual adentro del documento: buscalas y volvé a insertar la ' +
      'variable desde «Insertar variable».',
    );
  }

  // ── 9 · Lo que sobreviva lo filtra el schema de ProseMirror ──────────────
  return { html: h.trim(), avisos };
}

// ── Listas de Word ───────────────────────────────────────────────────────────

/**
 * Reconstruye las listas de Word leyendo `mso-list`.
 *
 * Word no pega `<ul>`: pega párrafos con `style="mso-list:l0 level2 lfo1"` y un
 * `<span style="mso-list:Ignore">·</span>` adelante, que es el glifo de la
 * viñeta dibujado a mano. Ese glifo hay que tirarlo o queda un «·» de texto
 * delante de cada ítem.
 *
 * El nivel sale de `levelN`. El tipo —viñeta o número— se decide por el
 * marcador: si empieza con `1.` o `1)` es una lista ordenada.
 */
function reconstruirListas(html: string): { html: string; reconstruidas: number } {
  const parrafo = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi;
  const partes: string[] = [];
  let reconstruidas = 0;
  let desde = 0;
  /** La pila de listas abiertas, una por nivel. */
  let abiertas: Array<'ul' | 'ol'> = [];

  const cerrarHasta = (nivel: number) => {
    while (abiertas.length > nivel) partes.push(`</${abiertas.pop()}>`);
  };

  /**
   * El texto entre dos párrafos.
   *
   * Con una lista abierta, los saltos de línea que Word deja entre `</p>` y
   * `<p>` caerían ENTRE los `<li>`, que es un lugar donde no puede haber texto:
   * quedan como espacio suelto arriba del `</ul>`. Si es sólo espacio, se tira.
   */
  const entre = (t: string) => {
    if (abiertas.length && !t.trim()) return;
    partes.push(t);
  };

  let m: RegExpExecArray | null;
  while ((m = parrafo.exec(html))) {
    const atributos = m[1] ?? '';
    const cuerpo = m[2] ?? '';
    const lista = /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(atributos);

    if (!lista) {
      entre(html.slice(desde, m.index));
      cerrarHasta(0);
      partes.push(m[0]);
      desde = m.index + m[0].length;
      continue;
    }

    entre(html.slice(desde, m.index));
    desde = m.index + m[0].length;

    const nivel = Math.max(1, Math.min(3, Number(lista[1]) || 1));

    // El glifo dibujado a mano: `mso-list:Ignore` es exactamente eso.
    const glifo = /<span[^>]*mso-list\s*:\s*Ignore[^>]*>([\s\S]*?)<\/span\s*>/i.exec(cuerpo);
    const marcador = glifo ? textoPelado(glifo[1]) : '';
    const tipo: 'ul' | 'ol' = /^\s*(?:\d+|[a-z]|[ivx]+)\s*[.)]/i.test(marcador) ? 'ol' : 'ul';

    let contenido = cuerpo.replace(
      /<span[^>]*mso-list\s*:\s*Ignore[^>]*>[\s\S]*?<\/span\s*>/gi, '',
    );
    contenido = contenido.replace(/^(?:\s|&nbsp;|<br\s*\/?>)+/i, '');

    cerrarHasta(nivel);
    while (abiertas.length < nivel) {
      abiertas.push(tipo);
      partes.push(`<${tipo}>`);
    }
    // Un nivel que cambia de viñeta a número: se cierra y se reabre.
    if (abiertas[nivel - 1] !== tipo) {
      partes.push(`</${abiertas.pop()}>`);
      abiertas.push(tipo);
      partes.push(`<${tipo}>`);
    }
    partes.push(`<li>${contenido}</li>`);
    reconstruidas++;
  }

  entre(html.slice(desde));
  cerrarHasta(0);
  return { html: partes.join(''), reconstruidas };
}

function textoPelado(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ').trim();
}

// ── Variables ────────────────────────────────────────────────────────────────

/**
 * Envuelve los `{{ }}` en su chip.
 *
 * Corre al final a propósito: para acá, los spans de revisión de Word ya no
 * están y `{{ contrato.` + `monto }}` volvió a ser un solo nodo de texto.
 *
 * Sólo mira los `{{ }}` que están FUERA de una etiqueta: buscarlos sobre el
 * HTML crudo haría que un atributo que contenga llaves se convierta en chip.
 */
export function envolverVariables(html: string): { html: string; rotos: number } {
  let rotos = 0;
  const salida = html.replace(/(<[^>]*>)|(\{\{[^{}]*\}\})/g, (_todo, etiqueta, token) => {
    if (etiqueta) return etiqueta;
    const limpio = String(token).replace(/\s+/g, ' ').trim();
    const m = /^\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}$/.exec(limpio);
    if (!m) return token;
    const formato = m[2] && FORMATOS_VALIDOS.includes(m[2]) ? m[2] : undefined;
    const texto = formato ? `{{ ${m[1]} | ${formato} }}` : `{{ ${m[1]} }}`;
    const attr = formato ? ` data-formato="${formato}"` : '';
    return `<span data-var="${m[1]}"${attr}>${texto}</span>`;
  });

  // Llaves que quedaron abiertas: se cuentan sobre el texto sin los tokens ya
  // resueltos, para no contar dos veces las de un chip.
  const sinTokens = salida.replace(/\{\{[^{}]*\}\}/g, '');
  rotos = (sinTokens.match(/\{\{/g) ?? []).length;
  return { html: salida, rotos };
}
