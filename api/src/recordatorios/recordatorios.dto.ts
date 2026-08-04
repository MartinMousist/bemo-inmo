import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const TIPOS_EVENTO = [
  'contrato_por_vencer',
  'ajuste_por_aplicar',
  'cuota_impaga',
  'reserva_por_vencer',
  'visita_agendada',
  'garantia_por_vencer',
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
