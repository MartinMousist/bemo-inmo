import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * Emprendimientos: la venta en pozo.
 *
 * ── Por qué el resumen se calcula y no se guarda ──
 *
 * Cuántas unidades hay libres, reservadas y vendidas sale de contar las
 * propiedades del emprendimiento. Guardarlo en columnas sería tener el mismo
 * dato en dos lugares y descubrir a los tres meses que no coinciden —el
 * contador dice 12 libres y el listado muestra 9—. Es barato: son 40 unidades,
 * no 40.000.
 */

export interface ResumenEmprendimiento {
  id: string;
  nombre: string;
  direccion: string;
  etapa: string;
  avancePct: number;
  avanceEl: string | null;
  entregaEstimada: string | null;
  entregaOriginal: string | null;
  /** Cuántos meses se corrió la entrega respecto de lo prometido. */
  atrasoMeses: number | null;
  unidades: {
    total: number;
    disponibles: number;
    reservadas: number;
    vendidas: number;
  };
  planes: number;
}

export interface UnidadDelPlano {
  id: string;
  codigo: string;
  piso: string | null;
  depto: string | null;
  tipologia: string | null;
  ambientes: number | null;
  supTotal: number | null;
  coeficiente: number | null;
  /** `disponible` | `reservada` | `vendida` | `sin_operacion` */
  estado: string;
  precio: number | null;
  moneda: string | null;
}

@Injectable()
export class EmprendimientosService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string): Promise<ResumenEmprendimiento[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaResumen>(
        `SELECT e.id, e.nombre, e.calle, e.numero, e.localidad, e.etapa,
                e.avance_pct, e.avance_el, e.entrega_estimada, e.entrega_original,
                count(p.id)::int AS unidades,
                count(*) FILTER (WHERE o.estado = 'disponible')::int AS disponibles,
                count(*) FILTER (WHERE o.estado = 'reservada')::int  AS reservadas,
                count(*) FILTER (WHERE o.estado = 'cerrada')::int    AS vendidas,
                (SELECT count(*)::int FROM plan_pago pp
                  WHERE pp.emprendimiento_id = e.id AND pp.activo) AS planes
           FROM emprendimiento e
           LEFT JOIN propiedad p ON p.emprendimiento_id = e.id
           -- La operación de venta de cada unidad. Puede no existir todavía:
           -- una unidad cargada y sin publicar no tiene operación.
           LEFT JOIN operacion o ON o.propiedad_id = p.id AND o.tipo = 'venta'
          GROUP BY e.id
          ORDER BY e.nombre`,
      );
      return rows.map(aResumen);
    });
  }

  async leer(tenantId: string, id: string): Promise<ResumenEmprendimiento> {
    const todos = await this.listar(tenantId);
    const uno = todos.find((e) => e.id === id);
    if (!uno) throw AppError.notFound('No se encontró ese emprendimiento.');
    return uno;
  }

  /**
   * Las unidades, agrupadas por piso.
   *
   * Es el plano: la grilla que el desarrollador mira a la mañana. Por eso el
   * orden es por piso y después por departamento, y no por código de propiedad
   * —que es el orden en que se cargaron, o sea ninguno—.
   */
  async plano(tenantId: string, id: string): Promise<Array<{ piso: string; unidades: UnidadDelPlano[] }>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaUnidad>(
        `SELECT p.id, p.codigo, p.piso, p.depto, p.tipologia, p.ambientes,
                p.sup_total, p.coeficiente,
                o.estado AS estado_operacion, o.precio, o.moneda
           FROM propiedad p
           LEFT JOIN operacion o ON o.propiedad_id = p.id AND o.tipo = 'venta'
          WHERE p.emprendimiento_id = $1
          -- NULLS FIRST deja arriba la planta baja y los locales, que no tienen
          -- piso cargado. Al final quedarían escondidos abajo de todo.
          -- (Sin comillas invertidas: adentro de un template literal cierran la
          --  cadena. Ya pasó una vez en este repo.)
          ORDER BY p.piso NULLS FIRST, p.depto, p.codigo`,
        [id],
      );

      const porPiso = new Map<string, UnidadDelPlano[]>();
      for (const r of rows) {
        const piso = r.piso ?? 'Planta baja';
        porPiso.set(piso, [...(porPiso.get(piso) ?? []), aUnidad(r)]);
      }
      return [...porPiso.entries()].map(([piso, unidades]) => ({ piso, unidades }));
    });
  }

  async crear(
    tenantId: string,
    dto: Record<string, unknown>,
  ): Promise<ResumenEmprendimiento> {
    const id = await this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO emprendimiento
             (tenant_id, nombre, calle, numero, localidad, provincia, etapa,
              entrega_estimada, entrega_original, descripcion, amenities)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                   -- La entrega ORIGINAL se congela con la primera carga: es
                   -- contra qué se mide el atraso después.
                   $8,$9,$10)
           RETURNING id`,
          [
            tenantId, dto.nombre, dto.calle, dto.numero ?? null,
            dto.localidad ?? null, dto.provincia ?? null, dto.etapa ?? 'pozo',
            dto.entregaEstimada ?? null, dto.descripcion ?? null,
            dto.amenities ?? [],
          ],
        );
        return rows[0].id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            409, ErrorCode.EN_USO,
            `Ya hay un emprendimiento que se llama «${dto.nombre}».`, 'Conflict',
          );
        }
        throw err;
      }
    });
    return this.leer(tenantId, id);
  }

  async editar(
    tenantId: string,
    id: string,
    dto: Record<string, unknown>,
  ): Promise<ResumenEmprendimiento> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE emprendimiento SET
           nombre           = coalesce($2, nombre),
           calle            = coalesce($3, calle),
           numero           = coalesce($4, numero),
           localidad        = coalesce($5, localidad),
           etapa            = coalesce($6, etapa),
           entrega_estimada = coalesce($7, entrega_estimada),
           descripcion      = coalesce($8, descripcion)
         WHERE id = $1`,
        [
          id, dto.nombre ?? null, dto.calle ?? null, dto.numero ?? null,
          dto.localidad ?? null, dto.etapa ?? null,
          dto.entregaEstimada ?? null, dto.descripcion ?? null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese emprendimiento.');
    });
    return this.leer(tenantId, id);
  }

  /**
   * El avance de obra.
   *
   * Va aparte de `editar` porque es lo que se toca seguido —una vez por mes— y
   * porque lleva su fecha: un «65%» sin decir de cuándo no le sirve a nadie que
   * puso plata en algo que todavía no existe.
   */
  async avance(tenantId: string, id: string, pct: number): Promise<ResumenEmprendimiento> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'UPDATE emprendimiento SET avance_pct = $2, avance_el = current_date WHERE id = $1',
        [id, pct],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese emprendimiento.');
    });
    return this.leer(tenantId, id);
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM emprendimiento WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró ese emprendimiento.');
    });
  }

  /** Reutilizable por el importador. */
  async existe(ej: Ejecutor, id: string): Promise<boolean> {
    const { rowCount } = await ej.query('SELECT 1 FROM emprendimiento WHERE id = $1', [id]);
    return Boolean(rowCount);
  }
}

interface FilaResumen {
  id: string; nombre: string; calle: string; numero: string | null;
  localidad: string | null; etapa: string;
  avance_pct: string; avance_el: string | null;
  entrega_estimada: string | null; entrega_original: string | null;
  unidades: number; disponibles: number; reservadas: number; vendidas: number;
  planes: number;
}

interface FilaUnidad {
  id: string; codigo: number; piso: string | null; depto: string | null;
  tipologia: string | null; ambientes: number | null;
  sup_total: string | null; coeficiente: string | null;
  estado_operacion: string | null; precio: string | null; moneda: string | null;
}

function aResumen(f: FilaResumen): ResumenEmprendimiento {
  // `date` de Postgres: se recorta el texto en vez de pasarlo por `Date`, que
  // le inventaría medianoche UTC y correría el día.
  const est = f.entrega_estimada ? String(f.entrega_estimada).slice(0, 10) : null;
  const ori = f.entrega_original ? String(f.entrega_original).slice(0, 10) : null;

  return {
    id: f.id,
    nombre: f.nombre,
    direccion: [f.calle, f.numero, f.localidad].filter(Boolean).join(' '),
    etapa: f.etapa,
    avancePct: Number(f.avance_pct),
    // `date` de Postgres llega como TEXTO, no como Date: se recorta. Pasarlo
    // por `Date` le inventaría medianoche UTC y correría el día — y acá
    // directamente reventaba, porque no hay `toISOString` en un string.
    avanceEl: f.avance_el ? String(f.avance_el).slice(0, 10) : null,
    entregaEstimada: est,
    entregaOriginal: ori,
    atrasoMeses: mesesEntre(ori, est),
    unidades: {
      total: f.unidades,
      disponibles: f.disponibles,
      reservadas: f.reservadas,
      vendidas: f.vendidas,
    },
    planes: f.planes,
  };
}

function aUnidad(f: FilaUnidad): UnidadDelPlano {
  return {
    id: f.id,
    codigo: `PROP-${String(f.codigo).padStart(4, '0')}`,
    piso: f.piso,
    depto: f.depto,
    tipologia: f.tipologia,
    ambientes: f.ambientes,
    supTotal: f.sup_total === null ? null : Number(f.sup_total),
    coeficiente: f.coeficiente === null ? null : Number(f.coeficiente),
    // Sin operación de venta la unidad existe pero no está a la venta. Es
    // distinto de «disponible» y la pantalla lo pinta distinto: una unidad que
    // nadie puso en venta no es una que nadie compró.
    estado: f.estado_operacion ?? 'sin_operacion',
    precio: f.precio === null ? null : Number(f.precio),
    moneda: f.moneda,
  };
}

/** Cuántos meses se corrió la entrega. `null` si falta alguna de las dos. */
export function mesesEntre(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null;
  const [a1, m1] = desde.split('-').map(Number);
  const [a2, m2] = hasta.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}
