import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

/**
 * Los mismos tipos que enumera el CHECK de `evento_programado`. Tienen que ir
 * en los dos lados: un tipo que la base acepta y este filtro no deja pasar
 * genera avisos que después nadie puede filtrar —el 400 sale recién cuando
 * alguien toca el desplegable, o sea en producción y no en un test—. Pasó al
 * agregar `garantia_revision_bcra` en la migración 019.
 */
export const TIPOS_EVENTO = [
  'contrato_por_vencer',
  'ajuste_por_aplicar',
  'cuota_impaga',
  'reserva_por_vencer',
  'visita_agendada',
  'garantia_por_vencer',
  'garantia_revision_bcra',

  // Etapa 18. Son los dos avisos que pide una bandeja omnicanal: que alguien
  // se entere de que hace falta una persona, y de que nadie contestó.
  'conversacion_escalada',
  'conversacion_sin_responder',
] as const;

/** `q` busca por título o detalle del aviso. */
export class FiltroAvisosDto extends PaginacionDto {
  /**
   * Por defecto la bandeja muestra lo que ya venció o vence hoy. `futuros=true`
   * suma lo que está programado más adelante.
   *
   * El `Transform` explícito existe porque el ValidationPipe corre con
   * `enableImplicitConversion: false` a propósito: en un query string todo llega
   * como texto, y sin esto `futuros=false` sería la cadena `"false"`, que es
   * `true`.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  futuros?: boolean;

  @IsOptional() @IsIn(TIPOS_EVENTO as unknown as string[]) tipo?: string;
}
