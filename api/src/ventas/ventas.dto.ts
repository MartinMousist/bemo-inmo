import { Type } from 'class-transformer';
import {
  IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const ESTADOS_VENTA = ['en_curso', 'boleto', 'escriturada', 'caida'] as const;

export class ExternaDto {
  @IsString() @MaxLength(120) nombre!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) porcentaje!: number;
}

export class AgenteRepartoDto {
  @IsUUID() usuarioId!: string;
  @IsString() @MaxLength(120) nombre!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) porcentaje!: number;
}

export class RepartoInternoDto {
  @IsOptional() @ValidateNested() @Type(() => AgenteRepartoDto) captador?: AgenteRepartoDto;
  @IsOptional() @ValidateNested() @Type(() => AgenteRepartoDto) cerrador?: AgenteRepartoDto;
}

export class CrearVentaDto {
  @IsUUID() operacionId!: string;
  @IsOptional() @IsUUID() compradorId?: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) precioCierre!: number;
  @IsIn(['ARS', 'USD']) moneda!: string;

  @IsOptional() @IsISO8601() fechaReserva?: string;
  @IsOptional() @IsISO8601() fechaBoleto?: string;
  @IsOptional() @IsString() @MaxLength(160) escribania?: string;
  @IsOptional() @IsString() @MaxLength(4000) notas?: string;
}

export class RepartoDto {
  /** { compradora: 3, vendedora: 3 } — % sobre el precio de cierre. */
  @IsObject() puntas!: Record<string, number>;

  /** { vendedora: { nombre: 'Otra', porcentaje: 50 } } */
  @IsOptional() @IsObject() externas?: Record<string, { nombre: string; porcentaje: number }>;

  @IsOptional() @ValidateNested() @Type(() => RepartoInternoDto)
  repartoInterno?: RepartoInternoDto;
}

/**
 * La política de comisiones de la inmobiliaria.
 *
 * Los seis números van **obligatorios**, no opcionales: un PUT parcial que
 * dejara `vendedora` afuera la escribiría como `undefined` y el motor
 * calcularía una punta menos sin decir nada. Es la misma trampa del `PATCH`
 * parcial que borraba número, ambientes y metros de una propiedad.
 */
export class PuntasVentaDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) compradora!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) vendedora!: number;
}

export class PuntasAlquilerDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) locataria!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) locadora!: number;
}

export class RepartoInternoConfigDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) captador!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) cerrador!: number;
}

export class ConfigComisionesDto {
  @ValidateNested() @Type(() => PuntasVentaDto) venta!: PuntasVentaDto;
  @ValidateNested() @Type(() => PuntasAlquilerDto) alquiler!: PuntasAlquilerDto;
  @ValidateNested() @Type(() => RepartoInternoConfigDto) repartoInterno!: RepartoInternoConfigDto;
}

export class CerrarVentaDto {
  @IsIn(['en_curso', 'boleto', 'escriturada', 'caida']) estado!: string;
  @IsOptional() @IsISO8601() fechaBoleto?: string;
  @IsOptional() @IsISO8601() fechaEscritura?: string;
  @IsOptional() @IsString() @MaxLength(160) escribania?: string;
  @IsOptional() @IsString() @MaxLength(300) motivoCaida?: string;
}

export class CobrarComisionDto {
  @IsOptional() @IsISO8601() fecha?: string;
}

/** `q` busca por código de propiedad, calle, localidad o nombre del comprador. */
export class FiltroVentasDto extends PaginacionDto {
  @IsOptional() @IsIn(ESTADOS_VENTA as unknown as string[]) estado?: string;
}
