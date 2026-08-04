import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginacionDto } from '../common/paginacion';

export const MEDIOS_COBRO = [
  'efectivo', 'transferencia', 'cheque', 'debito', 'otro',
] as const;

export class FiltroCajaDto extends PaginacionDto {
  /** Sin fechas, es el día de hoy: es la pregunta que se hace al cerrar. */
  @IsOptional() @IsISO8601() desde?: string;
  @IsOptional() @IsISO8601() hasta?: string;
  @IsOptional() @IsIn(MEDIOS_COBRO as unknown as string[]) medio?: string;

  /** Un día de cobranza son decenas de movimientos, no cientos. */
  override porPagina: number = 100;
}
