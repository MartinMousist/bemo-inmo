import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DocumentosService } from './documentos.service';
import { PlantillasService } from './plantillas.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

/**
 * El largo máximo del texto de un documento.
 *
 * Es el mismo que el de una plantilla (`MaxLength(60_000)` en
 * `plantillas.controller.ts`): un documento generado no puede ser mucho más
 * largo que el modelo del que sale. Va **explícito y no heredado** del
 * `BODY_LIMIT` global de 1 MB: el límite global existe para las fotos y no es un
 * criterio para el texto de un contrato. Y no se sube el global para resolver un
 * caso puntual — está escrito en `docs/CONTINUAR.md` §8.
 *
 * Sube de 60.000 a 250.000 junto con el de la plantilla, y por el mismo motivo:
 * con el editor con formato, el texto viaja marcado. Los dos números tienen que
 * moverse juntos — un documento que no se puede guardar porque su plantilla sí
 * entraba es un callejón sin salida a mitad de una edición.
 */
const LARGO_TEXTO = 250_000;

const CANALES = ['whatsapp', 'email', 'impresion', 'descarga', 'copia'] as const;

class CrearDocumentoDto {
  @IsUUID() contratoId!: string;
  @IsUUID() plantillaId!: string;
  /** Ausente = se guarda el texto del motor tal cual. */
  @IsOptional() @IsString() @MaxLength(LARGO_TEXTO) textoFinal?: string;
  @IsOptional() @IsString() @MaxLength(160) titulo?: string;
}

class EditarDocumentoDto {
  @IsOptional() @IsString() @MaxLength(LARGO_TEXTO) textoFinal?: string;
  @IsOptional() @IsString() @MaxLength(160) titulo?: string;
}

class EnvioDto {
  @IsIn(CANALES as unknown as string[]) canal!: string;
  /** El teléfono o el mail que se va a usar. Puede no ser el de la ficha. */
  @IsOptional() @IsString() @MaxLength(160) destino?: string;
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

/**
 * Los documentos de un contrato.
 *
 * Cuelgan del contrato porque es de lo que hablan: un pre-contrato sin contrato
 * no es nada. Los ve todo el equipo —un asesor tiene que poder decir qué se le
 * mandó al inquilino— y los crea y manda quien atiende: titular, administración
 * y asesor. Son los mismos roles que ya tenía `generar`, que es el paso anterior
 * del mismo circuito.
 *
 * `contable` queda afuera de crear y mandar, y adentro de leer: el pre-contrato
 * no es plata, pero saber qué papel salió sí es parte de mirar una cuenta.
 */
@Controller('contratos/:contratoId/documentos')
export class DocumentosDeContratoController {
  constructor(
    private readonly documentos: DocumentosService,
    private readonly plantillas: PlantillasService,
  ) {}

  @Get()
  listar(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.documentos.listarPorContrato(a.tenantId, id);
  }

  /** A quién se le puede mandar: las partes que tienen teléfono o mail. */
  @Get('destinatarios')
  destinatarios(@ActorActual() a: Actor, @Param('contratoId', ParseUUIDPipe) id: string) {
    return this.plantillas.destinatarios(a.tenantId, id);
  }
}

@Controller('documentos')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  /** Los límites de cada canal, con su fuente escrita. La pantalla los muestra. */
  @Get('limites')
  limites() {
    return this.documentos.limites();
  }

  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() a: Actor, @Body() dto: CrearDocumentoDto) {
    return this.documentos.crear(a.tenantId, a.usuarioId, dto);
  }

  @Get(':id')
  obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentos.obtener(a.tenantId, id);
  }

  /**
   * El documento dicho en texto plano.
   *
   * Es lo que baja como `.txt`, lo que copia el botón «Copiar» y lo que se mide
   * para decidir si un envío va completo o adjunto. Existe para que el front no
   * tenga una segunda implementación de `htmlATexto()`: dos versiones de la
   * misma proyección son dos textos distintos el día que una se toca.
   *
   * Mismos roles que `obtener()`: es el mismo documento, dicho de otra forma.
   */
  @Get(':id/texto')
  texto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentos.texto(a.tenantId, id);
  }

  @Put(':id')
  @Roles('owner', 'admin', 'agente')
  editar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarDocumentoDto,
  ) {
    return this.documentos.actualizar(a.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentos.borrar(a.tenantId, id);
  }

  /**
   * El enlace, sin registrar nada. Es lo que deja que la pantalla avise antes.
   *
   * GET y no POST porque no escribe: se puede pedir mil veces mientras alguien
   * cambia el destinatario en un desplegable, y no deja una sola fila.
   */
  @Get(':id/preparar')
  preparar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('canal') canal: string,
    @Query('destino') destino?: string,
  ) {
    const c = canal === 'email' ? 'email' : 'whatsapp';
    return this.documentos.preparar(a.tenantId, id, c, destino);
  }

  /**
   * Registra que se abrió un canal y devuelve la URL para abrirlo.
   *
   * ⚠️ Esto **no manda nada**. Abre el WhatsApp o el cliente de correo del
   * usuario con el texto cargado; apretar enviar sigue siendo de la persona. Por
   * eso lo que queda anotado es «se abrió», con su fecha y su nombre.
   */
  @Post(':id/envios')
  @Roles('owner', 'admin', 'agente')
  registrarEnvio(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnvioDto,
  ) {
    return this.documentos.registrarEnvio(a.tenantId, id, a.usuarioId, {
      canal: dto.canal as (typeof CANALES)[number],
      destino: dto.destino,
      nota: dto.nota,
    });
  }
}
