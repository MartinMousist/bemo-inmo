import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import type { Rol } from '../auth/tokens.service';
import { CanalesService } from './canales.service';
import { IngestaService } from './ingesta.service';

/**
 * La bandeja, del lado de quien atiende.
 *
 * ── El orden de la lista ES la feature ──
 *
 * No se ordena por «más reciente»: se ordena por **hace cuánto que alguien
 * espera**. Es la única pregunta que se le hace a una bandeja a la mañana —a
 * quién le estoy quedando mal— y ordenar por reciente la contesta al revés,
 * poniendo arriba lo que acaba de entrar y enterrando al que espera desde ayer.
 *
 * ── El teléfono enmascarado ──
 *
 * Un asesor puede conversar sin ver el número completo. Es la misma decisión de
 * la 17.2: el dato personal se muestra a quien lo necesita para trabajar, y
 * atender un chat no lo necesita. Titular y administración sí lo ven, porque
 * son quienes tienen que poder llamar.
 */

export interface ConversacionLista {
  id: string;
  canal: string;
  cuenta: string;
  contacto: string;
  /** El identificador del canal, enmascarado según el rol. */
  direccion: string;
  personaId: string | null;
  estado: string;
  noLeido: boolean;
  asignadoA: string | null;
  asignadoNombre: string | null;
  botActivo: boolean;
  ultimoMensaje: string | null;
  ultimoMensajeEl: string | null;
  /** Desde cuándo espera respuesta. `null` = no espera nada. */
  esperandoDesde: string | null;
  /** `false` cuando pasó la ventana de 24 h de Meta. */
  puedeResponderLibre: boolean;
}

export interface MensajeHilo {
  id: string;
  direccion: string;
  autorTipo: string;
  autorNombre: string | null;
  cuerpo: string | null;
  adjuntos: unknown[];
  estado: string;
  error: string | null;
  creadoEl: string;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly db: DbService,
    private readonly canales: CanalesService,
    private readonly ingesta: IngestaService,
  ) {}

  async listar(
    tenantId: string,
    rol: Rol,
    usuarioId: string,
    f: {
      estado?: string; canal?: string; cuentaId?: string; asignadoA?: string;
      soloMios?: boolean; noLeidos?: boolean; q?: string;
      pagina?: number; porPagina?: number;
    },
  ): Promise<Pagina<ConversacionLista>> {
    const pag = { pagina: f.pagina ?? 1, porPagina: f.porPagina ?? 25 };

    return this.db.withTenant(tenantId, async (ej) => {
      // ── La tercera excepción declarada a «el filtro NO es un permiso» ──
      //
      // Las otras dos las fija `common/filtro-agente.ts`: los leads y el
      // desglose de comisiones. Ésta es la del número personal.
      //
      // Si el canal es de una persona, sus conversaciones son suyas: los
      // clientes de Ana no los lee Diego. Las ve Ana, las ve titular y
      // administración —hacen falta para dar continuidad si Ana se enferma o se
      // va, y acá se maneja plata de terceros— y las ve quien esté asignado,
      // para que derivar un cliente funcione sin abrirle la bandeja entera.
      //
      // El canal de la inmobiliaria (`usuario_id IS NULL`) no cambia: lo ve el
      // equipo como siempre.
      // `$7` es NULL para titular y administración —sin restricción— y el id de
      // la persona para el resto. Va como PARÁMETRO y no interpolado en el
      // texto del SQL: el valor sale del token y hoy es confiable, pero
      // interpolar es el patrón que después alguien copia con un valor que no
      // lo es.
      const where = `
        WHERE ($1::text IS NULL OR c.estado = $1)
          AND ($7::uuid IS NULL
               OR cc.usuario_id IS NULL
               OR cc.usuario_id = $7
               OR c.asignado_a = $7)
          AND ($2::text IS NULL OR cc.canal = $2)
          AND ($3::uuid IS NULL OR c.canal_cuenta_id = $3)
          AND ($4::uuid IS NULL OR c.asignado_a = $4)
          AND ($5::boolean IS NOT TRUE OR c.no_leido)
          AND ($6::text IS NULL OR c.contacto_nombre ILIKE '%' || $6 || '%'
                                OR c.contacto_externo ILIKE '%' || $6 || '%')`;

      const params = [
        // Por defecto la bandeja muestra lo ABIERTO. Lo resuelto se pide.
        f.estado ?? 'abierta',
        f.canal ?? null,
        f.cuentaId ?? null,
        f.soloMios ? usuarioId : (f.asignadoA ?? null),
        f.noLeidos ?? null,
        f.q ?? null,
        rol === 'owner' || rol === 'admin' ? null : usuarioId,
      ];

      const { rows: total } = await ej.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM conversacion c
           JOIN canal_cuenta cc ON cc.id = c.canal_cuenta_id ${where}`,
        params,
      );

      const { rows } = await ej.query<FilaLista>(
        `SELECT c.id, cc.canal, cc.nombre AS cuenta, c.contacto_nombre, c.contacto_externo,
                c.persona_id, c.estado, c.no_leido, c.asignado_a, u.nombre AS asignado_nombre,
                c.bot_activo, c.ultimo_mensaje_el, c.ultimo_entrante_el, c.ventana_vence_el,
                (SELECT m.cuerpo FROM mensaje m
                  WHERE m.conversacion_id = c.id
                  ORDER BY m.created_at DESC LIMIT 1) AS ultimo_cuerpo,
                -- Espera respuesta si el ÚLTIMO mensaje del hilo es del cliente.
                -- No alcanza con «no leído»: un agente puede abrirlo, leerlo y
                -- no contestar, y eso sigue siendo alguien esperando.
                (SELECT m.direccion FROM mensaje m
                  WHERE m.conversacion_id = c.id
                  ORDER BY m.created_at DESC LIMIT 1) AS ultima_direccion
           FROM conversacion c
           JOIN canal_cuenta cc ON cc.id = c.canal_cuenta_id
           LEFT JOIN usuario u ON u.id = c.asignado_a
           ${where}
          -- Primero los que esperan, y de esos el que espera hace MÁS tiempo.
          ORDER BY (c.no_leido) DESC, c.ultimo_entrante_el ASC NULLS LAST
          LIMIT $8 OFFSET $9`,
        [...params, pag.porPagina, offset(pag)],
      );

      const ahora = Date.now();
      return armarPagina(rows.map((r) => this.aLista(r, rol, ahora)), Number(total[0].n), pag);
    });
  }

  /**
   * El hilo completo.
   *
   * Lleva la MISMA restricción de visibilidad que el listado, y no por
   * prolijidad: filtrar la lista y dejar abierto el detalle es exactamente el
   * agujero que apareció en la etapa 17 con el portal del inquilino —la lista
   * estaba bien y `vista()` no chequeaba el rol—. Un asesor que escribe la URL
   * de un hilo ajeno tiene que recibir un 404, no la conversación.
   */
  async hilo(
    tenantId: string,
    rol: Rol,
    usuarioId: string,
    id: string,
  ): Promise<{ conversacion: ConversacionLista; mensajes: MensajeHilo[] }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaLista>(
        `SELECT c.id, cc.canal, cc.nombre AS cuenta, c.contacto_nombre, c.contacto_externo,
                c.persona_id, c.estado, c.no_leido, c.asignado_a, u.nombre AS asignado_nombre,
                c.bot_activo, c.ultimo_mensaje_el, c.ultimo_entrante_el, c.ventana_vence_el,
                NULL AS ultimo_cuerpo, NULL AS ultima_direccion
           FROM conversacion c
           JOIN canal_cuenta cc ON cc.id = c.canal_cuenta_id
           LEFT JOIN usuario u ON u.id = c.asignado_a
          WHERE c.id = $1
            AND ($2::uuid IS NULL
                 OR cc.usuario_id IS NULL
                 OR cc.usuario_id = $2
                 OR c.asignado_a = $2)`,
        [id, rol === 'owner' || rol === 'admin' ? null : usuarioId],
      );
      // 404 y no 403: decir «existe pero no es tuya» ya confirma que existe.
      if (!rows.length) throw AppError.notFound('No se encontró esa conversación.');

      const { rows: mensajes } = await ej.query<FilaMensaje>(
        `SELECT m.id, m.direccion, m.autor_tipo, u.nombre AS autor_nombre, m.cuerpo,
                m.adjuntos, m.estado, m.error, m.created_at
           FROM mensaje m
           LEFT JOIN usuario u ON u.id = m.autor_usuario_id
          WHERE m.conversacion_id = $1
          ORDER BY m.created_at`,
        [id],
      );

      // Abrir el hilo lo marca leído. Es lo que espera cualquiera que usó un
      // chat, y no hacerlo deja el contador mintiendo.
      await ej.query('UPDATE conversacion SET no_leido = false WHERE id = $1', [id]);

      return {
        conversacion: this.aLista({ ...rows[0], no_leido: false }, rol, Date.now()),
        mensajes: mensajes.map((m) => ({
          id: m.id,
          direccion: m.direccion,
          autorTipo: m.autor_tipo,
          autorNombre: m.autor_nombre,
          cuerpo: m.cuerpo,
          adjuntos: (m.adjuntos ?? []) as unknown[],
          estado: m.estado,
          error: m.error,
          creadoEl: m.created_at.toISOString(),
        })),
      };
    });
  }

  /**
   * Contestar.
   *
   * Devuelve si SALIÓ o quedó en cola, y la pantalla lo dice tal cual. Es la
   * regla que manda sobre esta feature: un mensaje que el usuario cree enviado
   * y no salió es peor que no tener el cuadro de respuesta.
   */
  async responder(
    tenantId: string,
    id: string,
    texto: string,
    usuarioId: string,
  ): Promise<{ enviado: boolean; detalle: string }> {
    const datos = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ cuenta_id: string; contacto: string; estado: string }>(
        `SELECT canal_cuenta_id AS cuenta_id, contacto_externo AS contacto, estado
           FROM conversacion WHERE id = $1`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa conversación.');
      return rows[0];
    });

    if (datos.estado === 'bloqueada') {
      throw new AppError(
        422, ErrorCode.ESTADO_INVALIDO,
        'La conversación está bloqueada.', 'Unprocessable Entity',
      );
    }

    const cuenta = await this.canales.paraAdaptador(tenantId, datos.cuenta_id);
    return this.ingesta.responder(cuenta, id, datos.contacto, texto, 'agente', usuarioId);
  }

  /** Vincula o desvincula la propiedad. `null` la saca. */
  async vincularPropiedad(
    tenantId: string,
    id: string,
    propiedadId: string | null,
  ): Promise<void> {
    await this.actualizar(tenantId, id, 'propiedad_id = $2', [propiedadId]);
  }

  async asignar(tenantId: string, id: string, usuarioId: string | null): Promise<void> {
    await this.actualizar(tenantId, id, 'asignado_a = $2', [usuarioId]);
  }

  async cambiarEstado(tenantId: string, id: string, estado: string): Promise<void> {
    await this.actualizar(tenantId, id, 'estado = $2', [estado]);
  }

  async marcarLeido(tenantId: string, id: string, leido: boolean): Promise<void> {
    await this.actualizar(tenantId, id, 'no_leido = $2', [!leido]);
  }

  /**
   * Prender o apagar el bot en este hilo.
   *
   * Apagarlo a mano NO vence solo: es distinto de la pausa automática que se
   * activa cuando un agente contesta. Si venciera, el bot volvería a meterse en
   * una conversación que alguien decidió atender a mano.
   */
  async cambiarBot(tenantId: string, id: string, activo: boolean): Promise<void> {
    await this.actualizar(
      tenantId, id,
      'bot_activo = $2, bot_pausado_hasta = NULL',
      [activo],
    );
  }

  private async actualizar(
    tenantId: string,
    id: string,
    set: string,
    params: unknown[],
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE conversacion SET ${set} WHERE id = $1`,
        [id, ...params],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa conversación.');
    });
  }

  private aLista(r: FilaLista, rol: Rol, ahora: number): ConversacionLista {
    const esperando = r.ultima_direccion === 'entrante' || r.no_leido;

    return {
      id: r.id,
      canal: r.canal,
      cuenta: r.cuenta,
      contacto: r.contacto_nombre ?? enmascarar(r.contacto_externo, rol),
      direccion: enmascarar(r.contacto_externo, rol),
      personaId: r.persona_id,
      estado: r.estado,
      noLeido: r.no_leido,
      asignadoA: r.asignado_a,
      asignadoNombre: r.asignado_nombre,
      botActivo: r.bot_activo,
      ultimoMensaje: r.ultimo_cuerpo,
      ultimoMensajeEl: r.ultimo_mensaje_el?.toISOString() ?? null,
      esperandoDesde: esperando ? (r.ultimo_entrante_el?.toISOString() ?? null) : null,
      // Sin ventana registrada se asume que se puede: es el caso de Telegram y
      // del correo, que no tienen la regla de las 24 horas.
      puedeResponderLibre: !r.ventana_vence_el || r.ventana_vence_el.getTime() > ahora,
    };
  }
}

/**
 * El número, a medias.
 *
 * `whatsapp:+5492611234567` → `whatsapp:+54926····567`. Se dejan los últimos
 * tres para que alguien que conoce al cliente lo pueda reconocer, sin que el
 * número sirva para exportarlo a otro lado.
 */
export function enmascarar(valor: string, rol: Rol): string {
  if (rol === 'owner' || rol === 'admin') return valor;

  if (valor.includes('@')) {
    const [u, dom] = valor.split('@');
    return `${u.slice(0, 2)}···@${dom}`;
  }

  // El prefijo del canal (`whatsapp:`) se conserva: dice de dónde viene el
  // mensaje y no identifica a nadie.
  const i = valor.indexOf(':');
  const prefijo = i >= 0 ? valor.slice(0, i + 1) : '';
  const resto = i >= 0 ? valor.slice(i + 1) : valor;

  // Se enmascara SIEMPRE, también los cortos. La primera versión devolvía
  // entero cualquier identificador de ocho caracteres o menos «porque no había
  // nada que tapar», y un chat_id de Telegram tiene seis: quedaba a la vista
  // justo lo que se estaba tratando de esconder. Lo encontró el test.
  if (resto.length <= 3) return `${prefijo}····`;
  return `${prefijo}····${resto.slice(-3)}`;
}

interface FilaLista {
  id: string;
  canal: string;
  cuenta: string;
  contacto_nombre: string | null;
  contacto_externo: string;
  persona_id: string | null;
  estado: string;
  no_leido: boolean;
  asignado_a: string | null;
  asignado_nombre: string | null;
  bot_activo: boolean;
  ultimo_mensaje_el: Date | null;
  ultimo_entrante_el: Date | null;
  ventana_vence_el: Date | null;
  ultimo_cuerpo: string | null;
  ultima_direccion: string | null;
}

interface FilaMensaje {
  id: string;
  direccion: string;
  autor_tipo: string;
  autor_nombre: string | null;
  cuerpo: string | null;
  adjuntos: unknown;
  estado: string;
  error: string | null;
  created_at: Date;
}
