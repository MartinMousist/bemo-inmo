import { Modulo } from '../planes/modulo.guard';
import {
  Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post, Get, Put,
} from '@nestjs/common';
import { ActasService } from './actas.service';
import {
  CrearActaDto, EditarActaDto, FirmarDto, GuardarItemsDto, SubirFotoActaDto,
} from './actas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Las actas cuelgan del contrato: es lo que documentan.
 *
 * Las carga y las edita **el asesor**, que es quien recorre la casa con el
 * teléfono en la mano. Firmar también: la firma la hace quien está ahí parado
 * con el inquilino, y hacerla pasar por el titular frenaría la entrega de las
 * llaves media tarde.
 *
 * Borrar un acta no existe como endpoint, a propósito. Una firmada no se toca —
 * lo hace cumplir la base — y una sin firmar se arregla editándola. «Borrar el
 * acta y hacerla de nuevo» es justo lo que no queremos que sea fácil.
 */
@Modulo('actas', { lecturaLibre: true })
@Controller('contratos/:contratoId/actas')
export class ActasDeContratoController {
  constructor(private readonly actas: ActasService) {}

  @Get()
  leer(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.actas.leer(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(
    @ActorActual() a: Actor,
    @Param('contratoId', ParseUUIDPipe) id: string,
    @Body() dto: CrearActaDto,
  ) {
    return this.actas.crear(a.tenantId, id, a.usuarioId, dto);
  }
}

@Modulo('actas', { lecturaLibre: true })
@Controller('actas')
export class ActasController {
  constructor(private readonly actas: ActasService) {}

  @Patch(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarActaDto,
  ) {
    return this.actas.editar(a.tenantId, id, dto);
  }

  @Put(':id/items')
  @Roles('owner', 'admin', 'agente')
  guardarItems(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuardarItemsDto,
  ) {
    return this.actas.guardarItems(a.tenantId, id, dto);
  }

  /**
   * Firmar es irreversible y por eso es su propio endpoint, no un campo del
   * PATCH: un `firmadaEl` que se pudiera mandar junto con la fecha o los
   * medidores se manda sin querer.
   */
  @Post(':id/firmar')
  @Roles('owner', 'admin', 'agente')
  firmar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FirmarDto,
  ) {
    return this.actas.firmar(a.tenantId, id, a.usuarioId, dto.firmadaInquilino);
  }

  @Post('items/:itemId/fotos')
  @Roles('owner', 'admin', 'agente')
  subirFoto(
    @ActorActual() a: Actor,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SubirFotoActaDto,
  ) {
    // Se acepta con o sin el prefijo "data:image/...;base64,", igual que las
    // fotos de una propiedad y los documentos del garante.
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
    return this.actas.subirFoto(a.tenantId, itemId, datos, dto.nombre, a.usuarioId);
  }

  @Delete('fotos/:fotoId')
  @Roles('owner', 'admin', 'agente')
  borrarFoto(@ActorActual() a: Actor, @Param('fotoId', ParseUUIDPipe) fotoId: string) {
    return this.actas.borrarFoto(a.tenantId, fotoId);
  }
}
