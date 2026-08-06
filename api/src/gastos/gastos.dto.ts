import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString,
  IsUUID, MaxLength, Min,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const TIPOS_GASTO = [
  'reparacion', 'impuesto', 'expensas', 'servicio', 'seguro', 'otro',
] as const;
export const A_CARGO = ['propietario', 'inquilino', 'inmobiliaria'] as const;
export const ESTADOS_GASTO = ['registrado', 'rendido', 'anulado'] as const;

export const CATEGORIAS_RECLAMO = [
  'plomeria', 'electricidad', 'gas', 'humedad', 'cerrajeria',
  'climatizacion', 'estructura', 'artefactos', 'limpieza', 'otro',
] as const;
export const PRIORIDADES = ['baja', 'normal', 'alta', 'urgente'] as const;
export const ESTADOS_RECLAMO = ['abierto', 'en_curso', 'resuelto', 'cancelado'] as const;

// ── Proveedores ──────────────────────────────────────────────────────────────

export class CrearProveedorDto {
  @IsString() @MaxLength(160)
  nombre!: string;

  @IsOptional() @IsString() @MaxLength(80)
  rubro?: string;

  @IsOptional() @IsString() @MaxLength(20)
  cuit?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(160)
  email?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notas?: string;
}

export class EditarProveedorDto extends CrearProveedorDto {
  @IsOptional() @IsString() @MaxLength(160)
  declare nombre: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}

export class FiltroProveedoresDto extends PaginacionDto {
  @IsOptional() @IsString() @MaxLength(80)
  rubro?: string;

  /** Por defecto sólo los activos: un desactivado es historia, no una opción. */
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  incluirInactivos?: boolean;
}

// ── Gastos ───────────────────────────────────────────────────────────────────

export class CrearGastoDto {
  @IsUUID()
  propiedadId!: string;

  @IsOptional() @IsUUID()
  contratoId?: string;

  @IsOptional() @IsUUID()
  proveedorId?: string;

  @IsOptional() @IsUUID()
  reclamoId?: string;

  @IsString() @MaxLength(200)
  concepto!: string;

  @IsIn(TIPOS_GASTO)
  tipo!: (typeof TIPOS_GASTO)[number];

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  monto!: number;

  @IsIn(['ARS', 'USD'])
  moneda!: 'ARS' | 'USD';

  @IsOptional() @IsDateString()
  fecha?: string;

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsString() @MaxLength(120)
  comprobante?: string;

  @IsOptional() @IsString() @MaxLength(500)
  docUrl?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notas?: string;
}

export class EditarGastoDto {
  @IsOptional() @IsString() @MaxLength(200)
  concepto?: string;

  @IsOptional() @IsIn(TIPOS_GASTO)
  tipo?: (typeof TIPOS_GASTO)[number];

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  monto?: number;

  @IsOptional() @IsIn(['ARS', 'USD'])
  moneda?: 'ARS' | 'USD';

  @IsOptional() @IsDateString()
  fecha?: string;

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsUUID()
  proveedorId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  comprobante?: string;

  @IsOptional() @IsString() @MaxLength(500)
  docUrl?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notas?: string;
}

export class FiltroGastosDto extends PaginacionDto {
  @IsOptional() @IsUUID()
  propiedadId?: string;

  @IsOptional() @IsUUID()
  contratoId?: string;

  @IsOptional() @IsIn(ESTADOS_GASTO)
  estado?: (typeof ESTADOS_GASTO)[number];

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsIn(TIPOS_GASTO)
  tipo?: (typeof TIPOS_GASTO)[number];

  @IsOptional() @IsDateString()
  desde?: string;

  @IsOptional() @IsDateString()
  hasta?: string;
}

// ── Reclamos ─────────────────────────────────────────────────────────────────

export class CrearReclamoDto {
  @IsUUID()
  propiedadId!: string;

  @IsOptional() @IsUUID()
  contratoId?: string;

  @IsIn(CATEGORIAS_RECLAMO)
  categoria!: (typeof CATEGORIAS_RECLAMO)[number];

  @IsString() @MaxLength(4000)
  descripcion!: string;

  @IsOptional() @IsIn(PRIORIDADES)
  prioridad?: (typeof PRIORIDADES)[number];

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsUUID()
  proveedorId?: string;

  @IsOptional() @IsUUID()
  reportadoPor?: string;
}

export class EditarReclamoDto {
  @IsOptional() @IsIn(CATEGORIAS_RECLAMO)
  categoria?: (typeof CATEGORIAS_RECLAMO)[number];

  @IsOptional() @IsString() @MaxLength(4000)
  descripcion?: string;

  @IsOptional() @IsIn(PRIORIDADES)
  prioridad?: (typeof PRIORIDADES)[number];

  /**
   * `resuelto` NO se pone por acá: tiene su propio endpoint porque exige un
   * texto de resolución y sella la fecha. Un cambio de estado que además
   * congela datos no es un PATCH.
   */
  @IsOptional() @IsIn(['abierto', 'en_curso', 'cancelado'])
  estado?: 'abierto' | 'en_curso' | 'cancelado';

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsUUID()
  proveedorId?: string;
}

export class ResolverReclamoDto {
  @IsString() @MaxLength(2000)
  resolucion!: string;

  /** Si el arreglo tuvo costo, se carga el gasto en el mismo movimiento. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  monto?: number;

  @IsOptional() @IsIn(['ARS', 'USD'])
  moneda?: 'ARS' | 'USD';

  @IsOptional() @IsIn(A_CARGO)
  aCargoDe?: (typeof A_CARGO)[number];

  @IsOptional() @IsUUID()
  proveedorId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  comprobante?: string;
}

export class FiltroReclamosDto extends PaginacionDto {
  @IsOptional() @IsUUID()
  propiedadId?: string;

  @IsOptional() @IsUUID()
  contratoId?: string;

  @IsOptional() @IsIn(ESTADOS_RECLAMO)
  estado?: (typeof ESTADOS_RECLAMO)[number];

  @IsOptional() @IsIn(PRIORIDADES)
  prioridad?: (typeof PRIORIDADES)[number];

  @IsOptional() @IsIn(CATEGORIAS_RECLAMO)
  categoria?: (typeof CATEGORIAS_RECLAMO)[number];

  /** Abiertos y en curso, que es lo que se mira todos los días. */
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  soloPendientes?: boolean;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  diasSinMover?: number;
}
