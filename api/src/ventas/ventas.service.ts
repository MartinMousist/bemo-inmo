import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import {
  calcularComisiones,
  cuadra,
  type EntradaComision,
  type Punta,
} from './comisiones.motor';
import type {
  CerrarVentaDto,
  CrearVentaDto,
  FiltroVentasDto,
  RepartoDto,
} from './ventas.dto';

export interface Venta {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  comprador: { id: string; nombre: string } | null;
  precioCierre: number;
  moneda: string;
  fechaReserva: string | null;
  fechaBoleto: string | null;
  fechaEscritura: string | null;
  escribania: string | null;
  estado: string;
  comisiones: Array<{
    id: string;
    nivel: number;
    punta: string | null;
    concepto: string;
    monto: number;
    moneda: string;
    beneficiarioTipo: string;
    beneficiarioNombre: string | null;
    estado: string;
  }>;
  totales: {
    operacion: number;
    externas: number;
    agentes: number;
    casa: number;
  };
}

/** Los estados por los que pasa una venta, en orden. */
const FLUJO = ['en_curso', 'boleto', 'escriturada'] as const;

@Injectable()
export class VentasService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, f: FiltroVentasDto): Promise<Pagina<Venta>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.estado ?? null];

      const donde = `
        WHERE ($1::text IS NULL
               OR pr.calle ILIKE $1 OR pr.localidad ILIKE $1
               OR pr.codigo::text = trim(both '%' from $1)
               OR trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) ILIKE $1)
          AND ($2::text IS NULL OR v.estado = $2)`;

      // El conteo NO usa SELECT_VENTA: ese trae el json_agg de comisiones por
      // fila, y contar no necesita las comisiones de nadie.
      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM operacion_venta v
           JOIN operacion o ON o.id = v.operacion_id
           JOIN propiedad pr ON pr.id = o.propiedad_id
           LEFT JOIN persona pe ON pe.id = v.comprador_id
          ${donde}`,
        params,
      );

      const { rows } = await ej.query<FilaVenta>(
        `${SELECT_VENTA} ${donde} ORDER BY v.created_at DESC LIMIT $3 OFFSET $4`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aVenta), Number(conteo[0].total), f);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Venta> {
    return this.db.withTenant(tenantId, (ej) => this.leer(ej, id));
  }

  async crear(tenantId: string, dto: CrearVentaDto): Promise<Venta> {
    return this.db.withTenant(tenantId, async (ej) => {
      let id: string;
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO operacion_venta
             (tenant_id, operacion_id, comprador_id, precio_cierre, moneda,
              fecha_reserva, fecha_boleto, escribania, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            tenantId, dto.operacionId, dto.compradorId ?? null,
            dto.precioCierre, dto.moneda,
            dto.fechaReserva ?? null, dto.fechaBoleto ?? null,
            dto.escribania ?? null, dto.notas ?? null,
          ],
        );
        id = rows[0].id;
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(
            409,
            ErrorCode.OPERACION_DUPLICADA,
            'Esa operación ya tiene una venta en curso. Dala de baja antes de abrir otra.',
            'Conflict',
          );
        }
        if (codigoPg(err) === '23503') {
          throw AppError.notFound('No se encontró la operación o el comprador.');
        }
        throw err;
      }

      // La operación pasa a reservada: la propiedad deja de ofrecerse.
      await ej.query(
        `UPDATE operacion SET estado = 'reservada'
          WHERE id = $1 AND estado IN ('borrador','disponible')`,
        [dto.operacionId],
      );

      return this.leer(ej, id);
    });
  }

  /**
   * Calcula y guarda el reparto de comisiones.
   *
   * Se recalcula entero cada vez: es más simple y más seguro que reconciliar, y
   * mientras las comisiones estén proyectadas no hay nada que preservar. Una
   * comisión ya cobrada bloquea el recálculo.
   */
  async repartir(tenantId: string, ventaId: string, dto: RepartoDto): Promise<Venta> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: v } = await ej.query<{ precio_cierre: string; moneda: string }>(
        'SELECT precio_cierre, moneda FROM operacion_venta WHERE id = $1',
        [ventaId],
      );
      if (!v.length) throw AppError.notFound('No se encontró esa venta.');

      const { rows: cobradas } = await ej.query(
        `SELECT 1 FROM comision WHERE venta_id = $1 AND estado = 'cobrada' LIMIT 1`,
        [ventaId],
      );
      if (cobradas.length) {
        throw new AppError(
          409,
          ErrorCode.ESTADO_INVALIDO,
          'Hay comisiones ya cobradas: no se puede rehacer el reparto. Anulalas primero.',
          'Conflict',
        );
      }

      const entrada: EntradaComision = {
        base: Number(v[0].precio_cierre),
        moneda: v[0].moneda,
        puntas: dto.puntas as Partial<Record<Punta, number>>,
        externas: dto.externas as EntradaComision['externas'],
        repartoInterno: dto.repartoInterno,
      };

      const r = calcularComisiones(entrada);

      // Invariante dura: lo que factura la operación es exactamente lo que se
      // reparte. Si no cuadra hay plata perdida o inventada, y eso no se guarda.
      if (!cuadra(r)) {
        throw new AppError(
          500,
          ErrorCode.INTERNAL,
          'El reparto de comisiones no cuadra contra el total. No se guardó nada.',
          'Internal Server Error',
        );
      }

      await ej.query('DELETE FROM comision WHERE venta_id = $1', [ventaId]);

      // Dos INSERT en lote, no uno por línea.
      //
      // Todo `padre` del motor apunta a una línea de NIVEL 1 (ver
      // `comisiones.motor.ts`), así que alcanza con dos pasadas: primero los
      // nivel 1, después el resto ya con el id del padre resuelto. Una venta con
      // dos puntas, una externa y dos agentes eran nueve viajes a la base.
      //
      // El mapeo padre→id se hace por `punta`, que es única entre los nivel 1
      // (uno por punta), y NO por el orden en que vuelve el RETURNING: el orden
      // de las filas devueltas por un INSERT no es algo que el motor garantice,
      // y acá una fila mal encadenada es plata asignada a quien no corresponde.
      const nivel1 = r.lineas.filter((l) => l.nivel === 1);
      const resto = r.lineas.filter((l) => l.nivel !== 1);

      const idPorPunta = new Map<string, string>();

      if (nivel1.length) {
        const { rows: creadas } = await ej.query<{ id: string; punta: string }>(
          `INSERT INTO comision
             (tenant_id, venta_id, padre_id, nivel, punta, base_monto, moneda,
              porcentaje, monto, beneficiario_tipo, beneficiario_id,
              beneficiario_nombre, concepto)
           SELECT $1, $2, NULL, 1, x.punta, x.base, x.moneda, x.porcentaje,
                  x.monto, x.beneficiario_tipo, NULL, NULL, x.concepto
             FROM unnest($3::text[], $4::numeric[], $5::text[], $6::numeric[],
                         $7::numeric[], $8::text[], $9::text[])
                  AS x(punta, base, moneda, porcentaje, monto,
                       beneficiario_tipo, concepto)
           RETURNING id, punta`,
          [
            tenantId, ventaId,
            nivel1.map((l) => l.punta),
            nivel1.map((l) => l.base),
            nivel1.map((l) => l.moneda),
            nivel1.map((l) => l.porcentaje),
            nivel1.map((l) => l.monto),
            nivel1.map((l) => l.beneficiarioTipo),
            nivel1.map((l) => l.concepto),
          ],
        );
        for (const c of creadas) idPorPunta.set(c.punta, c.id);
      }

      if (resto.length) {
        const padres = resto.map((l) => {
          const dePunta = l.padre === undefined ? null : r.lineas[l.padre].punta;
          return dePunta === null ? null : (idPorPunta.get(dePunta) ?? null);
        });

        await ej.query(
          `INSERT INTO comision
             (tenant_id, venta_id, padre_id, nivel, punta, base_monto, moneda,
              porcentaje, monto, beneficiario_tipo, beneficiario_id,
              beneficiario_nombre, concepto)
           SELECT $1, $2, x.padre_id, x.nivel, x.punta, x.base, x.moneda,
                  x.porcentaje, x.monto, x.beneficiario_tipo, x.beneficiario_id,
                  x.beneficiario_nombre, x.concepto
             FROM unnest($3::uuid[], $4::smallint[], $5::text[], $6::numeric[],
                         $7::text[], $8::numeric[], $9::numeric[], $10::text[],
                         $11::uuid[], $12::text[], $13::text[])
                  AS x(padre_id, nivel, punta, base, moneda, porcentaje, monto,
                       beneficiario_tipo, beneficiario_id, beneficiario_nombre,
                       concepto)`,
          [
            tenantId, ventaId,
            padres,
            resto.map((l) => l.nivel),
            resto.map((l) => l.punta),
            resto.map((l) => l.base),
            resto.map((l) => l.moneda),
            resto.map((l) => l.porcentaje),
            resto.map((l) => l.monto),
            resto.map((l) => l.beneficiarioTipo),
            resto.map((l) => l.beneficiarioId ?? null),
            resto.map((l) => l.beneficiarioNombre ?? null),
            resto.map((l) => l.concepto),
          ],
        );
      }

      return this.leer(ej, ventaId);
    });
  }

  async avanzar(tenantId: string, id: string, dto: CerrarVentaDto): Promise<Venta> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: actual } = await ej.query<{ estado: string; operacion_id: string }>(
        'SELECT estado, operacion_id FROM operacion_venta WHERE id = $1',
        [id],
      );
      if (!actual.length) throw AppError.notFound('No se encontró esa venta.');

      const desde = FLUJO.indexOf(actual[0].estado as (typeof FLUJO)[number]);
      const hasta = FLUJO.indexOf(dto.estado as (typeof FLUJO)[number]);

      // El flujo no va para atrás: una venta escriturada no vuelve a "en curso".
      // Si algo salió mal, se marca caída y se abre otra.
      if (dto.estado !== 'caida' && (desde < 0 || hasta < desde)) {
        throw new AppError(
          422,
          ErrorCode.ESTADO_INVALIDO,
          `No se puede pasar de "${actual[0].estado}" a "${dto.estado}". ` +
            'El flujo va hacia adelante; si se cayó, marcala como caída.',
          'Unprocessable Entity',
        );
      }

      await ej.query(
        `UPDATE operacion_venta SET
           estado = $2,
           fecha_boleto = coalesce($3, fecha_boleto),
           fecha_escritura = coalesce($4, fecha_escritura),
           escribania = coalesce($5, escribania),
           motivo_caida = CASE WHEN $2 = 'caida' THEN $6 ELSE motivo_caida END
         WHERE id = $1`,
        [
          id, dto.estado, dto.fechaBoleto ?? null, dto.fechaEscritura ?? null,
          dto.escribania ?? null, dto.motivoCaida ?? null,
        ],
      );

      if (dto.estado === 'escriturada') {
        // Escrituró: la operación se cierra y las comisiones se devengan.
        await ej.query(`UPDATE operacion SET estado = 'cerrada' WHERE id = $1`, [
          actual[0].operacion_id,
        ]);
        await ej.query(
          `UPDATE comision SET estado = 'devengada'
            WHERE venta_id = $1 AND estado = 'proyectada'`,
          [id],
        );
      }

      if (dto.estado === 'caida') {
        // Se cayó: la propiedad vuelve al mercado y las comisiones se anulan.
        await ej.query(
          `UPDATE operacion SET estado = 'disponible'
            WHERE id = $1 AND estado = 'reservada'`,
          [actual[0].operacion_id],
        );
        await ej.query(
          `UPDATE comision SET estado = 'anulada'
            WHERE venta_id = $1 AND estado <> 'cobrada'`,
          [id],
        );
      }

      return this.leer(ej, id);
    });
  }

  async marcarCobrada(tenantId: string, comisionId: string, fecha?: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE comision SET estado = 'cobrada', cobrada_el = coalesce($2, current_date)
          WHERE id = $1 AND estado IN ('proyectada','devengada')`,
        [comisionId, fecha ?? null],
      );
      if (!rowCount) {
        throw AppError.notFound('No se encontró esa comisión, o ya estaba cobrada o anulada.');
      }
      return { id: comisionId, estado: 'cobrada' };
    });
  }

  /** Lo que le corresponde a cada agente. Es lo que evita las discusiones. */
  async porAgente(tenantId: string, actor: { usuarioId: string; rol: string }) {
    return this.db.withTenant(tenantId, async (ej) => {
      // El asesor ve lo suyo; el titular y administración, todo.
      const soloPropias = actor.rol === 'agente';
      const { rows } = await ej.query(
        `SELECT c.beneficiario_id AS "agenteId",
                coalesce(u.nombre, c.beneficiario_nombre) AS agente,
                c.moneda, c.estado,
                sum(c.monto) AS total,
                count(*)::int AS operaciones
           FROM comision c
           LEFT JOIN usuario u ON u.id = c.beneficiario_id
          WHERE c.beneficiario_tipo = 'agente'
            AND c.estado <> 'anulada'
            AND ($1::uuid IS NULL OR c.beneficiario_id = $1)
          GROUP BY c.beneficiario_id, u.nombre, c.beneficiario_nombre, c.moneda, c.estado
          ORDER BY agente, c.moneda, c.estado`,
        [soloPropias ? actor.usuarioId : null],
      );
      return rows.map((r) => ({ ...r, total: Number(r.total) }));
    });
  }

  private async leer(ej: Ejecutor, id: string): Promise<Venta> {
    const { rows } = await ej.query<FilaVenta>(`${SELECT_VENTA} WHERE v.id = $1`, [id]);
    if (!rows.length) throw AppError.notFound('No se encontró esa venta.');
    return aVenta(rows[0]);
  }
}

interface FilaVenta {
  id: string;
  propiedad_id: string;
  propiedad_codigo: number;
  propiedad_calle: string;
  propiedad_numero: string | null;
  propiedad_localidad: string | null;
  comprador_id: string | null;
  comprador_nombre: string | null;
  precio_cierre: string;
  moneda: string;
  fecha_reserva: string | null;
  fecha_boleto: string | null;
  fecha_escritura: string | null;
  escribania: string | null;
  estado: string;
  comisiones: Array<Record<string, unknown>> | null;
}

const SELECT_VENTA = `
  SELECT v.*,
    pr.id AS propiedad_id, pr.codigo AS propiedad_codigo, pr.calle AS propiedad_calle,
    pr.numero AS propiedad_numero, pr.localidad AS propiedad_localidad,
    trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS comprador_nombre,
    (SELECT json_agg(json_build_object(
        'id', c.id, 'nivel', c.nivel, 'punta', c.punta, 'concepto', c.concepto,
        'monto', c.monto, 'moneda', c.moneda,
        'beneficiarioTipo', c.beneficiario_tipo,
        'beneficiarioNombre', coalesce(u.nombre, c.beneficiario_nombre),
        'estado', c.estado) ORDER BY c.nivel, c.created_at)
       FROM comision c LEFT JOIN usuario u ON u.id = c.beneficiario_id
      WHERE c.venta_id = v.id) AS comisiones
  FROM operacion_venta v
  JOIN operacion o ON o.id = v.operacion_id
  JOIN propiedad pr ON pr.id = o.propiedad_id
  LEFT JOIN persona pe ON pe.id = v.comprador_id`;

function aVenta(f: FilaVenta): Venta {
  const comisiones = (f.comisiones ?? []).map((c) => ({
    id: String(c.id),
    nivel: Number(c.nivel),
    punta: (c.punta as string) ?? null,
    concepto: String(c.concepto),
    monto: Number(c.monto),
    moneda: String(c.moneda),
    beneficiarioTipo: String(c.beneficiarioTipo),
    beneficiarioNombre: (c.beneficiarioNombre as string) ?? null,
    estado: String(c.estado),
  }));

  const suma = (tipo: string) =>
    comisiones
      .filter((c) => c.beneficiarioTipo === tipo && c.estado !== 'anulada')
      .reduce((a, c) => a + c.monto, 0);

  return {
    id: f.id,
    propiedad: {
      id: f.propiedad_id,
      etiqueta: `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`,
      direccion: [
        [f.propiedad_calle, f.propiedad_numero].filter(Boolean).join(' '),
        f.propiedad_localidad,
      ]
        .filter(Boolean)
        .join(', '),
    },
    comprador: f.comprador_id
      ? { id: f.comprador_id, nombre: f.comprador_nombre ?? '' }
      : null,
    precioCierre: Number(f.precio_cierre),
    moneda: f.moneda,
    fechaReserva: f.fecha_reserva,
    fechaBoleto: f.fecha_boleto,
    fechaEscritura: f.fecha_escritura,
    escribania: f.escribania,
    estado: f.estado,
    comisiones,
    totales: {
      operacion: redondear(suma('operacion')),
      externas: redondear(suma('inmobiliaria_externa')),
      agentes: redondear(suma('agente')),
      casa: redondear(suma('casa')),
    },
  };
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
