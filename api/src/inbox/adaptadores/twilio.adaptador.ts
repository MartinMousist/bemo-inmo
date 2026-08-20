import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  Adaptador, ContextoWebhook, CuentaCanal, MensajeEntrante, ResultadoEnvio,
} from './tipos';

const TIMEOUT_MS = 20_000;

/**
 * Twilio: WhatsApp y SMS.
 *
 * ── Por qué Twilio antes que la API oficial de Meta ──
 *
 * Porque el sandbox de WhatsApp de Twilio anda HOY: el cliente manda un código
 * a un número compartido y queda habilitado, sin verificación de negocio ni
 * plantillas aprobadas —que es lo que lleva semanas—. Sirve para probar el
 * circuito completo y para los primeros clientes reales.
 *
 * Cuando la verificación de Meta esté, se cambia `proveedor` de `twilio` a
 * `meta` en la fila de la cuenta y las conversaciones siguen donde están. Eso
 * es todo el motivo por el que `canal` y `proveedor` son dos columnas.
 *
 * ── La ventana de 24 horas ──
 *
 * No la impone Twilio: la impone Meta, y aplica igual por los dos caminos.
 * Fuera de esa ventana sólo entra una plantilla aprobada. El adaptador no la
 * decide —la sabe la conversación— pero el error de Twilio cuando se viola
 * (código 63016) se traduce acá para que la pantalla pueda decir POR QUÉ no
 * salió, en vez de un «falló» que no ayuda a nadie.
 */
@Injectable()
export class TwilioAdaptador implements Adaptador {
  readonly proveedor = 'twilio';
  readonly canales = ['whatsapp', 'sms'] as const;
  private readonly logger = new Logger('Twilio');

  disponible(cuenta: CuentaCanal): { ok: boolean; detalle: string } {
    if (!cuenta.config.accountSid) return { ok: false, detalle: 'Falta el Account SID' };
    if (!cuenta.secreto) return { ok: false, detalle: 'Falta el Auth Token' };
    if (!cuenta.identificador) return { ok: false, detalle: 'Falta el número emisor' };
    return { ok: true, detalle: 'Conectado' };
  }

  /**
   * Firma de Twilio: HMAC-SHA1 del `url` + los parámetros del formulario
   * ordenados por clave y concatenados, con el Auth Token como clave.
   *
   * La URL tiene que ser EXACTAMENTE la que Twilio usó, incluido el esquema y
   * el host públicos. Detrás de un proxy eso no es lo que ve Express, y por eso
   * la cuenta puede fijar `urlPublica`: si el host no coincide, la firma no
   * valida y el webhook se rechaza entero. Es el mismo problema que ya mordió
   * con las URLs firmadas del bucket en la etapa 17.
   */
  verificarFirma(cuenta: CuentaCanal, ctx: ContextoWebhook): boolean {
    const token = cuenta.secreto;
    const firma = ctx.headers['x-twilio-signature'];
    if (!token || !firma) return false;

    const url = String(cuenta.config.urlPublica ?? '') || ctx.url;
    const params = (ctx.cuerpo ?? {}) as Record<string, unknown>;

    const base = Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + String(params[k] ?? ''), url);

    const esperado = createHmac('sha1', token).update(Buffer.from(base, 'utf8')).digest('base64');

    const a = Buffer.from(esperado);
    const b = Buffer.from(firma);
    // Longitudes distintas = no coincide. Se corta antes porque
    // `timingSafeEqual` tira si difieren, y esa excepción sería un 500.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parsear(cuerpo: unknown): MensajeEntrante[] {
    const p = (cuerpo ?? {}) as Record<string, string>;
    if (!p.From || !p.MessageSid) return [];

    const adjuntos: MensajeEntrante['adjuntos'] = [];
    const cuantos = Number(p.NumMedia ?? '0');
    for (let i = 0; i < cuantos; i++) {
      const url = p[`MediaUrl${i}`];
      const mime = p[`MediaContentType${i}`] ?? '';
      if (!url) continue;
      adjuntos.push({ tipo: tipoDeMime(mime), url, mime });
    }

    return [{
      idExterno: p.MessageSid,
      // Llega como `whatsapp:+549261...`. Se guarda TAL CUAL: es la dirección
      // con la que hay que contestar, y limpiarla obligaría a reconstruirla —y
      // a adivinar el canal— cada vez que se manda algo.
      contactoExterno: p.From,
      contactoNombre: p.ProfileName || null,
      cuerpo: p.Body ?? '',
      adjuntos,
      recibidoEl: new Date(),
    }];
  }

  async enviar(cuenta: CuentaCanal, destino: string, texto: string): Promise<ResultadoEnvio> {
    const listo = this.disponible(cuenta);
    if (!listo.ok) return { idExterno: null, enviado: false, detalle: listo.detalle };

    const sid = String(cuenta.config.accountSid);
    const auth = Buffer.from(`${sid}:${cuenta.secreto}`).toString('base64');

    const cuerpo = new URLSearchParams({
      From: cuenta.identificador,
      To: destino,
      Body: texto,
    });

    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: cuerpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const datos = (await res.json()) as { sid?: string; message?: string; code?: number };

      if (!res.ok) {
        return { idExterno: null, enviado: false, detalle: detalleDeError(datos) };
      }
      return { idExterno: datos.sid ?? null, enviado: true, detalle: 'Enviado' };
    } catch (err) {
      const detalle = err instanceof Error ? err.message : 'Error de red';
      this.logger.warn(`No se pudo enviar por Twilio: ${detalle}`);
      return { idExterno: null, enviado: false, detalle };
    }
  }
}

/**
 * Traduce el error de Twilio a algo que sirva en pantalla.
 *
 * `63016` es el que más va a pasar y el que peor se entiende crudo: el cliente
 * quedó fuera de la ventana de 24 horas. Decir «falló» ahí manda al asesor a
 * reintentar lo mismo tres veces.
 */
function detalleDeError(datos: { message?: string; code?: number }): string {
  if (datos.code === 63016) {
    return 'Pasaron más de 24 horas desde el último mensaje del cliente: '
      + 'sólo se puede enviar una plantilla aprobada.';
  }
  if (datos.code === 21610) return 'El cliente se dio de baja de este número.';
  if (datos.code === 63007) return 'El número emisor no está habilitado para WhatsApp.';
  return datos.message ?? 'Twilio rechazó el envío';
}

function tipoDeMime(mime: string): MensajeEntrante['adjuntos'][number]['tipo'] {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('application/')) return 'documento';
  return 'otro';
}
