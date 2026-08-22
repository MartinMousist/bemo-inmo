/**
 * Cómo se ve el listado de propiedades: tabla o tarjetas.
 *
 * ── Qué es esto y qué NO es ─────────────────────────────────────────────────
 *
 * Es una preferencia de **espacio de trabajo**, como la barra lateral plegada y
 * como el tema: quien da vuelta la pantalla para mostrarle la cartera a alguien
 * no quiere volver a apretar el interruptor en cada carga. No es un filtro. Por
 * eso el botón «Limpiar» de los filtros NO la toca: el filtro es una pregunta
 * sobre los datos, la vista es cómo se los mira.
 *
 * ── Una sola clave para las TRES pantallas ──────────────────────────────────
 *
 * Propiedades, la cartera de venta y la cartera de alquiler son el mismo objeto
 * visto de tres maneras. Guardar una preferencia por pantalla haría que la
 * vista se dé vuelta al pasar de una a otra, que es desorientador y no lo pidió
 * nadie. Si algún día una de las tres necesita su propia vista, se le agrega el
 * sufijo a la clave; hoy sería complejidad sin caso.
 *
 * ── Las reglas que se copian de `filtros.ts`, por número ────────────────────
 *
 * **Regla 2 · Un valor guardado que ya no es válido se descarta.** Si mañana se
 * renombra `tarjetas`, un `localStorage` viejo dejaría la pantalla sin ninguna
 * de las dos vistas: ni tabla ni grilla, o sea en blanco. Cae al default.
 *
 * **Regla 3 · Un `localStorage` que falla no rompe la pantalla.** En modo
 * privado de Safari, escribir tira excepción. Una vista que no se recuerda es
 * una molestia; una pantalla en blanco es un bug.
 *
 * La **regla 1** de `filtros.ts` —la página no se recuerda— acá no aplica y por
 * eso no está: no hay ninguna posición dentro del listado que se guarde. Se
 * escribe la ausencia para que la próxima sesión no la busque.
 *
 * ── El límite, dicho ────────────────────────────────────────────────────────
 *
 * `localStorage` es por **navegador**, no por usuario: dos personas que
 * comparten la máquina del mostrador comparten la vista, y la misma persona en
 * otra computadora arranca en tabla. Es el mismo límite que ya tienen el tema,
 * la barra lateral y los filtros. Agregar una columna en `usuario` sólo para
 * esto sería inconsistente; el día que se quiera de verdad, va una migración
 * para las cuatro preferencias juntas.
 */

const CLAVE = 'bemo-inmo:vista:propiedades';

/**
 * Las tres formas de mirar la cartera.
 *
 * `lista`    — una fila por propiedad CON su foto, como los portales. Es para
 *              recorrer buscando: la foto es lo que hace que el ojo se detenga.
 * `tarjetas` — la grilla. Para mostrarle la cartera a alguien.
 * `tabla`    — densa y sin fotos. Para trabajar y para imprimir.
 */
export type Vista = 'lista' | 'tabla' | 'tarjetas';

/**
 * La tabla es el DEFAULT y no se va a ningún lado.
 *
 * DESIGN.md §1: «la densidad es una virtud: un administrador quiere ver 30
 * contratos, no 6 tarjetas». El usuario primario mira la cartera para trabajar,
 * y para eso la tabla gana. Las tarjetas son la segunda vista, con otro uso
 * —mostrarle la cartera a alguien— y por eso hay un interruptor y no un
 * reemplazo.
 */
/**
 * La TABLA sigue siendo el default, y no es inercia.
 *
 * Lo decide `DESIGN.md` §1 —«la densidad es una virtud: un administrador quiere
 * ver 30 contratos, no 6 tarjetas»— y su matiz del 2026-08-09, que dice con
 * todas las letras que la tabla es el default de las tres pantallas de
 * propiedades «y no se va».
 *
 * `lista` se suma como TERCERA vista, no como reemplazo. Se probó cambiar el
 * default y lo frenaron los tests, que estaban bien: es una decisión del
 * sistema de diseño y no se cambia de costado mientras se agrega una vista.
 */
export const VISTA_POR_DEFECTO: Vista = 'tabla';

const VALIDAS: readonly Vista[] = ['lista', 'tabla', 'tarjetas'];

export function leerVista(): Vista {
  try {
    const guardada = localStorage.getItem(CLAVE);
    // Regla 2.
    return VALIDAS.includes(guardada as Vista) ? (guardada as Vista) : VISTA_POR_DEFECTO;
  } catch {
    // Regla 3.
    return VISTA_POR_DEFECTO;
  }
}

export function guardarVista(vista: Vista): void {
  try {
    localStorage.setItem(CLAVE, vista);
  } catch {
    // Regla 3.
  }
}
