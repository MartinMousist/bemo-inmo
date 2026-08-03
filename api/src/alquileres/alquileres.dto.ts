import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const INDICES = ['ipc', 'icl', 'uva', 'icp', 'porcentaje_fijo', 'ninguno'] as const;
export const INDICES_PUBLICADOS = ['ipc', 'icl', 'uva', 'icp'] as const;

export class LocadorDto {
  @IsUUID() personaId!: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  porcentaje?: number;
}

export class CrearContratoDto {
  @IsUUID() propiedadId!: string;
  @IsOptional() @IsUUID() operacionId?: string;

  @IsISO8601() fechaInicio!: string;
  @IsISO8601() fechaFin!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) diaVencimiento?: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) montoInicial!: number;
  @IsIn(['ARS', 'USD']) moneda!: string;

  @IsOptional() @IsIn(INDICES as unknown as string[]) indice?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) indicePorcentaje?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) periodicidadMeses?: number;
  @IsOptional() @IsISO8601() mesBase?: string;

  @IsOptional() @IsBoolean() administrado?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) deposito?: number;
  @IsOptional() @IsIn(['ARS', 'USD']) depositoMoneda?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  honorariosPct?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  punitorioDiarioPct?: number;

  @IsOptional() @IsIn(['borrador', 'por_iniciar', 'vigente']) estado?: string;
  @IsOptional() @IsString() @MaxLength(4000) notas?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LocadorDto)
  locadores?: LocadorDto[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) locatarios?: string[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) garantes?: string[];
}

export class FiltroContratosDto extends PaginacionDto {
  @IsOptional()
  @IsIn(['borrador', 'por_iniciar', 'vigente', 'vencido', 'rescindido', 'renovado'])
  estado?: string;
}

export class GenerarPeriodosDto {
  @IsOptional() @IsISO8601() hasta?: string;
}

export class RegistrarCobroDto {
  @IsUUID() periodoId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto!: number;
  @IsOptional() @IsISO8601() fecha?: string;
  @IsOptional() @IsIn(['efectivo', 'transferencia', 'cheque', 'debito', 'otro']) medio?: string;
  @IsOptional() @IsString() @MaxLength(80) comprobante?: string;
}

export class CargarIndiceDto {
  @IsIn(INDICES_PUBLICADOS as unknown as string[]) tipo!: string;
  @IsISO8601() periodo!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) valor!: number;
  @IsOptional() @IsString() @MaxLength(120) fuente?: string;
  @IsOptional() @IsISO8601() publicadoEl?: string;
}

export class CargarIndicesLoteDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CargarIndiceDto)
  valores!: CargarIndiceDto[];
}

export class GenerarLiquidacionesDto {
  @IsISO8601() periodo!: string;
}

export class AgregarGastoDto {
  @IsString() @MaxLength(160) concepto!: string;
  @IsIn(['expensas', 'reparacion', 'impuesto', 'ajuste', 'otro']) tipo!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto!: number;
}
