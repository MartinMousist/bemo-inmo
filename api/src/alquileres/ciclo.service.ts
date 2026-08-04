import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { round2 } from './ajustes.motor';
import { ContratosService, type Contrato } from './contratos.service';
import type { DevolverDepositoDto, RenovarContratoDto } from './alquileres.dto';

/**
 * El final del contrato: renovarlo y devolver el depósito.
 *
 * Las dos columnas que esto usa —`contrato_anterior_id` y `deposito_devuelto_el`—
 * existían en el schema desde la etapa 4 y **no las escribía nadie**. Renovar era
 * cargar un contrato nuevo a mano y perder la cadena; devolver el depósito no
 * dejaba ningún rastro en el sistema.
 *
 * Van juntas en un servicio aparte porque son el mismo momento: el contrato se
 * termina, y ahí se decide si sigue y qué pasa con la plata retenida.
 */
@Injectable()
export class CicloService {
  constructor(
    private readonly db: DbService,
    private readonly contratos: ContratosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── Renovación ─────────────────────────────────────────────────────────────

  /**
   * Crea el contrato que sigue, con todo lo del anterior ya cargado.
   *
   * Lo que se hereda —partes, índice, periodicidad, honorarios, punitorio,
   * depósito— es lo que en la práctica no cambia. Lo que sí cambia va en el
   * cuerpo: las fechas y el monto, que son la negociación.
   *
   * El anterior queda en `renovado`, no en `vencido`: son cosas distintas. Un
   * contrato vencido es una propiedad que se desocupó; uno renovado es el mismo
   * inquilino que sigue, y esa diferencia cambia lo que hay que hacer con la
   * propiedad.
   */
  async renovar(
    tenantId: string,
    contratoId: string,
    dto: RenovarContratoDto,
    usuarioId: string,
    ip?: string,
  ): Promise<Contrato> {
    // Se lee todo lo que hace falta ANTES de crear, en su propia transacción:
    // `contratos.crear` abre la suya y toma un advisory lock sobre la propiedad.
    const anterior = await this.db.withTenant(tenantId, (ej) => this.leerParaRenovar(ej, contratoId));

    if (anterior.estado === 'renovado') {
      throw new AppError(
        409,
        ErrorCode.OPERACION_DUPLICADA,
        'Ese contrato ya fue renovado. Buscá el contrato que lo sucede.',
        'Conflict',
      );
    }
    if (anterior.estado === 'borrador') {
      throw new AppError(
        422,
        ErrorCode.ESTADO_INVALIDO,
        'Un contrato en borrador no se renueva: todavía no empezó.',
        'Unprocessable Entity',
      );
    }
    if (dto.fechaInicio <= anterior.fecha_fin) {
      // Si se solaparan, el constraint EXCLUDE de la base lo rechazaría igual,
      // pero con un mensaje que habla de rangos y no de lo que pasó.
      throw new AppError(
        422,
        ErrorCode.CONTRATO_SOLAPADO,
        `La renovación tiene que empezar después del ${anterior.fecha_fin}, ` +
          'que es cuando termina el contrato actual.',
        'Unprocessable Entity',
      );
    }

    const nuevo = await this.contratos.crear(tenantId, {
      propiedadId: anterior.propiedad_id,
      operacionId: anterior.operacion_id ?? undefined,
      fechaInicio: dto.fechaInicio,
      fechaFin: dto.fechaFin,
      diaVencimiento: anterior.dia_vencimiento,

      // El monto del nuevo contrato es el que se negoció. Si no lo mandan, se
      // arranca del alquiler VIGENTE —no del inicial del contrato viejo—, que
      // es el que las dos partes vienen pagando.
      montoInicial: dto.montoInicial ?? Number(anterior.monto_vigente),
      moneda: anterior.moneda,

      indice: dto.indice ?? anterior.indice,
      indicePorcentaje:
        anterior.indice_porcentaje === null ? undefined : Number(anterior.indice_porcentaje),
      periodicidadMeses: dto.periodicidadMeses ?? anterior.periodicidad_meses,
      // El mes base del contrato nuevo es el mes en que arranca: el índice se
      // mide desde acá, no desde el contrato anterior. Arrastrarlo aplicaría de
      // nuevo aumentos que ya se aplicaron.
      mesBase: `${dto.fechaInicio.slice(0, 7)}-01`,

      administrado: anterior.administrado,
      deposito: anterior.deposito === null ? undefined : Number(anterior.deposito),
      depositoMoneda: anterior.deposito_moneda,
      honorariosPct: Number(anterior.honorarios_pct),
      punitorioDiarioPct: Number(anterior.punitorio_diario_pct),

      locadores: anterior.locadores,
      locatarios: anterior.locatarios,
      garantes: anterior.garantes,
      notas: dto.notas,
    });

    // El enlace y el cambio de estado, en una transacción aparte y después de
    // que el nuevo exista. El índice único sobre `contrato_anterior_id` impide
    // que dos contratos digan que renuevan al mismo.
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE contrato_alquiler SET contrato_anterior_id = $2 WHERE id = $1`,
        [nuevo.id, contratoId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró el contrato nuevo.');

      await ej.query(
        `UPDATE contrato_alquiler SET estado = 'renovado' WHERE id = $1`,
        [contratoId],
      );

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'contrato_renovado',
        usuarioId,
        entidadTipo: 'contrato_alquiler',
        entidadId: contratoId,
        monto: nuevo.montoInicial,
        moneda: nuevo.moneda,
        ip,
        detalle: {
          contratoNuevoId: nuevo.id,
          montoAnterior: Number(anterior.monto_vigente),
          desde: dto.fechaInicio,
          hasta: dto.fechaFin,
        },
      });

      return { ...nuevo, estado: nuevo.estado };
    });
  }

  /** La cadena completa de renovaciones, del más viejo al más nuevo. */
  async cadena(tenantId: string, contratoId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; fecha_inicio: string; fecha_fin: string;
        monto_inicial: string; moneda: string; estado: string; nivel: number;
      }>(
        // Recursiva en las dos direcciones: se sube hasta el primero y después
        // se baja hasta el último. Un contrato del medio tiene que poder ver la
        // historia entera, no sólo lo que vino después de él.
        `WITH RECURSIVE hacia_atras AS (
           SELECT c.*, 0 AS nivel FROM contrato_alquiler c WHERE c.id = $1
           UNION ALL
           SELECT p.*, h.nivel - 1
             FROM contrato_alquiler p
             JOIN hacia_atras h ON p.id = h.contrato_anterior_id
         ),
         raiz AS (SELECT id FROM hacia_atras ORDER BY nivel LIMIT 1),
         hacia_adelante AS (
           SELECT c.*, 0 AS nivel FROM contrato_alquiler c
            WHERE c.id = (SELECT id FROM raiz)
           UNION ALL
           SELECT s.*, a.nivel + 1
             FROM contrato_alquiler s
             JOIN hacia_adelante a ON s.contrato_anterior_id = a.id
         )
         SELECT id, fecha_inicio, fecha_fin, monto_inicial, moneda, estado, nivel
           FROM hacia_adelante ORDER BY nivel`,
        [contratoId],
      );

      return rows.map((r) => ({
        id: r.id,
        fechaInicio: String(r.fecha_inicio).slice(0, 10),
        fechaFin: String(r.fecha_fin).slice(0, 10),
        montoInicial: Number(r.monto_inicial),
        moneda: r.moneda,
        estado: r.estado,
        esEste: r.id === contratoId,
      }));
    });
  }

  // ── Depósito en garantía ───────────────────────────────────────────────────

  /**
   * Registra la devolución del depósito, con sus descuentos.
   *
   * Se guarda el **detalle** de cada descuento y no sólo el neto: "te devolví
   * menos" sin decir por qué es la palabra de uno contra la del otro, y es la
   * última discusión de todo alquiler.
   */
  async devolverDeposito(
    tenantId: string,
    contratoId: string,
    dto: DevolverDepositoDto,
    usuarioId: string,
    ip?: string,
  ) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        deposito: string | null; deposito_moneda: string;
        deposito_devuelto_el: Date | null; estado: string;
      }>(
        `SELECT deposito, deposito_moneda, deposito_devuelto_el, estado
           FROM contrato_alquiler WHERE id = $1 FOR UPDATE`,
        [contratoId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');

      const c = rows[0];
      if (c.deposito === null || Number(c.deposito) === 0) {
        throw new AppError(
          422,
          ErrorCode.ESTADO_INVALIDO,
          'Este contrato no tiene depósito registrado, así que no hay nada que devolver.',
          'Unprocessable Entity',
        );
      }
      if (c.deposito_devuelto_el) {
        throw new AppError(
          409,
          ErrorCode.OPERACION_DUPLICADA,
          'El depósito de este contrato ya figura devuelto.',
          'Conflict',
        );
      }

      const deposito = Number(c.deposito);
      const descuentos = dto.descuentos ?? [];
      const totalDescuentos = round2(
        descuentos.reduce((a, d) => a + Number(d.monto), 0),
      );
      const devuelto = round2(deposito - totalDescuentos);

      if (devuelto < 0) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          `Los descuentos suman ${totalDescuentos} y el depósito es ${deposito}. ` +
            'No se puede devolver un monto negativo: lo que exceda al depósito se ' +
            'reclama aparte.',
          'Unprocessable Entity',
        );
      }

      await ej.query(
        `UPDATE contrato_alquiler
            SET deposito_devuelto_el = coalesce($2::date, current_date),
                deposito_devuelto_monto = $3,
                deposito_devuelto_por = $4,
                deposito_descuentos = $5::jsonb
          WHERE id = $1`,
        [
          contratoId,
          dto.fecha ?? null,
          devuelto,
          usuarioId,
          JSON.stringify(descuentos),
        ],
      );

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'deposito_devuelto',
        usuarioId,
        entidadTipo: 'contrato_alquiler',
        entidadId: contratoId,
        monto: devuelto,
        moneda: c.deposito_moneda,
        ip,
        detalle: { depositoOriginal: deposito, totalDescuentos, descuentos },
      });

      return {
        contratoId,
        deposito,
        totalDescuentos,
        devuelto,
        moneda: c.deposito_moneda,
        descuentos,
      };
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async leerParaRenovar(ej: Ejecutor, id: string) {
    const { rows } = await ej.query<FilaRenovar>(
      `SELECT c.*,
              coalesce(
                (SELECT a.monto_nuevo FROM contrato_ajuste a
                  WHERE a.contrato_id = c.id
                    AND a.estado IN ('confirmado','notificado','aplicado')
                    AND a.vigente_desde <= current_date
                  ORDER BY a.vigente_desde DESC LIMIT 1),
                c.monto_inicial) AS monto_vigente,
              (SELECT json_agg(json_build_object(
                  'personaId', cp.persona_id, 'rol', cp.rol, 'porcentaje', cp.porcentaje))
                 FROM contrato_parte cp WHERE cp.contrato_id = c.id) AS partes
         FROM contrato_alquiler c WHERE c.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');

    const c = rows[0];
    const partes = c.partes ?? [];
    const porRol = (rol: string) => partes.filter((p) => p.rol === rol);

    return {
      ...c,
      fecha_fin: String(c.fecha_fin).slice(0, 10),
      locadores: porRol('locador').map((p) => ({
        personaId: String(p.personaId),
        porcentaje: p.porcentaje === null ? undefined : Number(p.porcentaje),
      })),
      locatarios: porRol('locatario').map((p) => String(p.personaId)),
      garantes: porRol('garante').map((p) => String(p.personaId)),
    };
  }
}

interface FilaRenovar {
  id: string;
  propiedad_id: string;
  operacion_id: string | null;
  fecha_fin: string;
  dia_vencimiento: number;
  monto_inicial: string;
  monto_vigente: string;
  moneda: string;
  indice: string;
  indice_porcentaje: string | null;
  periodicidad_meses: number;
  administrado: boolean;
  deposito: string | null;
  deposito_moneda: string;
  honorarios_pct: string;
  punitorio_diario_pct: string;
  estado: string;
  partes: Array<{ personaId: string; rol: string; porcentaje: number | null }> | null;
}
