import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsOptional } from 'class-validator';
import { TableroService } from './tablero.service';
import { ActorActual, type Actor } from '../auth/decoradores';

export class FiltroTableroDto {
  /**
   * Mes a mirar, en `YYYY-MM-DD`. Se normaliza al día 1 en el servicio: un
   * período es un mes, no una fecha.
   */
  @IsOptional()
  @IsDateString()
  periodo?: string;
}

@Controller('tablero')
export class TableroController {
  constructor(private readonly tablero: TableroService) {}

  /**
   * Sin `@Roles`, igual que `/inicio` y por la misma razón: lo que cambia por
   * rol es el CONTENIDO, no el acceso. Un asesor entra y ve el embudo y la
   * cartera —que es su trabajo— con `cobranza` y `negocio` en `null`.
   *
   * Filtrar después de consultar daría el mismo resultado en pantalla y dejaría
   * la plata viajando por un lugar donde no tenía que estar. Un permiso que se
   * puede esquivar por otra puerta no es un permiso.
   */
  @Get()
  resumen(@ActorActual() a: Actor, @Query() f: FiltroTableroDto) {
    return this.tablero.resumen(a.tenantId, a.rol, f.periodo);
  }
}
