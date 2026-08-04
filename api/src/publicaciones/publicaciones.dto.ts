import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PORTALES } from './etiquetas';

export class CrearPublicacionDto {
  @IsUUID() operacionId!: string;
  @IsIn(PORTALES as unknown as string[]) portal!: string;
}

export class ActualizarPublicacionDto {
  @IsOptional() @IsIn(['borrador', 'lista', 'publicada', 'pausada', 'error', 'baja'])
  estado?: string;
  @IsOptional() @IsString() @MaxLength(120) externalId?: string;
  @IsOptional() @IsString() @MaxLength(500) urlPublica?: string;
}
