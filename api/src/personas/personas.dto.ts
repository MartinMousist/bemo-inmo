import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginacionDto } from '../common/paginacion';
import { ROLES_PERSONA, type RolPersona } from './personas.service';

const DOC_TIPOS = ['dni', 'cuit', 'cuil', 'pasaporte', 'le', 'lc'] as const;

/**
 * El listado de personas, con el filtro por rol de la fila de pestañas.
 *
 * **Sin `message` propio, a propósito.** La tentación es redactar acá el texto
 * de error —«el rol no es válido, los que hay son…»— y sería texto muerto: el
 * `exceptionFactory` de `configurar-app.ts` DESCARTA los mensajes de
 * class-validator y arma uno solo en castellano a partir de los campos que
 * fallaron («El campo «rol» no es válido.»), justamente para que ningún texto
 * de librería llegue a la pantalla. Eso ya sale bien; escribir un mensaje que
 * nadie lee es el error #3 del playbook en dos líneas.
 *
 * Lo que sí importa es que el `detail` viaja por la clave `message` del
 * BadRequestException, que es la que lee el filtro RFC 9457 — la trampa anotada
 * en docs/CONTINUAR.md §4 desde la etapa 11.5.
 *
 * La lista de roles válidos sale de `ROLES_PERSONA`, la misma constante de la
 * que salen la derivación y los conteos: un rol séptimo no puede quedar como un
 * chip que se ve en la tabla y un filtro que la API rechaza con 400.
 */
export class ListarPersonasDto extends PaginacionDto {
  @IsOptional()
  @IsIn(ROLES_PERSONA as unknown as string[])
  rol?: RolPersona;
}

/** Los estados de cobranza derivados en `alquileres/cartera.service.ts`. */
const COBRANZAS = ['al_dia', 'parcial', 'en_mora', 'sin_cuotas'] as const;

export class ListarInquilinosDto extends PaginacionDto {
  /**
   * `vigentes` por defecto. Va como enumerado y no como booleano `soloVigentes`
   * porque el control de la pantalla tiene dos posiciones con nombre, y un
   * `?soloVigentes=false` en un enlace compartido no se lee.
   */
  @IsOptional()
  @IsIn(['vigentes', 'todos'])
  vigencia?: 'vigentes' | 'todos';

  @IsOptional()
  @IsIn(COBRANZAS as unknown as string[])
  cobranza?: string;
}

export class ListarPropietariosDto extends PaginacionDto {
  /**
   * Los que tienen una liquidación cerrada y sin pagar, o sea a quiénes se les
   * debe plata hoy. `@Transform` porque un query string manda `'true'`, texto, y
   * sin esto `Boolean('false')` da `true` — el filtro quedaría siempre puesto.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  soloConPendiente?: boolean;
}

/**
 * El listado general de garantías.
 *
 * `pendientes` es el default y es la decisión de producto de esta pantalla: la
 * pregunta real no es «quiénes son mis garantes» sino «qué carpeta me falta».
 * Arrancar en «todos» deja los que necesitan algo mezclados entre los que ya
 * están completos, que es como se pierde una garantía sin firmar.
 */
export class ListarGarantesDto extends PaginacionDto {
  @IsOptional()
  @IsIn(['pendientes', 'todos', 'aptos', 'observados'])
  estado?: 'pendientes' | 'todos' | 'aptos' | 'observados';

  @IsOptional()
  @IsIn(['vigentes', 'todos'])
  vigencia?: 'vigentes' | 'todos';
}

export class CrearPersonaDto {
  @IsOptional()
  @IsIn(['fisica', 'juridica'])
  tipo?: 'fisica' | 'juridica';

  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apellido?: string;

  @IsOptional()
  @IsIn(DOC_TIPOS as unknown as string[])
  docTipo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  docNumero?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  domicilio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notas?: string;
}

export class EditarPersonaDto extends CrearPersonaDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  declare nombre: string;
}
