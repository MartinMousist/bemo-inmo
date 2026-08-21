import { Modulo } from '../planes/modulo.guard';
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PlantillasService } from './plantillas.service';
import { catalogoPara } from './plantillas.variables';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

const TIPOS = [
  'pre_contrato_alquiler', 'pre_contrato_venta', 'reserva',
  'aviso_aumento', 'aviso_vencimiento', 'recibo', 'liquidacion', 'otro',
] as const;

const FORMATOS = ['texto', 'html'] as const;

/**
 * El largo máximo del contenido de una plantilla.
 *
 * Sube de 60.000 a 250.000 con el editor con formato, y el número tiene una
 * cuenta atrás: tres carillas de contrato limpias son unos 7.000 caracteres de
 * texto y alrededor de 40 KB una vez marcadas con `<p>`, `<strong>` y los
 * chips de variable. 250.000 deja lugar para un modelo largo de verdad y sigue
 * rechazando lo que este límite existe para rechazar: un pegado crudo de Word
 * de tres megas, con su hoja de estilos y sus comentarios condicionales, que es
 * exactamente lo que `limpiarPegado.ts` tira antes de que llegue acá.
 *
 * El `BODY_LIMIT` global de 1 MB sigue arriba y no se toca: existe para las
 * fotos y no es un criterio para el texto de un contrato.
 */
const LARGO_CONTENIDO = 250_000;

class GuardarPlantillaDto {
  @IsOptional() @IsUUID() id?: string;
  @IsIn(TIPOS as unknown as string[]) tipo!: string;
  @IsString() @MaxLength(120) nombre!: string;
  @IsString() @MaxLength(LARGO_CONTENIDO) contenido!: string;
  /** Ausente = html. Las plantillas nuevas nacen con formato. */
  @IsOptional() @IsIn(FORMATOS as unknown as string[]) formato?: string;
}

class PrevisualizarDto {
  @IsString() @MaxLength(LARGO_CONTENIDO) contenido!: string;
  @IsOptional() @IsIn(FORMATOS as unknown as string[]) formato?: string;
}

class GenerarDto {
  @IsUUID() contratoId!: string;
}

@Modulo('documentos', { lecturaLibre: true })
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

  /**
   * El catálogo de variables y bloques que ofrece el menú del editor.
   *
   * Sin rol propio: lo lee cualquiera que pueda abrir la pantalla, y no dice
   * ningún dato de la inmobiliaria — son los nombres de los campos y un ejemplo
   * inventado. Restringirlo a owner/admin dejaría al asesor editando el texto
   * de un documento generado sin poder ver cómo se llama nada.
   *
   * Va ANTES de cualquier ruta con parámetro: `@Get('variables')` después de un
   * `@Get(':id')` nunca se alcanza.
   */
  @Get('variables')
  variables(@Query('tipo') tipo?: string) {
    return catalogoPara(tipo);
  }

  /** Previsualiza con datos de ejemplo, sin tocar ningún contrato. */
  @Post('previsualizar')
  @Roles('owner', 'admin')
  previsualizar(@Body() dto: PrevisualizarDto) {
    return this.plantillas.previsualizar(
      dto.contenido,
      (dto.formato as 'texto' | 'html' | undefined) ?? 'html',
    );
  }

  @Put()
  @Roles('owner', 'admin')
  guardar(@ActorActual() a: Actor, @Body() dto: GuardarPlantillaDto) {
    return this.plantillas.guardar(a.tenantId, {
      ...dto,
      formato: (dto.formato as 'texto' | 'html' | undefined) ?? 'html',
    });
  }

  /**
   * Pasa una plantilla de texto plano al editor con formato.
   *
   * Es un paso EXPLÍCITO además del automático del `migrate`: una inmobiliaria
   * que trajo su plantilla después, o que la dejó en texto a propósito, la
   * convierte cuando quiere. Idempotente: sobre una que ya está en HTML
   * devuelve la misma sin tocarla.
   */
  @Post(':id/convertir')
  @Roles('owner', 'admin')
  convertir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.plantillas.convertir(a.tenantId, id);
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
