import { Modulo } from '../planes/modulo.guard';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConciliacionService } from './conciliacion.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

class ImportarExtractoDto {
  /** El CSV tal cual lo descargó del homebanking. */
  @IsString() @MaxLength(6_000_000) contenido!: string;
  @IsOptional() @IsString() @MaxLength(80) banco?: string;
  @IsOptional() @IsString() @MaxLength(60) cuenta?: string;
  @IsOptional() @IsString() @MaxLength(200) nombreArchivo?: string;
  @IsOptional() @IsIn(['ARS', 'USD']) moneda?: string;
}

class ImputarDto {
  /** La cuota elegida. La elige una PERSONA: el sistema sólo sugiere. */
  @IsUUID() periodoId!: string;
}

class IgnorarDto {
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

class PendientesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limite?: number;
}

/**
 * La conciliación bancaria.
 *
 * Importar y resolver es **de titular y administración**, no del asesor: acá se
 * decide a qué contrato entra cada peso, y eso termina en la liquidación al
 * propietario. El contable LEE —es su trabajo revisar la cobranza— y no imputa.
 */
@Modulo('conciliacion', { lecturaLibre: true })
@Controller('conciliacion')
export class ConciliacionController {
  constructor(private readonly conciliacion: ConciliacionService) {}

  @Get('pendientes')
  @Roles('owner', 'admin', 'contable')
  pendientes(@ActorActual() a: Actor, @Query() q: PendientesDto) {
    return this.conciliacion.pendientes(a.tenantId, q.limite);
  }

  @Post('extractos')
  @Roles('owner', 'admin')
  importar(@ActorActual() a: Actor, @Body() dto: ImportarExtractoDto) {
    return this.conciliacion.importar(a.tenantId, a.usuarioId, dto.contenido, {
      banco: dto.banco,
      cuenta: dto.cuenta,
      nombreArchivo: dto.nombreArchivo,
      moneda: dto.moneda,
    });
  }

  /**
   * Imputar es lo único que crea plata en el sistema desde acá, y por eso pide
   * la cuota explícita en el cuerpo: no hay un «imputar la mejor sugerencia».
   * Ese endpoint existiría para ahorrar un clic y costaría un cobro en el
   * contrato equivocado la primera vez que dos cuotas empaten.
   */
  @Post('movimientos/:id/imputar')
  @Roles('owner', 'admin')
  imputar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImputarDto,
    @Req() req: Request,
  ) {
    return this.conciliacion.imputar(a.tenantId, id, dto.periodoId, a.usuarioId, req.ip);
  }

  @Post('movimientos/:id/ignorar')
  @Roles('owner', 'admin')
  ignorar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IgnorarDto,
  ) {
    return this.conciliacion.ignorar(a.tenantId, id, a.usuarioId, dto.motivo);
  }

  @Post('movimientos/:id/reabrir')
  @Roles('owner', 'admin')
  reabrir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.conciliacion.reabrir(a.tenantId, id);
  }
}
