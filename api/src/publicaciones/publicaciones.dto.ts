import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FiltroConAgenteDto } from '../common/filtro-agente';
import { PORTALES } from './etiquetas';

export const ESTADOS_PUBLICACION = [
  'borrador', 'lista', 'publicada', 'pausada', 'error', 'baja',
] as const;

export class CrearPublicacionDto {
  @IsUUID() operacionId!: string;
  @IsIn(PORTALES as unknown as string[]) portal!: string;
}

export class ActualizarPublicacionDto {
  @IsOptional() @IsIn(ESTADOS_PUBLICACION as unknown as string[])
  estado?: string;
  @IsOptional() @IsString() @MaxLength(120) externalId?: string;
  @IsOptional() @IsString() @MaxLength(500) urlPublica?: string;
}

/**
 * `q` busca por título del aviso, calle o código de propiedad.
 *
 * `agenteId` (heredado) filtra por el **captador de la propiedad**. Es el
 * listado donde más sirve: «qué avisos míos están todavía sin publicar» era una
 * pregunta que había que contestar leyendo la lista entera.
 */
export class FiltroPublicacionesDto extends FiltroConAgenteDto {
  @IsOptional() @IsIn(PORTALES as unknown as string[]) portal?: string;
  @IsOptional() @IsIn(ESTADOS_PUBLICACION as unknown as string[]) estado?: string;
}
