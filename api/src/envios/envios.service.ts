import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Enviarle una selección de propiedades a un cliente.
 *
 * Reemplaza lo que hoy se hace a mano: seis capturas de pantalla por WhatsApp,
 * sin saber si las miró.
 *
 * ── La decisión que le da valor ──
 *
 * **Se registra si lo abrió.** Sin eso es un PDF más. Con eso, el asesor abre
 * la lista a la mañana y sabe a quién llamar: al que entró tres veces, no al
 * que nunca lo abrió.
 *
 * ── Por qué este token se guarda en claro y el del portal no ──
 *
 * El del propietario se guarda hasheado: da acceso a saldos, liquidaciones y
 * datos de una persona. Si se filtra la base, esos enlaces no sirven.
 *
 * Este muestra fichas de propiedades —lo mismo que ya está publicado en los
 * portales— y el asesor necesita poder volver a copiarlo tres días después para
 * reenviarlo. Un hash haría imposible eso sin generar un enlace nuevo cada vez,
 * y el cliente terminaría con cuatro enlaces distintos de la misma selección.
 *
 * La contrapartida está acotada a propósito: el envío VENCE (90 días por
 * defecto) y no expone ni el titular ni los datos de la operación interna.
 */
@Injectable()
export class EnviosService {
  constructor(private readonly db: DbService) {}

  async crear(
    tenantId: string,
    usuarioId: string,
    d: {
      propiedades: string[];
      personaId?: string | null;
      contactoNombre?: string | null;
      titulo?: string | null;
      mensaje?: string | null;
      diasValidez?: number;
    },
  ) {
    // 22 bytes ≈ 176 bits en base64url. Este enlace se manda por WhatsApp y no
    // pide sesión: adivinarlo tiene que ser imposible, no difícil.
    const token = randomBytes(22).toString('base64url');

    return this.db.withTenant(tenantId, async (ej) => {
      // Las propiedades se comprueban con el ejecutor del tenant: RLS ya impide
      // meter una ajena, pero un id que no existe tiene que fallar con un
      // mensaje claro y no crear un envío con menos fichas de las pedidas.
      const { rows: validas } = await ej.query<{ id: string }>(
        'SELECT id FROM propiedad WHERE id = ANY($1::uuid[])',
        [d.propiedades],
      );
      if (validas.length !== d.propiedades.length) {
        throw new AppError(
          404,
          ErrorCode.NOT_FOUND,
          'Alguna de las propiedades seleccionadas ya no existe.',
          'Not Found',
        );
      }

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO envio_propiedades
           (tenant_id, token, persona_id, contacto_nombre, titulo, mensaje, vence_el, creado_por)
         VALUES (app_current_tenant(), $1, $2, $3, $4, $5, current_date + $6::int, $7)
         RETURNING id`,
        [
          token, d.personaId ?? null, d.contactoNombre ?? null,
          d.titulo ?? null, d.mensaje ?? null, d.diasValidez ?? 90, usuarioId,
        ],
      );
      const envioId = rows[0].id;

      // El orden en que las eligió el asesor es información: la primera es la
      // que más le cierra al cliente. Se respeta tal cual llegó.
      await ej.query(
        `INSERT INTO envio_propiedad_item (tenant_id, envio_id, propiedad_id, orden)
         SELECT app_current_tenant(), $1, p.id, p.orden
           FROM unnest($2::uuid[]) WITH ORDINALITY AS p(id, orden)`,
        [envioId, d.propiedades],
      );

      return { id: envioId, token, propiedades: d.propiedades.length };
    });
  }

  async listar(tenantId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT e.id, e.token, e.titulo, e.contacto_nombre, e.vence_el,
                e.abierto_el, e.vistas, e.created_at,
                trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS persona,
                (SELECT count(*) FROM envio_propiedad_item i WHERE i.envio_id = e.id) AS propiedades
           FROM envio_propiedades e
           LEFT JOIN persona pe ON pe.id = e.persona_id
          ORDER BY e.created_at DESC
          LIMIT 200`,
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        token: r.token,
        titulo: r.titulo,
        // El nombre de la persona vinculada gana sobre el escrito a mano: si se
        // eligió un contacto de la base, ése es el dato bueno.
        para: (r.persona as string)?.trim() || r.contacto_nombre || 'Sin destinatario',
        propiedades: Number(r.propiedades),
        vistas: Number(r.vistas),
        abiertoEl: r.abierto_el,
        venceEl: r.vence_el,
        vencido: String(r.vence_el) < new Date().toISOString().slice(0, 10),
        creadoEl: r.created_at,
      }));
    });
  }

  async eliminar(tenantId: string, id: string) {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM envio_propiedades WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('El envío no existe.');
    });
  }

  /**
   * Lo que ve el cliente al abrir el enlace. Sin sesión y sin tenant: de qué
   * inmobiliaria es, es justo lo que viene a averiguar.
   */
  async abrir(token: string) {
    const rows = await this.db.query<{
      envio_id: string; tenant_id: string; titulo: string | null;
      mensaje: string | null; inmobiliaria: string; vencido: boolean;
    }>('SELECT * FROM app_envio_abrir($1)', [token]);

    // Un token inventado y uno vencido dan el MISMO error. Distinguirlos le
    // confirmaría a quien prueba enlaces al azar que ése existió.
    if (!rows.length || rows[0].vencido) {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        'Este enlace no es válido o ya venció. Pedile uno nuevo a tu inmobiliaria.',
        'Not Found',
      );
    }

    const e = rows[0];
    const propiedades = await this.db.withTenant(e.tenant_id, (ej) =>
      this.fichas(ej, e.envio_id),
    );

    return {
      titulo: e.titulo ?? 'Propiedades seleccionadas para vos',
      mensaje: e.mensaje,
      inmobiliaria: e.inmobiliaria,
      propiedades,
    };
  }

  /**
   * La ficha pública de cada propiedad.
   *
   * Lo que NO va, y es deliberado: el titular, el captador, las notas internas,
   * la comisión y la altura de la calle. El cliente necesita saber qué es,
   * dónde queda y cuánto sale. El resto es de la inmobiliaria.
   */
  private async fichas(ej: Ejecutor, envioId: string) {
    const { rows } = await ej.query(
      `SELECT p.id, 'PROP-' || lpad(p.codigo::text,4,'0') AS codigo,
              p.tipo, p.calle, p.localidad, p.provincia, p.descripcion,
              p.ambientes, p.dormitorios, p.banos, p.cocheras,
              p.sup_cubierta, p.sup_total, p.antiguedad,
              o.tipo AS operacion, o.precio, o.moneda, o.expensas,
              (SELECT json_agg(f.url ORDER BY f.es_portada DESC, f.orden)
                 FROM propiedad_foto f
                WHERE f.propiedad_id = p.id) AS fotos
         FROM envio_propiedad_item i
         JOIN propiedad p ON p.id = i.propiedad_id
         LEFT JOIN LATERAL (
           SELECT tipo, precio, moneda, expensas FROM operacion
            WHERE propiedad_id = p.id AND estado = 'disponible' LIMIT 1
         ) o ON true
        WHERE i.envio_id = $1
        ORDER BY i.orden`,
      [envioId],
    );

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      codigo: r.codigo,
      tipo: r.tipo,
      zona: [r.calle, r.localidad, r.provincia].filter(Boolean).join(', '),
      descripcion: r.descripcion,
      ambientes: r.ambientes,
      dormitorios: r.dormitorios,
      banos: r.banos,
      cocheras: r.cocheras,
      supCubierta: r.sup_cubierta === null ? null : Number(r.sup_cubierta),
      supTotal: r.sup_total === null ? null : Number(r.sup_total),
      antiguedad: r.antiguedad,
      operacion: r.operacion,
      precio: r.precio === null ? null : Number(r.precio),
      moneda: r.moneda,
      expensas: r.expensas === null ? null : Number(r.expensas),
      fotos: (r.fotos as unknown[]) ?? [],
    }));
  }
}
