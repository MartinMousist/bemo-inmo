import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { RegistroAdaptadores } from './adaptadores/registro';
import type { CuentaCanal, MensajeEntrante } from './adaptadores/tipos';
import {
  decidir, REGLAS_POR_DEFECTO, type Decision, type EstadoHilo, type ReglasBot,
} from './bot.motor';

/**
 * Lo que pasa cuando entra un mensaje.
 *
 * Es el corazón de la etapa 18: acá se junta el hilo, el bot y la escalada. El
 * resto —adaptadores, pantalla— son las puntas.
 *
 * ── El orden importa, y es este ──
 *
 *   1. Guardar el mensaje. **Primero, siempre.** Si el bot explota, si el
 *      adaptador no puede contestar, si se cae la red: el mensaje del cliente
 *      ya está guardado y alguien lo va a ver. Perder un mensaje entrante es la
 *      única falla de esta feature que no tiene arreglo después.
 *   2. Actualizar el hilo (no leído, ventana de 24 h, reabrir si estaba
 *      resuelto).
 *   3. Recién ahí, el bot.
 *
 * ── Los canales con ventana de 24 horas ──
 *
 * WhatsApp, Instagram y Messenger la tienen porque la impone Meta, y aplica
 * igual por Twilio o por la API oficial. Telegram y el correo no. Por eso la
 * ventana se fija por CANAL y no por proveedor.
 */

const HORAS_24 = 24 * 60 * 60 * 1000;
const CANALES_CON_VENTANA = new Set(['whatsapp', 'instagram', 'facebook']);

/** Cuánto se calla el bot después de que contestó un agente. */
const PAUSA_TRAS_AGENTE_MIN = 15;

export interface ResultadoIngesta {
  conversacionId: string;
  mensajeId: string | null;
  /** `true` si ya lo habíamos procesado: el webhook se reintentó. */
  duplicado: boolean;
  decision: Decision | null;
}

@Injectable()
export class IngestaService {
  private readonly logger = new Logger('Ingesta');

  constructor(
    private readonly db: DbService,
    private readonly registro: RegistroAdaptadores,
  ) {}

  async recibir(cuenta: CuentaCanal, mensajes: MensajeEntrante[]): Promise<ResultadoIngesta[]> {
    const salida: ResultadoIngesta[] = [];
    for (const m of mensajes) {
      salida.push(await this.recibirUno(cuenta, m));
    }
    return salida;
  }

  private async recibirUno(cuenta: CuentaCanal, m: MensajeEntrante): Promise<ResultadoIngesta> {
    const ctx = await this.db.withTenant(cuenta.tenantId, async (ej) => {
      const conv = await this.hiloDe(ej, cuenta, m);

      // Bloqueada = spam. Se descarta sin guardar y sin contestar: es todo el
      // sentido de bloquear a alguien.
      if (conv.estado === 'bloqueada') {
        return { conv, mensajeId: null, duplicado: false, ignorar: true };
      }

      const mensajeId = await this.guardarEntrante(ej, cuenta, conv.id, m);

      // Ya lo teníamos. El webhook se reintentó —los proveedores reintentan— y
      // un mensaje repetido en un hilo se lee como que el cliente insistió.
      if (!mensajeId) return { conv, mensajeId: null, duplicado: true, ignorar: true };

      await this.actualizarHilo(ej, cuenta, conv.id, m, conv.estado);
      return { conv, mensajeId, duplicado: false, ignorar: false };
    });

    if (ctx.ignorar) {
      return {
        conversacionId: ctx.conv.id,
        mensajeId: null,
        duplicado: ctx.duplicado,
        decision: null,
      };
    }

    const decision = await this.correrBot(cuenta, ctx.conv, m);

    return {
      conversacionId: ctx.conv.id,
      mensajeId: ctx.mensajeId,
      duplicado: false,
      decision,
    };
  }

  /** Trae el hilo con esta persona en esta cuenta, o lo abre. */
  private async hiloDe(
    ej: Ejecutor,
    cuenta: CuentaCanal,
    m: MensajeEntrante,
  ): Promise<FilaHilo> {
    // `ON CONFLICT DO UPDATE` y no `DO NOTHING`: con `DO NOTHING` no hay
    // `RETURNING` cuando la fila ya existe, y haría falta un segundo viaje. El
    // update del nombre además sirve: la gente se cambia el nombre de perfil.
    const { rows } = await ej.query<FilaHilo>(
      `INSERT INTO conversacion
         (tenant_id, canal_cuenta_id, contacto_externo, contacto_nombre)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, canal_cuenta_id, contacto_externo) DO UPDATE
         SET contacto_nombre = coalesce(EXCLUDED.contacto_nombre, conversacion.contacto_nombre)
       RETURNING id, estado, bot_activo, bot_pausado_hasta, asignado_a,
                 (SELECT count(*) FROM mensaje ms WHERE ms.conversacion_id = conversacion.id)::int
                   AS mensajes`,
      [cuenta.tenantId, cuenta.id, m.contactoExterno, m.contactoNombre],
    );
    return rows[0];
  }

  /** Guarda el entrante. Devuelve `null` si ya estaba (idempotencia). */
  private async guardarEntrante(
    ej: Ejecutor,
    cuenta: CuentaCanal,
    conversacionId: string,
    m: MensajeEntrante,
  ): Promise<string | null> {
    const { rows } = await ej.query<{ id: string }>(
      `INSERT INTO mensaje
         (tenant_id, conversacion_id, direccion, autor_tipo, cuerpo, adjuntos,
          id_externo, estado, created_at)
       VALUES ($1,$2,'entrante','cliente',$3,$4::jsonb,$5,'recibido',$6)
       ON CONFLICT (tenant_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        cuenta.tenantId, conversacionId, m.cuerpo,
        JSON.stringify(m.adjuntos ?? []), m.idExterno, m.recibidoEl,
      ],
    );
    return rows[0]?.id ?? null;
  }

  private async actualizarHilo(
    ej: Ejecutor,
    cuenta: CuentaCanal,
    conversacionId: string,
    m: MensajeEntrante,
    estadoPrevio: string,
  ): Promise<void> {
    // Un hilo resuelto que recibe un mensaje VUELVE a la bandeja. Si no, el
    // cliente escribe y nadie se entera nunca: quedó archivado del lado nuestro.
    const estado = estadoPrevio === 'resuelta' || estadoPrevio === 'archivada'
      ? 'abierta'
      : estadoPrevio;

    const ventana = CANALES_CON_VENTANA.has(cuenta.canal)
      ? new Date(m.recibidoEl.getTime() + HORAS_24)
      : null;

    await ej.query(
      `UPDATE conversacion SET
         estado = $2,
         no_leido = true,
         ultimo_mensaje_el = $3,
         ultimo_entrante_el = $3,
         ventana_vence_el = coalesce($4, ventana_vence_el)
       WHERE id = $1`,
      [conversacionId, estado, m.recibidoEl, ventana],
    );
  }

  /**
   * El bot decide y se ejecuta la decisión.
   *
   * Fuera de la transacción del guardado a propósito: mandar un mensaje es una
   * llamada de red que puede tardar segundos, y tener una transacción abierta
   * mientras tanto bloquea la fila del hilo. Si el envío falla, el mensaje del
   * cliente **ya está guardado** —que es lo único que no se puede perder—.
   */
  private async correrBot(
    cuenta: CuentaCanal,
    conv: FilaHilo,
    m: MensajeEntrante,
  ): Promise<Decision> {
    const reglas = reglasDe(cuenta);
    const estado: EstadoHilo = {
      botActivo: conv.bot_activo,
      botPausadoHasta: conv.bot_pausado_hasta,
      // El hilo recién se creó: este es el primer mensaje. Se cuenta ANTES de
      // insertar el entrante, así que 0 es «no había nada».
      esPrimerMensaje: conv.mensajes === 0,
      asignado: conv.asignado_a !== null,
    };

    const decision = decidir(m.cuerpo, reglas, estado, new Date());

    switch (decision.accion) {
      case 'callar':
        break;

      case 'responder':
        await this.responder(cuenta, conv.id, m.contactoExterno, decision.texto, 'bot');
        break;

      case 'escalar':
        if (decision.texto) {
          await this.responder(cuenta, conv.id, m.contactoExterno, decision.texto, 'bot');
        }
        await this.avisarQueHaceFaltaUnaPersona(
          cuenta, conv.id, 'conversacion_escalada', decision.motivo, decision.equipo,
        );
        break;

      case 'avisar':
        if (decision.texto) {
          await this.responder(cuenta, conv.id, m.contactoExterno, decision.texto, 'bot');
        }
        await this.avisarQueHaceFaltaUnaPersona(
          cuenta, conv.id, 'conversacion_escalada', decision.motivo, null,
        );
        break;
    }

    return decision;
  }

  /** Manda un mensaje y lo deja registrado, salga o no. */
  async responder(
    cuenta: CuentaCanal,
    conversacionId: string,
    destino: string,
    texto: string,
    autorTipo: 'bot' | 'agente',
    usuarioId?: string,
  ): Promise<{ enviado: boolean; detalle: string }> {
    const adaptador = this.registro.de(cuenta.proveedor);
    const r = adaptador
      ? await adaptador.enviar(cuenta, destino, texto)
      : { idExterno: null, enviado: false, detalle: `Sin adaptador para «${cuenta.proveedor}»` };

    await this.db.withTenant(cuenta.tenantId, async (ej) => {
      await ej.query(
        `INSERT INTO mensaje
           (tenant_id, conversacion_id, direccion, autor_tipo, autor_usuario_id,
            cuerpo, id_externo, estado, error)
         VALUES ($1,$2,'saliente',$3,$4,$5,$6,$7,$8)`,
        [
          cuenta.tenantId, conversacionId, autorTipo, usuarioId ?? null, texto,
          r.idExterno,
          // Lo que NO salió queda en `pendiente`, no en `fallido`: pendiente es
          // «todavía puede salir» y es lo que el reintento va a buscar. Es la
          // misma distinción que ya hace `evento_programado`.
          r.enviado ? 'enviado' : 'pendiente',
          r.enviado ? null : r.detalle,
        ],
      );

      await ej.query(
        `UPDATE conversacion SET
           ultimo_mensaje_el = now(),
           bot_pausado_hasta = CASE WHEN $2 = 'agente'
             THEN now() + ($3 || ' minutes')::interval ELSE bot_pausado_hasta END
         WHERE id = $1`,
        [conversacionId, autorTipo, String(PAUSA_TRAS_AGENTE_MIN)],
      );
    });

    return { enviado: r.enviado, detalle: r.detalle };
  }

  /**
   * El aviso de que hace falta una persona.
   *
   * Va al MISMO `evento_programado` que la etapa 7 construyó, así que aparece
   * en la bandeja de avisos que ya existe y ya tiene pantalla. Inventar un
   * sistema de notificaciones aparte sería una segunda bandeja que nadie mira.
   *
   * `dispara_el` es hoy: no es un recordatorio a futuro, es «esto pasa ahora».
   */
  private async avisarQueHaceFaltaUnaPersona(
    cuenta: CuentaCanal,
    conversacionId: string,
    tipo: 'conversacion_escalada' | 'conversacion_sin_responder',
    motivo: string,
    equipo: string | null,
  ): Promise<void> {
    await this.db.withTenant(cuenta.tenantId, async (ej) => {
      const { rows } = await ej.query<{ contacto: string | null; asignado: string | null }>(
        'SELECT contacto_nombre AS contacto, asignado_a AS asignado FROM conversacion WHERE id = $1',
        [conversacionId],
      );
      const quien = rows[0]?.contacto ?? 'Un contacto';

      await ej.query(
        `INSERT INTO evento_programado
           (tenant_id, tipo, entidad_tipo, entidad_id, dispara_el, canal,
            destinatario_usuario_id, titulo, detalle, payload)
         VALUES ($1,$2,'conversacion',$3,current_date,'app',$4,$5,$6,$7::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          cuenta.tenantId, tipo, conversacionId,
          rows[0]?.asignado ?? null,
          `${quien} necesita una respuesta`,
          motivo,
          JSON.stringify({ canal: cuenta.canal, equipo }),
        ],
      );
    });

    this.logger.log(`Escalada en ${cuenta.canal}: ${motivo}`);
  }
}

interface FilaHilo {
  id: string;
  estado: string;
  bot_activo: boolean;
  bot_pausado_hasta: Date | null;
  asignado_a: string | null;
  mensajes: number;
}

/**
 * Las reglas del bot salen de la cuenta, con las de fábrica como piso.
 *
 * Se fusiona campo por campo y no con un `??` sobre el objeto entero: una
 * inmobiliaria que quiere agregar una palabra de salida no tiene por qué
 * redefinir también el ruteo y las confirmaciones.
 */
export function reglasDe(cuenta: CuentaCanal): ReglasBot {
  const propias = (cuenta.config.reglas ?? {}) as Partial<ReglasBot>;
  return {
    palabrasDeSalida: propias.palabrasDeSalida ?? REGLAS_POR_DEFECTO.palabrasDeSalida,
    ruteo: propias.ruteo ?? REGLAS_POR_DEFECTO.ruteo,
    palabrasDeConfirmacion:
      propias.palabrasDeConfirmacion ?? REGLAS_POR_DEFECTO.palabrasDeConfirmacion,
    palabrasDeCancelacion:
      propias.palabrasDeCancelacion ?? REGLAS_POR_DEFECTO.palabrasDeCancelacion,
    bienvenida: propias.bienvenida ?? REGLAS_POR_DEFECTO.bienvenida,
    sinCoincidencia: propias.sinCoincidencia ?? REGLAS_POR_DEFECTO.sinCoincidencia,
  };
}
