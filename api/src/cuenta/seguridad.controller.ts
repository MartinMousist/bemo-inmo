import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';
import { GENERAL } from '../auth/limite-intentos';
import { CodigoTotpDto } from '../auth/auth.dto';
import { TotpService } from '../auth/totp.service';

/**
 * La seguridad de LA PERSONA, no la de la inmobiliaria.
 *
 * Va aparte de `CuentaController` —que es el tipo de cuenta, los módulos y el
 * plan— porque acá el sujeto es otro: cada uno administra su propio segundo
 * factor y nadie administra el de otro. Ni siquiera el titular puede apagarle
 * el suyo a un empleado; para eso está dar de baja la membresía.
 *
 * Todos los roles: el asesor que entra desde el teléfono en un locutorio tiene
 * el mismo problema que el titular. Lo que la etapa pedía era que el titular
 * PUDIERA, no que fuera el único.
 */
@Controller('cuenta/seguridad')
export class SeguridadController {
  constructor(private readonly totp: TotpService) {}

  @Get()
  @Roles('owner', 'admin', 'agente', 'contable')
  estado(@ActorActual() a: Actor) {
    return this.totp.estado(a.usuarioId);
  }

  /**
   * Paso 1. Devuelve el secreto y la URI para el QR.
   *
   * Todavía no activa nada: ver `TotpService.iniciar`.
   */
  @Post('2fa')
  @Roles('owner', 'admin', 'agente', 'contable')
  iniciar(@ActorActual() a: Actor) {
    return this.totp.iniciar(a.tenantId, a.usuarioId);
  }

  /**
   * Paso 2. Los códigos de recuperación se devuelven UNA vez y no se pueden
   * volver a ver: en la base están hasheados.
   *
   * Diez por minuto: son seis dígitos, y sin tope propio el contador general
   * —trescientos— dejaría probar treinta mil combinaciones en una hora.
   */
  @Post('2fa/confirmar')
  @Roles('owner', 'admin', 'agente', 'contable')
  @Throttle({ [GENERAL]: { limit: 10 } })
  confirmar(@ActorActual() a: Actor, @Body() dto: CodigoTotpDto) {
    return this.totp.confirmar(a.tenantId, a.usuarioId, dto.codigo);
  }

  /**
   * Apagarlo pide un código vigente, no sólo la sesión.
   *
   * Es `POST` y no `DELETE` porque lleva cuerpo: un DELETE con body lo
   * descartan proxies y clientes HTTP, y este es justo el que no puede quedar
   * sin su código por el camino.
   */
  @Post('2fa/desactivar')
  @Roles('owner', 'admin', 'agente', 'contable')
  @Throttle({ [GENERAL]: { limit: 10 } })
  async desactivar(@ActorActual() a: Actor, @Body() dto: CodigoTotpDto) {
    await this.totp.desactivar(a.usuarioId, dto.codigo);
    return { activo: false };
  }
}
