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


// Acá vivían `leerGruposCerrados()` y `guardarGruposCerrados()`.
//
// Guardaban qué grupos del menú estaban plegados, y era una idea que se rompía
// sola: nadie pliega un grupo a mano —sólo los abre para navegar— así que cada
// navegación borraba uno del conjunto guardado hasta dejarlo vacío, y el menú
// volvía a mostrar sus treinta y cinco entradas para siempre.
//
// Ahora el estado es de la sesión y lo calcula `AppShell`: abierto el grupo
// donde estás, más los que abras en esta visita.
