import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export const ETAPAS = ['pozo', 'en_construccion', 'terminado', 'entregado'] as const;
export const INDICES_PLAN = ['ninguno', 'cac', 'ipc', 'uva', 'icl'] as const;

export class CrearEmprendimientoDto {
  @IsString() @MinLength(2) @MaxLength(120) nombre!: string;
  @IsString() @MinLength(2) @MaxLength(160) calle!: string;
  @IsOptional() @IsString() @MaxLength(20) numero?: string;
  @IsOptional() @IsString() @MaxLength(80) localidad?: string;
  @IsOptional() @IsString() @MaxLength(80) provincia?: string;
  @IsOptional() @IsIn(ETAPAS as unknown as string[]) etapa?: string;
  @IsOptional() @IsISO8601() entregaEstimada?: string;
  @IsOptional() @IsString() @MaxLength(4000) descripcion?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(40) amenities?: string[];
}

export class EditarEmprendimientoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nombre?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) calle?: string;
  @IsOptional() @IsString() @MaxLength(20) numero?: string;
  @IsOptional() @IsString() @MaxLength(80) localidad?: string;
  @IsOptional() @IsIn(ETAPAS as unknown as string[]) etapa?: string;
  @IsOptional() @IsISO8601() entregaEstimada?: string;
  @IsOptional() @IsString() @MaxLength(4000) descripcion?: string;
}

export class AvanceDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) pct!: number;
}

export class RefuerzoDto {
  @Type(() => Number) @IsInt() @Min(1) cuota!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) pct!: number;
}

export class CrearPlanDto {
  @IsOptional() @IsUUID() emprendimientoId?: string;
  @IsString() @MinLength(2) @MaxLength(80) nombre!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) anticipoPct!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(360) cuotas!: number;

  @IsOptional() @IsArray() @ArrayMaxSize(24)
  @ValidateNested({ each: true }) @Type(() => RefuerzoDto)
  refuerzos?: RefuerzoDto[];

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  contraEntregaPct?: number;

  @IsOptional() @IsIn(INDICES_PLAN as unknown as string[]) indice?: string;
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
}

export class EditarPlanDto extends CrearPlanDto {
  @IsOptional() @IsBoolean() activo?: boolean;
}

export class PresupuestarDto {
  /** La unidad. Sin ella hace falta `precio` para simular. */
  @IsOptional() @IsUUID() propiedadId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) precio?: number;
  @IsOptional() @IsISO8601() desde?: string;
  /** Para comparar contra una unidad terminada equivalente. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1)
  comparableTerminado?: number;
}

export class ImportarUnidadesDto {
  @IsString() @MaxLength(2_000_000) csv!: string;
  /** Sin esto en `false`, no escribe. El default es simular. */
  @IsOptional() @IsBoolean() confirmar?: boolean;
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
}
