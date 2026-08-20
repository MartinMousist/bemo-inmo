import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { CanalesService } from './canales.service';
import { reglasDe } from './ingesta.service';
import { decidir, REGLAS_POR_DEFECTO, type Decision, type ReglasBot } from './bot.motor';

/**
 * La configuración del bot, por cuenta de canal.
 *
 * ── Por qué por cuenta y no una sola para toda la inmobiliaria ──
 *
 * Porque el número de ventas y el de administración no contestan lo mismo. Al
 * que escribe a ventas hay que rutearlo por tipo de operación; al que escribe a
 * administración, por cuota, expensas o reclamo. Una sola configuración
 * obligaría a que las palabras de los dos convivan y el ruteo se vuelve ruido.
 *
 * ── `probar()` es la mitad de esta feature ──
 *
 * Un bot cuyo comportamiento sólo se descubre cuando le escribe un cliente real
 * es un bot que nadie se anima a tocar. Probar una frase y ver **qué haría y
 * por qué** es lo que convierte esto en algo configurable de verdad. No escribe
 * nada: el motor es puro, así que probar es gratis y no deja rastro.
 */

export interface ConfigBot extends ReglasBot {
  /** Los valores de fábrica, para poder volver atrás. */
  porDefecto: ReglasBot;
}

@Injectable()
export class BotService {
  constructor(
    private readonly db: DbService,
    private readonly canales: CanalesService,
  ) {}

  async leer(tenantId: string, cuentaId: string): Promise<ConfigBot> {
    const cuenta = await this.canales.paraAdaptador(tenantId, cuentaId);
    return { ...reglasDe(cuenta), porDefecto: REGLAS_POR_DEFECTO };
  }

  async guardar(
    tenantId: string,
    cuentaId: string,
    reglas: Partial<ReglasBot>,
  ): Promise<ConfigBot> {
    // Se valida acá y no sólo en el DTO porque una regla vacía deja el bot
    // mudo sin decir por qué: la pantalla tiene que enterarse ahora.
    for (const r of reglas.ruteo ?? []) {
      if (!r.equipo?.trim() || !r.palabras?.length) {
        throw new AppError(
          422, ErrorCode.VALIDATION_FAILED,
          'Cada regla de ruteo necesita un equipo y al menos una palabra.',
          'Unprocessable Entity',
        );
      }
    }

    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE canal_cuenta
            SET config = config || jsonb_build_object('reglas', $2::jsonb)
          WHERE id = $1`,
        [cuentaId, JSON.stringify(reglas)],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa cuenta de canal.');
    });

    return this.leer(tenantId, cuentaId);
  }

  /**
   * Qué haría el bot con esta frase. No manda nada ni guarda nada.
   *
   * Se prueba contra un hilo IMAGINARIO en el estado más común —bot prendido,
   * sin agente asignado— porque lo que se quiere saber es si la regla dispara,
   * no si el bot está pausado en alguna conversación puntual.
   */
  async probar(
    tenantId: string,
    cuentaId: string,
    mensaje: string,
    esPrimerMensaje = false,
  ): Promise<{ decision: Decision; explicacion: string }> {
    const cuenta = await this.canales.paraAdaptador(tenantId, cuentaId);
    const decision = decidir(
      mensaje,
      reglasDe(cuenta),
      { botActivo: true, botPausadoHasta: null, esPrimerMensaje, asignado: false },
      new Date(),
    );

    return { decision, explicacion: explicar(decision) };
  }
}

/** La decisión en castellano, para que la pantalla no la tenga que interpretar. */
function explicar(d: Decision): string {
  switch (d.accion) {
    case 'responder':
      return 'Contesta automáticamente y no avisa a nadie.';
    case 'escalar':
      return d.equipo
        ? `Avisa que hace falta una persona del equipo de ${d.equipo}.`
        : 'Avisa que hace falta una persona, sin equipo definido.';
    case 'avisar':
      return d.clase === 'confirmacion'
        ? 'Lo toma como una confirmación y avisa para que alguien la registre.'
        : 'Lo toma como una cancelación y avisa para que alguien reprograme.';
    case 'callar':
      return 'No hace nada.';
  }
}
