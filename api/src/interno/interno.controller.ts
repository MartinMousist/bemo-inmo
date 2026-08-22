import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID,
  MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { InternoService, REF_TIPOS, type RefTipo } from './interno.service';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

class AbrirHiloDto {
  @IsArray()
  @ArrayMinSize(1)
  // Un hilo de doce personas es una reunión, y para eso está la reunión.
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  conQuienes!: string[];
}

class EnviarDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  texto!: string;

  /**
   * Lo que se está pasando: una propiedad, un contrato, una persona.
   *
   * Los dos van juntos o no va ninguno — lo mismo que exige el CHECK de la
   * base. Un tipo sin id no lleva a ningún lado.
   */
  @IsOptional() @IsIn(REF_TIPOS as unknown as string[])
  refTipo?: RefTipo;

  /*
   * Sin `@IsOptional()`, y no es un olvido.
   *
   * `@IsOptional()` saltea TODA la validación cuando el valor es `undefined`,
   * incluido el `@ValidateIf` — así que con los dos juntos, mandar `refTipo`
   * sin `refId` pasaba. Lo agarró un test. Con sólo `@ValidateIf`, el campo es
   * obligatorio exactamente cuando hay un tipo, que es la regla que el CHECK de
   * la base también exige.
   */
  @ValidateIf((o: EnviarDto) => o.refTipo !== undefined)
  @IsUUID('4')
  refId?: string;
}

/**
 * Mensajes entre la gente de la oficina.
 *
 * Los cuatro roles, DECLARADOS y no omitidos. Escribirle a un compañero no es
 * un permiso que se administre —los cuatro pueden— pero la regla de este repo
 * es que toda ruta que escribe diga a quién deja pasar, y «no puse nada» y
 * «puse los cuatro» se leen distinto dentro de seis meses. Hay un test que lo
 * exige, y agarró esto.
 *
 * Lo que sí acota de verdad es que cada consulta filtra por los hilos donde
 * participás — uno del que no sos parte da 404 y no 403, porque su existencia
 * tampoco te corresponde.
 */
@Controller('interno')
@Roles('owner', 'admin', 'agente', 'contable')
export class InternoController {
  constructor(private readonly interno: InternoService) {}

  @Get('hilos')
  hilos(@ActorActual() a: Actor) {
    return this.interno.hilos(a.tenantId, a.usuarioId);
  }

  /** Para el badge de la barra. Antes de `:id`, como toda ruta literal. */
  @Get('sin-leer')
  async sinLeer(@ActorActual() a: Actor) {
    return { total: await this.interno.sinLeer(a.tenantId, a.usuarioId) };
  }

  @Post('hilos')
  abrir(@ActorActual() a: Actor, @Body() dto: AbrirHiloDto) {
    return this.interno.abrirHilo(a.tenantId, a.usuarioId, dto.conQuienes);
  }

  @Get('hilos/:id')
  mensajes(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.interno.mensajes(a.tenantId, a.usuarioId, id);
  }

  @Post('hilos/:id')
  enviar(
    @ActorActual() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnviarDto,
  ) {
    return this.interno.enviar(
      a.tenantId, a.usuarioId, id, dto.texto,
      dto.refTipo && dto.refId ? { tipo: dto.refTipo, id: dto.refId } : undefined,
    );
  }
}
