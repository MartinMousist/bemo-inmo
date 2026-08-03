import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina, type PaginacionDto } from '../common/paginacion';
import type { CrearPersonaDto, EditarPersonaDto } from './personas.dto';

export interface Persona {
  id: string;
  tipo: 'fisica' | 'juridica';
  nombre: string;
  apellido: string | null;
  nombreCompleto: string;
  docTipo: string | null;
  docNumero: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: string | null;
  notas: string | null;
}

/**
 * Los roles NO se guardan: se derivan de las relaciones reales. Una persona es
 * "propietaria" porque tiene una titularidad, no porque alguien marcó una
 * casilla. Un dato derivado no se desincroniza.
 */
export type RolPersona = 'propietario' | 'interesado' | 'reservante';

export interface PersonaConRoles extends Persona {
  roles: RolPersona[];
}

@Injectable()
export class PersonasService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, p: PaginacionDto): Promise<Pagina<PersonaConRoles>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const filtro = p.q ? `%${p.q.trim()}%` : null;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM persona
          WHERE ($1::text IS NULL
                 OR (coalesce(nombre,'') || ' ' || coalesce(apellido,'')) ILIKE $1
                 OR doc_numero ILIKE $1
                 OR email::text ILIKE $1)`,
        [filtro],
      );

      const { rows } = await ej.query<FilaPersona>(
        `${SELECT_PERSONA}
          WHERE ($1::text IS NULL
                 OR (coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) ILIKE $1
                 OR p.doc_numero ILIKE $1
                 OR p.email::text ILIKE $1)
          ORDER BY p.apellido NULLS LAST, p.nombre
          LIMIT $2 OFFSET $3`,
        [filtro, p.porPagina, offset(p)],
      );

      return armarPagina(rows.map(aPersonaConRoles), Number(conteo[0].total), p);
    });
  }

  async obtener(tenantId: string, id: string): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      if (!rows.length) throw AppError.notFound('No se encontró esa persona.');
      return aPersonaConRoles(rows[0]);
    });
  }

  /**
   * Búsqueda por documento con alta inline: el front busca, y si no existe,
   * el formulario de alta aparece ahí mismo con el documento ya cargado. Nunca
   * "no encontrado, andá a otra pantalla a crearlo".
   */
  async buscarPorDocumento(
    tenantId: string,
    docNumero: string,
  ): Promise<PersonaConRoles | null> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPersona>(
        `${SELECT_PERSONA} WHERE p.doc_numero = $1 LIMIT 1`,
        [docNumero],
      );
      return rows.length ? aPersonaConRoles(rows[0]) : null;
    });
  }

  async crear(tenantId: string, dto: CrearPersonaDto): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      const id = await this.insertar(ej, tenantId, dto);
      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      return aPersonaConRoles(rows[0]);
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: EditarPersonaDto,
  ): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rowCount } = await ej.query(
          // PATCH: lo que no viene queda como estaba. Ver el mismo comentario
          // en propiedades.service.ts.
          `UPDATE persona SET
             tipo = coalesce($2, tipo),
             nombre = coalesce($3, nombre),
             apellido = coalesce($4, apellido),
             doc_tipo = coalesce($5, doc_tipo),
             doc_numero = coalesce($6, doc_numero),
             email = coalesce($7, email),
             telefono = coalesce($8, telefono),
             domicilio = coalesce($9, domicilio),
             notas = coalesce($10, notas)
           WHERE id = $1`,
          [
            id,
            dto.tipo ?? null,
            dto.nombre ?? null,
            dto.apellido ?? null,
            dto.docTipo ?? null,
            dto.docNumero ?? null,
            dto.email ?? null,
            dto.telefono ?? null,
            dto.domicilio ?? null,
            dto.notas ?? null,
          ],
        );
        // 404 y no un 200 vacío: si la fila es de otra inmobiliaria, RLS la
        // esconde y el UPDATE afecta cero filas. Devolver 200 mentiría.
        if (!rowCount) throw AppError.notFound('No se encontró esa persona.');
      } catch (err) {
        throw this.traducir(err);
      }

      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      return aPersonaConRoles(rows[0]);
    });
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rowCount } = await ej.query('DELETE FROM persona WHERE id = $1', [id]);
        if (!rowCount) throw AppError.notFound('No se encontró esa persona.');
      } catch (err) {
        if (codigoPg(err) === '23503') {
          throw new AppError(
            409,
            ErrorCode.EN_USO,
            'No se puede borrar: la persona es titular de una propiedad o parte de una operación.',
            'Conflict',
          );
        }
        throw err;
      }
    });
  }

  /** Reutilizable desde otros servicios que crean personas al vuelo. */
  async insertar(ej: Ejecutor, tenantId: string, dto: CrearPersonaDto): Promise<string> {
    try {
      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO persona
           (tenant_id, tipo, nombre, apellido, doc_tipo, doc_numero,
            email, telefono, domicilio, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          tenantId,
          dto.tipo ?? 'fisica',
          dto.nombre,
          dto.apellido ?? null,
          dto.docTipo ?? null,
          dto.docNumero ?? null,
          dto.email ?? null,
          dto.telefono ?? null,
          dto.domicilio ?? null,
          dto.notas ?? null,
        ],
      );
      return rows[0].id;
    } catch (err) {
      throw this.traducir(err);
    }
  }

  private traducir(err: unknown): unknown {
    if (codigoPg(err) === '23505') {
      return new AppError(
        409,
        ErrorCode.DOCUMENTO_DUPLICADO,
        'Ya existe una persona con ese documento.',
        'Conflict',
      );
    }
    return err;
  }
}

interface FilaPersona {
  id: string;
  tipo: 'fisica' | 'juridica';
  nombre: string;
  apellido: string | null;
  doc_tipo: string | null;
  doc_numero: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: string | null;
  notas: string | null;
  roles: string[];
}

// Los roles salen de las relaciones, no de una columna.
const SELECT_PERSONA = `
  SELECT p.id, p.tipo, p.nombre, p.apellido, p.doc_tipo, p.doc_numero,
         p.email::text AS email, p.telefono, p.domicilio, p.notas,
         array_remove(ARRAY[
           CASE WHEN EXISTS (SELECT 1 FROM titularidad t WHERE t.persona_id = p.id)
                THEN 'propietario' END,
           CASE WHEN EXISTS (SELECT 1 FROM oportunidad o WHERE o.persona_id = p.id)
                THEN 'interesado' END,
           CASE WHEN EXISTS (SELECT 1 FROM reserva r WHERE r.persona_id = p.id
                             AND r.estado = 'activa')
                THEN 'reservante' END
         ], NULL) AS roles
    FROM persona p`;

function aPersonaConRoles(f: FilaPersona): PersonaConRoles {
  const nombreCompleto = [f.nombre, f.apellido].filter(Boolean).join(' ');
  return {
    id: f.id,
    tipo: f.tipo,
    nombre: f.nombre,
    apellido: f.apellido,
    nombreCompleto,
    docTipo: f.doc_tipo,
    docNumero: f.doc_numero,
    email: f.email,
    telefono: f.telefono,
    domicilio: f.domicilio,
    notas: f.notas,
    roles: (f.roles ?? []) as RolPersona[],
  };
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
