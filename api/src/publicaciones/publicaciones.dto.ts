import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginacionDto } from '../common/paginacion';
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

/** `q` busca por título del aviso, calle o código de propiedad. */
export class FiltroPublicacionesDto extends PaginacionDto {
  @IsOptional() @IsIn(PORTALES as unknown as string[]) portal?: string;
  @IsOptional() @IsIn(ESTADOS_PUBLICACION as unknown as string[]) estado?: string;
}
