import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset } from '../common/paginacion';
import {
  generarAviso,
  generarFeedXml,
  type Aviso,
  type ItemFeed,
} from './aviso.motor';
import { CAMPOS_AVISO, datosParaAviso, type FilaAviso } from './publicaciones.datos';
import { INTEGRACION_ACTIVA } from './etiquetas';
import type {
  ActualizarPublicacionDto,
  CrearPublicacionDto,
  FiltroPublicacionesDto,
} from './publicaciones.dto';

@Injectable()
export class PublicacionesService {
  constructor(private readonly db: DbService) {}

  /**
   * El estado de cada portal. `integracionActiva: false` significa que todavía
   * no hay convenio y el flujo es copiar y pegar — y la UI lo dice con todas
   * las letras en vez de mostrar un botón "Publicar" que no publica.
   */
  portales() {
    return Object.entries(INTEGRACION_ACTIVA).map(([portal, activa]) => ({
      portal,
      integracionActiva: activa,
      modo: activa ? 'automatico' : 'copiar_y_pegar',
    }));
  }

  /** Genera el aviso de una operación sin guardar nada. */
  async previsualizar(tenantId: string, operacionId: string): Promise<Aviso> {
    return this.db.withTenant(tenantId, async (ej) => {
      const datos = await this.datosDeOperacion(ej, operacionId);
      return generarAviso(datos.propiedad, datos.operacion);
    });
  }

  async listar(tenantId: string, f: FiltroPublicacionesDto) {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.portal ?? null, f.estado ?? null];

      const desde = `
        FROM publicacion p
        JOIN operacion o ON o.id = p.operacion_id
        JOIN propiedad pr ON pr.id = o.propiedad_id
       WHERE ($1::text IS NULL
              OR p.aviso->>'titulo' ILIKE $1
              OR pr.calle ILIKE $1
              OR pr.codigo::text = trim(both '%' from $1))
         AND ($2::text IS NULL OR p.portal = $2)
         AND ($3::text IS NULL OR p.estado = $3)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${desde}`,
        params,
      );

      const { rows } = await ej.query(
        `SELECT p.id, p.portal, p.estado, p.url_publica AS "urlPublica",
                p.ultimo_sync AS "ultimoSync", p.ultimo_error AS "ultimoError",
                p.aviso->>'titulo' AS titulo,
                o.id AS "operacionId", o.tipo AS "tipoOperacion",
                pr.codigo AS "codigoPropiedad",
                trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS direccion
         ${desde}
          ORDER BY p.updated_at DESC
          LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      const items = rows.map((r) => ({
        ...r,
        etiquetaPropiedad: `PROP-${String(r.codigoPropiedad).padStart(4, '0')}`,
        integracionActiva: INTEGRACION_ACTIVA[r.portal as string] ?? false,
      }));

      return armarPagina(items, Number(conteo[0].total), f);
    });
  }

  async crear(tenantId: string, dto: CrearPublicacionDto) {
    return this.db.withTenant(tenantId, async (ej) => {
      const datos = await this.datosDeOperacion(ej, dto.operacionId);
      const aviso = generarAviso(datos.propiedad, datos.operacion);

      // Sin integración el aviso nace 'lista': está armado y esperando que
      // alguien lo pegue. Marcarlo 'publicada' sería mentir.
      const estado = INTEGRACION_ACTIVA[dto.portal] ? 'borrador' : 'lista';

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO publicacion (tenant_id, operacion_id, portal, estado, aviso)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (operacion_id, portal) DO UPDATE
           SET aviso = EXCLUDED.aviso, updated_at = now()
         RETURNING id`,
        [tenantId, dto.operacionId, dto.portal, estado, JSON.stringify(aviso)],
      );

      return { id: rows[0].id, portal: dto.portal, estado, aviso };
    });
  }

  async obtener(tenantId: string, id: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; portal: string; estado: string; aviso: Aviso;
        url_publica: string | null;
      }>(
        `SELECT id, portal, estado, aviso, url_publica FROM publicacion WHERE id = $1`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa publicación.');
      return {
        id: rows[0].id,
        portal: rows[0].portal,
        estado: rows[0].estado,
        urlPublica: rows[0].url_publica,
        aviso: rows[0].aviso,
        integracionActiva: INTEGRACION_ACTIVA[rows[0].portal] ?? false,
      };
    });
  }

  async actualizar(tenantId: string, id: string, dto: ActualizarPublicacionDto) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE publicacion SET
           estado = coalesce($2, estado),
           external_id = coalesce($3, external_id),
           url_publica = coalesce($4, url_publica),
           ultimo_sync = CASE WHEN $2 = 'publicada' THEN now() ELSE ultimo_sync END
         WHERE id = $1`,
        [id, dto.estado ?? null, dto.externalId ?? null, dto.urlPublica ?? null],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa publicación.');
      return this.obtener(tenantId, id);
    });
  }

  /** Regenera el aviso desde los datos actuales de la propiedad. */
  async regenerar(tenantId: string, id: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ operacion_id: string }>(
        'SELECT operacion_id FROM publicacion WHERE id = $1',
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa publicación.');

      const datos = await this.datosDeOperacion(ej, rows[0].operacion_id);
      const aviso = generarAviso(datos.propiedad, datos.operacion);

      await ej.query('UPDATE publicacion SET aviso = $2 WHERE id = $1', [
        id,
        JSON.stringify(aviso),
      ]);
      return this.obtener(tenantId, id);
    });
  }

  // ── Feed ───────────────────────────────────────────────────────────────────

  async token(tenantId: string): Promise<{ token: string; url: string }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ feed_token: string | null }>(
        'SELECT feed_token FROM tenant WHERE id = $1',
        [tenantId],
      );
      let token = rows[0]?.feed_token;
      if (!token) {
        token = randomBytes(24).toString('base64url');
        await ej.query('UPDATE tenant SET feed_token = $2 WHERE id = $1', [tenantId, token]);
      }
      return { token, url: `/v1/feed/${token}.xml` };
    });
  }

  async rotarToken(tenantId: string): Promise<{ token: string; url: string }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const token = randomBytes(24).toString('base64url');
      await ej.query('UPDATE tenant SET feed_token = $2 WHERE id = $1', [tenantId, token]);
      return { token, url: `/v1/feed/${token}.xml` };
    });
  }

  /**
   * El feed público. Se sirve SIN sesión —un portal lo consume por HTTP— así
   * que el tenant se resuelve por el token vía función SECURITY DEFINER, igual
   * que el login.
   */
  async feed(token: string): Promise<string> {
    const filas = await this.db.query<{ tenant_id: string | null }>(
      'SELECT app_tenant_por_feed_token($1) AS tenant_id',
      [token],
    );
    const tenantId = filas[0]?.tenant_id;
    if (!tenantId) throw AppError.notFound('Feed no encontrado.');

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: t } = await ej.query<{ nombre: string }>(
        'SELECT nombre FROM tenant WHERE id = $1',
        [tenantId],
      );

      const { rows } = await ej.query<FilaAviso>(
        `SELECT ${CAMPOS_AVISO}
           FROM operacion o
           JOIN propiedad pr ON pr.id = o.propiedad_id
          WHERE o.estado = 'disponible'
          ORDER BY pr.codigo`,
      );

      const items: ItemFeed[] = rows.map((r) => {
        const d = datosParaAviso(r);
        return {
          codigo: `PROP-${String(r.codigo).padStart(4, '0')}`,
          operacion: r.op_tipo,
          lat: r.lat === null ? null : Number(r.lat),
          lng: r.lng === null ? null : Number(r.lng),
          actualizado: r.updated_at.toISOString(),
          aviso: generarAviso(d.propiedad, d.operacion),
        };
      });

      return generarFeedXml(t[0]?.nombre ?? 'Inmobiliaria', items);
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async datosDeOperacion(ej: Ejecutor, operacionId: string) {
    const { rows } = await ej.query<FilaAviso>(
      `SELECT ${CAMPOS_AVISO}
         FROM operacion o JOIN propiedad pr ON pr.id = o.propiedad_id
        WHERE o.id = $1`,
      [operacionId],
    );
    if (!rows.length) throw AppError.notFound('No se encontró esa operación.');
    return datosParaAviso(rows[0]);
  }
}
