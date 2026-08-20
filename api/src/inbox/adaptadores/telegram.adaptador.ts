import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  Adaptador, ContextoWebhook, CuentaCanal, MensajeEntrante, ResultadoEnvio,
} from './tipos';

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 15_000;

/**
 * Telegram, vía Bot API.
 *
 * ── Por qué es el primero ──
 *
 * Porque es el único canal que se enciende **hoy y sin trámite**: un token de
 * BotFather son dos minutos, gratis, sin verificación de negocio ni plantillas
 * aprobadas. Eso permite dejar el circuito entero probado de punta a punta
 * —entra un mensaje real, aparece en la bandeja, se contesta, llega— y recién
 * después enchufar Twilio y Meta sobre una interfaz que ya se sabe que anda.
 *
 * ── Los dos modos de entrada ──
 *
 * `setWebhook` es lo correcto en producción, pero necesita una URL pública con
 * TLS: en una laptop no existe sin un túnel. Telegram además ofrece
 * `getUpdates` —long polling—, que sirve para desarrollo sin exponer nada.
 * Los dos terminan en el mismo `parsear()`, así que lo que se prueba con uno
 * vale para el otro.
 */
@Injectable()
export class TelegramAdaptador implements Adaptador {
  readonly proveedor = 'telegram';
  readonly canales = ['telegram'] as const;
  private readonly logger = new Logger('Telegram');

  disponible(cuenta: CuentaCanal): { ok: boolean; detalle: string } {
    return cuenta.secreto
      ? { ok: true, detalle: 'Conectado' }
      : { ok: false, detalle: 'Falta el token del bot (se saca de @BotFather)' };
  }

  /**
   * Telegram no firma el cuerpo: ofrece un `secret_token` que se fija al
   * registrar el webhook y devuelve en una cabecera. Es un secreto compartido,
   * no una firma, así que se compara en tiempo constante igual —comparar con
   * `===` filtra por tiempo cuántos caracteres coinciden—.
   */
  verificarFirma(cuenta: CuentaCanal, ctx: ContextoWebhook): boolean {
    const esperado = String(cuenta.config.webhookSecret ?? '');
    // Sin secreto configurado el webhook NO se acepta. El default es cerrado:
    // un endpoint público sin verificación es una bandeja que llena cualquiera.
    if (!esperado) return false;

    const recibido = ctx.headers['x-telegram-bot-api-secret-token'] ?? '';
    return igualEnTiempoConstante(esperado, recibido);
  }

  parsear(cuerpo: unknown): MensajeEntrante[] {
    const upd = cuerpo as ActualizacionTelegram;
    // `message` es el mensaje nuevo; `edited_message`, uno que el cliente
    // corrigió. Se toma el editado también: para quien lee la bandeja, el
    // texto corregido es LO QUE QUISO DECIR, y perderlo deja el hilo mintiendo.
    const m = upd?.message ?? upd?.edited_message;
    if (!m?.chat?.id) return [];

    const texto = m.text ?? m.caption ?? '';
    const adjuntos = adjuntosDe(m);
    // Sin texto y sin adjunto no hay nada que mostrar (un `sticker` que no
    // sabemos leer, un cambio de título de grupo).
    if (!texto && adjuntos.length === 0) return [];

    return [{
      idExterno: `tg:${m.message_id}:${m.chat.id}`,
      contactoExterno: String(m.chat.id),
      contactoNombre: nombreDe(m),
      cuerpo: texto,
      adjuntos,
      recibidoEl: new Date((m.date ?? Math.floor(Date.now() / 1000)) * 1000),
    }];
  }

  async enviar(cuenta: CuentaCanal, destino: string, texto: string): Promise<ResultadoEnvio> {
    if (!cuenta.secreto) {
      return { idExterno: null, enviado: false, detalle: 'Sin token del bot' };
    }

    try {
      const res = await fetch(`${API}/bot${cuenta.secreto}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: destino, text: texto }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const datos = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };

      if (!res.ok || !datos.ok) {
        // El detalle de Telegram se guarda tal cual: «bot was blocked by the
        // user» y «chat not found» son cosas distintas y el que mira la bandeja
        // tiene que poder distinguirlas.
        const detalle = datos.description ?? `HTTP ${res.status}`;
        this.logger.warn(`Envío rechazado por Telegram: ${detalle}`);
        return { idExterno: null, enviado: false, detalle };
      }

      return {
        idExterno: datos.result?.message_id ? `tg:${datos.result.message_id}:${destino}` : null,
        enviado: true,
        detalle: 'Enviado',
      };
    } catch (err) {
      const detalle = err instanceof Error ? err.message : 'Error de red';
      this.logger.warn(`No se pudo enviar por Telegram: ${detalle}`);
      return { idExterno: null, enviado: false, detalle };
    }
  }

  /**
   * Long polling, sólo para desarrollo.
   *
   * Devuelve las actualizaciones desde `offset`. El que llama guarda el último
   * `update_id` + 1: Telegram las repite hasta que se confirman, que es
   * exactamente lo que hace que un reinicio no pierda mensajes.
   */
  async traerActualizaciones(
    cuenta: CuentaCanal,
    offset: number,
  ): Promise<{ actualizaciones: Array<{ id: number; mensajes: MensajeEntrante[] }>; error?: string }> {
    if (!cuenta.secreto) return { actualizaciones: [], error: 'Sin token del bot' };

    try {
      const res = await fetch(
        `${API}/bot${cuenta.secreto}/getUpdates?offset=${offset}&timeout=0&limit=50`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      const datos = (await res.json()) as {
        ok?: boolean; description?: string;
        result?: Array<ActualizacionTelegram & { update_id: number }>;
      };
      if (!datos.ok) return { actualizaciones: [], error: datos.description ?? `HTTP ${res.status}` };

      return {
        actualizaciones: (datos.result ?? []).map((u) => ({
          id: u.update_id,
          mensajes: this.parsear(u),
        })),
      };
    } catch (err) {
      return { actualizaciones: [], error: err instanceof Error ? err.message : 'Error de red' };
    }
  }

  /** Registra el webhook en Telegram. Se usa desde la pantalla de canales. */
  async registrarWebhook(
    cuenta: CuentaCanal,
    url: string,
    secreto: string,
  ): Promise<{ ok: boolean; detalle: string }> {
    if (!cuenta.secreto) return { ok: false, detalle: 'Sin token del bot' };
    try {
      const res = await fetch(`${API}/bot${cuenta.secreto}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret_token: secreto, drop_pending_updates: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const datos = (await res.json()) as { ok?: boolean; description?: string };
      return { ok: Boolean(datos.ok), detalle: datos.description ?? 'Webhook registrado' };
    } catch (err) {
      return { ok: false, detalle: err instanceof Error ? err.message : 'Error de red' };
    }
  }

  /** Confirma que el token sirve y de qué bot es. */
  async verificarToken(token: string): Promise<{ ok: boolean; usuario?: string; detalle: string }> {
    try {
      const res = await fetch(`${API}/bot${token}/getMe`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const datos = (await res.json()) as {
        ok?: boolean; description?: string; result?: { username?: string };
      };
      return datos.ok
        ? { ok: true, usuario: datos.result?.username, detalle: 'Token válido' }
        : { ok: false, detalle: datos.description ?? `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detalle: err instanceof Error ? err.message : 'Error de red' };
    }
  }
}

interface MensajeTelegram {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number | string };
  from?: { first_name?: string; last_name?: string; username?: string };
  photo?: Array<{ file_id?: string }>;
  document?: { file_id?: string; file_name?: string; mime_type?: string };
  voice?: { file_id?: string; mime_type?: string };
  audio?: { file_id?: string; mime_type?: string };
  video?: { file_id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number };
}

interface ActualizacionTelegram {
  message?: MensajeTelegram;
  edited_message?: MensajeTelegram;
}

function nombreDe(m: MensajeTelegram): string | null {
  const f = m.from;
  if (!f) return null;
  const nombre = [f.first_name, f.last_name].filter(Boolean).join(' ').trim();
  return nombre || (f.username ? `@${f.username}` : null);
}

function adjuntosDe(m: MensajeTelegram): MensajeEntrante['adjuntos'] {
  const out: MensajeEntrante['adjuntos'] = [];

  // De las fotos, la ÚLTIMA es la de mayor resolución: Telegram manda el mismo
  // archivo en varios tamaños y quedarse con el primero deja una miniatura.
  if (m.photo?.length) {
    const grande = m.photo[m.photo.length - 1];
    if (grande.file_id) out.push({ tipo: 'imagen', idExterno: grande.file_id });
  }
  if (m.document?.file_id) {
    out.push({
      tipo: 'documento', idExterno: m.document.file_id,
      nombre: m.document.file_name, mime: m.document.mime_type,
    });
  }
  const audio = m.voice ?? m.audio;
  if (audio?.file_id) out.push({ tipo: 'audio', idExterno: audio.file_id, mime: audio.mime_type });
  if (m.video?.file_id) out.push({ tipo: 'video', idExterno: m.video.file_id, mime: m.video.mime_type });
  if (m.location) {
    out.push({
      tipo: 'ubicacion',
      url: `https://www.google.com/maps?q=${m.location.latitude},${m.location.longitude}`,
    });
  }
  return out;
}

/**
 * Comparación en tiempo constante, sin depender de la longitud.
 *
 * `timingSafeEqual` de Node exige buffers del mismo largo y tira si difieren,
 * lo que filtra el largo del secreto. Se hashean los dos primero: así siempre
 * se comparan 32 bytes.
 */
export function igualEnTiempoConstante(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
