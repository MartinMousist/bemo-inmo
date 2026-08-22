import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Mensajes entre la gente de la oficina.
 *
 * ── Qué NO es ──
 *
 * No es la bandeja omnicanal. Aquélla habla con gente de AFUERA —inquilinos,
 * interesados— por WhatsApp, mail o Instagram, y por eso tiene canales, bot y
 * plantillas. Esto es adentro, y no tiene nada de eso.
 *
 * ── Lo único que la otra no tiene, y es el punto ──
 *
 * **La referencia a algo del sistema.** «Mirá esta propiedad» con el enlace
 * adentro, y quien lo recibe llega de un toque. Un chat interno sin eso es un
 * WhatsApp peor —el WhatsApp ya lo tienen y funciona— y con eso es el lugar
 * donde se pasa el trabajo.
 *
 * Se guarda el TIPO y el ID, no una URL: una URL guardada se rompe el día que
 * cambie una ruta, y estos mensajes duran.
 */

export type RefTipo = 'propiedad' | 'contrato' | 'persona' | 'liquidacion' | 'reclamo' | 'aviso';

export const REF_TIPOS: RefTipo[] = [
  'propiedad', 'contrato', 'persona', 'liquidacion', 'reclamo', 'aviso',
];

@Injectable()
export class InternoService {
  constructor(private readonly db: DbService) {}

  /**
   * Los hilos de esta persona, con su último mensaje y cuántos no leyó.
   *
   * El no-leído es POR PARTICIPANTE y no por hilo: que un compañero lo abra no
   * lo marca leído para el resto.
   */
  async hilos(tenantId: string, usuarioId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT h.id, h.ultimo_el,
                (SELECT m.texto FROM mensaje_interno m
                  WHERE m.hilo_id = h.id ORDER BY m.created_at DESC LIMIT 1) AS ultimo_texto,
                (SELECT count(*) FROM mensaje_interno m
                  WHERE m.hilo_id = h.id
                    AND m.autor_id <> $1
                    AND (yo.leido_el IS NULL OR m.created_at > yo.leido_el)) AS sin_leer,
                -- Con quién es el hilo: todos MENOS vos. Un hilo se identifica
                -- por la otra persona, no por un asunto que nadie escribe.
                (SELECT string_agg(u.nombre, ', ' ORDER BY u.nombre)
                   FROM hilo_participante hp JOIN usuario u ON u.id = hp.usuario_id
                  WHERE hp.hilo_id = h.id AND hp.usuario_id <> $1) AS con_quien
           FROM hilo_interno h
           JOIN hilo_participante yo ON yo.hilo_id = h.id AND yo.usuario_id = $1
          ORDER BY h.ultimo_el DESC
          LIMIT 100`,
        [usuarioId],
      );

      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        conQuien: (r.con_quien as string) ?? 'Sin nadie más',
        ultimoTexto: r.ultimo_texto ?? null,
        ultimoEl: r.ultimo_el,
        sinLeer: Number(r.sin_leer ?? 0),
      }));
    });
  }

  /** Cuántos mensajes sin leer tiene esta persona, en total. Para el badge. */
  async sinLeer(tenantId: string, usuarioId: string): Promise<number> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM mensaje_interno m
           JOIN hilo_participante yo ON yo.hilo_id = m.hilo_id AND yo.usuario_id = $1
          WHERE m.autor_id <> $1
            AND (yo.leido_el IS NULL OR m.created_at > yo.leido_el)`,
        [usuarioId],
      );
      return Number(rows[0].n);
    });
  }

  /**
   * Abre el hilo con estas personas, o crea uno si no existe.
   *
   * ── Por qué se REUSA en vez de crear siempre ──
   *
   * Sin esto, escribirle tres veces a la misma persona deja tres hilos con la
   * misma cara en la lista, y la conversación queda partida en pedazos. La
   * clave es el CONJUNTO de participantes: los mismos dos, el mismo hilo.
   */
  async abrirHilo(tenantId: string, usuarioId: string, conQuienes: string[]) {
    const todos = [...new Set([usuarioId, ...conQuienes])].sort();
    if (todos.length < 2) {
      throw new AppError(
        400, ErrorCode.VALIDATION_FAILED,
        'Elegí con quién querés hablar.', 'Bad Request',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: existe } = await ej.query<{ id: string }>(
        `SELECT h.id FROM hilo_interno h
           JOIN hilo_participante hp ON hp.hilo_id = h.id
          GROUP BY h.id
         HAVING array_agg(hp.usuario_id ORDER BY hp.usuario_id) = $1::uuid[]`,
        [todos],
      );
      if (existe.length) return { id: existe[0].id };

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO hilo_interno (tenant_id, creado_por)
         VALUES (app_current_tenant(), $1) RETURNING id`,
        [usuarioId],
      );
      const hiloId = rows[0].id;

      await ej.query(
        `INSERT INTO hilo_participante (tenant_id, hilo_id, usuario_id)
         SELECT app_current_tenant(), $1, u FROM unnest($2::uuid[]) AS u`,
        [hiloId, todos],
      );

      return { id: hiloId };
    });
  }

  /** Los mensajes de un hilo. Marca leído en el mismo viaje. */
  async mensajes(tenantId: string, usuarioId: string, hiloId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'SELECT 1 FROM hilo_participante WHERE hilo_id = $1 AND usuario_id = $2',
        [hiloId, usuarioId],
      );
      // 404 y no 403: que un hilo del que no participás exista o no es
      // información que no te corresponde.
      if (!rowCount) throw AppError.notFound('No se encontró esa conversación.');

      const { rows } = await ej.query(
        `SELECT m.id, m.texto, m.ref_tipo, m.ref_id, m.created_at,
                m.autor_id, u.nombre AS autor
           FROM mensaje_interno m
           LEFT JOIN usuario u ON u.id = m.autor_id
          WHERE m.hilo_id = $1
          ORDER BY m.created_at
          LIMIT 300`,
        [hiloId],
      );

      // Leer ES marcar leído: pedir además un clic en «marcar como leído» es
      // trabajo que nadie hace y un contador que nunca baja.
      await ej.query(
        'UPDATE hilo_participante SET leido_el = now() WHERE hilo_id = $1 AND usuario_id = $2',
        [hiloId, usuarioId],
      );

      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        texto: r.texto,
        autor: r.autor ?? 'Alguien que ya no está',
        mio: r.autor_id === usuarioId,
        refTipo: r.ref_tipo ?? null,
        refId: r.ref_id ?? null,
        el: r.created_at,
      }));
    });
  }

  async enviar(
    tenantId: string,
    usuarioId: string,
    hiloId: string,
    texto: string,
    ref?: { tipo: RefTipo; id: string },
  ) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'SELECT 1 FROM hilo_participante WHERE hilo_id = $1 AND usuario_id = $2',
        [hiloId, usuarioId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa conversación.');

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO mensaje_interno (tenant_id, hilo_id, autor_id, texto, ref_tipo, ref_id)
         VALUES (app_current_tenant(), $1, $2, $3, $4, $5) RETURNING id`,
        [hiloId, usuarioId, texto.trim(), ref?.tipo ?? null, ref?.id ?? null],
      );

      // `ultimo_el` en el hilo para poder ordenar la lista sin tocar la tabla
      // de mensajes, que es la que crece.
      await ej.query('UPDATE hilo_interno SET ultimo_el = now() WHERE id = $1', [hiloId]);
      // Quien escribe ya leyó lo suyo.
      await ej.query(
        'UPDATE hilo_participante SET leido_el = now() WHERE hilo_id = $1 AND usuario_id = $2',
        [hiloId, usuarioId],
      );

      return { id: rows[0].id };
    });
  }
}
