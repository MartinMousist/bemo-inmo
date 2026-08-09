import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import type { FiltroAvisosDto } from './recordatorios.dto';

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

      // ── Garantías por vencer ──
      //
      // El evento `garantia_por_vencer` estaba declarado en el CHECK de la 010
      // y **nunca lo emitió nadie**: `garantia.vence_el` existía, la pantalla no
      // la cargaba y ningún bloque de acá la miraba. Es el error #3 del playbook
      // en tres capas a la vez, y por eso el campo «Vence el» de la pantalla de
      // garantes va en el mismo movimiento que este bloque: emitir sobre una
      // columna que ninguna pantalla llena es la misma feature fantasma con otra
      // ropa.
      //
      // Sólo contratos VIGENTES. Un seguro de caución que vence en un contrato
      // que ya terminó no hay que renovarlo, y avisarlo es ruido que entrena a
      // la gente a ignorar la bandeja.
      for (const dias of avisos.garantia_por_vencer ?? []) {
        sumar(
          'garantia_por_vencer',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'garantia_por_vencer', 'garantia', g.id,
                    (g.vence_el - $2::int) AS dispara,
                    'Vence la garantía de ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    coalesce(
                      nullif(trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')), ''),
                      nullif(g.detalle, ''),
                      'La garantía')
                      || ' · vence el ' || to_char(g.vence_el, 'DD/MM/YYYY') ||
                      '. Pedí la renovación antes de que el contrato quede sin respaldo.',
                    jsonb_build_object('diasAntes', $2, 'venceEl', g.vence_el,
                                       'tipo', g.tipo, 'contratoId', g.contrato_id)
               FROM garantia g
               JOIN contrato_alquiler c ON c.id = g.contrato_id
               JOIN propiedad pr ON pr.id = c.propiedad_id
               LEFT JOIN persona p ON p.id = g.persona_id
              WHERE c.estado = 'vigente' AND g.vence_el IS NOT NULL
                AND (g.vence_el - $2::int) BETWEEN current_date AND current_date + 400`,
            [tenantId, dias],
          ),
        );
      }

      // ── Revisión del BCRA ──
      //
      // El aviso NO consulta: avisa que hay que consultar. La diferencia es toda
      // la feature. Un cron que le pidiera al BCRA el dato bancario de un
      // garante cada seis meses estaría averiguando la situación crediticia de
      // un tercero sin que nadie se lo pida —el incidente que ya está anotado en
      // docs/CONTINUAR.md, pero a escala y repetido— y encima contra una API con
      // control de tráfico por IP. Acá aparece el aviso, lo aprieta una persona
      // y queda su nombre en `garantia_bcra_consulta.consultado_por`.
      //
      // La ventana arranca 180 días ANTES de hoy, al revés que las otras: una
      // revisión que venció hace dos meses sigue estando vencida, y si el
      // generador no corrió ese día el aviso no puede perderse para siempre.
      for (const dias of avisos.garantia_revision_bcra ?? []) {
        sumar(
          'garantia_revision_bcra',
          await this.insertar(
            ej,
            tenantId,
            `SELECT 'garantia_revision_bcra', 'garantia', g.id,
                    (g.bcra_revisar_el - $2::int) AS dispara,
                    'Revisar el BCRA del garante de ' || trim(pr.calle || ' ' || coalesce(pr.numero,'')),
                    coalesce(
                      nullif(trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')), ''),
                      'El garante')
                      || ': la última consulta es del ' ||
                      to_char(g.bcra_consultado_el, 'DD/MM/YYYY') ||
                      '. Volvé a consultarlo desde el contrato.',
                    jsonb_build_object('diasAntes', $2, 'revisarEl', g.bcra_revisar_el,
                                       'situacionAnterior', g.bcra_situacion,
                                       'contratoId', g.contrato_id)
               FROM garantia g
               JOIN contrato_alquiler c ON c.id = g.contrato_id
               JOIN propiedad pr ON pr.id = c.propiedad_id
               LEFT JOIN persona p ON p.id = g.persona_id
              WHERE c.estado = 'vigente' AND g.bcra_revisar_el IS NOT NULL
                -- La fecha de revisión se calcula al consultar, con el
                -- vencimiento de la garantía que había ESE día. Si después
                -- alguien lo adelanta, la fecha guardada queda del otro lado y
                -- el aviso pediría revisar una garantía ya vencida. Se vuelve a
                -- comprobar acá, contra el dato de hoy.
                AND (g.vence_el IS NULL OR g.bcra_revisar_el <= g.vence_el)
                AND (g.bcra_revisar_el - $2::int)
                    BETWEEN current_date - 180 AND current_date + 400`,
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
  /**
   * Antes esto tenía un `LIMIT 200` pelado. Eso no es paginar: es truncar en
   * silencio — la pantalla mostraba 200 avisos y no había forma de saber que
   * había un aviso 201, ni de llegar a él. Ahora el total viene en la respuesta.
   */
  async bandeja(tenantId: string, f: FiltroAvisosDto): Promise<Pagina<Evento>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [f.futuros ?? false, f.tipo ?? null, q];

      const donde = `
        WHERE estado IN ('pendiente','enviado')
          AND ($1::boolean OR dispara_el <= current_date)
          AND ($2::text IS NULL OR tipo = $2)
          AND ($3::text IS NULL OR titulo ILIKE $3 OR detalle ILIKE $3)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM evento_programado ${donde}`,
        params,
      );

      const { rows } = await ej.query<{
        id: string; tipo: string; titulo: string; detalle: string | null;
        dispara_el: string; estado: string; canal: string;
        entidad_tipo: string; entidad_id: string;
      }>(
        `SELECT id, tipo, titulo, detalle, dispara_el, estado, canal,
                entidad_tipo, entidad_id
           FROM evento_programado
         ${donde}
          ORDER BY dispara_el, created_at
          LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      const items = rows.map((r) => ({
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

      return armarPagina(items, Number(conteo[0].total), f);
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
