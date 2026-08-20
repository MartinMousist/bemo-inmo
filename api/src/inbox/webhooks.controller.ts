import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico } from '../auth/decoradores';
import { GENERAL } from '../auth/limite-intentos';
import { RegistroAdaptadores } from './adaptadores/registro';
import { CanalesService } from './canales.service';
import { IngestaService } from './ingesta.service';

/**
 * Por acá entran los mensajes.
 *
 * ── El endpoint más expuesto del sistema ──
 *
 * Es **público y tiene que serlo**: Telegram, Twilio y Meta no tienen forma de
 * autenticarse contra nosotros. Lo que lo protege son tres cosas, y las tres
 * hacen falta:
 *
 *   1. El token de la URL, 32 bytes aleatorios, que dice de qué inmobiliaria es.
 *   2. La firma del proveedor, que el adaptador verifica. **Sin firma válida no
 *      se procesa nada**, ni siquiera se guarda.
 *   3. Un tope de tráfico propio, porque un endpoint público sin techo es una
 *      forma de llenarle la base a alguien.
 *
 * ── Por qué siempre contesta 200 ──
 *
 * Un token que no existe, una firma que no valida y un mensaje que no se pudo
 * parsear devuelven 200 igual. Dos motivos: los proveedores **reintentan** ante
 * cualquier cosa que no sea 2xx —y reintentar algo que rechazamos a propósito
 * no lo va a arreglar—, y un 404 le confirmaría a quien está probando URLs que
 * las otras existen. Lo que pasó queda en el log, no en la respuesta.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly canales: CanalesService,
    private readonly ingesta: IngestaService,
    private readonly registro: RegistroAdaptadores,
  ) {}

  /**
   * La verificación inicial de Meta: pega con `GET` y espera que le devuelvan
   * el `hub.challenge` tal cual. Sin esto, la suscripción al webhook no se
   * puede activar.
   */
  @Publico()
  @Throttle({ [GENERAL]: { limit: 60 } })
  @Get(':token')
  async verificar(
    @Param('token') token: string,
    @Query('hub.mode') modo?: string,
    @Query('hub.verify_token') verify?: string,
    @Query('hub.challenge') challenge?: string,
  ): Promise<string> {
    if (modo !== 'subscribe' || !challenge) return '';

    const cuenta = await this.canales.porWebhook(token);
    // El `verifyToken` lo elige quien configura la cuenta y lo copia en el
    // panel de Meta. Comparar contra él es lo que impide que un tercero active
    // su propia suscripción contra nuestra URL.
    if (!cuenta || String(cuenta.config.verifyToken ?? '') !== verify) return '';

    return challenge;
  }

  @Publico()
  // 600 por minuto por IP. Alcanza de sobra para el tráfico real de una
  // inmobiliaria y corta un intento de inundar la bandeja.
  @Throttle({ [GENERAL]: { limit: 600 } })
  @Post(':token')
  @HttpCode(200)
  async recibir(
    @Param('token') token: string,
    @Body() cuerpo: unknown,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    const cuenta = await this.canales.porWebhook(token);
    if (!cuenta) return { ok: true };

    const adaptador = this.registro.de(cuenta.proveedor);
    if (!adaptador) return { ok: true };

    const valida = adaptador.verificarFirma(cuenta, {
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      headers: req.headers as Record<string, string | undefined>,
      cuerpo,
      // Lo captura el parser en `configurar-app.ts`. Meta firma los BYTES, y
      // `JSON.stringify` de lo que parseó Express no los devuelve.
      crudo: (req as Request & { rawBody?: string }).rawBody,
    });
    if (!valida) return { ok: true };

    const mensajes = adaptador.parsear(cuerpo);
    if (mensajes.length) await this.ingesta.recibir(cuenta, mensajes);

    return { ok: true };
  }
}
