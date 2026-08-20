import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  Adaptador, ContextoWebhook, CuentaCanal, MensajeEntrante, ResultadoEnvio,
} from './tipos';

/**
 * Correo.
 *
 * ── Lo que este adaptador NO hace, y por qué está escrito igual ──
 *
 * No manda correo. Mandarlo de verdad necesita un proveedor —SMTP o una API
 * tipo Resend/SendGrid— y hoy no hay ninguno configurado. Escribir un cliente
 * SMTP a mano para tener «algo» sería sumar la parte más frágil del sistema
 * para resolver un problema que se resuelve con una variable de entorno.
 *
 * Lo que sí hace es lo que cuesta y no depende del proveedor: **parsear el
 * correo entrante** y verificar la firma del webhook. El formato de entrada es
 * casi el mismo en todos los proveedores (`from`, `subject`, `text`), así que
 * esto ya sirve para el que se elija.
 *
 * `disponible()` devuelve `false` con el motivo. La pantalla lo muestra tal
 * cual y el cuadro de respuesta dice que queda en cola: es la misma regla que
 * ya cumplen `GET /avisos/canales` y el botón «Publicar» de la etapa 6.
 */
@Injectable()
export class EmailAdaptador implements Adaptador {
  readonly proveedor = 'smtp';
  readonly canales = ['email'] as const;

  disponible(cuenta: CuentaCanal): { ok: boolean; detalle: string } {
    if (!cuenta.config.proveedorSaliente) {
      return {
        ok: false,
        detalle: 'Falta configurar el proveedor de correo saliente (SMTP, Resend o SendGrid).',
      };
    }
    if (!cuenta.secreto) return { ok: false, detalle: 'Falta la clave del proveedor de correo.' };
    return { ok: true, detalle: 'Conectado' };
  }

  /**
   * Los proveedores de correo entrante firman con HMAC-SHA256 sobre el cuerpo
   * crudo, igual que Meta. El nombre de la cabecera cambia según cuál sea, así
   * que se configura por cuenta en vez de quedar clavado acá.
   */
  verificarFirma(cuenta: CuentaCanal, ctx: ContextoWebhook): boolean {
    const secreto = String(cuenta.config.webhookSecret ?? '');
    const cabecera = String(cuenta.config.cabeceraFirma ?? 'x-webhook-signature');
    const firma = ctx.headers[cabecera.toLowerCase()];
    if (!secreto || !firma || !ctx.crudo) return false;

    const esperado = createHmac('sha256', secreto).update(ctx.crudo, 'utf8').digest('hex');
    const a = Buffer.from(esperado);
    const b = Buffer.from(String(firma).replace(/^sha256=/, ''));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parsear(cuerpo: unknown): MensajeEntrante[] {
    const p = (cuerpo ?? {}) as Record<string, unknown>;

    const de = String(p.from ?? p.sender ?? '');
    if (!de) return [];

    // El texto plano antes que el HTML: el hilo se lee, no se renderiza, y el
    // HTML de un correo trae firmas, imágenes de seguimiento y tres capas de
    // citas del mensaje anterior.
    const texto = String(p.text ?? p['body-plain'] ?? p.plain ?? '');
    const asunto = String(p.subject ?? '');

    return [{
      idExterno: String(p.messageId ?? p['message-id'] ?? p.id ?? `mail:${Date.now()}`),
      contactoExterno: direccionDe(de),
      contactoNombre: nombreDe(de),
      // El asunto va adentro del cuerpo porque el hilo no tiene dónde ponerlo:
      // en un chat no existe. Perderlo dejaría mensajes sin contexto —«te
      // mando lo que hablamos» sin saber de qué—.
      cuerpo: asunto ? `${asunto}\n\n${texto}`.trim() : texto,
      adjuntos: [],
      recibidoEl: new Date(),
    }];
  }

  async enviar(cuenta: CuentaCanal, _destino: string, _texto: string): Promise<ResultadoEnvio> {
    const listo = this.disponible(cuenta);
    // Nunca devuelve `enviado: true`. Cuando haya proveedor, se implementa acá
    // y todo lo de arriba —hilos, bot, escalada— ya funciona sin tocarse.
    return {
      idExterno: null,
      enviado: false,
      detalle: listo.ok
        ? 'El envío por correo todavía no está implementado: queda en cola.'
        : listo.detalle,
    };
  }
}

/** `Ana Torres <ana@correo.test>` → `ana@correo.test` */
function direccionDe(de: string): string {
  const m = de.match(/<([^>]+)>/);
  return (m ? m[1] : de).trim().toLowerCase();
}

/** `Ana Torres <ana@correo.test>` → `Ana Torres` */
function nombreDe(de: string): string | null {
  const m = de.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : null;
}
