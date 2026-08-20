import { Transform } from 'class-transformer';
import {
  IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const CANALES = ['whatsapp', 'telegram', 'email', 'instagram', 'facebook', 'sms'] as const;
export const PROVEEDORES = ['twilio', 'telegram', 'smtp', 'meta'] as const;
export const ESTADOS_CONVERSACION = ['abierta', 'resuelta', 'archivada', 'bloqueada'] as const;

export class FiltroConversacionesDto extends PaginacionDto {
  @IsOptional() @IsIn(ESTADOS_CONVERSACION as unknown as string[]) estado?: string;
  @IsOptional() @IsIn(CANALES as unknown as string[]) canal?: string;
  @IsOptional() @IsUUID() cuentaId?: string;
  @IsOptional() @IsUUID() asignadoA?: string;

  /**
   * `@Transform` y no `@Type(() => Boolean)`: `Boolean('false')` es `true`, y
   * el filtro quedaría siempre encendido. Es la misma trampa que ya documentó
   * el DTO de propiedades.
   */
  @IsOptional() @Transform(aBooleano) soloMios?: boolean;
  @IsOptional() @Transform(aBooleano) noLeidos?: boolean;

  // `q` lo hereda de PaginacionDto: buscar por texto ya está resuelto ahí y
  // redeclararlo acá sólo crea dos reglas de validación para lo mismo.
}

/** `'true'` y `'1'` son verdadero; cualquier otra cosa, falso. */
function aBooleano({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true' || value === '1';
}

export class ResponderDto {
  @IsString() @MinLength(1) @MaxLength(4000) texto!: string;
}

export class AsignarDto {
  /** `null` para sacarle el dueño a la conversación. */
  @IsOptional() @IsUUID() usuarioId?: string | null;
}

export class EstadoConversacionDto {
  @IsIn(ESTADOS_CONVERSACION as unknown as string[]) estado!: string;
}

export class BanderaDto {
  @IsBoolean() valor!: boolean;
}

export class CrearCuentaCanalDto {
  @IsIn(CANALES as unknown as string[]) canal!: string;
  @IsIn(PROVEEDORES as unknown as string[]) proveedor!: string;
  @IsString() @MinLength(2) @MaxLength(60) nombre!: string;
  @IsString() @MinLength(1) @MaxLength(200) identificador!: string;
  /** Entra y no sale: se guarda cifrado y no hay endpoint que lo devuelva. */
  @IsOptional() @IsString() @MaxLength(500) secreto?: string;
  @IsOptional() config?: Record<string, unknown>;
}

export class EditarCuentaCanalDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) nombre?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) identificador?: string;
  @IsOptional() @IsBoolean() activa?: boolean;
  /** Cadena vacía BORRA la credencial; ausente la deja como está. */
  @IsOptional() @IsString() @MaxLength(500) secreto?: string;
  @IsOptional() config?: Record<string, unknown>;
}
