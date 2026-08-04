import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportarService } from './exportar.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { nombreArchivo } from '../common/csv';

/**
 * Export CSV de todo lo que en pantalla es una tabla.
 *
 * No es una feature de lujo: una inmobiliaria que no puede sacar sus datos del
 * sistema está atrapada, y saberlo la hace dudar antes de entrar. Poder
 * llevarse la cartera en un CSV es parte de que la cuenta sea suya.
 */
@Controller('exportar')
export class ExportarController {
  constructor(private readonly exportar: ExportarService) {}

  @Get(':recurso.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Roles('owner', 'admin', 'contable')
  async csv(
    @ActorActual() a: Actor,
    @Param('recurso') recurso: string,
    @Query('periodo') periodo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.exportar.generar(a.tenantId, recurso, periodo);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nombreArchivo(recurso)}"`,
    );
    return csv;
  }
}
