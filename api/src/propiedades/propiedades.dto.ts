import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const TIPOS_PROPIEDAD = [
  'departamento', 'casa', 'ph', 'local', 'oficina',
  'galpon', 'terreno', 'cochera', 'campo',
] as const;

export const TIPOS_OPERACION = ['venta', 'alquiler', 'alquiler_temporario'] as const;
export const MONEDAS = ['ARS', 'USD'] as const;

export class TitularDto {
  @IsUUID()
  personaId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  porcentaje!: number;
}

export class CrearPropiedadDto {
  @IsString() @MaxLength(160) calle!: string;
  @IsOptional() @IsString() @MaxLength(20) numero?: string;
  @IsOptional() @IsString() @MaxLength(20) piso?: string;
  @IsOptional() @IsString() @MaxLength(20) depto?: string;
  @IsOptional() @IsString() @MaxLength(80) localidad?: string;
  @IsOptional() @IsString() @MaxLength(60) provincia?: string;
  @IsOptional() @IsString() @MaxLength(12) cp?: string;

  /** Si vienen, se respetan y NO se geocodifica. Es la salida manual cuando
   *  no hay API key o cuando Google ubica mal la dirección. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;

  @IsIn(TIPOS_PROPIEDAD as unknown as string[]) tipo!: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supTotal?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supCubierta?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) ambientes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) dormitorios?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) banos?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) cocheras?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(300) antiguedad?: number;

  @IsOptional() @IsString() @MaxLength(40) orientacion?: string;
  @IsOptional() @IsString() @MaxLength(40) estadoConservacion?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true })
  amenities?: string[];

  @IsOptional() @IsString() @MaxLength(5000) descripcion?: string;
  @IsOptional() @IsString() @MaxLength(5000) notasInternas?: string;
  @IsOptional() @IsUUID() agenteCaptadorId?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TitularDto)
  @ArrayMaxSize(20)
  titulares?: TitularDto[];
}

export class EditarPropiedadDto extends CrearPropiedadDto {
  @IsOptional() @IsString() @MaxLength(160) declare calle: string;
  @IsOptional() @IsIn(TIPOS_PROPIEDAD as unknown as string[]) declare tipo: string;
}

export class CrearOperacionDto {
  @IsIn(TIPOS_OPERACION as unknown as string[]) tipo!: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) precio?: number;
  @IsIn(MONEDAS as unknown as string[]) moneda!: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) expensas?: number;
  @IsOptional() @IsIn(MONEDAS as unknown as string[]) expensasMoneda?: string;

  @IsOptional()
  @IsIn(['borrador', 'disponible', 'reservada', 'cerrada', 'suspendida'])
  estado?: string;

  @IsOptional() @IsISO8601() exclusividadHasta?: string;
}

export class EditarOperacionDto extends CrearOperacionDto {
  @IsOptional() @IsIn(TIPOS_OPERACION as unknown as string[]) declare tipo: string;
  @IsOptional() @IsIn(MONEDAS as unknown as string[]) declare moneda: string;
}

export class FiltroPropiedadesDto extends PaginacionDto {
  @IsOptional() @IsIn(TIPOS_PROPIEDAD as unknown as string[]) tipo?: string;
  @IsOptional() @IsIn(TIPOS_OPERACION as unknown as string[]) operacion?: string;
  @IsOptional() @IsIn(['borrador', 'disponible', 'reservada', 'cerrada', 'suspendida'])
  estado?: string;

  /**
   * Traer también las operaciones cerradas.
   *
   * El listado general muestra lo que se está OFRECIENDO y las cerradas sobran.
   * Las carteras de venta y alquiler muestran lo que la inmobiliaria TIENE: una
   * unidad alquilada tiene su operación en `cerrada`, y sin esto la cartera de
   * alquiler mostraba 3 de 13 — justo las tres que NO están alquiladas.
   *
   * Es opt-in y no el default para no cambiarle el significado al listado que
   * ya existía.
   */
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  incluirCerradas?: boolean;
}
