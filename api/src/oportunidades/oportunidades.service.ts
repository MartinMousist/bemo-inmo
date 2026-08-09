import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { ordenSeguro } from '../common/orden';
import { PersonasService } from '../personas/personas.service';
import type {
  CrearOportunidadDto,
  CrearReservaDto,
  CrearVisitaDto,
  EditarOportunidadDto,
  EditarReservaDto,
  EditarVisitaDto,
  FiltroOportunidadesDto,
} from './oportunidades.dto';

/** El embudo, en orden. Sirve para el tablero y para validar transiciones. */
export const EMBUDO = [
  'nueva', 'contactada', 'calificada', 'visita', 'negociacion',
] as const;

export interface Oportunidad {
  id: string;
  persona: { id: string; nombre: string; telefono: string | null; email: string | null };
  propiedad: { id: string; etiqueta: string; direccion: string } | null;
  operacionId: string | null;
  agenteId: string | null;
  agenteNombre: string | null;
  origen: string;
  estado: string;
  motivoPerdida: string | null;
  interes: string | null;
  presupuestoMin: number | null;
  presupuestoMax: number | null;
  moneda: string;
  notas: string | null;
  visitas: Array<{ id: string; fechaHora: string; estado: string; feedback: string | null }>;
  creadaEl: string;
  /** Días desde el último movimiento. Derivado de `updated_at`, no un campo. */
  diasSinTocar: number;
}

@Injectable()
export class OportunidadesService {
  constructor(
    private readonly db: DbService,
    private readonly personas: PersonasService,
  ) {}

  async listar(
    tenantId: string,
    f: FiltroOportunidadesDto,
    actor: { usuarioId: string; rol: string },
  ): Promise<Pagina<Oportunidad>> {
    return this.db.withTenant(tenantId, async (ej) => {
      // Un asesor ve las suyas. No es sólo cosmético: es la diferencia entre
      // "el equipo colabora" y "cualquiera se lleva la cartera de leads".
      //
      // Los leads son la EXCEPCIÓN declarada al filtro por agente del resto de
      // los listados: en propiedades, cartera, ventas y publicaciones el filtro
      // es una herramienta y cualquiera ve todo. Acá es una regla de negocio, y
      // abrirla no se revierte con un deploy: el que carga un lead deja de
      // tenerlo protegido para siempre.
      const soloPropias = actor.rol === 'agente';
      const q = f.q ? `%${f.q.trim()}%` : null;

      // Un asesor que filtraba por un compañero recibía UNA LISTA VACÍA: las
      // dos condiciones —la pedida y la forzada— caen sobre la misma columna y
      // no se pueden cumplir a la vez. Eso es indistinguible de «ese agente no
      // tiene ningún lead», o sea un bug de datos fabricado. Ahora lo dice.
      //
      // La pantalla, además, no le ofrece otros agentes al rol `agente`: este
      // 403 es la red por abajo, no la interfaz.
      if (soloPropias && f.agenteId && f.agenteId !== actor.usuarioId) {
        throw AppError.forbidden(
          'Un asesor ve solamente sus propios leads. Los del resto del equipo ' +
            'los ve un titular o administración.',
        );
      }

      const params = [
        q,
        f.estado ?? null,
        f.agenteId ?? null,
        soloPropias ? actor.usuarioId : null,
      ];

      const donde = `
        WHERE ($1::text IS NULL
               OR trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) ILIKE $1
               OR pe.telefono ILIKE $1 OR pe.email::text ILIKE $1)
          AND ($2::text IS NULL OR o.estado = $2)
          AND ($3::uuid IS NULL OR o.agente_id = $3)
          AND ($4::uuid IS NULL OR o.agente_id = $4)`;

      const base = `FROM oportunidad o JOIN persona pe ON pe.id = o.persona_id ${donde}`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total ${base}`,
        params,
      );

      // El kanban no necesita ordenar —cada columna es una etapa— pero la vista
      // de lista sí: con 300 leads la pregunta es «¿cuál se me está enfriando?»,
      // y eso es ordenar por días sin tocar. La lista blanca es lo que hace que
      // ordenar por una columna no sea dejar que el cliente escriba SQL.
      const orden = ordenSeguro(
        {
          persona: 'persona_nombre',
          estado: 'o.estado',
          presupuesto: 'o.presupuesto_max',
          origen: 'o.origen',
          diasSinTocar: 'dias_sin_tocar',
          creada: 'o.created_at',
        },
        'o.created_at DESC',
        f.orden,
        f.dir,
      );

      const { rows } = await ej.query<FilaOportunidad>(
        `${SELECT_OPORTUNIDAD} ${donde}
         ORDER BY ${orden}
         LIMIT $5 OFFSET $6`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aOportunidad), Number(conteo[0].total), f);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Oportunidad> {
    return this.db.withTenant(tenantId, (ej) => this.leer(ej, id));
  }

  /**
   * Crea la oportunidad y, si hace falta, la persona en el mismo movimiento.
   *
   * Es el patrón de "búsqueda con alta inline": quien atiende una consulta no
   * puede tener que irse a otra pantalla a dar de alta al interesado y volver.
   */
  async crear(
    tenantId: string,
    dto: CrearOportunidadDto,
    creadaPor: string,
  ): Promise<Oportunidad> {
    if (!dto.personaId && !dto.persona) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Hace falta una persona: mandá personaId o los datos para darla de alta.',
        'Unprocessable Entity',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const personaId =
        dto.personaId ?? (await this.personas.insertar(ej, tenantId, dto.persona!));

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO oportunidad
           (tenant_id, persona_id, operacion_id, agente_id, origen, portal_origen,
            interes, presupuesto_min, presupuesto_max, moneda, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          tenantId, personaId, dto.operacionId ?? null,
          dto.agenteId ?? creadaPor,
          dto.origen ?? 'otro', dto.portalOrigen ?? null,
          dto.interes ?? null, dto.presupuestoMin ?? null, dto.presupuestoMax ?? null,
          dto.moneda ?? 'ARS', dto.notas ?? null,
        ],
      );
      return this.leer(ej, rows[0].id);
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: EditarOportunidadDto,
  ): Promise<Oportunidad> {
    // Perder una oportunidad sin decir por qué hace que el dato no sirva para
    // nada después: no se puede saber si se pierde por precio, por zona o por
    // demora en atender.
    if (dto.estado === 'perdida' && !dto.motivoPerdida) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Para marcar una oportunidad como perdida hay que indicar el motivo.',
        'Unprocessable Entity',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE oportunidad SET
           estado = coalesce($2, estado),
           motivo_perdida = CASE WHEN $2 = 'perdida' THEN $3 ELSE motivo_perdida END,
           agente_id = coalesce($4, agente_id),
           operacion_id = coalesce($5, operacion_id),
           notas = coalesce($6, notas),
           presupuesto_min = coalesce($7, presupuesto_min),
           presupuesto_max = coalesce($8, presupuesto_max)
         WHERE id = $1`,
        [
          id, dto.estado ?? null, dto.motivoPerdida ?? null,
          dto.agenteId ?? null, dto.operacionId ?? null, dto.notas ?? null,
          dto.presupuestoMin ?? null, dto.presupuestoMax ?? null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa oportunidad.');
      return this.leer(ej, id);
    });
  }

  // ── Visitas ────────────────────────────────────────────────────────────────

  async agendarVisita(
    tenantId: string,
    oportunidadId: string,
    dto: CrearVisitaDto,
    porDefectoAgente: string,
  ): Promise<Oportunidad> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'SELECT 1 FROM oportunidad WHERE id = $1',
        [oportunidadId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa oportunidad.');

      await ej.query(
        `INSERT INTO visita (tenant_id, oportunidad_id, operacion_id, agente_id, fecha_hora)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          tenantId, oportunidadId, dto.operacionId ?? null,
          dto.agenteId ?? porDefectoAgente, dto.fechaHora,
        ],
      );

      // Agendar una visita mueve el embudo solo. Pedirle al usuario que además
      // cambie el estado a mano es pedirle que haga el trabajo del sistema.
      await ej.query(
        `UPDATE oportunidad SET estado = 'visita'
          WHERE id = $1 AND estado IN ('nueva','contactada','calificada')`,
        [oportunidadId],
      );

      return this.leer(ej, oportunidadId);
    });
  }

  async editarVisita(
    tenantId: string,
    oportunidadId: string,
    visitaId: string,
    dto: EditarVisitaDto,
  ): Promise<Oportunidad> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE visita SET
           estado = coalesce($3, estado),
           feedback = coalesce($4, feedback),
           fecha_hora = coalesce($5, fecha_hora)
         WHERE id = $1 AND oportunidad_id = $2`,
        [visitaId, oportunidadId, dto.estado ?? null, dto.feedback ?? null, dto.fechaHora ?? null],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa visita.');
      return this.leer(ej, oportunidadId);
    });
  }

  // ── Reservas ───────────────────────────────────────────────────────────────

  /**
   * La seña. El índice parcial `ix_reserva_activa` garantiza una sola activa por
   * operación aunque dos personas reserven en el mismo milisegundo: es un
   * constraint de base, no un SELECT previo.
   */
  async reservar(tenantId: string, dto: CrearReservaDto): Promise<{ id: string }> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO reserva
             (tenant_id, operacion_id, persona_id, monto, moneda, vence_el, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            tenantId, dto.operacionId, dto.personaId, dto.monto, dto.moneda,
            dto.venceEl ?? null, dto.notas ?? null,
          ],
        );

        await ej.query(
          `UPDATE operacion SET estado = 'reservada'
            WHERE id = $1 AND estado IN ('borrador','disponible')`,
          [dto.operacionId],
        );

        return { id: rows[0].id };
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(
            409,
            ErrorCode.RESERVA_ACTIVA,
            'Esa operación ya tiene una reserva activa. Dala de baja antes de tomar otra.',
            'Conflict',
          );
        }
        if (codigoPg(err) === '23503') {
          throw AppError.notFound('No se encontró la operación o la persona.');
        }
        throw err;
      }
    });
  }

  async cambiarReserva(
    tenantId: string,
    id: string,
    dto: EditarReservaDto,
  ): Promise<{ id: string; estado: string }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ operacion_id: string }>(
        `UPDATE reserva SET estado = $2, notas = coalesce($3, notas)
          WHERE id = $1 RETURNING operacion_id`,
        [id, dto.estado, dto.notas ?? null],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa reserva.');

      // Si la reserva se cae, la operación vuelve a estar disponible. Dejarla
      // "reservada" la esconde de los listados para siempre.
      if (dto.estado === 'caida' || dto.estado === 'vencida') {
        await ej.query(
          `UPDATE operacion SET estado = 'disponible'
            WHERE id = $1 AND estado = 'reservada'`,
          [rows[0].operacion_id],
        );
      }

      return { id, estado: dto.estado };
    });
  }

  async listarReservas(tenantId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT r.id, r.monto, r.moneda, r.fecha, r.vence_el AS "venceEl", r.estado,
                r.notas,
                trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS persona,
                p.codigo AS "codigoPropiedad", p.calle, p.numero, o.tipo AS "tipoOperacion"
           FROM reserva r
           JOIN persona pe ON pe.id = r.persona_id
           JOIN operacion o ON o.id = r.operacion_id
           JOIN propiedad p ON p.id = o.propiedad_id
          ORDER BY r.fecha DESC`,
      );
      return rows;
    });
  }

  private async leer(ej: Ejecutor, id: string): Promise<Oportunidad> {
    const { rows } = await ej.query<FilaOportunidad>(
      `${SELECT_OPORTUNIDAD} WHERE o.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró esa oportunidad.');
    return aOportunidad(rows[0]);
  }
}

interface FilaOportunidad {
  id: string;
  persona_id: string;
  persona_nombre: string;
  persona_telefono: string | null;
  persona_email: string | null;
  propiedad_id: string | null;
  propiedad_codigo: number | null;
  propiedad_calle: string | null;
  propiedad_numero: string | null;
  propiedad_localidad: string | null;
  operacion_id: string | null;
  agente_id: string | null;
  agente_nombre: string | null;
  origen: string;
  estado: string;
  motivo_perdida: string | null;
  interes: string | null;
  presupuesto_min: string | null;
  presupuesto_max: string | null;
  moneda: string;
  notas: string | null;
  visitas: Array<Record<string, unknown>> | null;
  created_at: Date;
  updated_at: Date;
  dias_sin_tocar: number;
}

const SELECT_OPORTUNIDAD = `
  SELECT o.id, o.persona_id, o.operacion_id, o.agente_id, o.origen, o.estado,
         o.motivo_perdida, o.interes, o.presupuesto_min, o.presupuesto_max,
         o.moneda, o.notas, o.created_at, o.updated_at,
         -- «Días sin tocar»: el derivado que ordena la pantalla de Leads. Un
         -- lead de 20 días sin movimiento ES el problema, y hasta acá el
         -- kanban no lo mostraba ni se podía ordenar por él.
         --
         -- Sale de updated_at, que el trigger app_touch_updated_at mueve en
         -- cada cambio: no hay ni va a haber una columna «último contacto» que
         -- alguien tenga que acordarse de tocar. current_date de la base y
         -- ::date de los dos lados, así el resultado son días de calendario
         -- enteros y no una fracción con husos horarios adentro.
         -- (Sin comillas invertidas: adentro de un template literal cierran el
         -- literal y tsc tira TS1005 en la línea de abajo.)
         (current_date - o.updated_at::date)::int AS dias_sin_tocar,
         trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS persona_nombre,
         pe.telefono AS persona_telefono,
         pe.email::text AS persona_email,
         pr.id AS propiedad_id, pr.codigo AS propiedad_codigo,
         pr.calle AS propiedad_calle, pr.numero AS propiedad_numero,
         pr.localidad AS propiedad_localidad,
         u.nombre AS agente_nombre,
         (SELECT json_agg(json_build_object(
             'id', v.id, 'fechaHora', v.fecha_hora, 'estado', v.estado,
             'feedback', v.feedback) ORDER BY v.fecha_hora DESC)
            FROM visita v WHERE v.oportunidad_id = o.id) AS visitas
    FROM oportunidad o
    JOIN persona pe ON pe.id = o.persona_id
    LEFT JOIN operacion op ON op.id = o.operacion_id
    LEFT JOIN propiedad pr ON pr.id = op.propiedad_id
    LEFT JOIN usuario u ON u.id = o.agente_id`;

function aOportunidad(f: FilaOportunidad): Oportunidad {
  return {
    id: f.id,
    persona: {
      id: f.persona_id,
      nombre: f.persona_nombre,
      telefono: f.persona_telefono,
      email: f.persona_email,
    },
    propiedad: f.propiedad_id
      ? {
          id: f.propiedad_id,
          etiqueta: `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`,
          direccion: [
            [f.propiedad_calle, f.propiedad_numero].filter(Boolean).join(' '),
            f.propiedad_localidad,
          ]
            .filter(Boolean)
            .join(', '),
        }
      : null,
    operacionId: f.operacion_id,
    agenteId: f.agente_id,
    agenteNombre: f.agente_nombre,
    origen: f.origen,
    estado: f.estado,
    motivoPerdida: f.motivo_perdida,
    interes: f.interes,
    presupuestoMin: f.presupuesto_min === null ? null : Number(f.presupuesto_min),
    presupuestoMax: f.presupuesto_max === null ? null : Number(f.presupuesto_max),
    moneda: f.moneda,
    notas: f.notas,
    visitas: (f.visitas ?? []).map((v) => ({
      id: String(v.id),
      fechaHora: String(v.fechaHora),
      estado: String(v.estado),
      feedback: (v.feedback as string) ?? null,
    })),
    creadaEl: f.created_at.toISOString(),
    diasSinTocar: Number(f.dias_sin_tocar),
  };
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
