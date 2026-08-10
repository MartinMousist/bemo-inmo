import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsISO8601, IsInt, IsOptional, IsString,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ESTADOS } from './actas.motor';

export const TIPOS_ACTA = ['entrega', 'devolucion'] as const;

export class ItemDto {
  @IsString() @MaxLength(120) ambiente!: string;
  @IsIn(ESTADOS as unknown as string[]) estado!: string;
  @IsOptional() @IsString() @MaxLength(1000) detalle?: string;
}

export class CrearActaDto {
  @IsIn(TIPOS_ACTA as unknown as string[]) tipo!: string;
  @IsOptional() @IsISO8601() fecha?: string;

  /**
   * Los ambientes con los que arranca.
   *
   * En la de DEVOLUCIÓN se ignora: se copian los de la entrega. Es lo único que
   * hace comparables a las dos actas — si cada una se cargara con sus propios
   * ambientes, el comparativo mostraría dos listas que no se cruzan.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => ItemDto)
  items?: ItemDto[];
}

export class EditarActaDto {
  @IsOptional() @IsISO8601() fecha?: string;
  @IsOptional() @IsString() @MaxLength(500) presentes?: string;
  @IsOptional() @IsString() @MaxLength(4000) observaciones?: string;
  @IsOptional() @IsString() @MaxLength(60) medidorLuz?: string;
  @IsOptional() @IsString() @MaxLength(60) medidorGas?: string;
  @IsOptional() @IsString() @MaxLength(60) medidorAgua?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) llavesEntregadas?: number;
}

export class GuardarItemsDto {
  @IsArray() @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => ItemDto)
  items!: ItemDto[];
}

export class FirmarDto {
  /**
   * Quién firmó del otro lado. Texto y no FK: en la entrega puede firmar la
   * madre del inquilino, y obligar a crear una ficha para eso convierte un
   * trámite de diez minutos en carga de datos.
   */
  @IsString() @MaxLength(160) firmadaInquilino!: string;
}

export class SubirFotoActaDto {
  /** La imagen en base64, igual que las fotos y los documentos del garante. */
  @IsString() @MaxLength(14_000_000) datos!: string;
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
}
