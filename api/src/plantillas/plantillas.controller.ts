import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PlantillasService } from './plantillas.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

const TIPOS = [
  'pre_contrato_alquiler', 'pre_contrato_venta', 'reserva',
  'aviso_aumento', 'aviso_vencimiento', 'recibo', 'liquidacion', 'otro',
] as const;

class GuardarPlantillaDto {
  @IsOptional() @IsUUID() id?: string;
  @IsIn(TIPOS as unknown as string[]) tipo!: string;
  @IsString() @MaxLength(120) nombre!: string;
  @IsString() @MaxLength(60_000) contenido!: string;
}

class PrevisualizarDto {
  @IsString() @MaxLength(60_000) contenido!: string;
}

class GenerarDto {
  @IsUUID() contratoId!: string;
}

@Controller('plantillas')
export class PlantillasController {
  constructor(private readonly plantillas: PlantillasService) {}

  @Get()
  listar(@ActorActual() a: Actor) {
    return this.plantillas.listar(a.tenantId);
  }

  /** Copia las plantillas base a la cuenta. Idempotente. */
  @Post('sembrar')
  @Roles('owner', 'admin')
  sembrar(@ActorActual() a: Actor) {
    return this.plantillas.sembrar(a.tenantId);
  }

  /** Previsualiza con datos de ejemplo, sin tocar ningún contrato. */
  @Post('previsualizar')
  @Roles('owner', 'admin')
  previsualizar(@Body() dto: PrevisualizarDto) {
    return this.plantillas.previsualizar(dto.contenido);
  }

  @Put()
  @Roles('owner', 'admin')
  guardar(@ActorActual() a: Actor, @Body() dto: GuardarPlantillaDto) {
    return this.plantillas.guardar(a.tenantId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.plantillas.borrar(a.tenantId, id);
  }

  /**
   * El recibo de un cobro concreto.
   *
   * Va acá y no en `/cobros/:id/recibo` porque es una plantilla renderizada, no
   * una acción sobre el cobro: el cobro no cambia por imprimir su comprobante.
   */
  @Post('recibo/:cobroId')
  @Roles('owner', 'admin', 'contable')
  recibo(@ActorActual() a: Actor, @Param('cobroId', ParseUUIDPipe) cobroId: string) {
    return this.plantillas.recibo(a.tenantId, cobroId);
  }

  /** Genera el documento con los datos reales de un contrato. */
  @Post(':id/generar')
  @Roles('owner', 'admin', 'agente')
  generar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerarDto,
  ) {
    return this.plantillas.generar(a.tenantId, id, dto.contratoId);
  }
}
