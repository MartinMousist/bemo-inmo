import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

/**
 * Paginación del lado del servidor desde el día uno.
 *
 * Una inmobiliaria de 500 propiedades no entra en memoria, y descubrirlo cuando
 * ya hay pantallas escritas contra un array completo obliga a reescribirlas.
 */
export class PaginacionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  porPagina: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export interface Pagina<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export function armarPagina<T>(
  items: T[],
  total: number,
  { pagina, porPagina }: PaginacionDto,
): Pagina<T> {
  return {
    items,
    total,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export function offset({ pagina, porPagina }: PaginacionDto): number {
  return (pagina - 1) * porPagina;
}
