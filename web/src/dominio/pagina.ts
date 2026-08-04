/**
 * La forma que devuelve el backend en toda lista paginada. Ver
 * `api/src/common/paginacion.ts` — si cambia allá, cambia acá.
 */
export interface Pagina<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export function paginaVacia<T>(porPagina = 25): Pagina<T> {
  return { items: [], total: 0, pagina: 1, porPagina, paginas: 1 };
}

/**
 * Arma el query string de una lista.
 *
 * Los valores vacíos se omiten en vez de mandarse como `""`: el backend valida
 * con `@IsIn(...)` y una cadena vacía es un 400, no "sin filtro".
 */
export function consulta(
  base: { pagina: number; porPagina: number },
  filtros: Record<string, string | number | boolean | undefined | null> = {},
): string {
  const p = new URLSearchParams({
    pagina: String(base.pagina),
    porPagina: String(base.porPagina),
  });

  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === null || valor === '') continue;
    p.set(clave, String(valor));
  }

  return p.toString();
}
