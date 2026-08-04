/**
 * Parser de CSV. Puro, sin dependencias.
 *
 * No alcanza con `split(',')`: los archivos que exporta Excel traen campos
 * entrecomillados con comas y saltos de línea adentro, y comillas escapadas
 * duplicándolas. Un split ingenuo parte una dirección como
 * "San Martín 1450, Piso 3" en dos columnas y corrompe toda la fila.
 */

export interface CsvParseado {
  cabeceras: string[];
  filas: Array<Record<string, string>>;
}

/** Detecta el separador mirando la primera línea. Excel es-AR usa `;`. */
export function detectarSeparador(texto: string): string {
  const primera = texto.split(/\r?\n/)[0] ?? '';
  const punto = (primera.match(/;/g) ?? []).length;
  const coma = (primera.match(/,/g) ?? []).length;
  const tab = (primera.match(/\t/g) ?? []).length;

  if (tab > punto && tab > coma) return '\t';
  return punto >= coma ? ';' : ',';
}

export function parsearCsv(texto: string, separador?: string): CsvParseado {
  // El BOM que escribe Excel se cuela en el nombre de la primera columna y
  // hace que "codigo" no matchee con "codigo".
  const limpio = texto.replace(/^﻿/, '');
  const sep = separador ?? detectarSeparador(limpio);

  const filas: string[][] = [];
  let campo = '';
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (enComillas) {
      if (c === '"') {
        // Comilla duplicada = una comilla literal.
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c !== '\r') {
      campo += c;
    }
  }

  // La última fila puede no terminar en salto de línea.
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }

  const sinVacias = filas.filter((f) => f.some((c) => c.trim() !== ''));
  if (!sinVacias.length) return { cabeceras: [], filas: [] };

  const cabeceras = sinVacias[0].map(normalizar);

  return {
    cabeceras,
    filas: sinVacias.slice(1).map((f) => {
      const o: Record<string, string> = {};
      cabeceras.forEach((h, i) => {
        o[h] = (f[i] ?? '').trim();
      });
      return o;
    }),
  };
}

/**
 * Normaliza un nombre de columna: sin acentos, sin espacios, en minúscula.
 * Así "Sup. Total", "sup total" y "SUP_TOTAL" son la misma columna — que es lo
 * que una planilla real va a tener, porque la escribió una persona.
 */
export function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Número escrito por una persona: "1.234,56", "1234.56", "$ 1.234", "1 234,56".
 * Devuelve null si no se puede interpretar — nunca 0, porque un 0 inventado en
 * un precio o una superficie es peor que un campo vacío.
 */
export function numeroFlexible(v: string | undefined | null): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Se saca todo lo que no sea dígito, coma, punto o signo.
  let limpio = s.replace(/[^\d,.\-]/g, '');
  if (!limpio || limpio === '-') return null;

  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');

  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El que está más a la derecha es el decimal.
    if (ultimaComa > ultimoPunto) {
      limpio = limpio.replace(/\./g, '').replace(',', '.');
    } else {
      limpio = limpio.replace(/,/g, '');
    }
  } else if (ultimaComa > -1) {
    // Sólo coma: decimal si quedan 1-2 dígitos después; si no, es de miles.
    const despues = limpio.length - ultimaComa - 1;
    limpio = despues <= 2 ? limpio.replace(',', '.') : limpio.replace(/,/g, '');
  } else if (ultimoPunto > -1) {
    const despues = limpio.length - ultimoPunto - 1;
    // "1.234" es mil doscientos treinta y cuatro, no 1,234.
    if (despues === 3 && limpio.replace(/[.\-]/g, '').length > 3) {
      limpio = limpio.replace(/\./g, '');
    }
  }

  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Fecha escrita por una persona: dd/mm/aaaa, aaaa-mm-dd, dd-mm-aa. */
export function fechaFlexible(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // dd/mm/aaaa — el formato argentino. NUNCA mm/dd: un 03/04 es 3 de abril.
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    let anio = +m[3];
    if (anio < 100) anio += anio < 50 ? 2000 : 1900;
    return iso(anio, +m[2], +m[1]);
  }

  return null;
}

function iso(a: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
