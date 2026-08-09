import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import {
  calcularComisiones,
  cuadra,
  type EntradaComision,
  type Punta,
} from './comisiones.motor';
import {
  aLineas,
  cuadraGuardado,
  hayReparto,
  SELECT_COMISIONES,
  totalesDe,
  type LineaGuardada,
  type TotalesComision,
} from './comisiones.lectura';
import { configEfectiva } from './comisiones.config.service';
import { insertarLineas, pctDeAgente, type SugerenciaReparto } from './ventas.service';
import type { RepartoDto } from './ventas.dto';

/**
 * La comisión del alquiler: la que el sistema nunca generó.
 *
 * `comision.contrato_id` existe desde la migración 008 y **no tenía un solo
 * escritor**. La única fila de comisión de alquiler que había en todo el
 * producto la puso el seed a mano, así que cualquier pantalla que las mostrara
 * habría estado mostrando el dato de una inmobiliaria de demostración.
 *
 * Vive en `ventas/` y no en `alquileres/` porque es el MISMO motor, la misma
 * tabla y el mismo formulario que el reparto de una venta: la única diferencia
 * son las puntas y la base. Ponerlo en `contratos.service.ts` habría duplicado
 * `insertarLineas`, la validación y la lectura, y las dos copias se separan en
 * el primer campo que se agregue.
 *
 * ── Las dos decisiones que definen el cálculo ──
 *
 * **La base es UN MES, y es `monto_inicial`.** No la cuota vigente: si se
 * calculara contra el monto de hoy, cada ajuste por índice recalcularía una
 * comisión que quizás ya se cobró. Es el mismo principio del ajuste confirmado
 * inmutable. El mes que se cobra al firmar es el mes que se firmó.
 *
 * **Se genera con un paso explícito, como en ventas.** Un contrato cargado para
 * probar no puede dejar una comisión proyectada dando vueltas en la caja, y
 * «firmar» y «acordar quién cobra» son dos momentos distintos del mostrador. La
 * pantalla ofrece el botón con todo pre-llenado desde la política de la casa,
 * así que el paso cuesta un clic y no una carga.
 */

export interface ComisionesDeContrato {
  contratoId: string;
  /** Un mes de alquiler: la base del cálculo, congelada al firmar. */
  base: number;
  moneda: string;
  comisiones: LineaGuardada[];
  totales: TotalesComision;
  cuadra: boolean;
  repartida: boolean;
  /** `true` si hay alguna cobrada: el reparto no se puede rehacer. */
  bloqueada: boolean;
}

@Injectable()
export class ComisionesContratoService {
  constructor(private readonly db: DbService) {}

  async leer(tenantId: string, contratoId: string): Promise<ComisionesDeContrato> {
    return this.db.withTenant(tenantId, (ej) => this.leerCon(ej, contratoId));
  }

  /**
   * Calcula y guarda la comisión del contrato.
   *
   * Se recalcula entero cada vez, igual que en ventas: mientras esté proyectada
   * no hay nada que preservar, y reconciliar líneas sería más código para el
   * mismo resultado. Una comisión ya cobrada lo bloquea.
   */
  async repartir(
    tenantId: string,
    contratoId: string,
    dto: RepartoDto,
  ): Promise<ComisionesDeContrato> {
    return this.db.withTenant(tenantId, async (ej) => {
      const c = await this.datosDelContrato(ej, contratoId);

      const { rows: cobradas } = await ej.query(
        `SELECT 1 FROM comision WHERE contrato_id = $1 AND estado = 'cobrada' LIMIT 1`,
        [contratoId],
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
        base: c.montoInicial,
        moneda: c.moneda,
        puntas: dto.puntas as Partial<Record<Punta, number>>,
        externas: dto.externas as EntradaComision['externas'],
        repartoInterno: dto.repartoInterno,
      };

      validarPuntasDeAlquiler(entrada);

      const r = calcularComisiones(entrada);
      if (!cuadra(r)) {
        throw new AppError(
          500,
          ErrorCode.INTERNAL,
          'El reparto de comisiones no cuadra contra el total. No se guardó nada.',
          'Internal Server Error',
        );
      }

      await ej.query('DELETE FROM comision WHERE contrato_id = $1', [contratoId]);
      await insertarLineas(ej, tenantId, { contratoId }, r.lineas);

      return this.leerCon(ej, contratoId);
    });
  }

  /**
   * El reparto que el sistema propone para este contrato.
   *
   * Puntas desde `configEfectiva` de la operación de alquiler de la propiedad
   * —si la propiedad tiene su propio %, gana el de la propiedad—; captador
   * desde `propiedad.agente_captador_id`; cerrador, quien está cargando. Todo
   * editable.
   */
  async sugerir(
    tenantId: string,
    contratoId: string,
    actor: { usuarioId: string },
  ): Promise<SugerenciaReparto> {
    return this.db.withTenant(tenantId, async (ej) => {
      const c = await this.datosDelContrato(ej, contratoId);

      const { config, heredada } = await configEfectiva(ej, tenantId, c.operacionId);
      const captador = await pctDeAgente(
        ej, c.captadorId, config.repartoInterno.captador, 'captador',
      );
      const cerrador = await pctDeAgente(
        ej, actor.usuarioId, config.repartoInterno.cerrador, 'cerrador',
      );

      return {
        base: c.montoInicial,
        moneda: c.moneda,
        puntas: { locataria: config.alquiler.locataria, locadora: config.alquiler.locadora },
        puntasHeredadas: heredada,
        captador: c.captadorId
          ? { ...captador, usuarioId: c.captadorId, nombre: c.captadorNombre ?? '' }
          : null,
        cerrador: { ...cerrador, usuarioId: actor.usuarioId },
        repartoInternoCasa: config.repartoInterno,
      };
    });
  }

  private async datosDelContrato(ej: Ejecutor, contratoId: string) {
    const { rows } = await ej.query<{
      monto_inicial: string;
      moneda: string;
      operacion_id: string | null;
      captador_id: string | null;
      captador_nombre: string | null;
    }>(
      `SELECT c.monto_inicial, c.moneda, c.operacion_id,
              pr.agente_captador_id AS captador_id, cap.nombre AS captador_nombre
         FROM contrato_alquiler c
         JOIN propiedad pr ON pr.id = c.propiedad_id
         LEFT JOIN usuario cap ON cap.id = pr.agente_captador_id
        WHERE c.id = $1`,
      [contratoId],
    );
    if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');

    return {
      montoInicial: Number(rows[0].monto_inicial),
      moneda: rows[0].moneda,
      // Un contrato puede no tener operación asociada —se puede cargar uno
      // viejo sin haberlo publicado—, y entonces no hay override que aplicar.
      operacionId: rows[0].operacion_id,
      captadorId: rows[0].captador_id,
      captadorNombre: rows[0].captador_nombre,
    };
  }

  private async leerCon(ej: Ejecutor, contratoId: string): Promise<ComisionesDeContrato> {
    const c = await this.datosDelContrato(ej, contratoId);
    const { rows } = await ej.query<{ comisiones: Array<Record<string, unknown>> | null }>(
      `SELECT ${SELECT_COMISIONES('c.contrato_id = $1')} AS comisiones`,
      [contratoId],
    );
    const comisiones = aLineas(rows[0]?.comisiones ?? null);

    return {
      contratoId,
      base: c.montoInicial,
      moneda: c.moneda,
      comisiones,
      totales: totalesDe(comisiones),
      cuadra: cuadraGuardado(comisiones),
      repartida: hayReparto(comisiones),
      bloqueada: comisiones.some((l) => l.estado === 'cobrada'),
    };
  }
}

/**
 * Un alquiler se reparte por las puntas locataria y locadora.
 *
 * Mandar `compradora` acá no da error de base —la CHECK las acepta las
 * cuatro— y la comisión saldría con una punta que no existe en un alquiler,
 * imposible de explicar en la liquidación. Se corta con un mensaje que dice
 * cuáles son las buenas.
 */
function validarPuntasDeAlquiler(e: EntradaComision): void {
  const validas = new Set(['locataria', 'locadora']);
  // `Object.keys` sobre el DTO trae las CUATRO puntas: class-transformer arma
  // la instancia con todos los campos declarados, y los que no vinieron quedan
  // en `undefined`. Sin este filtro, cualquier alquiler daría 422 por una
  // «punta compradora» que nadie mandó.
  for (const [p, v] of Object.entries(e.puntas)) {
    if (v === undefined || v === null) continue;
    if (!validas.has(p)) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        `Un alquiler se reparte entre la punta locataria y la locadora; «${p}» es de una venta.`,
        'Unprocessable Entity',
      );
    }
  }

  const conMonto = Object.entries(e.puntas).filter(([, v]) => Number(v) > 0);
  if (!conMonto.length) {
    throw new AppError(
      422,
      ErrorCode.VALIDATION_FAILED,
      'Ninguna punta cobra honorarios: no habría comisión que repartir. La base es ' +
        'un mes de alquiler, así que 100 % es un mes entero.',
      'Unprocessable Entity',
    );
  }

  for (const [punta, externa] of Object.entries(e.externas ?? {})) {
    if (!externa || !externa.porcentaje) continue;
    if (Number(e.puntas[punta as Punta] ?? 0) <= 0) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        `Estás compartiendo la punta ${punta} con «${externa.nombre}», pero esa punta ` +
          'no cobra honorarios: no hay nada que repartir.',
        'Unprocessable Entity',
      );
    }
  }
}
