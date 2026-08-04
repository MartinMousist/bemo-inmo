import { Transform } from 'class-transformer';
import {
  IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const ENTIDADES_NOTA = [
  'contrato_alquiler', 'propiedad', 'persona', 'oportunidad',
] as const;

export const TIPOS_NOTA = [
  'nota', 'llamado', 'whatsapp', 'email', 'visita', 'reclamo',
] as const;

export class CrearNotaDto {
  @IsIn(ENTIDADES_NOTA as unknown as string[]) entidadTipo!: string;
  @IsUUID() entidadId!: string;

  @IsString() @Length(1, 4000) texto!: string;
  @IsOptional() @IsIn(TIPOS_NOTA as unknown as string[]) tipo?: string;

  /** Con fecha, la nota es un pendiente y aparece en el inicio ese día. */
  @IsOptional() @IsISO8601() recordarEl?: string;
}

/** `q` busca dentro del texto de la nota. */
export class FiltroNotasDto extends PaginacionDto {
  @IsOptional() @IsIn(ENTIDADES_NOTA as unknown as string[]) entidadTipo?: string;
  @IsOptional() @IsUUID() entidadId?: string;
  @IsOptional() @IsIn(TIPOS_NOTA as unknown as string[]) tipo?: string;

  /**
   * El `Transform` explícito porque el ValidationPipe corre con
   * `enableImplicitConversion: false`: en un query string todo llega como texto
   * y sin esto `soloPendientes=false` sería la cadena `"false"`, que es `true`.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  soloPendientes?: boolean;
}
