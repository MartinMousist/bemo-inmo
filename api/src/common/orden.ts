/**
 * Ordenar por columna, sin dejar que el cliente escriba SQL.
 *
 * Motor puro: entra data, sale un fragmento de SQL. No toca base ni red, así
 * que se prueba con casos de papel — que es donde conviene tener los casos de
 * un módulo cuyo error se paga caro.
 *
 * Vive aparte de `paginacion.ts` a propósito: aquel archivo define un DTO con
 * decoradores de `class-validator`, e importarlo desde un test de función pura
 * arrastra el runtime de metadata sin necesidad.
 */

/**
 * Traduce el `orden` del cliente a un fragmento de SQL, o al orden por defecto.
 *
 * La lista blanca mapea **clave pública → expresión SQL** y no acepta nada que
 * no esté en ella. Es la única defensa: `ORDER BY` no admite parámetros
 * ligados, así que la columna hay que concatenarla sí o sí.
 *
 * `NULLS LAST` en las dos direcciones a propósito: una fila sin dato no es "la
 * más chica", es una fila sin dato, y ponerla arriba al ordenar descendente
 * llena la primera pantalla de guiones.
 */
export function ordenSeguro(
  columnas: Record<string, string>,
  porDefecto: string,
  orden?: string,
  dir?: 'asc' | 'desc',
): string {
  // `Object.hasOwn` y no `columnas[orden]` a secas: un `orden` de `constructor`
  // o `__proto__` encuentra algo en la cadena de prototipos y devolvería una
  // función en vez de `undefined`. Es la misma trampa que ya apareció en el
  // motor de plantillas.
  const col = orden && Object.hasOwn(columnas, orden) ? columnas[orden] : undefined;
  if (!col) return porDefecto;
  return `${col} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
}
