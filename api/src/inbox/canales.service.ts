import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { loadEnv } from '../config/env';
import type { Rol } from '../auth/tokens.service';
import { RegistroAdaptadores } from './adaptadores/registro';
import { IngestaService } from './ingesta.service';
import type { CuentaCanal } from './adaptadores/tipos';

/**
 * Las cuentas de canal conectadas: un número de WhatsApp, un bot, una casilla.
 *
 * ── La regla que ordena este archivo ──
 *
 * **El secreto entra y no sale.** Se guarda cifrado con `pgcrypto` y sólo se
 * descifra hacia adentro, para que un adaptador pueda mandar un mensaje. No hay
 * ni un método que lo devuelva por la API, ni siquiera a un `owner`: un token
 * que la pantalla puede mostrar es un token que termina en una captura, en el
 * historial del navegador o en un log del proxy.
 *
 * Lo que la pantalla sí puede saber es si el canal **funciona**, que es la
 * pregunta real: `disponible()` de cada adaptador devuelve el motivo cuando no.
 */

export interface CuentaVisible {
  id: string;
  canal: string;
  proveedor: string;
  nombre: string;
  identificador: string;
  activa: boolean;
  /** Si puede enviar de verdad hoy. La pantalla lo muestra tal cual. */
  disponible: boolean;
  detalle: string;
  /** `true` si tiene credencial cargada. NUNCA cuál. */
  tieneSecreto: boolean;
  /** `null` = canal de la inmobiliaria. Con valor, el número de esa persona. */
  usuarioId: string | null;
  usuarioNombre: string | null;
  /** `false` = cargado y esperando que el titular lo habilite. */
  aprobada: boolean;
  config: Record<string, unknown>;
  /** La URL a la que el proveedor tiene que pegarle. */
  rutaWebhook: string;
  creadaEl: string;
}

@Injectable()
export class CanalesService {
  private readonly logger = new Logger('Canales');

  constructor(
    private readonly db: DbService,
    private readonly registro: RegistroAdaptadores,
    private readonly ingesta: IngestaService,
  ) {}

  private get clave(): string {
    return loadEnv().CANALES_SECRETO;
  }

  /**
   * Los canales que esta persona puede ver.
   *
   * Titular y administración ven todos. El resto ve los de la inmobiliaria y
   * **el suyo**: el número de un compañero no es asunto de nadie más, y su
   * credencial menos.
   */
  async listar(tenantId: string, rol?: Rol, usuarioId?: string): Promise<CuentaVisible[]> {
    const todos = !rol || rol === 'owner' || rol === 'admin';

    const filas = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaCuenta>(
        `SELECT cc.id, cc.tenant_id, cc.canal, cc.proveedor, cc.nombre, cc.identificador,
                cc.config, cc.activa, cc.webhook_token, cc.created_at, cc.usuario_id,
                cc.aprobada_el, u.nombre AS usuario_nombre,
                (cc.secreto IS NOT NULL) AS tiene_secreto
           FROM canal_cuenta cc
           LEFT JOIN usuario u ON u.id = cc.usuario_id
          WHERE ($1::uuid IS NULL OR cc.usuario_id IS NULL OR cc.usuario_id = $1)
          ORDER BY cc.usuario_id NULLS FIRST, cc.canal, cc.nombre`,
        [todos ? null : usuarioId],
      );
      return rows;
    });

    // El secreto se descifra acá adentro SÓLO para preguntarle al adaptador si
    // la cuenta está completa. No sale de este método.
    const out: CuentaVisible[] = [];
    for (const f of filas) {
      const secreto = f.tiene_secreto ? await this.descifrar(f.id) : null;
      out.push(this.aVisible(f, secreto));
    }
    return out;
  }

  /**
   * La cuenta lista para que un adaptador trabaje, con el secreto descifrado.
   *
   * Interno. Devolver esto por un endpoint sería tirar el cifrado a la basura.
   */
  async paraAdaptador(tenantId: string, cuentaId: string): Promise<CuentaCanal> {
    const f = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaCuenta>(
        `SELECT id, tenant_id, canal, proveedor, nombre, identificador, config,
                activa, webhook_token, created_at, usuario_id,
                (secreto IS NOT NULL) AS tiene_secreto
           FROM canal_cuenta WHERE id = $1`,
        [cuentaId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa cuenta de canal.');
      return rows[0];
    });

    return {
      id: f.id,
      tenantId: f.tenant_id,
      usuarioId: f.usuario_id ?? null,
      canal: f.canal,
      proveedor: f.proveedor,
      identificador: f.identificador,
      config: f.config ?? {},
      secreto: f.tiene_secreto ? await this.descifrar(f.id) : null,
    };
  }

  /**
   * Resuelve un webhook entrante.
   *
   * Sin `withTenant`: el webhook llega SIN contexto de inmobiliaria —de qué
   * inmobiliaria es, es justamente lo que viene a averiguar—. Por eso el token
   * de la URL es único globalmente y la función que lo resuelve es
   * SECURITY DEFINER.
   */
  async porWebhook(token: string): Promise<CuentaCanal | null> {
    const filas = await this.db.query<{
      id: string; tenant_id: string; canal: string; proveedor: string;
      config: Record<string, unknown>; activa: boolean;
    }>('SELECT * FROM app_canal_por_webhook($1)', [token]);

    const f = filas[0];
    if (!f || !f.activa) return null;

    const extra = await this.db.withTenant(f.tenant_id, async (ej) => {
      const { rows } = await ej.query<{
        identificador: string; usuario_id: string | null; aprobada_el: Date | null;
      }>(
        'SELECT identificador, usuario_id, aprobada_el FROM canal_cuenta WHERE id = $1',
        [f.id],
      );
      return rows[0];
    });

    // Un canal cargado y todavía sin aprobar NO recibe. Aprobar a medias —que
    // igual entren los mensajes— no es aprobar, es un cartel.
    if (!extra?.aprobada_el) return null;

    return {
      id: f.id,
      tenantId: f.tenant_id,
      usuarioId: extra.usuario_id ?? null,
      canal: f.canal,
      proveedor: f.proveedor,
      identificador: extra.identificador,
      config: f.config ?? {},
      secreto: await this.descifrar(f.id),
    };
  }

  async crear(
    tenantId: string,
    dto: {
      canal: string; proveedor: string; nombre: string;
      identificador: string; secreto?: string; config?: Record<string, unknown>;
      /** Sólo titular/administración pueden mandarlo. */
      usuarioId?: string | null;
    },
    actor?: { rol: Rol; usuarioId: string },
  ): Promise<CuentaVisible> {
    const adaptador = this.registro.de(dto.proveedor);
    if (!adaptador) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `No hay adaptador para el proveedor «${dto.proveedor}».`, 'Unprocessable Entity',
      );
    }
    if (!adaptador.canales.includes(dto.canal)) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `El proveedor «${dto.proveedor}» no maneja el canal «${dto.canal}».`,
        'Unprocessable Entity',
      );
    }

    // 32 bytes: la URL del webhook es pública y este token es lo único que la
    // hace impredecible.
    const webhookToken = randomBytes(32).toString('base64url');

    // El secreto con el que el proveedor firma lo que nos manda.
    //
    // Se genera SOLO y no se le pide a nadie: en Telegram lo elegimos nosotros
    // y se lo pasamos a `setWebhook`, así que pedírselo al usuario es pedirle
    // que invente una credencial nuestra. Sin él, `verificarFirma` rechaza todo
    // —el default es cerrado— y el canal quedaría conectado pero sordo, que es
    // la peor combinación: parece que anda y no entra un mensaje.
    const config: Record<string, unknown> = { ...(dto.config ?? {}) };
    if (!config.webhookSecret) config.webhookSecret = randomBytes(24).toString('base64url');

    // Quién es el dueño y si nace aprobado.
    //
    // Un asesor sólo puede cargar SU número, y queda esperando: un canal es una
    // credencial que habilita a escribirle a los clientes en nombre de la
    // inmobiliaria. Que cualquiera lo prenda solo es demasiado; que el titular
    // tenga que cargar diez tokens ajenos es demasiado poco.
    const esJefe = !actor || actor.rol === 'owner' || actor.rol === 'admin';
    const dueno = esJefe ? (dto.usuarioId ?? null) : actor.usuarioId;
    const naceAprobado = esJefe;

    const id = await this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO canal_cuenta
             (tenant_id, canal, proveedor, nombre, identificador, config,
              webhook_token, usuario_id, aprobada_el, aprobada_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,
                   CASE WHEN $9::boolean THEN now() ELSE NULL END,
                   -- El cast es obligatorio: dentro de un CASE con NULL en la
                   -- otra rama, Postgres no puede inferir el tipo del parámetro
                   -- y lo toma como text, que no entra en una columna uuid.
                   CASE WHEN $9::boolean THEN $10::uuid ELSE NULL END)
           RETURNING id`,
          [
            tenantId, dto.canal, dto.proveedor, dto.nombre, dto.identificador,
            JSON.stringify(config), webhookToken, dueno,
            naceAprobado, actor?.usuarioId ?? null,
          ],
        );
        return rows[0].id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            409, ErrorCode.EN_USO,
            `Ya hay una cuenta de ${dto.canal} con ese identificador.`, 'Conflict',
          );
        }
        throw err;
      }
    });

    if (dto.secreto) await this.guardarSecreto(id, dto.secreto);

    const listadas = await this.listar(tenantId, actor?.rol, actor?.usuarioId);
    return listadas.find((c) => c.id === id)!;
  }

  /**
   * El titular habilita un canal cargado por alguien del equipo.
   *
   * Hasta acá el canal no recibe ni envía: `porWebhook()` lo rechaza. Aprobar
   * es lo que lo enciende.
   */
  async aprobar(tenantId: string, id: string, usuarioId: string): Promise<CuentaVisible> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE canal_cuenta SET aprobada_el = now(), aprobada_por = $2
          WHERE id = $1 AND aprobada_el IS NULL`,
        [id, usuarioId],
      );
      if (!rowCount) {
        throw new AppError(
          422, ErrorCode.ESTADO_INVALIDO,
          'Ese canal no existe o ya estaba aprobado.', 'Unprocessable Entity',
        );
      }
    });
    const listadas = await this.listar(tenantId);
    return listadas.find((c) => c.id === id)!;
  }

  /**
   * ¿Puede esta persona tocar este canal?
   *
   * Titular y administración, cualquiera. El resto, sólo el suyo — y el de la
   * inmobiliaria no, que es de todos y de nadie.
   */
  async puedeAdministrar(
    tenantId: string,
    id: string,
    actor: { rol: Rol; usuarioId: string },
  ): Promise<boolean> {
    if (actor.rol === 'owner' || actor.rol === 'admin') return true;
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ usuario_id: string | null }>(
        'SELECT usuario_id FROM canal_cuenta WHERE id = $1', [id],
      );
      return rows[0]?.usuario_id === actor.usuarioId;
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: {
      nombre?: string; identificador?: string; activa?: boolean;
      secreto?: string; config?: Record<string, unknown>;
    },
  ): Promise<CuentaVisible> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE canal_cuenta SET
           nombre        = coalesce($2, nombre),
           identificador = coalesce($3, identificador),
           activa        = coalesce($4, activa),
           config        = coalesce($5::jsonb, config)
         WHERE id = $1`,
        [
          id, dto.nombre ?? null, dto.identificador ?? null,
          dto.activa ?? null, dto.config ? JSON.stringify(dto.config) : null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa cuenta de canal.');
    });

    // `undefined` = no lo tocan. Cadena vacía = lo borran. Son cosas distintas:
    // sin la distinción, editar el nombre de una cuenta le borraría el token.
    if (dto.secreto !== undefined) await this.guardarSecreto(id, dto.secreto);

    const listadas = await this.listar(tenantId);
    return listadas.find((c) => c.id === id)!;
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM canal_cuenta WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró esa cuenta de canal.');
    });
  }

  /**
   * Deja la cuenta lista contra el proveedor.
   *
   * En Telegram valida el token y registra el webhook si la URL es pública. En
   * los canales que no lo soportan lo dice, en vez de fingir que hizo algo.
   */
  async conectar(
    tenantId: string,
    id: string,
    urlWebhook: string | null,
  ): Promise<{ ok: boolean; detalle: string; identidad?: string }> {
    const cuenta = await this.paraAdaptador(tenantId, id);
    const adaptador = this.registro.de(cuenta.proveedor);

    if (!adaptador?.conectar) {
      return {
        ok: false,
        detalle: `El webhook de ${cuenta.proveedor} se carga a mano en su panel. `
          + 'Copiá la URL de esta pantalla y pegala ahí.',
      };
    }

    const r = await adaptador.conectar(cuenta, urlWebhook);

    // Si el proveedor devolvió cómo se llama la cuenta, se guarda: es lo que
    // confirma que el token es del bot que se cree y no de otro.
    if (r.ok && r.identidad) {
      await this.db.withTenant(tenantId, async (ej) => {
        await ej.query(
          "UPDATE canal_cuenta SET identificador = $2 WHERE id = $1 AND identificador <> $2",
          [id, `@${r.identidad}`],
        );
      });
    }

    return r;
  }

  /**
   * Trae los mensajes pendientes sin webhook (desarrollo).
   *
   * El offset se guarda en la config: Telegram repite cada actualización hasta
   * que se la confirma pidiendo desde un offset mayor, así que sin guardarlo
   * cada sondeo traería todo de nuevo.
   */
  async sondear(
    tenantId: string,
    id: string,
  ): Promise<{ recibidos: number; detalle: string }> {
    const cuenta = await this.paraAdaptador(tenantId, id);
    const adaptador = this.registro.de(cuenta.proveedor);

    if (!adaptador?.sondear) {
      return {
        recibidos: 0,
        detalle: `${cuenta.proveedor} no permite recibir sin webhook.`,
      };
    }

    const offset = Number(cuenta.config.pollOffset ?? 0);
    const r = await adaptador.sondear(cuenta, offset);
    if (r.error) return { recibidos: 0, detalle: r.error };

    if (r.mensajes.length) await this.ingesta.recibir(cuenta, r.mensajes);

    // El offset avanza SIEMPRE que Telegram haya devuelto algo, aunque ningún
    // update se haya convertido en mensaje (un sticker, un cambio de título):
    // si no, esos updates vuelven en cada sondeo para siempre.
    if (r.siguienteOffset > offset) {
      await this.db.withTenant(tenantId, async (ej) => {
        await ej.query(
          `UPDATE canal_cuenta
              SET config = config || jsonb_build_object('pollOffset', $2::int)
            WHERE id = $1`,
          [id, r.siguienteOffset],
        );
      });
    }

    return {
      recibidos: r.mensajes.length,
      detalle: r.mensajes.length
        ? `Entraron ${r.mensajes.length} mensajes.`
        : 'No había mensajes nuevos.',
    };
  }

  /** Lo que el sistema sabe manejar, para armar el selector de la pantalla. */
  catalogo() {
    return this.registro.catalogo();
  }

  private async guardarSecreto(cuentaId: string, secreto: string): Promise<void> {
    await this.db.query('SELECT app_canal_guardar_secreto($1, $2, $3)', [
      cuentaId, secreto || null, this.clave,
    ]);
  }

  private async descifrar(cuentaId: string): Promise<string | null> {
    try {
      const filas = await this.db.query<{ app_canal_secreto: string | null }>(
        'SELECT app_canal_secreto($1, $2)', [cuentaId, this.clave],
      );
      return filas[0]?.app_canal_secreto ?? null;
    } catch {
      // Descifrar falla cuando `CANALES_SECRETO` cambió después de guardar. Se
      // trata como «no hay credencial» en vez de reventar: la pantalla dice que
      // el canal no está disponible y se puede volver a cargar el token, que es
      // lo único que se puede hacer. Un 500 acá dejaría la pantalla de canales
      // inaccesible y sin forma de arreglarla.
      this.logger.error(
        `No se pudo descifrar el secreto de la cuenta ${cuentaId}. `
        + '¿Cambió CANALES_SECRETO? Hay que volver a cargar la credencial.',
      );
      return null;
    }
  }

  private aVisible(f: FilaCuenta, secreto: string | null): CuentaVisible {
    const adaptador = this.registro.de(f.proveedor);
    const estado = adaptador
      ? adaptador.disponible({
          id: f.id, tenantId: f.tenant_id, canal: f.canal, proveedor: f.proveedor,
          identificador: f.identificador, config: f.config ?? {}, secreto,
        })
      : { ok: false, detalle: `Sin adaptador para «${f.proveedor}»` };

    return {
      id: f.id,
      canal: f.canal,
      proveedor: f.proveedor,
      nombre: f.nombre,
      identificador: f.identificador,
      activa: f.activa,
      // Sin aprobar no está disponible, diga lo que diga el adaptador: el
      // token puede ser perfecto y el canal seguir apagado.
      disponible: estado.ok && f.activa && f.aprobada_el != null,
      detalle: f.aprobada_el == null
        ? 'Esperando que el titular lo habilite'
        : (f.activa ? estado.detalle : 'Desactivada'),
      tieneSecreto: f.tiene_secreto,
      usuarioId: f.usuario_id ?? null,
      usuarioNombre: f.usuario_nombre ?? null,
      aprobada: f.aprobada_el !== null && f.aprobada_el !== undefined,
      config: sinSecretos(f.config ?? {}),
      rutaWebhook: `/v1/webhooks/${f.webhook_token}`,
      creadaEl: f.created_at.toISOString(),
    };
  }
}

interface FilaCuenta {
  id: string;
  tenant_id: string;
  usuario_id?: string | null;
  usuario_nombre?: string | null;
  aprobada_el?: Date | null;
  canal: string;
  proveedor: string;
  nombre: string;
  identificador: string;
  config: Record<string, unknown> | null;
  activa: boolean;
  webhook_token: string;
  created_at: Date;
  tiene_secreto: boolean;
}

/**
 * `config` es jsonb libre y ahí adentro también hay secretos —el `appSecret` de
 * Meta, el `webhookSecret` de Telegram—. Se filtran antes de devolverla.
 *
 * Lista de lo que SE PERMITE, no de lo que se prohíbe: una lista negra deja
 * pasar la clave que alguien agregue mañana, y el que la agrega no se va a
 * acordar de venir a este archivo.
 */
const CONFIG_PUBLICA = new Set([
  'accountSid', 'phoneNumberId', 'pageId', 'urlPublica',
  'proveedorSaliente', 'cabeceraFirma', 'reglas',
]);

function sinSecretos(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (CONFIG_PUBLICA.has(k)) out[k] = v;
  }
  return out;
}

export type { Ejecutor };
