import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsIn,
  IsInt,
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
import { CrearPersonaDto } from '../personas/personas.dto';

export const ORIGENES = [
  'portal', 'web', 'whatsapp', 'telefono', 'referido', 'cartel', 'redes', 'otro',
] as const;

export const ESTADOS_OPORTUNIDAD = [
  'nueva', 'contactada', 'calificada', 'visita', 'negociacion', 'ganada', 'perdida',
] as const;

export class CrearOportunidadDto {
  /** Una de las dos: persona existente, o los datos para darla de alta acá mismo. */
  @IsOptional() @IsUUID() personaId?: string;

  @IsOptional() @ValidateNested() @Type(() => CrearPersonaDto)
  persona?: CrearPersonaDto;

  @IsOptional() @IsUUID() operacionId?: string;
  @IsOptional() @IsUUID() agenteId?: string;

  @IsOptional() @IsIn(ORIGENES as unknown as string[]) origen?: string;
  @IsOptional() @IsString() @MaxLength(60) portalOrigen?: string;
  @IsOptional() @IsIn(['venta', 'alquiler']) interes?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  presupuestoMin?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  presupuestoMax?: number;

  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
  @IsOptional() @IsString() @MaxLength(4000) notas?: string;
}

export class EditarOportunidadDto {
  @IsOptional() @IsIn(ESTADOS_OPORTUNIDAD as unknown as string[]) estado?: string;
  @IsOptional() @IsString() @MaxLength(200) motivoPerdida?: string;
  @IsOptional() @IsUUID() agenteId?: string;
  @IsOptional() @IsUUID() operacionId?: string;
  @IsOptional() @IsString() @MaxLength(4000) notas?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  presupuestoMin?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  presupuestoMax?: number;
}

export class FiltroOportunidadesDto extends PaginacionDto {
  @IsOptional() @IsIn(ESTADOS_OPORTUNIDAD as unknown as string[]) estado?: string;
  @IsOptional() @IsUUID() agenteId?: string;
}

export class CrearVisitaDto {
  @IsISO8601() fechaHora!: string;
  @IsOptional() @IsUUID() operacionId?: string;
  @IsOptional() @IsUUID() agenteId?: string;
}

export class EditarVisitaDto {
  @IsOptional() @IsIn(['agendada', 'realizada', 'cancelada', 'ausente']) estado?: string;
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
  @IsOptional() @IsISO8601() fechaHora?: string;
}

export class CrearReservaDto {
  @IsUUID() operacionId!: string;
  @IsUUID() personaId!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  monto!: number;

  @IsIn(['ARS', 'USD']) moneda!: string;
  @IsOptional() @IsISO8601() venceEl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
}

export class EditarReservaDto {
  @IsIn(['activa', 'convertida', 'caida', 'vencida']) estado!: string;
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
}

/**
 * El filtro de la agenda.
 *
 * `agenteId` acepta el centinela `'yo'` además de un uuid — es el mismo que ya
 * usan los listados por agente, y por eso NO lleva `@IsUUID()`: validarlo como
 * uuid obligaría a inventar otra forma de decir «lo mío».
 */
export class AgendaDto {
  @IsOptional() @IsString() @MaxLength(40) agenteId?: string;

  /** Cuántos días hacia adelante. Dos semanas por defecto. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) dias?: number;
}
