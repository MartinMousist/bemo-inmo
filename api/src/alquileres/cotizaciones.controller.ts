import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import {
  CotizacionesService, TIPOS_COTIZACION, type TipoCotizacion,
} from './cotizaciones.service';

const MONEDAS = ['ARS', 'USD'];

class CargarCotizacionDto {
  @IsISO8601() fecha!: string;
  /** ARS por un dólar. */
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) valor!: number;
}

class ConvertirDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monto!: number;
  @IsIn(MONEDAS) desde!: string;
  @IsIn(MONEDAS) hasta!: string;
  @IsIn(TIPOS_COTIZACION as unknown as string[]) tipo!: TipoCotizacion;
  /** Sin fecha, la de hoy. Con fecha, la vigente ese día. */
  @IsOptional() @IsISO8601() fecha?: string;
}

class ListarCotizacionesDto {
  @IsOptional() @IsIn(TIPOS_COTIZACION as unknown as string[]) tipo?: TipoCotizacion;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) dias?: number;
}

@Controller('cotizaciones')
export class CotizacionesController {
  constructor(private readonly cot: CotizacionesService) {}

  /** Sin `@Roles`: el tipo de cambio lo mira cualquiera que cargue una operación. */
  @Get()
  listar(@ActorActual() a: Actor, @Query() q: ListarCotizacionesDto) {
    return this.cot.listar(a.tenantId, q.tipo, q.dias ?? 30);
  }

  /**
   * Convertir con memoria de cálculo.
   *
   * `POST` y no `GET` aunque no escriba nada: el cuerpo lleva cinco campos y
   * meterlos en la query los deja en el historial del navegador y en los logs
   * del proxy. Es una calculadora, no un recurso.
   */
  @Post('convertir')
  convertir(@ActorActual() a: Actor, @Body() dto: ConvertirDto) {
    return this.cot.convertir(a.tenantId, dto.monto, dto.desde, dto.hasta, dto.tipo, dto.fecha);
  }

  /**
   * La cotización propia de la inmobiliaria.
   *
   * Con `@Roles`: con este número se convierte plata que se le liquida a un
   * propietario. Es el mismo recorte que ya tiene la carga de índices.
   */
  @Post('propia')
  @Roles('owner', 'admin', 'contable')
  cargarPropia(@ActorActual() a: Actor, @Body() dto: CargarCotizacionDto) {
    return this.cot.cargarPropia(a.tenantId, dto.fecha, dto.valor, a.usuarioId);
  }

  /** Trae del BCRA lo que falte. Idempotente: el día ya cargado no se pisa. */
  @Post('sincronizar')
  @Roles('owner', 'admin', 'contable')
  sincronizar() {
    return this.cot.sincronizar();
  }
}
