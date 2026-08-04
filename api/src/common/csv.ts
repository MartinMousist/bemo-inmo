/**
 * Export CSV.
 *
 * Dos decisiones que parecen menores y no lo son:
 *
 * 1. **BOM UTF-8 al principio.** Sin él, Excel en Windows abre el archivo en
 *    Latin-1 y "Arístides" se ve "ArÃ­stides". Es el 90% de los reportes de
 *    "el export está roto".
 * 2. **Separador `;` y no `,`.** Excel en configuración regional es-AR espera
 *    punto y coma; con coma mete todo en una sola columna.
 */

export interface ColumnaCsv<T> {
  titulo: string;
  /**
   * `unknown` a propósito: las filas vienen de SQL crudo y `escapar` ya
   * normaliza cualquier cosa. Tipar más estrecho obligaría a castear en cada
   * columna sin ganar ninguna garantía real.
   */
  valor: (fila: T) => unknown;
}

const BOM = '﻿';
const SEP = ';';

export function aCsv<T>(filas: T[], columnas: Array<ColumnaCsv<T>>): string {
  const cabecera = columnas.map((c) => escapar(c.titulo)).join(SEP);
  const cuerpo = filas.map((f) =>
    columnas.map((c) => escapar(c.valor(f))).join(SEP),
  );
  return BOM + [cabecera, ...cuerpo].join('\r\n') + '\r\n';
}

/**
 * Los números se escriben con coma decimal (es-AR) y SIN separador de miles:
 * el punto de miles hace que Excel los lea como texto.
 */
export function numeroCsv(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n.toFixed(2).replace('.', ',');
}

function escapar(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);

  // Un valor que arranca con =, +, - o @ lo interpreta Excel como fórmula.
  // Es una vía real de inyección: un nombre "=1+1" o algo peor se ejecuta al
  // abrir el archivo. Se prefija con comilla simple para neutralizarlo.
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;

  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Nombre de archivo con la fecha, para que no se pisen dos exports. */
export function nombreArchivo(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}
