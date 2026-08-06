import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Los mismos seis tipos que admite la tabla desde la migración 007. */
export const TIPOS_GARANTIA = [
  'propietaria', 'recibo_sueldo', 'seguro_caucion',
  'garante_solidario', 'deposito_ampliado', 'otra',
] as const;

export const TIPOS_DOCUMENTO = [
  'dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3', 'otro',
] as const;

export class CrearGaranteDto {
  /** El garante es una persona del sistema: así se lo puede buscar y reusar. */
  @IsUUID() personaId!: string;
  @IsOptional() @IsIn(TIPOS_GARANTIA as unknown as string[]) tipo?: string;
  @IsOptional() @IsString() @MaxLength(500) detalle?: string;
  @IsOptional() @IsISO8601() venceEl?: string;
}

export class EditarGaranteDto {
  @IsOptional() @IsIn(TIPOS_GARANTIA as unknown as string[]) tipo?: string;
  @IsOptional() @IsString() @MaxLength(500) detalle?: string;
  @IsOptional() @IsISO8601() venceEl?: string;
  /** El día que firmó el contrato. Todos los garantes tienen que firmarlo. */
  @IsOptional() @IsISO8601() firmoEl?: string;
}

export class SubirDocumentoDto {
  @IsIn(TIPOS_DOCUMENTO as unknown as string[]) tipo!: string;
  /**
   * La imagen en base64, igual que las fotos de una propiedad: el límite de
   * body ya está fijado por ruta y no hace falta sumar un parser de multipart.
   */
  @IsString() @MaxLength(14_000_000) datos!: string;
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
}
