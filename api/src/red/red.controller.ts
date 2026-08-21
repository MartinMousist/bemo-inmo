import { Modulo } from '../planes/modulo.guard';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import {
  IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RedService } from './red.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

class BuscarRedDto {
  @IsOptional() @IsIn(['venta', 'alquiler', 'alquiler_temporario'])
  operacion?: string;

  @IsOptional()
  @IsIn(['departamento','casa','ph','local','oficina','galpon','terreno','cochera','campo'])
  tipo?: string;

  @IsOptional() @IsString() @MaxLength(80)
  localidad?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  precioMin?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  precioMax?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100)
  limite?: number;
}

class CompartirDto {
  @IsBoolean()
  compartida!: boolean;

  /**
   * Lo que se ofrece a quien traiga el comprador. Opcional a propósito: hay
   * quien prefiere publicar y negociarlo caso por caso.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  comisionPct?: number;
}

@Modulo('red')
@Controller('red')
export class RedController {
  constructor(private readonly red: RedService) {}

  /**
   * Cuántas propiedades y cuántas inmobiliarias hay del otro lado.
   *
   * Existe para que la pantalla pueda decir la verdad cuando la Red está vacía,
   * en vez de mostrar una tabla sin resultados que parece un error.
   */
  @Get('pulso')
  @Roles('owner', 'admin', 'agente')
  pulso(@ActorActual() a: Actor) {
    return this.red.pulso(a.tenantId);
  }

  // Antes de `:id` cualquiera: Nest resuelve por orden de declaración.
  @Get('mias')
  @Roles('owner', 'admin', 'agente')
  mias(@ActorActual() a: Actor) {
    return this.red.misCompartidas(a.tenantId);
  }

  @Get()
  @Roles('owner', 'admin', 'agente')
  buscar(@ActorActual() a: Actor, @Query() q: BuscarRedDto) {
    return this.red.buscar(a.tenantId, q);
  }

  /**
   * Publicar o bajar una propiedad de la Red.
   *
   * Sin `agente`: mostrarle la cartera a otras inmobiliarias, y con cuánta
   * comisión, es una decisión comercial de quien dirige. Un asesor puede
   * BUSCAR en la Red —eso le sirve para vender— pero no decide qué se ofrece.
   */
  @Put('propiedades/:id')
  @Roles('owner', 'admin')
  compartir(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: CompartirDto,
  ) {
    return this.red.compartir(a.tenantId, id, d);
  }
}
