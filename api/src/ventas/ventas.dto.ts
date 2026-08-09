import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../common/paginacion';
import { FiltroConAgenteDto } from '../common/filtro-agente';

export const ESTADOS_VENTA = ['en_curso', 'boleto', 'escriturada', 'caida'] as const;

export class ExternaDto {
  @IsString() @MaxLength(120) nombre!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) porcentaje!: number;
  /** La ficha del catálogo, si salió de ahí. Opcional: se puede compartir con
   *  una agencia que todavía no está cargada. */
  @IsOptional() @IsUUID() externaId?: string;
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

/**
 * Los honorarios por punta.
 *
 * Las cuatro puntas van declaradas y todas opcionales: una venta usa
 * compradora/vendedora y un alquiler locataria/locadora, y el mismo DTO sirve
 * para los dos. Lo que NO se admite es una punta inventada.
 *
 * Antes esto era un `@IsObject()` pelado y class-validator no mira adentro:
 * `{"puntas":{"foo":3}}` llegaba entero al motor, se armaba una fila con
 * `punta = 'foo'` y la que cortaba era la CHECK de Postgres — un **500** en vez
 * de un 422 que dice qué está mal. Estaba tapado porque la única pantalla que
 * mandaba un reparto tipeaba las puntas a mano.
 */
export class PuntasDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  compradora?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  vendedora?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  locataria?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  locadora?: number;
}

/**
 * Con quién se comparte cada punta.
 *
 * Mismo problema que arriba y peor: `{"externas":{"vendedora":{"porcentaje":50}}}`
 * sin `nombre` insertaba `beneficiario_nombre = NULL` y reventaba contra la
 * CHECK `beneficiario_tipo <> 'inmobiliaria_externa' OR beneficiario_nombre IS
 * NOT NULL`. Otro 500. Y es justo el campo que esta etapa expone en la
 * pantalla, así que dejaba de estar tapado.
 */
export class ExternasDto {
  @IsOptional() @ValidateNested() @Type(() => ExternaDto) compradora?: ExternaDto;
  @IsOptional() @ValidateNested() @Type(() => ExternaDto) vendedora?: ExternaDto;
  @IsOptional() @ValidateNested() @Type(() => ExternaDto) locataria?: ExternaDto;
  @IsOptional() @ValidateNested() @Type(() => ExternaDto) locadora?: ExternaDto;
}

export class RepartoDto {
  /**
   * { compradora: 3, vendedora: 3 } — % sobre el precio de cierre.
   *
   * OBLIGATORIO. Ya se intentó una vez hacerlo opcional «porque el servidor
   * puede sugerirlo» y se revirtió: sin fallback, un reparto sin puntas no
   * calcula nada y la venta queda con cero comisiones sin que nadie se entere.
   * El servidor sugiere por otro endpoint; el front rellena y manda.
   */
  @ValidateNested() @Type(() => PuntasDto) puntas!: PuntasDto;

  /** { vendedora: { nombre: 'Otra', porcentaje: 50 } } */
  @IsOptional() @ValidateNested() @Type(() => ExternasDto) externas?: ExternasDto;

  @IsOptional() @ValidateNested() @Type(() => RepartoInternoDto)
  repartoInterno?: RepartoInternoDto;
}

export class ExternaCrearDto {
  @IsString() @MaxLength(120) nombre!: string;
  @IsOptional() @IsString() @MaxLength(20) cuit?: string;
  @IsOptional() @IsString() @MaxLength(120) contacto?: string;
  @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
}

export class ExternaEditarDto extends ExternaCrearDto {
  @IsOptional() @IsString() @MaxLength(120) declare nombre: string;
  @IsOptional() @IsBoolean() activa?: boolean;
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

/**
 * El override de comisiones de UNA operación. Las dos secciones son
 * opcionales: mandar `{}` limpia el override y la operación vuelve a heredar.
 *
 * Va acá abajo y no arriba con el resto del reparto **por el orden de
 * evaluación**, que en este archivo no es cosmético: con `emitDecoratorMetadata`
 * el decorador guarda el tipo de la propiedad al definir la clase, así que
 * referenciar `PuntasVentaDto` antes de su `class` explota en el arranque con
 * «Cannot access before initialization» — no en el typecheck, que pasa
 * perfecto, sino cuando Nest carga el módulo.
 */
export class ComisionesOperacionDto {
  @IsOptional() @ValidateNested() @Type(() => PuntasVentaDto) venta?: PuntasVentaDto;
  @IsOptional() @ValidateNested() @Type(() => PuntasAlquilerDto) alquiler?: PuntasAlquilerDto;
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

/**
 * `q` busca por código de propiedad, calle, localidad o nombre del comprador.
 *
 * `agenteId` (heredado) trae las ventas donde esa persona **cobra comisión o
 * captó la propiedad**. Ver el comentario de `listar()` en `ventas.service.ts`:
 * el criterio es doble a propósito, porque una venta sin reparto todavía no
 * tiene ni una comisión.
 */
export class FiltroVentasDto extends FiltroConAgenteDto {
  @IsOptional() @IsIn(ESTADOS_VENTA as unknown as string[]) estado?: string;
}
