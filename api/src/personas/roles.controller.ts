import { Controller, Get, Query } from '@nestjs/common';
import { InquilinosService } from './inquilinos.service';
import { PropietariosService } from './propietarios.service';
import { GarantesService } from '../garantes/garantes.service';
import {
  ListarGarantesDto,
  ListarInquilinosDto,
  ListarPropietariosDto,
} from './personas.dto';
import { ActorActual, type Actor } from '../auth/decoradores';

/**
 * Las tres pantallas de personas por rol: Inquilinos, Propietarios y Garantes.
 *
 * Van los tres en un controlador y no en tres archivos porque son la misma
 * feature —la agenda mirada por rol— y separarlos deja tres archivos de doce
 * líneas que hay que abrir juntos para entender uno.
 *
 * ── Sin `@Roles`, y eso es una decisión, no un olvido ──
 *
 * Estas pantallas muestran plata: Propietarios muestra liquidaciones y saldos
 * pendientes, Inquilinos muestra deudas. La tentación es cerrarlas al rol
 * `agente`, y no se hace, por dos razones concretas:
 *
 * 1. **Es la misma plata que el agente ya ve** en Cartera de alquileres y en
 *    Liquidaciones, que tampoco tienen `@Roles`. Cerrar esta puerta y dejar la
 *    de al lado abierta no protege nada: da la sensación de un permiso que se
 *    esquiva navegando distinto, y «un permiso que se esquiva restando no es un
 *    permiso» ya está escrito en el módulo de comisiones.
 * 2. **Lo que sí es del compañero está cerrado donde vive**: el desglose de
 *    comisiones por agente y los montos del perfil ajeno se filtran en el back
 *    (`/equipo/:usuarioId`). Eso es plata de una persona; esto es plata de la
 *    inmobiliaria, y quien atiende el mostrador necesita poder contestar
 *    «¿cuánto debe este inquilino?» sin pedir permiso.
 *
 * Si el dueño decide lo contrario, el cambio es un `@Roles` por endpoint MÁS
 * los tests de denegación de cada uno: es por eso que la decisión se toma acá y
 * no después.
 */
@Controller()
export class RolesPersonaController {
  constructor(
    private readonly inquilinos: InquilinosService,
    private readonly propietarios: PropietariosService,
    private readonly garantes: GarantesService,
  ) {}

  @Get('inquilinos')
  listarInquilinos(@ActorActual() a: Actor, @Query() f: ListarInquilinosDto) {
    return this.inquilinos.listar(a.tenantId, f);
  }

  @Get('propietarios')
  listarPropietarios(@ActorActual() a: Actor, @Query() f: ListarPropietariosDto) {
    return this.propietarios.listar(a.tenantId, f);
  }

  /**
   * El listado general de garantías.
   *
   * `GET /v1/garantes` y no `/contratos/:id/garantes`, que es el que ya existe y
   * sigue existiendo: son dos preguntas distintas —«¿este contrato está en
   * regla?» y «¿qué carpeta me falta?»— y la segunda no se puede contestar
   * entrando a los contratos de a uno.
   */
  @Get('garantes')
  listarGarantes(@ActorActual() a: Actor, @Query() f: ListarGarantesDto) {
    return this.garantes.listarTodos(a.tenantId, f);
  }
}
