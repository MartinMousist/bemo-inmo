/**
 * Motor de plantillas. Puro: entra una plantilla y un contexto, sale el texto.
 *
 * Deliberadamente **no** es un lenguaje de programación. Soporta variables,
 * condicionales simples y listas, y nada más. Una plantilla de contrato la
 * edita el titular de la inmobiliaria desde un textarea: si el motor pudiera
 * ejecutar código arbitrario, ese textarea sería una consola con los permisos
 * del servidor.
 *
 *   {{ contrato.monto }}                    variable
 *   {{ contrato.monto | moneda }}           con formato
 *   {% si garantes %}…{% fin %}             condicional
 *   {% para g en garantes %}…{% fin %}      lista
 */

export type Contexto = Record<string, unknown>;

export interface ResultadoPlantilla {
  texto: string;
  /** Variables que la plantilla pidió y el contexto no tenía. */
  faltantes: string[];
}

const FORMATOS: Record<string, (v: unknown, ctx: Contexto) => string> = {
  moneda: (v, ctx) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const m = typeof ctx.moneda === 'string' ? ctx.moneda : 'ARS';
    return `${m} ${n.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  },
  numero: (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('es-AR') : '—';
  },
  fecha: (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  },
  fecha_larga: (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
    if (!m) return '—';
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    return `${Number(m[3])} de ${meses[Number(m[2]) - 1]} de ${m[1]}`;
  },
  mayusculas: (v) => String(v ?? '').toUpperCase(),
  /** Monto en letras: en un contrato el número va acompañado de su texto. */
  letras: (v) => enLetras(Math.floor(Number(v) || 0)),
};

export function renderizar(plantilla: string, contexto: Contexto): ResultadoPlantilla {
  const faltantes = new Set<string>();
  const texto = bloque(plantilla, contexto, faltantes);
  return { texto, faltantes: [...faltantes] };
}

/** Resuelve un bloque: primero las estructuras, después las variables. */
function bloque(txt: string, ctx: Contexto, faltantes: Set<string>): string {
  let salida = estructuras(txt, ctx, faltantes);

  salida = salida.replace(
    /\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g,
    (_, ruta: string, formato?: string) => {
      const v = leer(ctx, ruta);
      if (v === undefined || v === null || v === '') {
        faltantes.add(ruta);
        // Un hueco visible es mejor que un vacío silencioso: en un contrato,
        // que falte un dato tiene que saltar a la vista antes de firmarlo.
        return `«${ruta}»`;
      }
      return formato && FORMATOS[formato] ? FORMATOS[formato](v, ctx) : String(v);
    },
  );

  return salida;
}

/**
 * Condicionales y listas. Se resuelven de adentro hacia afuera buscando el
 * `{% fin %}` que corresponde, para que anidar funcione.
 */
function estructuras(txt: string, ctx: Contexto, faltantes: Set<string>): string {
  const apertura = /\{%\s*(si|para)\s+([\w.]+)(?:\s+en\s+([\w.]+))?\s*%\}/;

  let m = apertura.exec(txt);
  while (m) {
    const desde = m.index;
    const cuerpoDesde = desde + m[0].length;
    const cierre = buscarFin(txt, cuerpoDesde);
    if (cierre === -1) break; // sin `fin`: se deja como está, no se rompe todo

    const cuerpo = txt.slice(cuerpoDesde, cierre.inicio);
    let reemplazo = '';

    if (m[1] === 'si') {
      const v = leer(ctx, m[2]);
      const verdadero = Array.isArray(v) ? v.length > 0 : Boolean(v);
      reemplazo = verdadero ? bloque(cuerpo, ctx, faltantes) : '';
    } else {
      const lista = leer(ctx, m[3] ?? '');
      if (Array.isArray(lista)) {
        reemplazo = lista
          .map((item) =>
            bloque(cuerpo, { ...ctx, [m![2]]: item }, faltantes),
          )
          .join('');
      }
    }

    txt = txt.slice(0, desde) + reemplazo + txt.slice(cierre.fin);
    m = apertura.exec(txt);
  }

  return txt;
}

/** El `{% fin %}` que cierra la estructura abierta, contando anidados. */
function buscarFin(txt: string, desde: number): { inicio: number; fin: number } | -1 {
  const token = /\{%\s*(si|para|fin)\b[^%]*%\}/g;
  token.lastIndex = desde;
  let nivel = 0;
  let m: RegExpExecArray | null;

  while ((m = token.exec(txt))) {
    if (m[1] === 'fin') {
      if (nivel === 0) return { inicio: m.index, fin: m.index + m[0].length };
      nivel--;
    } else {
      nivel++;
    }
  }
  return -1;
}

/**
 * Lee una ruta del contexto, **sólo por propiedades propias**.
 *
 * Con acceso normal (`o[k]`) la búsqueda sube por la cadena de prototipos, y
 * `{{ constructor }}` devuelve `function Object() { [native code] }`. No llega
 * a ejecutar nada, pero filtra internals del motor a un documento que se
 * imprime y se firma — y es el primer escalón de un ataque de prototipos.
 * `hasOwnProperty` corta eso de raíz.
 */
function leer(ctx: Contexto, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((o, k) => {
    if (!o || typeof o !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(o, k) ? (o as Contexto)[k] : undefined;
  }, ctx);
}

/** Las variables que una plantilla usa. Sirve para avisar antes de generar. */
export function variablesDe(plantilla: string): string[] {
  const vistas = new Set<string>();
  for (const m of plantilla.matchAll(/\{\{\s*([\w.]+)/g)) vistas.add(m[1]);
  return [...vistas].sort();
}

// ── Números en letras ────────────────────────────────────────────────────────

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte'];
const DECENAS = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta',
  'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function enLetras(n: number): string {
  if (n === 0) return 'cero';
  if (n < 0) return `menos ${enLetras(-n)}`;
  if (n >= 1e12) return String(n);

  const millones = Math.floor(n / 1e6);
  const resto = n % 1e6;

  let s = '';
  if (millones === 1) s = 'un millón';
  else if (millones > 1) s = `${enLetras(millones)} millones`;

  if (resto) s += (s ? ' ' : '') + hastaMillon(resto);
  return s.trim();
}

function hastaMillon(n: number): string {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;

  let s = '';
  if (miles === 1) s = 'mil';
  else if (miles > 1) s = `${hastaMil(miles)} mil`;

  if (resto) s += (s ? ' ' : '') + hastaMil(resto);
  return s;
}

function hastaMil(n: number): string {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(hastaCien(r));
  return partes.join(' ');
}

function hastaCien(n: number): string {
  if (n <= 20) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (!u) return DECENAS[d] === 'veinti' ? 'veinte' : DECENAS[d];
  // "veintiuno" va junto; el resto lleva "y".
  return d === 2 ? `veinti${UNIDADES[u]}` : `${DECENAS[d]} y ${UNIDADES[u]}`;
}
