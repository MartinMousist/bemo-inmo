import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FotosService } from './fotos.service';
import { AlmacenamientoService } from './almacenamiento.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { AppError, ErrorCode } from '../common/app-error';

class SubirFotoDto {
  /**
   * La imagen en base64. Se eligió esto sobre multipart para no sumar una
   * dependencia de parseo: el límite de body ya está fijado y el volumen de
   * fotos de una inmobiliaria no justifica streaming.
   */
  @IsString() @MaxLength(14_000_000) datos!: string;
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
}

class ReordenarDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) ids!: string[];
}

@Controller('propiedades/:propiedadId/fotos')
export class FotosController {
  constructor(
    private readonly fotos: FotosService,
    private readonly almacen: AlmacenamientoService,
  ) {}

  @Get()
  listar(@ActorActual() a: Actor, @Param('propiedadId', ParseUUIDPipe) id: string) {
    return this.fotos.listar(a.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  async subir(
    @ActorActual() a: Actor,
    @Param('propiedadId', ParseUUIDPipe) id: string,
    @Body() dto: SubirFotoDto,
  ) {
    // Se acepta con o sin el prefijo "data:image/...;base64,".
    const limpio = dto.datos.replace(/^data:[^;]+;base64,/, '');
    let datos: Buffer;
    try {
      datos = Buffer.from(limpio, 'base64');
    } catch {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'La imagen no es base64 válido.', 'Unprocessable Entity');
    }
    return this.fotos.subir(a.tenantId, id, datos, dto.nombre);
  }

  @Put('orden')
  @Roles('owner', 'admin', 'agente')
  reordenar(
    @ActorActual() a: Actor,
    @Param('propiedadId', ParseUUIDPipe) id: string,
    @Body() dto: ReordenarDto,
  ) {
    return this.fotos.reordenar(a.tenantId, id, dto.ids);
  }

  @Put(':fotoId/portada')
  @Roles('owner', 'admin', 'agente')
  portada(
    @ActorActual() a: Actor,
    @Param('propiedadId', ParseUUIDPipe) id: string,
    @Param('fotoId', ParseUUIDPipe) fotoId: string,
  ) {
    return this.fotos.marcarPortada(a.tenantId, id, fotoId);
  }

  @Delete(':fotoId')
  @Roles('owner', 'admin', 'agente')
  @HttpCode(204)
  borrar(
    @ActorActual() a: Actor,
    @Param('propiedadId', ParseUUIDPipe) id: string,
    @Param('fotoId', ParseUUIDPipe) fotoId: string,
  ) {
    return this.fotos.borrar(a.tenantId, id, fotoId);
  }
}
