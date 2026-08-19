import { Transform, Type } from 'class-transformer';
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
import { FiltroConAgenteDto } from '../common/filtro-agente';

export const TIPOS_PROPIEDAD = [
  'departamento', 'casa', 'ph', 'local', 'oficina',
  'galpon', 'terreno', 'cochera', 'campo',
] as const;

export const TIPOS_OPERACION = ['venta', 'alquiler', 'alquiler_temporario'] as const;
export const MONEDAS = ['ARS', 'USD'] as const;

/**
 * Los catálogos de la migración 027, en el mismo lugar que los de arriba.
 *
 * Van acá y no en el service porque son la fuente de verdad que valida el DTO
 * — y el front los espeja en `dominio/catalogos-propiedad.ts` para armar
 * selects y checkboxes con las mismas claves. Un catálogo cerrado es lo que
 * permite filtrar por igualdad en vez de por lo que cada quien tipeó: sin
 * esto, «orientación norte» no encuentra las filas que dicen «Norte».
 */
export const ORIENTACIONES = [
  'norte', 'noreste', 'este', 'sureste',
  'sur', 'suroeste', 'oeste', 'noroeste',
] as const;

export const DISPOSICIONES = ['frente', 'contrafrente', 'lateral', 'interno'] as const;

export const CALEFACCIONES = [
  'central', 'individual', 'radiadores', 'losa_radiante',
  'aire_frio_calor', 'a_lena', 'sin_calefaccion',
] as const;

/**
 * Migración 028. `condominio` acá es el LOTEO —un conjunto chico de unidades
 * con espacios comunes—, no la titularidad compartida que ya usa esa palabra
 * en `titularidad`: son dos sentidos del rubro inmobiliario que coinciden en
 * el nombre y no tienen relación entre sí.
 */
export const URBANIZACIONES = ['abierto', 'barrio_privado', 'country', 'condominio'] as const;

/**
 * Lo que puede tener una propiedad, agrupado sólo para la pantalla —acá es una
 * lista plana porque es lo único que el DTO necesita para validar—.
 *
 * Los primeros once son los que YA usan los seeds (`ascensor`, `balcon`,
 * `deposito`, `parque`, `parrilla`, `patio`, `pileta`, `quincho`, `seguridad`,
 * `sum`, `vidriera`): agregar el catálogo no les cambia el valor a esas filas.
 */
export const AMENITIES = [
  // Ya sembrados
  'ascensor', 'balcon', 'deposito', 'parque', 'parrilla', 'patio',
  'pileta', 'quincho', 'seguridad', 'sum', 'vidriera',
  // Edificio
  'gimnasio', 'solarium', 'laundry', 'cowork', 'generador',
  // Unidad
  'terraza', 'jardin', 'baulera', 'placards', 'vestidor',
  'lavadero', 'aire_acondicionado',
  // Seguridad
  'portero', 'camaras', 'alarma',
  // Aptitud
  'apto_credito', 'apto_profesional', 'apto_comercial', 'pet_friendly',
  'amoblado', 'luminoso',
] as const;

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

  /**
   * Si vienen, se respetan y NO se geocodifica. Es la salida manual cuando no
   * hay API key **o cuando Google ubica mal la dirección** — el segundo caso no
   * desaparece el día que llegue la key.
   *
   * Van SIEMPRE de a dos. En un PATCH, `null` explícito en las dos significa
   * «borrá las coordenadas», y ausentes significa «no las toques»: es la misma
   * distinción undefined/null del captador. Media coordenada —una sola de las
   * dos con valor— es un 422, porque antes borraba las dos en silencio.
   *
   * El tipo admite `null` por eso: `@Type(() => Number)` deja pasar el `null`
   * sin convertirlo a 0 (verificado) y `@IsOptional()` no lo valida.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number | null;

  @IsIn(TIPOS_PROPIEDAD as unknown as string[]) tipo!: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supTotal?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supCubierta?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) ambientes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) dormitorios?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) banos?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) cocheras?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(300) antiguedad?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50) plantas?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) toilettes?: number;

  @IsOptional() @IsIn(ORIENTACIONES as unknown as string[]) orientacion?: string;
  @IsOptional() @IsIn(DISPOSICIONES as unknown as string[]) disposicion?: string;
  @IsOptional() @IsIn(CALEFACCIONES as unknown as string[]) calefaccion?: string;
  @IsOptional() @IsIn(URBANIZACIONES as unknown as string[]) tipoUrbanizacion?: string;
  @IsOptional() @IsString() @MaxLength(120) nombreComplejo?: string;
  @IsOptional() @IsString() @MaxLength(40) estadoConservacion?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(40)
  @IsIn(AMENITIES as unknown as string[], { each: true })
  amenities?: string[];

  @IsOptional() @IsString() @MaxLength(5000) descripcion?: string;
  @IsOptional() @IsString() @MaxLength(5000) notasInternas?: string;
  /**
   * Quién captó la propiedad.
   *
   * `null` explícito significa **desasignar** y no «no vino»: es la excepción a
   * la regla del PATCH parcial, igual que el % de comisión de un agente. Ver el
   * comentario del UPDATE en `propiedades.service.ts`. Por eso el tipo admite
   * `null` en vez de sólo `string | undefined`.
   */
  @IsOptional() @IsUUID() agenteCaptadorId?: string | null;

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

/**
 * Un multi-select en la URL puede llegar de dos formas: `?x=a&x=b` (Express ya
 * lo arma como array) o `?x=a,b` (un solo valor, más corto de escribir a mano
 * y lo que arma un `<select multiple>` simple). Sin este transform, la segunda
 * forma llega como el STRING `"a,b"` y `@IsIn` la rechaza porque `"a,b"` no es
 * ninguna de las claves del catálogo.
 */
function listaDesdeQuery({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length) return value.split(',');
  return value;
}

export class FiltroPropiedadesDto extends FiltroConAgenteDto {
  @IsOptional() @IsIn(TIPOS_PROPIEDAD as unknown as string[]) tipo?: string;
  @IsOptional() @IsIn(TIPOS_OPERACION as unknown as string[]) operacion?: string;
  @IsOptional() @IsIn(['borrador', 'disponible', 'reservada', 'cerrada', 'suspendida'])
  estado?: string;

  // ── Rangos ───────────────────────────────────────────────────────────────
  //
  // `Min` y `Max` inclusive, y ninguno obliga al otro: «desde 3 ambientes» es
  // un filtro tan válido como «entre 2 y 4». La regla del NULLS del `donde` es
  // la misma que ya usa el resto de la query: el filtro no aplica si no vino.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) ambientesMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) ambientesMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dormitoriosMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dormitoriosMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) banosMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) banosMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) toilettesMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) toilettesMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) cocherasMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) cocherasMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) plantasMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) plantasMax?: number;

  // Sólo el máximo: en un portal se busca «hasta 10 años», nunca «entre 8 y 12
  // años exactos» — la pregunta real es «qué tan nueva», con piso en 0 siempre.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(300) antiguedadMax?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supTotalMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supTotalMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supCubiertaMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supCubiertaMax?: number;

  // ── Multi-select ─────────────────────────────────────────────────────────
  @IsOptional() @Transform(listaDesdeQuery) @IsArray()
  @IsIn(ORIENTACIONES as unknown as string[], { each: true })
  orientacion?: string[];

  @IsOptional() @Transform(listaDesdeQuery) @IsArray()
  @IsIn(DISPOSICIONES as unknown as string[], { each: true })
  disposicion?: string[];

  @IsOptional() @Transform(listaDesdeQuery) @IsArray()
  @IsIn(CALEFACCIONES as unknown as string[], { each: true })
  calefaccion?: string[];

  @IsOptional() @Transform(listaDesdeQuery) @IsArray()
  @IsIn(URBANIZACIONES as unknown as string[], { each: true })
  tipoUrbanizacion?: string[];

  /**
   * «Tiene TODOS estos» (`@>` en el service), no «tiene alguno». Es la
   * pregunta que se hace quien filtra: pedir pileta y seguridad y recibir una
   * propiedad con seguridad pero sin pileta no es lo que se pidió.
   */
  @IsOptional() @Transform(listaDesdeQuery) @IsArray() @ArrayMaxSize(40)
  @IsIn(AMENITIES as unknown as string[], { each: true })
  amenities?: string[];

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

  /**
   * Las que NO tienen captador asignado.
   *
   * Es un estado real y no un caso raro: el importador de CSV ni siquiera lista
   * la columna `agente_captador_id` en su INSERT, así que **toda** propiedad que
   * entra por importación nace sin captador. Sin esta opción, «¿cuáles quedaron
   * sin dueño de la captación?» no se puede contestar desde la pantalla.
   *
   * Va como campo aparte y no como un valor centinela de `agenteId` (tipo
   * `agenteId=sin-asignar`) porque `agenteId` es un uuid validado: meterle una
   * palabra mágica obligaría a aflojar el `@IsUUID()` de los seis listados para
   * que uno solo pueda decir «ninguno».
   *
   * `@Transform` y no `@Type(() => Boolean)`: `Boolean('false')` es `true`, así
   * que con el transform de tipo mandar `sinCaptador=false` filtraría igual.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  sinCaptador?: boolean;
}
