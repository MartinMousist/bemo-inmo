/**
 * El filtro por agente del lado del front.
 *
 * El backend tiene UNA sola semántica: `agenteId=<uuid>`. No existe
 * `agenteId=mias`, a propósito —así el titular pide «las de Sofía» con el mismo
 * mecanismo con el que un asesor pide las suyas—. «Las mías» es una decisión de
 * esta capa: manda el uuid propio.
 *
 * Lo que sí vive acá son dos **centinelas que nunca viajan al backend**:
 *
 *  · `'yo'` — «las mías». Se guarda así en `localStorage` y se traduce al uuid
 *    recién al armar la consulta. El motivo es concreto y no teórico: en una
 *    inmobiliaria la PC del mostrador se comparte, y guardar el uuid haría que
 *    la segunda persona abra la pantalla filtrada por la primera y vea una
 *    lista vacía sin entender por qué. Con el centinela, «las mías» significa
 *    las de quien está mirando.
 *
 *  · `'sin-asignar'` — las que no tienen captador. Se traduce a `sinCaptador`,
 *    que es un parámetro aparte porque `agenteId` es un uuid validado y meterle
 *    una palabra mágica obligaría a aflojar el `@IsUUID()` de los seis listados.
 *    Sólo lo acepta el listado de propiedades.
 */
export const AGENTE_TODOS = '';
export const AGENTE_YO = 'yo';
export const AGENTE_SIN_ASIGNAR = 'sin-asignar';

/**
 * La firma lleva index signature a propósito: `consulta()` de `dominio/pagina`
 * recibe un `Record<string, …>` y estos parámetros se le pasan con spread.
 */
export interface ParamsAgente extends Record<string, string | undefined> {
  agenteId?: string;
  sinCaptador?: string;
}

/**
 * Del valor del filtro a los parámetros de la consulta.
 *
 * Devuelve `{}` cuando no hay filtro, y también cuando el valor es `'yo'` pero
 * todavía no se sabe quién es «yo» (la sesión no terminó de restaurarse): sin
 * uuid, mandar cualquier otra cosa sería inventar un filtro.
 */
export function paramsDeAgente(valor: string, miUsuarioId: string | null): ParamsAgente {
  if (!valor) return {};
  if (valor === AGENTE_SIN_ASIGNAR) return { sinCaptador: 'true' };
  if (valor === AGENTE_YO) return miUsuarioId ? { agenteId: miUsuarioId } : {};
  return { agenteId: valor };
}

/** ¿Este valor filtra algo? Sirve para el «Limpiar» y para los vacíos. */
export function hayFiltroDeAgente(valor: string): boolean {
  return valor !== AGENTE_TODOS;
}
