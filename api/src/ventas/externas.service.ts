import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * El catálogo de inmobiliarias con las que se comparten operaciones.
 *
 * Antes de la 021 el nombre de la otra agencia era texto libre adentro de la
 * comisión. Funcionaba para imprimir una fila y no servía para nada más: con
 * «Propiedades del Oeste», «Prop. del Oeste» y «propiedades del oeste» como
 * tres agencias distintas, la pregunta que sí se hace —«¿cuánto le pagamos este
 * año?»— no tenía respuesta.
 *
 * Dos cosas que este servicio hace y conviene no revisar sin motivo:
 *
 * **El alta la puede hacer un asesor.** Quien está cerrando una operación
 * compartida a las siete de la tarde no puede quedar trabado esperando que el
 * titular cargue una ficha. Dar de baja, en cambio, es de titular y
 * administración: saca a la agencia de todos los autocompletar.
 *
 * **No se borra: se desactiva.** Un DELETE se llevaría puesto el enlace de las
 * comisiones ya pagadas (`ON DELETE SET NULL`), y con él la única forma de
 * sumar el histórico por agencia.
 */

export interface Externa {
  id: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activa: boolean;
  /** Lo que se le pagó, por moneda. Vacío si nunca cobró nada. */
  pagado: Array<{ moneda: string; total: number; operaciones: number; estado: string }>;
}

export interface DatosExterna {
  nombre: string;
  cuit?: string;
  contacto?: string;
  telefono?: string;
  email?: string;
  notas?: string;
  activa?: boolean;
}

@Injectable()
export class ExternasService {
  constructor(private readonly db: DbService) {}

  /**
   * Sin paginar, a propósito: es la libreta de las agencias con las que se
   * trabaja. Una inmobiliaria de barrio tiene entre cinco y veinte, y el tope
   * real es la cantidad de colegas de la zona. Es un bound del mundo, no una
   * apuesta.
   */
  async listar(tenantId: string, incluirInactivas = false): Promise<Externa[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaExterna>(
        `${SELECT_EXTERNA}
          WHERE ($1::boolean OR e.activa)
          ORDER BY e.activa DESC, lower(e.nombre)`,
        [incluirInactivas],
      );
      return rows.map(aExterna);
    });
  }

  async crear(tenantId: string, dto: DatosExterna): Promise<Externa> {
    return this.db.withTenant(tenantId, async (ej) => {
      let id: string;
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO inmobiliaria_externa
             (tenant_id, nombre, cuit, contacto, telefono, email, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            tenantId, dto.nombre.trim(), dto.cuit ?? null, dto.contacto ?? null,
            dto.telefono ?? null, dto.email ?? null, dto.notas ?? null,
          ],
        );
        id = rows[0].id;
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(
            409,
            ErrorCode.VALIDATION_FAILED,
            `Ya tenés cargada una inmobiliaria con el nombre «${dto.nombre.trim()}».`,
            'Conflict',
          );
        }
        throw err;
      }
      return this.leer(ej, id);
    });
  }

  /**
   * Editar es un PATCH y usa coalesce en todo, con UNA excepción escrita:
   * `activa` es un booleano que se manda entero desde el switch de la pantalla,
   * así que `false` tiene que poder escribirse. Con `coalesce($n, activa)` un
   * `false` se escribiría bien —no es NULL— pero dejarlo dicho evita que el
   * próximo que lo lea lo "arregle".
   */
  async editar(tenantId: string, id: string, dto: Partial<DatosExterna>): Promise<Externa> {
    return this.db.withTenant(tenantId, async (ej) => {
      let rowCount: number | null;
      try {
        ({ rowCount } = await ej.query(
          `UPDATE inmobiliaria_externa SET
             nombre = coalesce($2, nombre),
             cuit = coalesce($3, cuit),
             contacto = coalesce($4, contacto),
             telefono = coalesce($5, telefono),
             email = coalesce($6, email),
             notas = coalesce($7, notas),
             activa = coalesce($8, activa)
           WHERE id = $1`,
          [
            id, dto.nombre?.trim() ?? null, dto.cuit ?? null, dto.contacto ?? null,
            dto.telefono ?? null, dto.email ?? null, dto.notas ?? null,
            dto.activa ?? null,
          ],
        ));
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(
            409, ErrorCode.VALIDATION_FAILED,
            'Ya tenés otra inmobiliaria cargada con ese nombre.', 'Conflict',
          );
        }
        throw err;
      }
      if (!rowCount) throw AppError.notFound('No se encontró esa inmobiliaria.');
      return this.leer(ej, id);
    });
  }

  private async leer(ej: Ejecutor, id: string): Promise<Externa> {
    const { rows } = await ej.query<FilaExterna>(`${SELECT_EXTERNA} WHERE e.id = $1`, [id]);
    if (!rows.length) throw AppError.notFound('No se encontró esa inmobiliaria.');
    return aExterna(rows[0]);
  }
}

interface FilaExterna {
  id: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activa: boolean;
  pagado: Array<Record<string, unknown>> | null;
}

// `pagado` se agrupa por moneda Y por estado: ARS y USD no se suman nunca, y
// «cobrada» y «proyectada» tampoco — una es plata que salió y la otra una
// promesa. Las anuladas quedan afuera.
const SELECT_EXTERNA = `
  SELECT e.*,
    (SELECT json_agg(json_build_object(
        'moneda', x.moneda, 'estado', x.estado,
        'total', x.total, 'operaciones', x.operaciones)
       ORDER BY x.moneda, x.estado)
       FROM (SELECT c.moneda, c.estado, sum(c.monto) AS total,
                    count(*)::int AS operaciones
               FROM comision c
              WHERE c.externa_id = e.id AND c.estado <> 'anulada'
              GROUP BY c.moneda, c.estado) x) AS pagado
  FROM inmobiliaria_externa e`;

function aExterna(f: FilaExterna): Externa {
  return {
    id: f.id,
    nombre: f.nombre,
    cuit: f.cuit,
    contacto: f.contacto,
    telefono: f.telefono,
    email: f.email,
    notas: f.notas,
    activa: f.activa,
    pagado: (f.pagado ?? []).map((p) => ({
      moneda: String(p.moneda),
      estado: String(p.estado),
      total: Number(p.total),
      operaciones: Number(p.operaciones),
    })),
  };
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
