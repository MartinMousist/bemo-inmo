const CLAVE = 'bemo-inmo:sidebar';

/**
 * Sidebar plegado: preferencia persistida, igual que el tema.
 *
 * Se guarda porque es una decisión de espacio de trabajo, no un estado de
 * sesión: quien trabaja en un portátil de 13" y plegó la barra para ver la
 * cartera completa no quiere volver a plegarla en cada carga.
 *
 * En pantalla angosta la barra ya es un cajón que entra y sale, así que el
 * plegado no aplica: `familia.css` lo cancela por media query en vez de
 * apagarlo desde acá, para que la preferencia sobreviva al cambio de tamaño.
 */
export function leerPlegado(): boolean {
  return localStorage.getItem(CLAVE) === '1';
}

export function guardarPlegado(plegado: boolean): void {
  localStorage.setItem(CLAVE, plegado ? '1' : '0');
}

const CLAVE_GRUPOS = 'bemo-inmo:sidebar:cerrados';

/**
 * Qué grupos del menú están plegados.
 *
 * ── Por qué se guardan los CERRADOS y no los abiertos ──
 *
 * Para que un grupo nuevo nazca visible. Si guardáramos los abiertos, la
 * sección que se agregue el mes que viene no estaría en la lista de nadie y
 * quedaría escondida para todos los que ya usan el sistema —una feature nueva
 * que nadie encuentra—. Con los cerrados, lo que no se conoce se muestra.
 *
 * `null` significa «nunca eligió nada»: ahí manda el default, que es dejar
 * abierto sólo el grupo de la pantalla actual. Son 32 entradas en 6 secciones y
 * abiertas de una no entran en pantalla; el ítem 8 exige scrollear para
 * encontrarlo, que es exactamente cómo se pierde una pantalla nueva.
 */
export function leerGruposCerrados(): Set<string> | null {
  const crudo = localStorage.getItem(CLAVE_GRUPOS);
  if (crudo === null) return null;
  try {
    const arr = JSON.parse(crudo) as unknown;
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    // Un valor corrupto no puede dejar el menú inutilizable: se cae al default.
    return null;
  }
}

export function guardarGruposCerrados(cerrados: Set<string>): void {
  localStorage.setItem(CLAVE_GRUPOS, JSON.stringify([...cerrados]));
}
