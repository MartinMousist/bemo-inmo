import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { ImportarService, PLANTILLAS, type Recurso } from './importar.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

class ImportarDto {
  @IsIn(['personas', 'propiedades']) recurso!: Recurso;
  // 5 MB de texto son ~40.000 filas: más que suficiente para una cartera y
  // acotado para que un archivo enorme no tumbe el proceso.
  @IsString() @MaxLength(5_000_000) csv!: string;
}

@Controller('importar')
export class ImportarController {
  constructor(private readonly importar: ImportarService) {}

  /** Plantilla de ejemplo, para no tener que adivinar las columnas. */
  @Get('plantilla/:recurso.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  plantilla(@Param('recurso') recurso: string, @Res({ passthrough: true }) res: Response) {
    const p = PLANTILLAS[recurso as Recurso];
    if (!p) return 'recurso desconocido\r\n';
    res.setHeader('Content-Disposition', `attachment; filename="modelo-${recurso}.csv"`);
    return '﻿' + p;
  }

  /** Muestra qué va a pasar. NO escribe nada. */
  @Post('previsualizar')
  @Roles('owner', 'admin')
  previsualizar(@ActorActual() a: Actor, @Body() dto: ImportarDto) {
    return this.importar.previsualizar(a.tenantId, dto.recurso, dto.csv);
  }

  @Post()
  @Roles('owner', 'admin')
  ejecutar(@ActorActual() a: Actor, @Body() dto: ImportarDto) {
    return this.importar.importar(a.tenantId, dto.recurso, dto.csv);
  }
}
