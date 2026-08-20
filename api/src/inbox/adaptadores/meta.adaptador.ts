import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  Adaptador, ContextoWebhook, CuentaCanal, MensajeEntrante, ResultadoEnvio,
} from './tipos';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 20_000;

/**
 * Meta: WhatsApp Cloud API, Instagram y Messenger.
 *
 * ── Está escrito ENTERO a propósito, aunque todavía no se pueda usar ──
 *
 * No es un stub. Parsea el formato real de los webhooks de Meta, verifica la
 * firma real y manda por el Graph real. Lo único que falta son las credenciales
 * y la verificación de negocio, que es trámite y no código.
 *
 * Se escribió ahora porque el formato de Meta es **la parte difícil** —los
 * mensajes vienen anidados en `entry[].changes[].value.messages[]` y el
 * remitente en otro array— y descubrir eso el día que llegue la aprobación,
 * con el cliente esperando, es la peor forma de encontrarse con un parser.
 *
 * Mientras tanto `disponible()` devuelve `false` con el motivo, la pantalla lo
 * dice y el cuadro de respuesta avisa que queda en cola. Nunca se simula que un
 * mensaje salió.
 */
@Injectable()
export class MetaAdaptador implements Adaptador {
  readonly proveedor = 'meta';
  readonly canales = ['whatsapp', 'instagram', 'facebook'] as const;
  private readonly logger = new Logger('Meta');

  disponible(cuenta: CuentaCanal): { ok: boolean; detalle: string } {
    if (!cuenta.config.phoneNumberId && !cuenta.config.pageId) {
      return { ok: false, detalle: 'Falta el Phone Number ID (WhatsApp) o el Page ID' };
    }
    if (!cuenta.secreto) {
      return {
        ok: false,
        detalle: 'Falta el token de acceso. Requiere verificación de negocio en Meta '
          + 'y, para WhatsApp, plantillas aprobadas.',
      };
    }
    return { ok: true, detalle: 'Conectado' };
  }

  /**
   * `X-Hub-Signature-256`: HMAC-SHA256 del cuerpo CRUDO con el App Secret.
   *
   * Sobre el crudo y no sobre el objeto ya parseado: `JSON.stringify` de lo que
   * parseó Express no devuelve byte por byte lo que mandó Meta —cambia el orden
   * de claves y los espacios— y la firma no valida nunca. Es el error clásico
   * de esta integración.
   */
  verificarFirma(cuenta: CuentaCanal, ctx: ContextoWebhook): boolean {
    const appSecret = String(cuenta.config.appSecret ?? '');
    const firma = ctx.headers['x-hub-signature-256'];
    if (!appSecret || !firma || !ctx.crudo) return false;

    const esperado = 'sha256=' + createHmac('sha256', appSecret).update(ctx.crudo, 'utf8').digest('hex');
    const a = Buffer.from(esperado);
    const b = Buffer.from(firma);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parsear(cuerpo: unknown): MensajeEntrante[] {
    const p = cuerpo as PayloadMeta;
    const out: MensajeEntrante[] = [];

    for (const entrada of p?.entry ?? []) {
      for (const cambio of entrada.changes ?? []) {
        const v = cambio.value;
        if (!v?.messages?.length) continue;

        // Los nombres vienen en OTRO array, indexado por el wa_id. Meta no los
        // pone adentro del mensaje.
        const nombres = new Map(
          (v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]),
        );

        for (const m of v.messages) {
          if (!m.id || !m.from) continue;
          out.push({
            idExterno: m.id,
            contactoExterno: m.from,
            contactoNombre: nombres.get(m.from) ?? null,
            cuerpo: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? '',
            adjuntos: adjuntosDe(m),
            // Viene en segundos y como string.
            recibidoEl: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()),
          });
        }
      }
    }
    return out;
  }

  async enviar(cuenta: CuentaCanal, destino: string, texto: string): Promise<ResultadoEnvio> {
    const listo = this.disponible(cuenta);
    if (!listo.ok) return { idExterno: null, enviado: false, detalle: listo.detalle };

    const id = String(cuenta.config.phoneNumberId ?? cuenta.config.pageId);

    try {
      const res = await fetch(`${GRAPH}/${id}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cuenta.secreto}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destino,
          type: 'text',
          text: { body: texto },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const datos = (await res.json()) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number };
      };

      if (!res.ok || datos.error) {
        const detalle = datos.error?.code === 131047
          ? 'Pasaron más de 24 horas desde el último mensaje del cliente: '
            + 'sólo se puede enviar una plantilla aprobada.'
          : (datos.error?.message ?? `HTTP ${res.status}`);
        this.logger.warn(`Meta rechazó el envío: ${detalle}`);
        return { idExterno: null, enviado: false, detalle };
      }

      return { idExterno: datos.messages?.[0]?.id ?? null, enviado: true, detalle: 'Enviado' };
    } catch (err) {
      const detalle = err instanceof Error ? err.message : 'Error de red';
      return { idExterno: null, enviado: false, detalle };
    }
  }
}

interface MensajeMeta {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string } };
  image?: { id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string };
  document?: { id?: string; filename?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number };
}

interface PayloadMeta {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: MensajeMeta[];
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
      };
    }>;
  }>;
}

function adjuntosDe(m: MensajeMeta): MensajeEntrante['adjuntos'] {
  const out: MensajeEntrante['adjuntos'] = [];
  if (m.image?.id) out.push({ tipo: 'imagen', idExterno: m.image.id, mime: m.image.mime_type });
  if (m.audio?.id) out.push({ tipo: 'audio', idExterno: m.audio.id, mime: m.audio.mime_type });
  if (m.video?.id) out.push({ tipo: 'video', idExterno: m.video.id, mime: m.video.mime_type });
  if (m.document?.id) {
    out.push({
      tipo: 'documento', idExterno: m.document.id,
      nombre: m.document.filename, mime: m.document.mime_type,
    });
  }
  if (m.location) {
    out.push({
      tipo: 'ubicacion',
      url: `https://www.google.com/maps?q=${m.location.latitude},${m.location.longitude}`,
    });
  }
  return out;
}
