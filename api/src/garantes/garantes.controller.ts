import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { GarantesService } from './garantes.service';
import { CrearGaranteDto, EditarGaranteDto, SubirDocumentoDto } from './garantes.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { LimiteDeTercero } from '../auth/limite-intentos';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Los garantes cuelgan del contrato: es lo que garantizan.
 *
 * Todo el equipo los ve —un asesor que muestra la propiedad tiene que poder
 * decir qué falta— y los modifica titular, administración y el asesor que está
 * armando la carpeta. La consulta al BCRA también: es el paso que destraba la
 * operación y hacerla pasar por el titular la frenaría media tarde.
 */
@Controller('contratos/:contratoId/garantes')
export class GarantesController {
  constructor(private readonly garantes: GarantesService) {}

  @Get()
  listar(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.garantes.listar(a.tenantId, id);
  }

  /** Cuántos hay, cuántos sirven y qué falta para que el contrato esté en regla. */
  @Get('verificacion')
  verificar(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.garantes.verificar(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(
    @ActorActual() a: Actor,
    @Param('contratoId', ParseUUIDPipe) id: string,
    @Body() dto: CrearGaranteDto,
  ) {
    return this.garantes.crear(a.tenantId, id, dto);
  }
}

@Controller('garantes')
export class GaranteController {
  constructor(private readonly garantes: GarantesService) {}

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarGaranteDto,
  ) {
    return this.garantes.editar(a.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.garantes.borrar(a.tenantId, id);
  }

  /**
   * Consulta la Central de Deudores del BCRA y congela la respuesta.
   *
   * Es un POST y no un GET porque escribe: el veredicto queda guardado con su
   * fecha, y esa foto es la que explica seis meses después por qué se aceptó a
   * este garante.
   *
   * El mismo endpoint sirve para la primera consulta y para la revisión: no hay
   * un «re-consultar» aparte porque es el mismo acto —preguntarle al BCRA— y la
   * diferencia entre una y otra la marca el historial, no la ruta. Quién apretó
   * queda guardado en `garantia_bcra_consulta.consultado_por`: acá se está
   * mirando el dato bancario de un tercero y eso tiene que tener nombre.
   */
  /**
   * La URL para abrir un documento del legajo.
   *
   * Ruta literal antes que `:id`: Nest resuelve en orden de declaración, y al
   * revés «documentos» entraría como id.
   *
   * Que sea un endpoint aparte es el punto: mirar el DNI de alguien queda
   * registrado con nombre y fecha, que es lo que pide la 17.2.
   */
  @Get('documentos/:documentoId')
  @Roles('owner', 'admin', 'agente')
  verDocumento(
    @ActorActual() a: Actor,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Req() req: Request,
  ) {
    return this.garantes.verDocumento(a.tenantId, documentoId, a.usuarioId, req.ip);
  }

  @Post(':id/bcra')
  @Roles('owner', 'admin', 'agente')
  @LimiteDeTercero()
  consultarBcra(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.garantes.consultarBcra(a.tenantId, id, a.usuarioId);
  }

  @Post(':id/documentos')
  @Roles('owner', 'admin', 'agente')
  async subirDocumento(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubirDocumentoDto,
  ) {
    // Se acepta con o sin el prefijo "data:image/...;base64,", igual que las
    // fotos: el front manda lo que le da el input de archivo.
    const limpio = dto.datos.replace(/^data:[^;]+;base64,/, '');
    let datos: Buffer;
    try {
      datos = Buffer.from(limpio, 'base64');
    } catch {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'La imagen no es base64 válido.', 'Unprocessable Entity',
      );
    }
    return this.garantes.subirDocumento(a.tenantId, id, dto.tipo, datos, dto.nombre, a.usuarioId);
  }

  @Delete(':id/documentos/:documentoId')
  @Roles('owner', 'admin', 'agente')
  borrarDocumento(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
  ) {
    return this.garantes.borrarDocumento(a.tenantId, id, documentoId);
  }
}
