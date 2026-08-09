import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';
import { FiltroConAgenteDto } from '../common/filtro-agente';

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

  /**
   * A quién le corresponde el interés por mora. Va por contrato y no como regla
   * global porque no hay una sola respuesta: en la mayoría compensa al
   * propietario por la plata que no cobró a tiempo, pero es negociable.
   *
   * El default 'propietario' es el que NO le da plata extra a quien administra
   * sin que el dueño lo haya acordado.
   */
  @IsOptional() @IsIn(['propietario', 'inmobiliaria']) punitorioPara?: string;

  @IsOptional() @IsIn(['borrador', 'por_iniciar', 'vigente']) estado?: string;
  @IsOptional() @IsString() @MaxLength(4000) notas?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LocadorDto)
  locadores?: LocadorDto[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) locatarios?: string[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) garantes?: string[];
}

export const ESTADOS_CONTRATO = [
  'borrador', 'por_iniciar', 'vigente', 'vencido', 'rescindido', 'renovado',
] as const;

/**
 * `agenteId` hereda de `FiltroConAgenteDto` y, en alquileres, es el **captador
 * de la propiedad**: `contrato_alquiler` no tiene columna de agente propia.
 * La pantalla lo rotula «Captador» por eso mismo. Si algún día hace falta «lo
 * que coloqué yo», es una columna nueva (`agente_colocador_id`) con su
 * migración, no un rótulo distinto sobre el mismo dato.
 */
export class FiltroContratosDto extends FiltroConAgenteDto {
  @IsOptional()
  @IsIn(ESTADOS_CONTRATO as unknown as string[])
  estado?: string;
}

export class FiltroVencimientosDto extends PaginacionDto {
  /** Ventana hacia adelante. Máximo un año: más allá no es "lo que vence". */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) dias?: number;
  @IsOptional() @IsIn(['contrato', 'ajuste', 'cuota']) tipo?: string;

  /** Es un tablero: se mira de corrido, no de a 25. */
  override porPagina: number = 100;
}

export const ESTADOS_COBRANZA = ['al_dia', 'parcial', 'en_mora', 'sin_cuotas'] as const;

/** `q` busca por calle, localidad, código de propiedad o nombre de una parte. */
export class FiltroCarteraDto extends FiltroContratosDto {
  @IsOptional() @IsIn(ESTADOS_COBRANZA as unknown as string[]) cobranza?: string;
  @IsOptional() @IsIn(INDICES as unknown as string[]) indice?: string;

  /**
   * Mes de vencimiento del contrato, `YYYY-MM`.
   *
   * No es `@IsISO8601`: eso aceptaría un día suelto y acá el filtro es por mes.
   * El regex es explícito para que `2026-13` sea un 400 y no una consulta que
   * devuelve vacío sin decir por qué.
   */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'venceEn tiene que ser YYYY-MM' })
  venceEn?: string;
}

/** Selección múltiple de la cartera: generar cuotas o proyectar ajustes en tanda. */
export class LoteContratosDto {
  // Tope de 200: es una acción de una pantalla, no una migración. Sin límite,
  // un cliente puede mandar 10.000 ids y dejar la conexión ocupada un rato largo.
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) ids!: string[];
  @IsOptional() @IsISO8601() hasta?: string;
}

export class GenerarPeriodosDto {
  @IsOptional() @IsISO8601() hasta?: string;
}

export class RegistrarCobroDto {
  @IsUUID() periodoId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto!: number;

  /**
   * A qué se imputa el pago. Por defecto al alquiler.
   *
   * Sin esto, cobrar el interés por mora obligaría a inflar el monto de la cuota
   * y el saldo dejaría de cuadrar contra lo pactado.
   */
  @IsOptional() @IsIn(['alquiler', 'punitorio']) imputacion?: 'alquiler' | 'punitorio';
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

/**
 * Renovar hereda todo lo que no cambia (partes, índice, honorarios, punitorio,
 * depósito). Acá va sólo lo que se negocia.
 */
export class RenovarContratoDto {
  @IsISO8601() fechaInicio!: string;
  @IsISO8601() fechaFin!: string;

  /** Si no viene, se arranca del alquiler VIGENTE, no del inicial del anterior. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  montoInicial?: number;

  @IsOptional() @IsIn(INDICES as unknown as string[]) indice?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) periodicidadMeses?: number;
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
}

export class DescuentoDepositoDto {
  @IsString() @Length(3, 160) concepto!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto!: number;
}

export class DevolverDepositoDto {
  @IsOptional() @IsISO8601() fecha?: string;

  /**
   * Cada descuento con su concepto. El detalle y no sólo el neto: "te devolví
   * menos" sin decir por qué es la palabra de uno contra la del otro.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => DescuentoDepositoDto)
  descuentos?: DescuentoDepositoDto[];
}

export class CondonarPunitorioDto {
  /**
   * Obligatorio a propósito: es plata que alguien resigna en nombre del
   * propietario, y "porque sí" no es una respuesta que se le pueda dar después.
   */
  @IsString() @Length(3, 300) motivo!: string;
}

export const ESTADOS_LIQUIDACION = ['borrador', 'cerrada', 'pagada'] as const;

/** `q` busca por nombre del propietario. */
export class FiltroLiquidacionesDto extends PaginacionDto {
  @IsOptional() @IsISO8601() periodo?: string;
  @IsOptional() @IsIn(ESTADOS_LIQUIDACION as unknown as string[]) estado?: string;
}

/** `q` busca por tipo o fuente del índice. */
export class FiltroIndicesDto extends PaginacionDto {
  @IsOptional() @IsIn(INDICES_PUBLICADOS as unknown as string[]) tipo?: string;
  @IsOptional() @IsISO8601() desde?: string;
  /**
   * Cierra la ventana. Sin esto sólo se podía pedir "de tal mes en adelante", y
   * mirar un año concreto obligaba a traer todo lo posterior y descartarlo.
   */
  @IsOptional() @IsISO8601() hasta?: string;

  /**
   * Los índices se listan de a más: son ~74 períodos por tipo y la pantalla los
   * muestra en columna. 25 por página obligaría a paginar para ver un año.
   */
  override porPagina: number = 100;
}
