import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, PaginacionDto, type Pagina } from '../common/paginacion';
import { IndicesService } from './indices.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { GarantesService } from '../garantes/garantes.service';
import { DocumentosService } from '../plantillas/documentos.service';
import { calcularPunitorio } from './punitorios.motor';
import {
  AjusteImposible,
  calcularAjuste,
  periodosDeAjuste,
  round2,
  sumarMeses,
  type TipoIndice,
} from './ajustes.motor';
import type {
  CrearContratoDto,
  FiltroContratosDto,
  FiltroVencimientosDto,
  RegistrarCobroDto,
} from './alquileres.dto';

export interface Contrato {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  fechaInicio: string;
  fechaFin: string;
  diaVencimiento: number;
  montoInicial: number;
  montoVigente: number;
  moneda: string;
  indice: TipoIndice;
  indicePorcentaje: number | null;
  periodicidadMeses: number;
  mesBase: string;
  administrado: boolean;
  honorariosPct: number;
  estado: string;
  locadores: Array<{ personaId: string; nombre: string; porcentaje: number | null }>;
  locatarios: Array<{ personaId: string; nombre: string }>;
  garantes: Array<{ personaId: string; nombre: string }>;
  proximoAjuste: string | null;
  diasParaVencer: number;
}

@Injectable()
export class ContratosService {
  private readonly logger = new Logger('Contratos');

  constructor(
    private readonly db: DbService,
    private readonly indices: IndicesService,
    private readonly auditoria: AuditoriaService,
    // Sólo para `resumenFicha()`: el veredicto de «garantía apta» vive en
    // `verificar()` y no se copia acá. No hay ciclo — `GarantesService` no sabe
    // de contratos — pero si algún día lo supiera, esto es lo primero a mirar.
    private readonly garantes: GarantesService,
    // Para que el contrato nuevo nazca con su pre-contrato escrito. Tampoco hay
    // ciclo: `DocumentosService` habla con `PlantillasService` y con la base, y
    // no sabe que existe este servicio.
    private readonly documentos: DocumentosService,
  ) {}

  // ── Contratos ──────────────────────────────────────────────────────────────

  async listar(tenantId: string, f: FiltroContratosDto): Promise<Pagina<Contrato>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.estado ?? null, f.agenteId ?? null];

      // `agenteId` acá es el CAPTADOR de la propiedad, no «el agente del
      // contrato»: `contrato_alquiler` no tiene columna de agente propia, así
      // que lo único que la base sabe es quién captó el inmueble. Quien colocó
      // el inquilino no siempre es esa persona, y por eso la pantalla rotula la
      // columna «Captador». Decirle «Agente» sería afirmar algo que el dato no
      // dice.
      const donde = `
        WHERE ($1::text IS NULL OR pr.calle ILIKE $1 OR pr.localidad ILIKE $1)
          AND ($2::text IS NULL OR c.estado = $2)
          AND ($3::uuid IS NULL OR pr.agente_captador_id = $3)`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM contrato_alquiler c
           JOIN propiedad pr ON pr.id = c.propiedad_id ${donde}`,
        params,
      );

      const { rows } = await ej.query<FilaContrato>(
        `${SELECT_CONTRATO} ${donde}
         ORDER BY c.fecha_fin
         LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aContrato), Number(conteo[0].total), f);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Contrato> {
    return this.db.withTenant(tenantId, (ej) => this.leer(ej, id));
  }

  /**
   * Un contrato nuevo, con su pre-contrato ya escrito.
   *
   * El documento se genera DESPUÉS y FUERA de la transacción, a propósito y por
   * dos razones distintas:
   *
   * · **Fuera**, porque `DocumentosService.crear()` abre su propio `withTenant`.
   *   Anidarlos tomaría dos conexiones del pool para el mismo request y, con
   *   varios contratos cargándose a la vez, es la clase de cosa que agota el
   *   pool un martes a las seis de la tarde.
   * · **Después y sin poder fallar**, porque el contrato es el hecho legal y el
   *   documento es una comodidad. Si no hay plantilla o el motor se queja, el
   *   contrato igual quedó guardado: se registra el motivo y la ficha lo dice.
   *   Al revés —perder un contrato porque no se pudo armar un papel— sería
   *   absurdo.
   */
  async crear(
    tenantId: string,
    dto: CrearContratoDto,
    usuarioId?: string,
  ): Promise<Contrato> {
    const contrato = await this.crearContrato(tenantId, dto);

    if (usuarioId) {
      try {
        await this.documentos.generarPreContrato(tenantId, usuarioId, contrato.id);
      } catch (err) {
        this.logger.warn(
          `El contrato ${contrato.id} se creó pero su pre-contrato no: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return contrato;
  }

  private async crearContrato(tenantId: string, dto: CrearContratoDto): Promise<Contrato> {
    return this.db.withTenant(tenantId, async (ej) => {
      // Serializa la creación de contratos sobre la misma propiedad ANTES de
      // tocar el constraint EXCLUDE. Sin esto, dos transacciones esperándose
      // pueden ciclar y Postgres mata una con deadlock, que el cliente ve como
      // un 500 en vez del 409 que corresponde.
      await ej.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        dto.propiedadId,
      ]);

      let contratoId: string;
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO contrato_alquiler (
             tenant_id, propiedad_id, operacion_id, fecha_inicio, fecha_fin,
             dia_vencimiento, monto_inicial, moneda, indice, indice_porcentaje,
             periodicidad_meses, mes_base, administrado, deposito, deposito_moneda,
             honorarios_pct, punitorio_diario_pct, punitorio_para, estado, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          [
            tenantId, dto.propiedadId, dto.operacionId ?? null,
            dto.fechaInicio, dto.fechaFin, dto.diaVencimiento ?? 10,
            dto.montoInicial, dto.moneda, dto.indice ?? 'ipc',
            dto.indicePorcentaje ?? null, dto.periodicidadMeses ?? 3,
            // Por defecto el mes base es el del inicio: es contra ese índice
            // que se mide el primer aumento.
            dto.mesBase ?? primerDia(dto.fechaInicio),
            dto.administrado ?? true,
            dto.deposito ?? null, dto.depositoMoneda ?? dto.moneda,
            dto.honorariosPct ?? 0, dto.punitorioDiarioPct ?? 0,
            dto.punitorioPara ?? 'propietario',
            dto.estado ?? 'vigente', dto.notas ?? null,
          ],
        );
        contratoId = rows[0].id;
      } catch (err) {
        if (codigoPg(err) === '23P01') {
          throw new AppError(
            409,
            ErrorCode.CONTRATO_SOLAPADO,
            'Esa propiedad ya tiene un contrato vigente que se superpone con esas fechas.',
            'Conflict',
          );
        }
        if (codigoPg(err) === '23503') {
          throw AppError.notFound('No se encontró la propiedad.');
        }
        throw err;
      }

      await this.guardarPartes(ej, tenantId, contratoId, dto);

      // La operación de alquiler queda cerrada: la propiedad dejó de ofrecerse.
      if (dto.operacionId) {
        await ej.query(
          `UPDATE operacion SET estado = 'cerrada' WHERE id = $1`,
          [dto.operacionId],
        );
      }

      return this.leer(ej, contratoId);
    });
  }

  private async guardarPartes(
    ej: Ejecutor,
    tenantId: string,
    contratoId: string,
    dto: CrearContratoDto,
  ): Promise<void> {
    const filas: Array<[string, string, number | null]> = [];
    for (const l of dto.locadores ?? []) filas.push([l.personaId, 'locador', l.porcentaje ?? null]);
    for (const l of dto.locatarios ?? []) filas.push([l, 'locatario', null]);
    for (const g of dto.garantes ?? []) filas.push([g, 'garante', null]);

    // Un solo INSERT para todas las partes. Un contrato con tres locadores en
    // condominio, dos locatarios y dos garantes eran siete viajes a la base.
    if (filas.length) {
      await ej.query(
        `INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol, porcentaje)
         SELECT $1, $2, x.persona_id, x.rol, x.porcentaje
           FROM unnest($3::uuid[], $4::text[], $5::numeric[])
                AS x(persona_id, rol, porcentaje)
         ON CONFLICT (contrato_id, persona_id, rol) DO NOTHING`,
        [
          tenantId,
          contratoId,
          filas.map((f) => f[0]),
          filas.map((f) => f[1]),
          filas.map((f) => f[2]),
        ],
      );
    }

    // Si no vinieron locadores, se toman los titulares de la propiedad con su
    // porcentaje de condominio. Es lo correcto en el 90% de los casos y evita
    // cargar dos veces el mismo dato.
    if (!dto.locadores?.length) {
      await ej.query(
        `INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol, porcentaje)
         SELECT $1, $2, t.persona_id, 'locador', t.porcentaje
           FROM titularidad t
           JOIN contrato_alquiler c ON c.id = $2
          WHERE t.propiedad_id = c.propiedad_id
         ON CONFLICT DO NOTHING`,
        [tenantId, contratoId],
      );
    }
  }

  // ── Ajustes ────────────────────────────────────────────────────────────────

  /**
   * Proyecta los ajustes que le faltan al contrato hasta hoy + un período.
   *
   * Sale como `proyectado`: hasta que una persona lo confirma, no se notifica ni
   * se aplica a ninguna cuota. El sistema calcula; la decisión de mandarlo es de
   * alguien que se hace cargo.
   */
  async proyectarAjustes(
    tenantId: string,
    contratoId: string,
  ): Promise<{ creados: number; sinIndice: string[] }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const c = await this.crudo(ej, contratoId);

      if (c.indice === 'ninguno') {
        throw new AppError(
          422,
          ErrorCode.SIN_AJUSTE,
          'Este contrato no tiene actualización: el monto es fijo por todo el plazo.',
          'Unprocessable Entity',
        );
      }

      const { rows: existentes } = await ej.query<{ vigente_desde: Date }>(
        'SELECT vigente_desde FROM contrato_ajuste WHERE contrato_id = $1',
        [contratoId],
      );
      const yaHay = new Set(existentes.map((e) => iso(e.vigente_desde)));

      // Se proyecta hasta un período por delante de hoy: más allá, los índices
      // ni siquiera existen todavía.
      const limite = sumarMeses(hoyPrimerDia(), c.periodicidad_meses);

      // Qué meses se ajustan, contra qué índice y dónde se corta: eso es cálculo
      // puro y vive en el motor, que es donde se testea con casos de papel y de
      // donde lo toma también el seed. Acá abajo queda sólo lo que necesita la
      // base.
      const cadena = periodosDeAjuste(
        c.fecha_inicio, c.fecha_fin, c.periodicidad_meses, iso(c.mes_base), limite,
      );

      let creados = 0;
      const sinIndice: string[] = [];
      let montoVigente = Number(c.monto_inicial);
      /**
       * Re-ancla de la cadena. `null` = la cadena del motor sirve tal cual.
       *
       * Es el pedazo que NO se puede extraer al motor puro: un ajuste que ya
       * está en la base —cargado a mano, o migrado— puede tener otro período
       * base, y a partir de ahí toda la cadena se corre. Esto es estado, no
       * cuenta. Está comentado igual del otro lado, en `periodosDeAjuste()`.
       */
      let anclado: string | null = null;

      for (const p of cadena) {
        const fecha = p.vigenteDesde;

        if (yaHay.has(fecha)) {
          // Ya existe: se toma su monto como base para el siguiente.
          const { rows } = await ej.query<{ monto_nuevo: string; periodo_actual: string | null }>(
            'SELECT monto_nuevo, periodo_actual FROM contrato_ajuste WHERE contrato_id = $1 AND vigente_desde = $2',
            [contratoId, fecha],
          );
          montoVigente = Number(rows[0].monto_nuevo);
          if (rows[0].periodo_actual) anclado = iso(rows[0].periodo_actual);
          continue;
        }

        const periodoBase = anclado ?? p.periodoBase;
        const periodoActual = p.periodoActual;

        let valorBase: number | null = null;
        let valorActual: number | null = null;
        if (c.indice !== 'porcentaje_fijo') {
          valorBase = await this.indices.valor(c.indice, periodoBase);
          valorActual = await this.indices.valor(c.indice, periodoActual);
          if (valorBase === null || valorActual === null) {
            sinIndice.push(fecha);
            break; // sin este ajuste no se puede encadenar el siguiente
          }
        }

        let r;
        try {
          r = calcularAjuste({
            montoVigente,
            moneda: c.moneda,
            indice: c.indice,
            indicePorcentaje: c.indice_porcentaje ? Number(c.indice_porcentaje) : null,
            valorBase,
            valorActual,
            periodoBase,
            periodoActual,
          });
        } catch (err) {
          if (err instanceof AjusteImposible) {
            sinIndice.push(fecha);
            break;
          }
          throw err;
        }

        await ej.query(
          `INSERT INTO contrato_ajuste (
             tenant_id, contrato_id, vigente_desde, periodo_base, periodo_actual,
             indice_tipo, valor_base, valor_actual, coeficiente,
             monto_anterior, monto_nuevo, moneda, memoria)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            tenantId, contratoId, fecha,
            c.indice === 'porcentaje_fijo' ? null : periodoBase,
            c.indice === 'porcentaje_fijo' ? null : periodoActual,
            c.indice, valorBase, valorActual, r.coeficiente,
            montoVigente, r.montoNuevo, c.moneda,
            JSON.stringify({ ...r.memoria, explicacion: r.explicacion }),
          ],
        );

        creados++;
        montoVigente = r.montoNuevo;
        // El ancla acompaña: si venía re-anclada por un ajuste existente, el
        // siguiente tiene que seguir esa cadena y no la del motor.
        anclado = periodoActual;
      }

      return { creados, sinIndice };
    });
  }

  async confirmarAjuste(
    tenantId: string,
    ajusteId: string,
    usuarioId: string,
    ip?: string,
  ): Promise<{ id: string; estado: string; montoNuevo: number }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        estado: string; monto_nuevo: string; monto_anterior: string;
        moneda: string; contrato_id: string; vigente_desde: string;
      }>(
        `UPDATE contrato_ajuste
            SET estado = 'confirmado', confirmado_por = $2, confirmado_el = now()
          WHERE id = $1 AND estado = 'proyectado'
          RETURNING estado, monto_nuevo, monto_anterior, moneda, contrato_id, vigente_desde`,
        [ajusteId, usuarioId],
      );

      if (!rows.length) {
        const existe = await ej.query('SELECT 1 FROM contrato_ajuste WHERE id = $1', [ajusteId]);
        throw existe.rowCount
          ? new AppError(
              409,
              ErrorCode.AJUSTE_YA_CONFIRMADO,
              'Ese ajuste ya estaba confirmado. Un ajuste confirmado no se recalcula.',
              'Conflict',
            )
          : AppError.notFound('No se encontró ese ajuste.');
      }

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'ajuste_confirmado',
        usuarioId,
        entidadTipo: 'contrato_ajuste',
        entidadId: ajusteId,
        monto: Number(rows[0].monto_nuevo),
        moneda: rows[0].moneda,
        ip,
        detalle: {
          contratoId: rows[0].contrato_id,
          montoAnterior: Number(rows[0].monto_anterior),
          vigenteDesde: iso(rows[0].vigente_desde),
        },
      });

      return { id: ajusteId, estado: rows[0].estado, montoNuevo: Number(rows[0].monto_nuevo) };
    });
  }

  async listarAjustes(tenantId: string, contratoId: string, f: PaginacionDto) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: conteo } = await ej.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM contrato_ajuste WHERE contrato_id = $1',
        [contratoId],
      );

      const { rows } = await ej.query(
        `SELECT id, vigente_desde AS "vigenteDesde", indice_tipo AS "indiceTipo",
                periodo_base AS "periodoBase", periodo_actual AS "periodoActual",
                valor_base AS "valorBase", valor_actual AS "valorActual",
                coeficiente, monto_anterior AS "montoAnterior",
                monto_nuevo AS "montoNuevo", moneda, estado,
                memoria->>'explicacion' AS explicacion,
                confirmado_el AS "confirmadoEl", notificado_el AS "notificadoEl"
           FROM contrato_ajuste
          WHERE contrato_id = $1
          ORDER BY vigente_desde
          LIMIT $2 OFFSET $3`,
        [contratoId, f.porPagina, offset(f)],
      );

      const items = rows.map((r) => ({
        ...r,
        valorBase: r.valorBase === null ? null : Number(r.valorBase),
        valorActual: r.valorActual === null ? null : Number(r.valorActual),
        coeficiente: Number(r.coeficiente),
        montoAnterior: Number(r.montoAnterior),
        montoNuevo: Number(r.montoNuevo),
      }));

      return armarPagina(items, Number(conteo[0].total), f);
    });
  }

  // ── Períodos ───────────────────────────────────────────────────────────────

  /**
   * Genera las cuotas del contrato hasta el mes indicado. Idempotente: correrlo
   * dos veces no duplica nada, porque `(contrato, periodo)` es único y se usa
   * ON CONFLICT DO NOTHING.
   */
  async generarPeriodos(
    tenantId: string,
    contratoId: string,
    hasta?: string,
  ): Promise<{ creados: number }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const c = await this.crudo(ej, contratoId);

      if (!c.administrado) {
        throw new AppError(
          422,
          ErrorCode.NO_ADMINISTRADO,
          'Este contrato es sólo de intermediación: no genera cuotas mensuales.',
          'Unprocessable Entity',
        );
      }

      const tope = hasta ? primerDia(hasta) : hoyPrimerDia();
      const { rows: ajustes } = await ej.query<{ vigente_desde: string; monto_nuevo: string }>(
        `SELECT vigente_desde, monto_nuevo FROM contrato_ajuste
          WHERE contrato_id = $1 AND estado IN ('confirmado','notificado','aplicado')
          ORDER BY vigente_desde`,
        [contratoId],
      );

      const expensas = Number(c.expensas ?? 0);
      let creados = 0;

      for (
        let p = iso(c.fecha_inicio) <= tope ? primerDia(iso(c.fecha_inicio)) : null;
        p && p <= tope && p <= iso(c.fecha_fin);
        p = sumarMeses(p, 1)
      ) {
        // El monto del período es el del último ajuste CONFIRMADO cuya vigencia
        // ya empezó. Los proyectados no cuentan: todavía no los aprobó nadie.
        let monto = Number(c.monto_inicial);
        for (const a of ajustes) {
          if (iso(a.vigente_desde) <= p) monto = Number(a.monto_nuevo);
        }

        const total = round2(monto + expensas);
        const vence = venceEl(p, c.dia_vencimiento);

        const { rowCount } = await ej.query(
          `INSERT INTO periodo_alquiler
             (tenant_id, contrato_id, periodo, vence_el, monto_alquiler, expensas, total, moneda)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (contrato_id, periodo) DO NOTHING`,
          [tenantId, contratoId, p, vence, monto, expensas, total, c.moneda],
        );
        creados += rowCount ?? 0;
      }

      // Marca vencidas las que pasaron su fecha sin pagarse.
      await ej.query(
        `UPDATE periodo_alquiler SET estado = 'vencido'
          WHERE contrato_id = $1 AND estado = 'pendiente' AND vence_el < current_date`,
        [contratoId],
      );

      return { creados };
    });
  }

  async listarPeriodos(tenantId: string, contratoId: string, f: PaginacionDto) {
    return this.db.withTenant(tenantId, async (ej) => {
      // Crece con el TIEMPO, no con la cartera: un contrato de tres años son 36
      // cuotas y uno de diez, 120. No se rompe mañana, pero tampoco tiene techo.
      const { rows: conteo } = await ej.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM periodo_alquiler WHERE contrato_id = $1',
        [contratoId],
      );

      const { rows } = await ej.query<FilaPeriodo>(
        `SELECT p.id, p.periodo, p.vence_el AS "venceEl",
                p.monto_alquiler AS "montoAlquiler", p.expensas, p.otros,
                p.total, p.moneda, p.estado,
                p.punitorio_cobrado AS "punitorioCobrado",
                p.punitorio_condonado_el AS "punitorioCondonadoEl",
                p.punitorio_condonado_motivo AS "punitorioCondonadoMotivo",
                c.punitorio_diario_pct AS "tasaPunitoria",
                coalesce((SELECT sum(co.monto) FROM cobro co
                           WHERE co.periodo_id = p.id
                             AND co.imputacion = 'alquiler'), 0) AS cobrado
           FROM periodo_alquiler p
           JOIN contrato_alquiler c ON c.id = p.contrato_id
          WHERE p.contrato_id = $1
          ORDER BY p.periodo DESC
          LIMIT $2 OFFSET $3`,
        [contratoId, f.porPagina, offset(f)],
      );
      return armarPagina(rows.map(aPeriodo), Number(conteo[0].total), f);
    });
  }

  /**
   * Perdona el interés por mora de una cuota.
   *
   * Es una decisión comercial de todos los días —el inquilino bueno que se
   * atrasó una semana— y **deja rastro**: es plata que alguien resigna en nombre
   * del propietario, así que queda quién, cuándo y por qué.
   */
  async condonarPunitorio(
    tenantId: string,
    periodoId: string,
    motivo: string,
    usuarioId: string,
    ip?: string,
  ) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; vence_el: string; total: string; moneda: string;
        tasa: string; condonado_el: Date | null; contrato_id: string; cobrado: string;
      }>(
        `SELECT p.id, p.vence_el, p.total, p.moneda, p.contrato_id,
                c.punitorio_diario_pct AS tasa,
                p.punitorio_condonado_el AS condonado_el,
                coalesce((SELECT sum(co.monto) FROM cobro co
                           WHERE co.periodo_id = p.id
                             AND co.imputacion = 'alquiler'), 0) AS cobrado
           FROM periodo_alquiler p
           JOIN contrato_alquiler c ON c.id = p.contrato_id
          WHERE p.id = $1
          FOR UPDATE OF p`,
        [periodoId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa cuota.');

      const p = rows[0];
      if (p.condonado_el) {
        throw new AppError(
          409,
          ErrorCode.OPERACION_DUPLICADA,
          'El punitorio de esta cuota ya estaba condonado.',
          'Conflict',
        );
      }

      // Se guarda cuánto se perdonó, calculado al momento de perdonarlo. Sin el
      // monto, el asiento dice "se condonó" sin decir cuánto, que para una
      // auditoría de plata es no decir nada.
      const punitorio = calcularPunitorio({
        saldo: round2(Number(p.total) - Number(p.cobrado)),
        moneda: p.moneda,
        venceEl: iso(p.vence_el),
        hasta: hoyIso(),
        tasaDiariaPct: Number(p.tasa),
      });

      await ej.query(
        `UPDATE periodo_alquiler
            SET punitorio_condonado_el = now(),
                punitorio_condonado_por = $2,
                punitorio_condonado_motivo = $3
          WHERE id = $1`,
        [periodoId, usuarioId, motivo],
      );

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'punitorio_condonado',
        usuarioId,
        entidadTipo: 'periodo_alquiler',
        entidadId: periodoId,
        monto: punitorio.monto,
        moneda: p.moneda,
        ip,
        detalle: {
          motivo,
          contratoId: p.contrato_id,
          explicacion: punitorio.explicacion,
          memoria: punitorio.memoria,
        },
      });

      return { id: periodoId, condonado: true, montoCondonado: punitorio.monto };
    });
  }

  // ── Cobros ─────────────────────────────────────────────────────────────────

  async registrarCobro(
    tenantId: string,
    dto: RegistrarCobroDto,
    usuarioId: string,
    ip?: string,
  ): Promise<{
    id: string;
    estadoPeriodo: string;
    saldo: number;
    imputacion: string;
    punitorioCobrado: number;
  }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: per } = await ej.query<{
        total: string; moneda: string; estado: string; contrato_id: string;
        punitorio_cobrado: string;
      }>(
        `SELECT total, moneda, estado, contrato_id, punitorio_cobrado
           FROM periodo_alquiler WHERE id = $1 FOR UPDATE`,
        [dto.periodoId],
      );
      if (!per.length) throw AppError.notFound('No se encontró ese período.');

      const imputacion = dto.imputacion ?? 'alquiler';

      const { rows: ins } = await ej.query<{ id: string }>(
        `INSERT INTO cobro (tenant_id, periodo_id, monto, moneda, fecha, medio,
                            comprobante, registrado_por, imputacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          tenantId, dto.periodoId, dto.monto, per[0].moneda,
          dto.fecha ?? hoyIso(),
          dto.medio ?? 'transferencia', dto.comprobante ?? null, usuarioId,
          imputacion,
        ],
      );

      // El saldo de la cuota sólo mira lo imputado a ALQUILER. Si el punitorio
      // contara, cobrar el interés dejaría la cuota como saldada sin que el
      // alquiler se hubiera terminado de pagar.
      const { rows: sum } = await ej.query<{ cobrado: string }>(
        `SELECT coalesce(sum(monto),0) AS cobrado FROM cobro
          WHERE periodo_id = $1 AND imputacion = 'alquiler'`,
        [dto.periodoId],
      );

      const total = Number(per[0].total);
      const cobrado = Number(sum[0].cobrado);
      const saldo = round2(total - cobrado);
      const estado = saldo <= 0 ? 'pagado' : cobrado > 0 ? 'parcial' : 'pendiente';

      // El punitorio cobrado se acumula en la cuota y NO se recalcula después:
      // el interés se congela el día que se cobra. Recalcularlo en cada lectura
      // haría que una cuota ya saldada mostrara otro número mañana, porque los
      // días de mora siguen corriendo.
      const punitorioCobrado =
        imputacion === 'punitorio'
          ? round2(Number(per[0].punitorio_cobrado) + dto.monto)
          : Number(per[0].punitorio_cobrado);

      await ej.query(
        `UPDATE periodo_alquiler SET estado = $2, punitorio_cobrado = $3 WHERE id = $1`,
        [dto.periodoId, estado, punitorioCobrado],
      );

      await this.auditoria.anotar(ej, tenantId, {
        accion: 'cobro_registrado',
        usuarioId,
        entidadTipo: 'cobro',
        entidadId: ins[0].id,
        monto: dto.monto,
        moneda: per[0].moneda,
        ip,
        detalle: {
          periodoId: dto.periodoId,
          contratoId: per[0].contrato_id,
          imputacion,
          medio: dto.medio ?? 'transferencia',
          saldoDespues: saldo,
        },
      });

      return {
        id: ins[0].id,
        estadoPeriodo: estado,
        saldo,
        imputacion,
        punitorioCobrado,
      };
    });
  }

  // ── El resumen de la ficha ─────────────────────────────────────────────────

  /**
   * Lo que dice cada cabecera de la ficha del contrato cuando su bloque está
   * cerrado.
   *
   * Existe por una razón concreta: los bloques de la ficha se pueden plegar, y
   * un bloque cerrado que para decir su número tiene que montar su contenido no
   * ahorró nada — se habrían pedido igual los once endpoints de siempre. Acá
   * salen los seis números en **una consulta**, y el bloque cerrado no pide nada.
   *
   * ── Tres reglas que este método se impone ──
   *
   * 1. **Los conteos salen de `count()`, no de contar un array.** La ficha pide
   *    ajustes y cuotas con `?porPagina=100` y `PaginacionDto` topea en 100: un
   *    contrato de diez años son 120 cuotas y veinte se caen del listado. Que se
   *    caigan del listado es una omisión; que la cabecera diga «3 impagas»
   *    cuando hay 23 es una **afirmación falsa**, que es peor. Por eso los
   *    números de arriba nunca se derivan de la página de abajo.
   *
   * 2. **La cabecera no dice nada que el bloque abierto no diga.** Un resumen
   *    calculado sin las reglas de rol de cada endpoint sería el mismo dato por
   *    otra puerta, y un permiso que se esquiva leyendo una cabecera no es un
   *    permiso. Hoy ninguno de los seis bloques de la ficha enmascara —
   *    `/contratos/:id/comisiones` la lee todo el equipo a propósito («el asesor
   *    necesita saber cómo quedó»), y lo mismo cuotas, ajustes, garantes,
   *    documentos y notas—, así que el resumen tampoco enmascara. **El día que
   *    alguno enmascare** —el precedente es `equipo.service.ts`, donde
   *    `veMontos` deja los importes de un compañero en `null` con el motivo
   *    escrito— este método tiene que enmascarar igual, con `null` y no con
   *    cero: un cero es un número falso.
   *
   * 3. **Ningún monto sin su moneda y ninguna fecha por `new Date()`.** Las
   *    columnas `date` salen ya recortadas con `to_char(…, 'YYYY-MM-DD')`
   *    desde SQL, que es el mismo `String(x).slice(0,10)` del front pero del
   *    lado donde no hay zona horaria que aplicar.
   *
   * Los garantes son la excepción al «un solo viaje», y a propósito: el
   * veredicto de si una garantía es apta lo decide `garantes.verificar()` —una
   * póliza de caución se mide distinto que una persona, y la regla ya se pagó
   * dos veces—. Escribir una segunda versión en SQL sería tener dos definiciones
   * de «en regla» que se separan en el primer cambio, y ahí la cabecera y el
   * bloque abierto empiezan a decir cosas distintas, que es exactamente lo que
   * esta feature no puede hacer.
   */
  async resumenFicha(tenantId: string, contratoId: string): Promise<ResumenFicha> {
    const [fila, garantes] = await Promise.all([
      this.db.withTenant(tenantId, async (ej) => {
        const { rows } = await ej.query<FilaResumen>(SQL_RESUMEN_FICHA, [contratoId]);
        if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');
        return rows[0];
      }),
      this.garantes.verificar(tenantId, contratoId),
    ]);

    const moneda = fila.moneda;

    return {
      contratoId,
      garantes: {
        total: garantes.garantes,
        aptos: garantes.aptos,
        minimo: garantes.minimo,
        enRegla: garantes.enRegla,
        pendientes: garantes.pendientes.length,
        // El primero textual y no un conteo: «falta consultar el BCRA» dice qué
        // hacer, «3 pendientes» manda a abrir el bloque para averiguarlo.
        primerPendiente: garantes.pendientes[0] ?? null,
      },
      // `null` y no un objeto en cero: un contrato de intermediación no tiene
      // cuotas, no tiene cero cuotas. La ficha directamente no dibuja el bloque.
      cuotas: fila.administrado
        ? {
            generadas: Number(fila.cuotas_generadas),
            impagas: Number(fila.cuotas_impagas),
            vencidas: Number(fila.cuotas_vencidas),
            deuda: { monto: Number(fila.cuotas_deuda), moneda: fila.cuotas_moneda ?? moneda },
            proximaVence: fila.cuotas_proxima,
          }
        : null,
      aumentos: {
        total: Number(fila.ajustes_total),
        proyectados: Number(fila.ajustes_proyectados),
        proximo: aAjusteResumen(fila.ajuste_proximo),
        // Un ajuste proyectado cuya vigencia YA empezó es plata que se está
        // dejando de cobrar todos los meses, y es justo el que no se ve: el
        // listado lo muestra igual que a los demás. En la cabecera va aparte.
        atrasado: aAjusteResumen(fila.ajuste_atrasado),
      },
      comision: {
        armada: Number(fila.comision_lineas) > 0,
        repartida: Number(fila.comision_reparto) > 0,
        sinCobrar: Number(fila.comision_sin_cobrar),
        total:
          Number(fila.comision_lineas) > 0
            ? { monto: Number(fila.comision_total), moneda: fila.comision_moneda ?? moneda }
            : null,
      },
      documentos: {
        total: Number(fila.docs_total),
        sinMandar: Number(fila.docs_sin_mandar),
        ultimoEl: fila.docs_ultimo === null ? null : new Date(fila.docs_ultimo).toISOString(),
      },
      notas: {
        total: Number(fila.notas_total),
        pendientes: Number(fila.notas_pendientes),
        ultimaEl: fila.notas_ultima === null ? null : new Date(fila.notas_ultima).toISOString(),
      },
    };
  }

  // ── Vencimientos ───────────────────────────────────────────────────────────

  /**
   * El tablero. Junta lo que vence de todas las fuentes en una sola lista
   * ordenada: contratos, ajustes por confirmar y cuotas impagas.
   */
  async vencimientos(
    tenantId: string,
    f: FiltroVencimientosDto,
  ): Promise<Pagina<Vencimiento>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const params = [f.dias ?? 90, f.tipo ?? null];

      // Un UNION ALL de tres tablas sobre TODA la cartera. Con 200 contratos y
      // sus cuotas, "los próximos 90 días" son cientos de filas, y antes salían
      // todas juntas en cada carga del tablero.
      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM (${SQL_VENCIMIENTOS}) v
          WHERE ($2::text IS NULL OR v.tipo = $2)`,
        params,
      );

      const { rows } = await ej.query<FilaVencimiento>(
        `SELECT * FROM (${SQL_VENCIMIENTOS}) v
          WHERE ($2::text IS NULL OR v.tipo = $2)
          ORDER BY v.fecha
          LIMIT $3 OFFSET $4`,
        [...params, f.porPagina, offset(f)],
      );

      const items = rows.map((r) => ({
        tipo: r.tipo,
        entidadId: r.entidadId,
        contratoId: r.contratoId,
        fecha: iso(r.fecha),
        codigoPropiedad: r.codigoPropiedad,
        referencia: r.referencia,
        monto: r.monto === null ? null : Number(r.monto),
        moneda: r.moneda,
        detalle: r.detalle,
        etiquetaPropiedad: `PROP-${String(r.codigoPropiedad).padStart(4, '0')}`,
      }));

      return armarPagina(items, Number(conteo[0].total), f);
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async crudo(ej: Ejecutor, id: string) {
    const { rows } = await ej.query<{
      id: string;
      propiedad_id: string;
      fecha_inicio: string;
      fecha_fin: string;
      dia_vencimiento: number;
      monto_inicial: string;
      moneda: string;
      indice: TipoIndice;
      indice_porcentaje: string | null;
      periodicidad_meses: number;
      mes_base: string;
      administrado: boolean;
      expensas: string | null;
    }>(
      `SELECT c.*, (SELECT o.expensas FROM operacion o WHERE o.id = c.operacion_id) AS expensas
         FROM contrato_alquiler c WHERE c.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');

    const c = rows[0];
    return {
      ...c,
      fecha_inicio: iso(c.fecha_inicio),
      fecha_fin: iso(c.fecha_fin),
      mes_base: iso(c.mes_base),
    };
  }

  private async leer(ej: Ejecutor, id: string): Promise<Contrato> {
    const { rows } = await ej.query<FilaContrato>(`${SELECT_CONTRATO} WHERE c.id = $1`, [id]);
    if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');
    return aContrato(rows[0]);
  }
}

interface FilaContrato {
  id: string;
  propiedad_id: string;
  propiedad_codigo: number;
  propiedad_calle: string;
  propiedad_numero: string | null;
  propiedad_localidad: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  dia_vencimiento: number;
  monto_inicial: string;
  monto_vigente: string;
  moneda: string;
  indice: TipoIndice;
  indice_porcentaje: string | null;
  periodicidad_meses: number;
  mes_base: string;
  administrado: boolean;
  honorarios_pct: string;
  estado: string;
  partes: Array<Record<string, unknown>> | null;
  proximo_ajuste: string | null;
  dias_para_vencer: number;
}

/**
 * Lo que vence, de las tres fuentes, en una sola lista.
 *
 * Va como constante porque el conteo y la página tienen que usar exactamente el
 * mismo SQL. Duplicarlo es cómo el paginador termina diciendo 40 y mostrando 12.
 */
const SQL_VENCIMIENTOS = `
  SELECT 'contrato' AS tipo, c.id AS "entidadId", c.id AS "contratoId",
         c.fecha_fin AS fecha, pr.codigo AS "codigoPropiedad",
         trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS referencia,
         NULL::numeric AS monto, c.moneda, NULL::text AS detalle
    FROM contrato_alquiler c
    JOIN propiedad pr ON pr.id = c.propiedad_id
   WHERE c.estado = 'vigente'
     AND c.fecha_fin BETWEEN current_date AND current_date + $1::int

  UNION ALL

  SELECT 'ajuste', a.id, c.id, a.vigente_desde,
         pr.codigo, trim(pr.calle || ' ' || coalesce(pr.numero,'')),
         a.monto_nuevo, a.moneda, a.estado
    FROM contrato_ajuste a
    JOIN contrato_alquiler c ON c.id = a.contrato_id
    JOIN propiedad pr ON pr.id = c.propiedad_id
   WHERE a.estado IN ('proyectado','confirmado')
     AND a.vigente_desde <= current_date + $1::int
     -- Sin piso hacia atrás: un ajuste sin confirmar cuya vigencia ya pasó es
     -- exactamente lo que no hay que dejar caer. Esconderlo después de 31 días
     -- es perder plata en silencio.

  UNION ALL

  SELECT 'cuota', p.id, c.id, p.vence_el,
         pr.codigo, trim(pr.calle || ' ' || coalesce(pr.numero,'')),
         p.total, p.moneda, p.estado
    FROM periodo_alquiler p
    JOIN contrato_alquiler c ON c.id = p.contrato_id
    JOIN propiedad pr ON pr.id = c.propiedad_id
   WHERE p.estado IN ('pendiente','parcial','vencido')
     AND p.vence_el <= current_date + $1::int`;

interface FilaVencimiento {
  tipo: string;
  entidadId: string;
  contratoId: string;
  fecha: string;
  codigoPropiedad: number;
  referencia: string;
  monto: string | null;
  moneda: string;
  detalle: string | null;
}

export interface Vencimiento {
  tipo: string;
  entidadId: string;
  contratoId: string;
  fecha: string;
  codigoPropiedad: number;
  referencia: string;
  monto: number | null;
  moneda: string;
  detalle: string | null;
  etiquetaPropiedad: string;
}

// ── El resumen de la ficha ───────────────────────────────────────────────────

/** Un importe SIEMPRE viaja con su moneda. Ver DESIGN.md §5. */
interface Importe {
  monto: number;
  moneda: string;
}

interface AjusteResumen {
  vigenteDesde: string;
  montoAnterior: number;
  montoNuevo: number;
  moneda: string;
  estado: string;
}

export interface ResumenFicha {
  contratoId: string;
  garantes: {
    total: number;
    aptos: number;
    minimo: number;
    enRegla: boolean;
    pendientes: number;
    primerPendiente: string | null;
  };
  /** `null` en un contrato de intermediación: no tiene cuotas, no tiene cero. */
  cuotas: {
    generadas: number;
    impagas: number;
    vencidas: number;
    deuda: Importe;
    proximaVence: string | null;
  } | null;
  aumentos: {
    total: number;
    proyectados: number;
    /** El siguiente que todavía no rige. */
    proximo: AjusteResumen | null;
    /** Proyectado y con la vigencia ya empezada: plata que no se está cobrando. */
    atrasado: AjusteResumen | null;
  };
  comision: {
    armada: boolean;
    repartida: boolean;
    sinCobrar: number;
    total: Importe | null;
  };
  documentos: { total: number; sinMandar: number; ultimoEl: string | null };
  notas: { total: number; pendientes: number; ultimaEl: string | null };
}

interface FilaResumen {
  moneda: string;
  administrado: boolean;
  cuotas_generadas: string;
  cuotas_impagas: string;
  cuotas_vencidas: string;
  cuotas_deuda: string;
  cuotas_moneda: string | null;
  cuotas_proxima: string | null;
  ajustes_total: string;
  ajustes_proyectados: string;
  ajuste_proximo: Record<string, unknown> | null;
  ajuste_atrasado: Record<string, unknown> | null;
  comision_lineas: string;
  comision_reparto: string;
  comision_sin_cobrar: string;
  comision_total: string;
  comision_moneda: string | null;
  docs_total: string;
  docs_sin_mandar: string;
  docs_ultimo: Date | string | null;
  notas_total: string;
  notas_pendientes: string;
  notas_ultima: Date | string | null;
}

/**
 * Los seis números de las cabeceras, en un viaje.
 *
 * Todo `count()`: ver la regla 1 de `resumenFicha()`. Y todas las columnas
 * `date` salen por `to_char(…, 'YYYY-MM-DD')` — una `date` de Postgres no tiene
 * zona, y convertirla a `Date` le inventa medianoche UTC: un vencimiento del 01
 * se muestra el 31 del mes anterior. Es la trampa que este repo ya pagó.
 *
 * «Impaga» usa el MISMO predicado que el tablero de vencimientos
 * (`estado IN ('pendiente','parcial','vencido')`) y no un `saldo > 0` suelto: una
 * cuota condonada tiene saldo y no se debe, y con dos definiciones la cabecera
 * de la ficha y el tablero del inicio contarían distinto sobre la misma cartera.
 */
const SQL_RESUMEN_FICHA = `
  WITH ct AS (
    SELECT id, moneda, administrado FROM contrato_alquiler WHERE id = $1
  ),
  cuota AS (
    SELECT p.vence_el, p.moneda,
           p.total - coalesce((SELECT sum(co.monto) FROM cobro co
                                WHERE co.periodo_id = p.id
                                  AND co.imputacion = 'alquiler'), 0) AS saldo
      FROM periodo_alquiler p
     WHERE p.contrato_id = $1
       AND p.estado IN ('pendiente', 'parcial', 'vencido')
  ),
  ajuste AS (
    SELECT to_char(a.vigente_desde, 'YYYY-MM-DD') AS "vigenteDesde",
           a.monto_anterior AS "montoAnterior", a.monto_nuevo AS "montoNuevo",
           a.moneda, a.estado, a.vigente_desde
      FROM contrato_ajuste a
     WHERE a.contrato_id = $1
  )
  SELECT
    ct.moneda,
    ct.administrado,

    (SELECT count(*) FROM periodo_alquiler p WHERE p.contrato_id = $1) AS cuotas_generadas,
    (SELECT count(*) FROM cuota) AS cuotas_impagas,
    (SELECT count(*) FROM cuota WHERE vence_el < current_date) AS cuotas_vencidas,
    (SELECT coalesce(sum(saldo), 0) FROM cuota) AS cuotas_deuda,
    (SELECT max(moneda) FROM cuota) AS cuotas_moneda,
    (SELECT to_char(min(vence_el), 'YYYY-MM-DD') FROM cuota
      WHERE vence_el >= current_date) AS cuotas_proxima,

    (SELECT count(*) FROM ajuste) AS ajustes_total,
    (SELECT count(*) FROM ajuste WHERE estado = 'proyectado') AS ajustes_proyectados,
    (SELECT to_json(x) FROM (
       SELECT "vigenteDesde", "montoAnterior", "montoNuevo", moneda, estado
         FROM ajuste WHERE vigente_desde > current_date
        ORDER BY vigente_desde LIMIT 1) x) AS ajuste_proximo,
    (SELECT to_json(x) FROM (
       SELECT "vigenteDesde", "montoAnterior", "montoNuevo", moneda, estado
         FROM ajuste
        WHERE estado = 'proyectado' AND vigente_desde <= current_date
        ORDER BY vigente_desde LIMIT 1) x) AS ajuste_atrasado,

    (SELECT count(*) FROM comision m
      WHERE m.contrato_id = $1 AND m.estado <> 'anulada') AS comision_lineas,
    (SELECT count(*) FROM comision m
      WHERE m.contrato_id = $1 AND m.estado <> 'anulada' AND m.nivel > 1) AS comision_reparto,
    (SELECT count(*) FROM comision m
      WHERE m.contrato_id = $1 AND m.nivel > 1
        AND m.estado NOT IN ('anulada', 'cobrada')) AS comision_sin_cobrar,
    (SELECT coalesce(sum(m.monto), 0) FROM comision m
      WHERE m.contrato_id = $1 AND m.estado <> 'anulada'
        AND m.beneficiario_tipo = 'operacion') AS comision_total,
    (SELECT max(m.moneda) FROM comision m
      WHERE m.contrato_id = $1 AND m.estado <> 'anulada'
        AND m.beneficiario_tipo = 'operacion') AS comision_moneda,

    (SELECT count(*) FROM documento_generado d
      WHERE d.contrato_id = $1) AS docs_total,
    (SELECT count(*) FROM documento_generado d
      WHERE d.contrato_id = $1 AND d.primer_envio_el IS NULL) AS docs_sin_mandar,
    (SELECT max(d.created_at) FROM documento_generado d
      WHERE d.contrato_id = $1) AS docs_ultimo,

    (SELECT count(*) FROM nota n
      WHERE n.entidad_tipo = 'contrato_alquiler' AND n.entidad_id = $1) AS notas_total,
    (SELECT count(*) FROM nota n
      WHERE n.entidad_tipo = 'contrato_alquiler' AND n.entidad_id = $1
        AND n.recordar_el IS NOT NULL AND n.resuelta_el IS NULL) AS notas_pendientes,
    (SELECT max(n.created_at) FROM nota n
      WHERE n.entidad_tipo = 'contrato_alquiler' AND n.entidad_id = $1) AS notas_ultima
  FROM ct`;

function aAjusteResumen(crudo: Record<string, unknown> | null): AjusteResumen | null {
  if (!crudo) return null;
  return {
    // Ya viene recortada desde SQL: no pasa por `new Date()` en ningún momento.
    vigenteDesde: String(crudo.vigenteDesde).slice(0, 10),
    montoAnterior: Number(crudo.montoAnterior),
    montoNuevo: Number(crudo.montoNuevo),
    moneda: String(crudo.moneda),
    estado: String(crudo.estado),
  };
}

const SELECT_CONTRATO = `
  SELECT c.*,
    pr.id AS propiedad_id, pr.codigo AS propiedad_codigo, pr.calle AS propiedad_calle,
    pr.numero AS propiedad_numero, pr.localidad AS propiedad_localidad,
    coalesce(
      (SELECT a.monto_nuevo FROM contrato_ajuste a
        WHERE a.contrato_id = c.id
          AND a.estado IN ('confirmado','notificado','aplicado')
          AND a.vigente_desde <= current_date
        ORDER BY a.vigente_desde DESC LIMIT 1),
      c.monto_inicial) AS monto_vigente,
    (SELECT min(a.vigente_desde) FROM contrato_ajuste a
       WHERE a.contrato_id = c.id AND a.vigente_desde > current_date) AS proximo_ajuste,
    (c.fecha_fin - current_date) AS dias_para_vencer,
    (SELECT json_agg(json_build_object(
        'personaId', cp.persona_id, 'rol', cp.rol, 'porcentaje', cp.porcentaje,
        'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))))
       FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
      WHERE cp.contrato_id = c.id) AS partes
  FROM contrato_alquiler c
  JOIN propiedad pr ON pr.id = c.propiedad_id`;

function aContrato(f: FilaContrato): Contrato {
  const partes = f.partes ?? [];
  const porRol = (rol: string) => partes.filter((p) => p.rol === rol);

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
    fechaInicio: iso(f.fecha_inicio),
    fechaFin: iso(f.fecha_fin),
    diaVencimiento: f.dia_vencimiento,
    montoInicial: Number(f.monto_inicial),
    montoVigente: Number(f.monto_vigente),
    moneda: f.moneda,
    indice: f.indice,
    indicePorcentaje: f.indice_porcentaje === null ? null : Number(f.indice_porcentaje),
    periodicidadMeses: f.periodicidad_meses,
    mesBase: iso(f.mes_base),
    administrado: f.administrado,
    honorariosPct: Number(f.honorarios_pct),
    estado: f.estado,
    locadores: porRol('locador').map((p) => ({
      personaId: String(p.personaId),
      nombre: String(p.nombre),
      porcentaje: p.porcentaje === null ? null : Number(p.porcentaje),
    })),
    locatarios: porRol('locatario').map((p) => ({
      personaId: String(p.personaId),
      nombre: String(p.nombre),
    })),
    garantes: porRol('garante').map((p) => ({
      personaId: String(p.personaId),
      nombre: String(p.nombre),
    })),
    proximoAjuste: f.proximo_ajuste ? iso(f.proximo_ajuste) : null,
    diasParaVencer: Number(f.dias_para_vencer),
  };
}

interface FilaPeriodo {
  id: string;
  periodo: string;
  venceEl: string;
  montoAlquiler: string;
  expensas: string;
  otros: string;
  total: string;
  moneda: string;
  estado: string;
  cobrado: string;
  punitorioCobrado: string;
  punitorioCondonadoEl: Date | null;
  punitorioCondonadoMotivo: string | null;
  tasaPunitoria: string;
}

/**
 * Arma la cuota con su punitorio **calculado al momento de leerla**.
 *
 * Es derivado y no una columna a propósito: los días de mora corren solos, y una
 * cuota impaga debe más hoy que ayer. Lo que sí se congela es lo ya cobrado
 * (`punitorio_cobrado`), que no se recalcula nunca.
 */
function aPeriodo(f: FilaPeriodo) {
  const total = Number(f.total);
  const cobrado = Number(f.cobrado);
  const saldo = round2(total - cobrado);
  const condonado = f.punitorioCondonadoEl !== null;

  const punitorio = calcularPunitorio({
    saldo,
    moneda: f.moneda,
    venceEl: iso(f.venceEl),
    hasta: hoyIso(),
    tasaDiariaPct: Number(f.tasaPunitoria),
  });

  return {
    id: f.id,
    periodo: iso(f.periodo),
    venceEl: iso(f.venceEl),
    montoAlquiler: Number(f.montoAlquiler),
    expensas: Number(f.expensas),
    otros: Number(f.otros),
    total,
    moneda: f.moneda,
    estado: f.estado,
    cobrado,
    saldo,
    punitorio: {
      // Condonado es CERO devengado, pero se sigue informando cuánto se perdonó:
      // esconderlo haría que el propietario no vea nunca esa decisión.
      devengado: condonado ? 0 : punitorio.monto,
      condonado,
      condonadoMotivo: f.punitorioCondonadoMotivo,
      montoCondonado: condonado ? punitorio.monto : 0,
      cobrado: Number(f.punitorioCobrado),
      diasDeMora: punitorio.diasDeMora,
      tasaDiariaPct: Number(f.tasaPunitoria),
      explicacion: punitorio.explicacion,
      // Lo que falta cobrar de interés. Nunca negativo: si se cobró de más, la
      // diferencia es un tema de la liquidación, no un saldo a favor acá.
      saldo: condonado
        ? 0
        : Math.max(0, round2(punitorio.monto - Number(f.punitorioCobrado))),
    },
  };
}

/** Hoy en `YYYY-MM-DD` local, sin pasar por UTC. */
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function iso(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

function primerDia(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

function hoyPrimerDia(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

/** El día de vencimiento del mes, acotado por si el mes es más corto. */
function venceEl(periodo: string, dia: number): string {
  const [a, m] = periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${periodo.slice(0, 7)}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
