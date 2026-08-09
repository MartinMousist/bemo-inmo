import { IsOptional, IsUUID } from 'class-validator';
import { PaginacionDto } from './paginacion';

/**
 * El filtro por agente, con UN solo nombre para todos los listados.
 *
 * Antes de esto la única relación agente↔listado que se usaba era
 * `oportunidad.agente_id`, y no como filtro sino como **restricción dura**: el
 * rol `agente` veía sólo lo suyo y no había forma de acotar ningún otro listado.
 * `propiedad.agente_captador_id` existía desde la 006 y ninguna pantalla lo
 * ofrecía como filtro.
 *
 * Tres decisiones que este archivo fija de una vez:
 *
 * 1. **El filtro NO es un permiso.** Un asesor sigue viendo la cartera entera
 *    de la inmobiliaria: `agenteId` es una herramienta para acotarla, no un
 *    recorte de lo que puede ver. La única excepción declarada son los leads
 *    —`oportunidad`, donde el rol `agente` ve sólo los suyos por una regla de
 *    negocio escrita en su servicio— y el desglose de comisiones por agente,
 *    que es plata del compañero.
 *
 * 2. **No existe un valor mágico `agenteId=mias`.** El back tiene una sola
 *    semántica —«las de este uuid»— y así el titular puede pedir «las de
 *    Sofía» con el mismo mecanismo con el que un asesor pide las suyas. «Las
 *    mías» es una decisión del front: manda su propio uuid.
 *
 * 3. **Siempre `@IsUUID()`, nunca texto libre.** Un `agenteId` inventado tiene
 *    que ser un 400 y no una consulta que devuelve vacío sin decir por qué —el
 *    mismo motivo por el que `venceEn` valida su formato con un regex en vez de
 *    aceptar cualquier cosa.
 *
 * Se hereda de acá en vez de copiar la propiedad en cada `Filtro*Dto` para que
 * el nombre no pueda divergir: el front monta **un solo** `SelectAgente` en las
 * seis pantallas y un `agente_id` en una sola de ellas lo rompería en silencio.
 */
export class FiltroConAgenteDto extends PaginacionDto {
  @IsOptional() @IsUUID() agenteId?: string;
}
