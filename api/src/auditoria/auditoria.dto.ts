import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginacionDto } from '../common/paginacion';
import { ACCIONES } from './auditoria.service';

/** `q` busca por nombre de quien lo hizo o por el detalle del asiento. */
export class FiltroAuditoriaDto extends PaginacionDto {
  @IsOptional() @IsIn(ACCIONES as unknown as string[]) accion?: string;
  @IsOptional() @IsISO8601() desde?: string;
  @IsOptional() @IsISO8601() hasta?: string;

  /** El caso normal es "mostrame el último tiempo", no "la página 1 de 40". */
  override porPagina: number = 50;
}
