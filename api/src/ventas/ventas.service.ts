import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import {
  calcularComisiones,
  cuadra,
  type EntradaComision,
  type LineaComision as LineaMotor,
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
  /** Quién captó la propiedad. Es lo que pre-llena el captador del reparto. */
  agenteCaptador: { id: string; nombre: string } | null;
  operacionId: string;
  comisiones: LineaGuardada[];
  totales: TotalesComision;
  /** ¿Lo que se repartió suma exactamente lo que factura la operación? */
  cuadra: boolean;
  /** ¿Ya se repartió, o sólo están los honorarios de la operación? */
  repartida: boolean;
}

/** Los estados por los que pasa una venta, en orden. */
const FLUJO = ['en_curso', 'boleto', 'escriturada'] as const;

@Injectable()
export class VentasService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, f: FiltroVentasDto): Promise<Pagina<Venta>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.estado ?? null, f.agenteId ?? null];

      // «Mis ventas» son DOS cosas y las dos cuentan: donde el agente cobra
      // comisión, y donde captó la propiedad.
      //
      // Sólo por comisión sería el criterio estricto —la relación fuerte es
      // `comision.beneficiario_id`, con su índice parcial `ix_comision_agente`—
      // pero una venta recién cargada TODAVÍA NO tiene reparto, así que no
      // tiene ni una fila de comisión: «mis ventas» aparecería vacío justo en
      // el momento en que más se mira, que es cuando la operación se acaba de
      // cerrar. Sólo por captador sería peor todavía: quien vendió la propiedad
      // de un compañero no la vería nunca.
      //
      // La pantalla lo dice con todas las letras («ventas donde cobrás comisión
      // o captaste la propiedad») para que el número no sorprenda.
      const donde = `
        WHERE ($1::text IS NULL
               OR pr.calle ILIKE $1 OR pr.localidad ILIKE $1
               OR pr.codigo::text = trim(both '%' from $1)
               OR trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) ILIKE $1)
          AND ($2::text IS NULL OR v.estado = $2)
          AND ($3::uuid IS NULL
               OR pr.agente_captador_id = $3
               OR EXISTS (SELECT 1 FROM comision cm
                           WHERE cm.venta_id = v.id
                             AND cm.beneficiario_tipo = 'agente'
                             AND cm.beneficiario_id = $3
                             AND cm.estado <> 'anulada'))`;

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
        `${SELECT_VENTA} ${donde} ORDER BY v.created_at DESC LIMIT $4 OFFSET $5`,
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

      validarReparto(entrada);

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
      await insertarLineas(ej, tenantId, { ventaId }, r.lineas);

      return this.leer(ej, ventaId);
    });
  }

  /**
   * El reparto que el sistema propone, para que la pantalla lo muestre ya
   * cargado.
   *
   * **El servidor sugiere; el usuario confirma.** Todo lo que devuelve es
   * editable, y por una razón concreta escrita en el traspaso: el captador no
   * siempre es quien cargó la propiedad. Lo automático tiene que ser un valor
   * por defecto, no un hecho.
   *
   * De dónde sale cada cosa:
   *   · puntas    → `configEfectiva`: el override de la operación sobre la
   *                 política de la casa.
   *   · captador  → `propiedad.agente_captador_id`, con el % de SU membresía y
   *                 fallback al de la inmobiliaria.
   *   · cerrador  → quien está cargando el reparto, con el mismo criterio.
   *   · externa   → la de la operación, si ya se compartió alguna vez.
   */
  async sugerirReparto(
    tenantId: string,
    ventaId: string,
    actor: { usuarioId: string },
  ): Promise<SugerenciaReparto> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        operacion_id: string;
        precio_cierre: string;
        moneda: string;
        captador_id: string | null;
        captador_nombre: string | null;
      }>(
        `SELECT v.operacion_id, v.precio_cierre, v.moneda,
                pr.agente_captador_id AS captador_id, cap.nombre AS captador_nombre
           FROM operacion_venta v
           JOIN operacion o ON o.id = v.operacion_id
           JOIN propiedad pr ON pr.id = o.propiedad_id
           LEFT JOIN usuario cap ON cap.id = pr.agente_captador_id
          WHERE v.id = $1`,
        [ventaId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa venta.');
      const v = rows[0];

      const { config, heredada } = await configEfectiva(ej, tenantId, v.operacion_id);
      const captador = await pctDeAgente(
        ej, v.captador_id, config.repartoInterno.captador, 'captador',
      );
      const cerrador = await pctDeAgente(
        ej, actor.usuarioId, config.repartoInterno.cerrador, 'cerrador',
      );

      return {
        base: Number(v.precio_cierre),
        moneda: v.moneda,
        puntas: { compradora: config.venta.compradora, vendedora: config.venta.vendedora },
        puntasHeredadas: heredada,
        captador: v.captador_id
          ? { ...captador, usuarioId: v.captador_id, nombre: v.captador_nombre ?? '' }
          : null,
        cerrador: { ...cerrador, usuarioId: actor.usuarioId },
        repartoInternoCasa: config.repartoInterno,
      };
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
  /**
   * Sin paginar, a propósito: es un **agregado**, no una lista.
   *
   * El `GROUP BY` devuelve una fila por (agente × moneda × estado): con dos
   * monedas y cuatro estados, un equipo de diez personas son 80 filas como
   * techo. Paginar un resumen que ya está agrupado sería partir el total en
   * pedazos, que es justo lo contrario de para qué sirve.
   */
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
  operacion_id: string;
  propiedad_id: string;
  propiedad_codigo: number;
  propiedad_calle: string;
  propiedad_numero: string | null;
  propiedad_localidad: string | null;
  comprador_id: string | null;
  comprador_nombre: string | null;
  captador_id: string | null;
  captador_nombre: string | null;
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
    pr.agente_captador_id AS captador_id, cap.nombre AS captador_nombre,
    ${SELECT_COMISIONES('c.venta_id = v.id')} AS comisiones
  FROM operacion_venta v
  JOIN operacion o ON o.id = v.operacion_id
  JOIN propiedad pr ON pr.id = o.propiedad_id
  LEFT JOIN persona pe ON pe.id = v.comprador_id
  LEFT JOIN usuario cap ON cap.id = pr.agente_captador_id`;

function aVenta(f: FilaVenta): Venta {
  const comisiones = aLineas(f.comisiones);

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
    agenteCaptador: f.captador_id
      ? { id: f.captador_id, nombre: f.captador_nombre ?? '' }
      : null,
    operacionId: f.operacion_id,
    precioCierre: Number(f.precio_cierre),
    moneda: f.moneda,
    fechaReserva: f.fecha_reserva,
    fechaBoleto: f.fecha_boleto,
    fechaEscritura: f.fecha_escritura,
    escribania: f.escribania,
    estado: f.estado,
    comisiones,
    totales: totalesDe(comisiones),
    cuadra: cuadraGuardado(comisiones),
    repartida: hayReparto(comisiones),
  };
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/** El % de un agente para un rol, con su origen. */
export interface PctAgente {
  nombre: string;
  porcentaje: number;
  /** `true` si es el de SU membresía; `false` si heredó el de la casa. */
  propio: boolean;
}

export interface SugerenciaReparto {
  base: number;
  moneda: string;
  puntas: Record<string, number>;
  /** `false` cuando la operación tiene su propio % y no el de la casa. */
  puntasHeredadas: boolean;
  captador: (PctAgente & { usuarioId: string }) | null;
  cerrador: PctAgente & { usuarioId: string };
  /** El reparto interno de la casa, para poder mostrar de dónde salió cada %. */
  repartoInternoCasa: { captador: number; cerrador: number };
}

/**
 * El % que le toca a un agente, con fallback a la política de la casa.
 *
 * `membresia.comision_captador_pct` en NULL **no es cero**: es «heredá el de la
 * inmobiliaria». Está escrito así en el COMMENT de la 017 y es la razón por la
 * que este fallback existe en vez de un `coalesce` en el SQL — el llamador
 * necesita saber si el número es propio o heredado para poder decirlo en
 * pantalla.
 */
export async function pctDeAgente(
  ej: Ejecutor,
  usuarioId: string | null,
  porDefecto: number,
  rol: 'captador' | 'cerrador' = 'captador',
): Promise<PctAgente> {
  if (!usuarioId) return { nombre: '', porcentaje: porDefecto, propio: false };

  const columna = rol === 'captador' ? 'comision_captador_pct' : 'comision_cerrador_pct';
  const { rows } = await ej.query<{ nombre: string; pct: string | null }>(
    `SELECT u.nombre, m.${columna} AS pct
       FROM membresia m JOIN usuario u ON u.id = m.usuario_id
      WHERE m.usuario_id = $1`,
    [usuarioId],
  );
  if (!rows.length) return { nombre: '', porcentaje: porDefecto, propio: false };

  const pct = rows[0].pct;
  return {
    nombre: rows[0].nombre,
    porcentaje: pct === null ? porDefecto : Number(pct),
    propio: pct !== null,
  };
}

/**
 * Las reglas que el motor no puede chequear porque no sabe de dónde vino la
 * entrada.
 *
 * Compartir una punta que no cobra nada es la más traicionera: el motor calcula
 * `0 × 50% = 0`, no emite ninguna línea, y la pantalla muestra un reparto
 * prolijo donde la agencia con la que se acordó 50/50 no figura. Nadie ve el
 * error hasta que la otra inmobiliaria reclama.
 */
function validarReparto(e: EntradaComision): void {
  const conMonto = Object.entries(e.puntas).filter(([, p]) => Number(p) > 0);
  if (!conMonto.length) {
    throw new AppError(
      422, ErrorCode.VALIDATION_FAILED,
      'El reparto no tiene ninguna punta con honorarios: no habría comisión que repartir.',
      'Unprocessable Entity',
    );
  }

  for (const [punta, externa] of Object.entries(e.externas ?? {})) {
    if (!externa || !externa.porcentaje) continue;
    const pct = Number(e.puntas[punta as Punta] ?? 0);
    if (pct <= 0) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `Estás compartiendo la punta ${punta} con «${externa.nombre}», pero esa punta ` +
          'no cobra honorarios: no hay nada que repartir. Cargá el % de la punta primero.',
        'Unprocessable Entity',
      );
    }
    if (!externa.nombre?.trim()) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `Falta el nombre de la inmobiliaria con la que se comparte la punta ${punta}.`,
        'Unprocessable Entity',
      );
    }
  }
}

/**
 * Guarda las líneas del motor, sea de una venta o de un contrato de alquiler.
 *
 * Dos INSERT en lote, no uno por línea. Todo `padre` del motor apunta a una
 * línea de NIVEL 1, así que alcanza con dos pasadas: primero los nivel 1,
 * después el resto ya con el id del padre resuelto. Una venta con dos puntas,
 * una externa y dos agentes eran nueve viajes a la base.
 *
 * El mapeo padre→id se hace por `punta`, que es única entre los nivel 1 (uno
 * por punta), y NO por el orden en que vuelve el RETURNING: el orden de las
 * filas devueltas por un INSERT no es algo que el motor garantice, y acá una
 * fila mal encadenada es plata asignada a quien no corresponde.
 */
export async function insertarLineas(
  ej: Ejecutor,
  tenantId: string,
  duenio: { ventaId?: string; contratoId?: string },
  lineas: LineaMotor[],
): Promise<void> {
  const ventaId = duenio.ventaId ?? null;
  const contratoId = duenio.contratoId ?? null;

  const nivel1 = lineas.filter((l) => l.nivel === 1);
  const resto = lineas.filter((l) => l.nivel !== 1);
  const idPorPunta = new Map<string, string>();

  if (nivel1.length) {
    const { rows: creadas } = await ej.query<{ id: string; punta: string }>(
      `INSERT INTO comision
         (tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto,
          moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id,
          beneficiario_nombre, externa_id, concepto)
       SELECT $1, $2, $3, NULL, 1, x.punta, x.base, x.moneda, x.porcentaje,
              x.monto, x.beneficiario_tipo, NULL, NULL, NULL, x.concepto
         FROM unnest($4::text[], $5::numeric[], $6::text[], $7::numeric[],
                     $8::numeric[], $9::text[], $10::text[])
              AS x(punta, base, moneda, porcentaje, monto,
                   beneficiario_tipo, concepto)
       RETURNING id, punta`,
      [
        tenantId, ventaId, contratoId,
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
      const dePunta = l.padre === undefined ? null : lineas[l.padre].punta;
      return dePunta === null ? null : (idPorPunta.get(dePunta) ?? null);
    });

    await ej.query(
      `INSERT INTO comision
         (tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto,
          moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id,
          beneficiario_nombre, externa_id, concepto)
       SELECT $1, $2, $3, x.padre_id, x.nivel, x.punta, x.base, x.moneda,
              x.porcentaje, x.monto, x.beneficiario_tipo, x.beneficiario_id,
              x.beneficiario_nombre, x.externa_id, x.concepto
         FROM unnest($4::uuid[], $5::smallint[], $6::text[], $7::numeric[],
                     $8::text[], $9::numeric[], $10::numeric[], $11::text[],
                     $12::uuid[], $13::text[], $14::uuid[], $15::text[])
              AS x(padre_id, nivel, punta, base, moneda, porcentaje, monto,
                   beneficiario_tipo, beneficiario_id, beneficiario_nombre,
                   externa_id, concepto)`,
      [
        tenantId, ventaId, contratoId,
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
        resto.map((l) => l.externaId ?? null),
        resto.map((l) => l.concepto),
      ],
    );
  }
}
