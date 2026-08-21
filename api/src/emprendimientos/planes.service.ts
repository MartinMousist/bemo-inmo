import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import {
  analizarInversion, armarPresupuesto, PlanInvalido, validarPlan,
  type Inversion, type PlanPago, type Presupuesto,
} from './plan-pago.motor';

export interface PlanGuardado extends PlanPago {
  id: string;
  emprendimientoId: string | null;
  activo: boolean;
  /** Los problemas del plan, si tiene. La pantalla los muestra antes de usarlo. */
  problemas: string[];
}

export interface PresupuestoCompleto {
  unidad: { id: string; codigo: string; supTotal: number | null } | null;
  plan: { id: string; nombre: string };
  presupuesto: Presupuesto;
  inversion: Inversion;
}

@Injectable()
export class PlanesPagoService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, emprendimientoId?: string): Promise<PlanGuardado[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<Fila>(
        `SELECT id, emprendimiento_id, nombre, anticipo_pct, cuotas, refuerzos,
                contra_entrega_pct, indice, moneda, activo
           FROM plan_pago
          WHERE ($1::uuid IS NULL OR emprendimiento_id = $1)
          ORDER BY activo DESC, nombre`,
        [emprendimientoId ?? null],
      );
      return rows.map(aPlan);
    });
  }

  async crear(tenantId: string, dto: Record<string, unknown>): Promise<PlanGuardado> {
    const plan = desdeDto(dto);

    // Se valida ANTES de guardar. Un plan cuyos porcentajes no cierran no es un
    // borrador: es una lista de precios que le va a cobrar de más o de menos a
    // alguien, y guardarlo «para arreglarlo después» es dejarlo listo para que
    // se use por error.
    const problemas = validarPlan(plan);
    if (problemas.length) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED, problemas.join(' '), 'Unprocessable Entity',
      );
    }

    const id = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO plan_pago
           (tenant_id, emprendimiento_id, nombre, anticipo_pct, cuotas, refuerzos,
            contra_entrega_pct, indice, moneda)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id`,
        [
          tenantId, dto.emprendimientoId ?? null, plan.nombre, plan.anticipoPct,
          plan.cuotas, JSON.stringify(plan.refuerzos), plan.contraEntregaPct,
          plan.indice, plan.moneda,
        ],
      );
      return rows[0].id;
    });

    return (await this.listar(tenantId)).find((p) => p.id === id)!;
  }

  async editar(tenantId: string, id: string, dto: Record<string, unknown>): Promise<PlanGuardado> {
    const actual = (await this.listar(tenantId)).find((p) => p.id === id);
    if (!actual) throw AppError.notFound('No se encontró ese plan de pago.');

    const plan = desdeDto({ ...actual, ...dto });
    const problemas = validarPlan(plan);
    if (problemas.length) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED, problemas.join(' '), 'Unprocessable Entity',
      );
    }

    await this.db.withTenant(tenantId, async (ej) => {
      await ej.query(
        `UPDATE plan_pago SET
           nombre = $2, anticipo_pct = $3, cuotas = $4, refuerzos = $5::jsonb,
           contra_entrega_pct = $6, indice = $7, moneda = $8,
           activo = coalesce($9, activo)
         WHERE id = $1`,
        [
          id, plan.nombre, plan.anticipoPct, plan.cuotas,
          JSON.stringify(plan.refuerzos), plan.contraEntregaPct,
          plan.indice, plan.moneda, dto.activo ?? null,
        ],
      );
    });

    return (await this.listar(tenantId)).find((p) => p.id === id)!;
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM plan_pago WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró ese plan de pago.');
    });
  }

  /**
   * El presupuesto para un cliente.
   *
   * El precio sale de la operación de venta de la unidad, no se manda desde el
   * navegador: así el presupuesto que se le imprime a alguien es el precio
   * publicado y no uno que se pueda escribir a mano en la URL.
   *
   * `precio` explícito se acepta SÓLO cuando no hay unidad —para simular—, y la
   * respuesta lo dice.
   */
  async presupuestar(
    tenantId: string,
    planId: string,
    opciones: { propiedadId?: string; precio?: number; desde?: string; comparableTerminado?: number },
  ): Promise<PresupuestoCompleto> {
    const plan = (await this.listar(tenantId)).find((p) => p.id === planId);
    if (!plan) throw AppError.notFound('No se encontró ese plan de pago.');

    const unidad = opciones.propiedadId
      ? await this.unidad(tenantId, opciones.propiedadId)
      : null;

    const precio = unidad?.precio ?? opciones.precio ?? null;
    if (precio === null) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'Falta el precio: la unidad no tiene una operación de venta con precio '
        + 'cargado, y no se pasó uno para simular.',
        'Unprocessable Entity',
      );
    }

    try {
      const presupuesto = armarPresupuesto(
        precio, plan,
        // `date` de Postgres nunca por `new Date()`: se arma el texto.
        opciones.desde ?? new Date().toISOString().slice(0, 10),
      );
      return {
        unidad: unidad
          ? { id: unidad.id, codigo: unidad.codigo, supTotal: unidad.supTotal }
          : null,
        plan: { id: plan.id, nombre: plan.nombre },
        presupuesto,
        inversion: analizarInversion(
          presupuesto, unidad?.supTotal ?? null, opciones.comparableTerminado ?? null,
        ),
      };
    } catch (err) {
      if (err instanceof PlanInvalido) {
        throw new AppError(
          422, ErrorCode.VALIDATION_FAILED, err.message, 'Unprocessable Entity',
        );
      }
      throw err;
    }
  }

  private async unidad(tenantId: string, id: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; codigo: number; sup_total: string | null; precio: string | null;
      }>(
        `SELECT p.id, p.codigo, p.sup_total, o.precio
           FROM propiedad p
           LEFT JOIN operacion o ON o.propiedad_id = p.id AND o.tipo = 'venta'
          WHERE p.id = $1`,
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa unidad.');
      const r = rows[0];
      return {
        id: r.id,
        codigo: `PROP-${String(r.codigo).padStart(4, '0')}`,
        supTotal: r.sup_total === null ? null : Number(r.sup_total),
        precio: r.precio === null ? null : Number(r.precio),
      };
    });
  }
}

interface Fila {
  id: string; emprendimiento_id: string | null; nombre: string;
  anticipo_pct: string; cuotas: number; refuerzos: unknown;
  contra_entrega_pct: string; indice: string; moneda: string; activo: boolean;
}

function aPlan(f: Fila): PlanGuardado {
  const plan: PlanPago = {
    nombre: f.nombre,
    anticipoPct: Number(f.anticipo_pct),
    cuotas: f.cuotas,
    refuerzos: (f.refuerzos as Array<{ cuota: number; pct: number }>) ?? [],
    contraEntregaPct: Number(f.contra_entrega_pct),
    indice: f.indice as PlanPago['indice'],
    moneda: f.moneda,
  };
  return {
    ...plan,
    id: f.id,
    emprendimientoId: f.emprendimiento_id,
    activo: f.activo,
    // Se recalcula al leer, no se guarda: un plan válido puede dejar de serlo
    // si alguien edita la cantidad de cuotas y deja un refuerzo colgado.
    problemas: validarPlan(plan),
  };
}

function desdeDto(dto: Record<string, unknown>): PlanPago {
  return {
    nombre: String(dto.nombre ?? ''),
    anticipoPct: Number(dto.anticipoPct ?? 0),
    cuotas: Number(dto.cuotas ?? 0),
    refuerzos: (dto.refuerzos as Array<{ cuota: number; pct: number }>) ?? [],
    contraEntregaPct: Number(dto.contraEntregaPct ?? 0),
    indice: (dto.indice as PlanPago['indice']) ?? 'ninguno',
    moneda: String(dto.moneda ?? 'USD'),
  };
}
