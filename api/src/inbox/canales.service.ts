import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { loadEnv } from '../config/env';
import { RegistroAdaptadores } from './adaptadores/registro';
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
  ) {}

  private get clave(): string {
    return loadEnv().CANALES_SECRETO;
  }

  async listar(tenantId: string): Promise<CuentaVisible[]> {
    const filas = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaCuenta>(
        `SELECT id, tenant_id, canal, proveedor, nombre, identificador, config,
                activa, webhook_token, created_at, (secreto IS NOT NULL) AS tiene_secreto
           FROM canal_cuenta ORDER BY canal, nombre`,
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
                activa, webhook_token, created_at, (secreto IS NOT NULL) AS tiene_secreto
           FROM canal_cuenta WHERE id = $1`,
        [cuentaId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa cuenta de canal.');
      return rows[0];
    });

    return {
      id: f.id,
      tenantId: f.tenant_id,
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

    const ident = await this.db.withTenant(f.tenant_id, async (ej) => {
      const { rows } = await ej.query<{ identificador: string }>(
        'SELECT identificador FROM canal_cuenta WHERE id = $1', [f.id],
      );
      return rows[0]?.identificador ?? '';
    });

    return {
      id: f.id,
      tenantId: f.tenant_id,
      canal: f.canal,
      proveedor: f.proveedor,
      identificador: ident,
      config: f.config ?? {},
      secreto: await this.descifrar(f.id),
    };
  }

  async crear(
    tenantId: string,
    dto: {
      canal: string; proveedor: string; nombre: string;
      identificador: string; secreto?: string; config?: Record<string, unknown>;
    },
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

    const id = await this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO canal_cuenta
             (tenant_id, canal, proveedor, nombre, identificador, config, webhook_token)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            tenantId, dto.canal, dto.proveedor, dto.nombre, dto.identificador,
            JSON.stringify(dto.config ?? {}), webhookToken,
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

    const listadas = await this.listar(tenantId);
    return listadas.find((c) => c.id === id)!;
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
      disponible: estado.ok && f.activa,
      detalle: f.activa ? estado.detalle : 'Desactivada',
      tieneSecreto: f.tiene_secreto,
      config: sinSecretos(f.config ?? {}),
      rutaWebhook: `/v1/webhooks/${f.webhook_token}`,
      creadaEl: f.created_at.toISOString(),
    };
  }
}

interface FilaCuenta {
  id: string;
  tenant_id: string;
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
