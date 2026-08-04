import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError } from '../common/app-error';

export interface Evento {
  id: string;
  tipo: string;
  titulo: string;
  detalle: string | null;
  disparaEl: string;
  estado: string;
  canal: string;
  entidadTipo: string;
  entidadId: string;
}

/**
 * Recordatorios.
 *
 * El generador es **idempotente por diseño**: la clave única
 * `(tipo, entidad, fecha, canal)` hace que correrlo dos veces el mismo día no
 * duplique un aviso. Eso importa porque va a correr en un cron y los crons se
 * reintentan.
 *
 * Los avisos se generan **por adelantado**, no cuando el hecho ocurre: un
 * contrato que vence en 90 días genera hoy su evento con `dispara_el` a 90 días.
 * Así la bandeja muestra lo que viene y no sólo lo que ya pasó.
 *
 * ⚠️ El ENVÍO por email y WhatsApp todavía no existe. Los eventos se generan y
 * se ven en la app; `canal: 'app'` es el único que funciona hoy. WhatsApp
 * Business Cloud API necesita verificación de negocio y plantillas aprobadas, y
 * eso es un trámite, no código. Cuando esté, se agrega un despachador y los
 * eventos ya generados salen solos.
 */
@Injectable()
export class RecordatoriosService {
  private readonly logger = new Logger('Recordatorios');

  constructor(private readonly db: DbService) {}

  /**
   * Recorre lo que vence y crea los eventos que falten.
   * Devuelve cuántos creó por tipo.
   */
  async generar(tenantId: string): Promise<Record<string, number>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: cfg } = await ej.query<{ avisos: Record<string, number[]> }>(
        'SELECT avisos FROM tenant WHERE id = $1',
        [tenantId],
      );
      const avisos = cfg[0]?.avisos ?? {};

      const creados: Record<string, number> = {};
      const sumar = (tipo: string, n: number) => {
        creados[tipo] = (creados[tipo] ?? 0) + n;
      };

      // ── Contratos por vencer ──
      for (const dias of avisos.contrato_por_vencer ?? []) {
        sumar(
          'contrato_por_vencer',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'contrato_por_vencer', 'contrato', c.id,
                    (c.fecha_fin - $2::int) AS dispara,
                    'Vence el contrato de ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    'En ' || $2::text || ' días. Definí si se renueva o se recupera la unidad.',
                    jsonb_build_object('diasAntes', $2, 'fechaFin', c.fecha_fin)
               FROM contrato_alquiler c
               JOIN propiedad pr ON pr.id = c.propiedad_id
              WHERE c.estado = 'vigente'
                AND (c.fecha_fin - $2::int) BETWEEN current_date AND current_date + 400`,
            [tenantId, dias],
          ),
        );
      }

      // ── Ajustes por aplicar ──
      for (const dias of avisos.ajuste_por_aplicar ?? []) {
        sumar(
          'ajuste_por_aplicar',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'ajuste_por_aplicar', 'ajuste', a.id,
                    (a.vigente_desde - $2::int) AS dispara,
                    'Aumento de ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    a.moneda || ' ' || to_char(a.monto_anterior, 'FM999G999G999D00') ||
                      ' → ' || a.moneda || ' ' || to_char(a.monto_nuevo, 'FM999G999G999D00'),
                    jsonb_build_object('diasAntes', $2, 'montoNuevo', a.monto_nuevo,
                                       'estado', a.estado)
               FROM contrato_ajuste a
               JOIN contrato_alquiler c ON c.id = a.contrato_id
               JOIN propiedad pr ON pr.id = c.propiedad_id
              WHERE a.estado IN ('proyectado','confirmado')
                AND (a.vigente_desde - $2::int) BETWEEN current_date - 30 AND current_date + 400`,
            [tenantId, dias],
          ),
        );
      }

      // ── Reservas por vencer ──
      for (const dias of avisos.reserva_por_vencer ?? []) {
        sumar(
          'reserva_por_vencer',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'reserva_por_vencer', 'reserva', r.id,
                    (r.vence_el - $2::int) AS dispara,
                    'Vence la reserva de ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    'Seña de ' || r.moneda || ' ' || to_char(r.monto, 'FM999G999G999D00'),
                    jsonb_build_object('diasAntes', $2)
               FROM reserva r
               JOIN operacion o ON o.id = r.operacion_id
               JOIN propiedad pr ON pr.id = o.propiedad_id
              WHERE r.estado = 'activa' AND r.vence_el IS NOT NULL
                AND (r.vence_el - $2::int) BETWEEN current_date AND current_date + 400`,
            [tenantId, dias],
          ),
        );
      }

      // ── Cuotas impagas ──
      // Acá los días van HACIA ADELANTE del vencimiento: se avisa el día que
      // vence y después a los 5 y 15 de mora.
      for (const dias of avisos.cuota_impaga ?? []) {
        sumar(
          'cuota_impaga',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'cuota_impaga', 'periodo', p.id,
                    (p.vence_el + $2::int) AS dispara,
                    'Cuota impaga · ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    to_char(p.periodo, 'MM/YYYY') || ' · ' || p.moneda || ' ' ||
                      to_char(p.total, 'FM999G999G999D00'),
                    jsonb_build_object('diasMora', $2, 'total', p.total)
               FROM periodo_alquiler p
               JOIN contrato_alquiler c ON c.id = p.contrato_id
               JOIN propiedad pr ON pr.id = c.propiedad_id
              WHERE p.estado IN ('pendiente','parcial','vencido')
                AND (p.vence_el + $2::int) BETWEEN current_date - 90 AND current_date + 400`,
            [tenantId, dias],
          ),
        );
      }

      return creados;
    });
  }

  /**
   * El INSERT ... SELECT con ON CONFLICT DO NOTHING es lo que hace idempotente
   * a todo esto: si el evento ya existe, no pasa nada.
   */
  private async insertar(
    ej: Ejecutor,
    tenantId: string,
    select: string,
    params: unknown[],
  ): Promise<number> {
    const { rowCount } = await ej.query(
      `INSERT INTO evento_programado
         (tenant_id, tipo, entidad_tipo, entidad_id, dispara_el, titulo, detalle, payload)
       SELECT $1, x.* FROM (${select}) AS x(tipo, entidad_tipo, entidad_id, dispara_el,
                                            titulo, detalle, payload)
       ON CONFLICT (tipo, entidad_id, dispara_el, canal) DO NOTHING`,
      params,
    );
    return rowCount ?? 0;
  }

  /** La bandeja: lo que hay que mirar hoy. */
  async bandeja(tenantId: string, incluirFuturos = false): Promise<Evento[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; tipo: string; titulo: string; detalle: string | null;
        dispara_el: string; estado: string; canal: string;
        entidad_tipo: string; entidad_id: string;
      }>(
        `SELECT id, tipo, titulo, detalle, dispara_el, estado, canal,
                entidad_tipo, entidad_id
           FROM evento_programado
          WHERE estado IN ('pendiente','enviado')
            AND ($1::boolean OR dispara_el <= current_date)
          ORDER BY dispara_el, created_at
          LIMIT 200`,
        [incluirFuturos],
      );

      return rows.map((r) => ({
        id: r.id,
        tipo: r.tipo,
        titulo: r.titulo,
        detalle: r.detalle,
        disparaEl: r.dispara_el,
        estado: r.estado,
        canal: r.canal,
        entidadTipo: r.entidad_tipo,
        entidadId: r.entidad_id,
      }));
    });
  }

  async marcarVisto(tenantId: string, id: string): Promise<{ id: string; estado: string }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE evento_programado SET estado = 'visto', visto_el = now()
          WHERE id = $1 AND estado IN ('pendiente','enviado')`,
        [id],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese aviso.');
      return { id, estado: 'visto' };
    });
  }

  /**
   * Cancela los avisos de una entidad que dejó de tener sentido: un contrato
   * renovado, una cuota que se pagó, una reserva que se convirtió.
   */
  async cancelarDe(tenantId: string, entidadId: string): Promise<number> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE evento_programado SET estado = 'cancelado'
          WHERE entidad_id = $1 AND estado = 'pendiente'`,
        [entidadId],
      );
      return rowCount ?? 0;
    });
  }

  /** Capacidades reales de envío. La UI lo muestra tal cual. */
  canales() {
    return [
      { canal: 'app', disponible: true, detalle: 'Bandeja dentro del sistema' },
      {
        canal: 'email',
        disponible: false,
        detalle: 'Falta configurar el proveedor de correo',
      },
      {
        canal: 'whatsapp',
        disponible: false,
        detalle:
          'WhatsApp Business Cloud API requiere verificación de negocio y plantillas aprobadas',
      },
    ];
  }
}
