import { Type } from 'class-transformer';
import { IsNumber, Max, Min, ValidateIf } from 'class-validator';

/**
 * El % de una persona, en % de lo que le queda a la casa.
 *
 * Los dos campos van SIEMPRE y admiten `null` explícito: `null` significa
 * «heredá el reparto de la inmobiliaria» —así lo dice el COMMENT de la 017— y
 * es distinto de `0`, que es alguien que efectivamente no cobra por captar.
 *
 * Por eso `@ValidateIf(v !== null)` en vez de `@IsOptional()`: `@IsOptional()`
 * también deja pasar `null` pero, junto con un `?? null` del lado del
 * controlador, haría que **omitir** el campo se escriba como «heredar». Un
 * PATCH que sólo quiso tocar el del captador le borraría el override al
 * cerrador sin decir nada — la trampa de siempre, al revés. Con esto, mandar la
 * clave en `undefined` es un 400 y el front tiene que mandar la fila entera.
 */
export class ComisionesAgenteDto {
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  comisionCaptadorPct!: number | null;

  @ValidateIf((_, v) => v !== null)
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  comisionCerradorPct!: number | null;
}
