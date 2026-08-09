import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService } from '../database/db.service';
import { TokensService, type Rol } from '../auth/tokens.service';
import { AppError, ErrorCode } from '../common/app-error';
import { leerConfig } from '../ventas/comisiones.config.service';

interface FilaCaptada {
  id: string;
  codigo: number;
  calle: string;
  numero: string | null;
  localidad: string | null;
  tipo: string;
  operaciones: Array<Record<string, unknown>> | null;
}

interface FilaVentaAgente {
  id: string;
  codigo: number;
  calle: string;
  numero: string | null;
  precio_cierre: string;
  moneda: string;
  estado: string;
  fecha_escritura: string | null;
}

/** Un monto siempre con su moneda y su estado. Nunca un total que los mezcle. */
export interface MontoPorMoneda {
  moneda: string;
  estado: string;
  total: number;
  lineas?: number;
}

export interface PerfilAgente {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  estado: string;
  sucursal: string | null;
  esPropio: boolean;
  comisionCaptadorPct: number | null;
  comisionCerradorPct: number | null;
  heredado: { captador: number; cerrador: number };
  /** `null` cuando el que mira no tiene permiso para ver estos montos. */
  comisiones: MontoPorMoneda[] | null;
  comisionesMotivo: string | null;
  captadas: Array<{
    id: string;
    etiqueta: string;
    direccion: string;
    tipo: string;
    operaciones: Array<{ tipo: string; precio: number | null; moneda: string; estado: string }>;
  }>;
  contratos: Array<{
    id: string; etiqueta: string; direccion: string;
    desde: string; hasta: string; monto: number; moneda: string; estado: string;
  }>;
  ventas: Array<{
    id: string; etiqueta: string; direccion: string;
    precioCierre: number; moneda: string; estado: string; fechaEscritura: string | null;
  }>;
  inmobiliaria: {
    ventasCerradas: number;
    contratosVigentes: number;
    propiedades: number;
    operado: Array<{ moneda: string; total: number; operaciones: number }>;
    /** `null` para el rol agente: ver el comentario de `perfil()`. */
    comisionesDeAgentes: MontoPorMoneda[] | null;
    comisionesMotivo: string | null;
  };
}

export interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  estado: string;
  /**
   * El % de esta persona cuando capta y cuando cierra, en % de lo que le queda
   * a la casa —la unidad del motor—.
   *
   * `null` **no es cero**: es «hereda el de la inmobiliaria». Cero es un agente
   * que efectivamente no cobra por captar. Por eso viajan los dos números y
   * además el heredado, para que la pantalla pueda mostrar el valor que rige en
   * gris sin tener que pedir la config aparte.
   */
  comisionCaptadorPct: number | null;
  comisionCerradorPct: number | null;
}

export interface EquipoConPolitica {
  miembros: Miembro[];
  /** El reparto de la casa: lo que rige para quien no tiene número propio. */
  heredado: { captador: number; cerrador: number };
  /** El total de honorarios de una venta, para traducir a «% de la venta». */
  totalVenta: number;
}

export interface Invitacion {
  id: string;
  email: string;
  rol: Rol;
  expiraEl: string;
  estado: 'pendiente' | 'aceptada' | 'cancelada' | 'vencida';
}

const DIAS_VALIDEZ = 7;

@Injectable()
export class EquipoService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Todo lo de acá pasa por withTenant. La RLS es la que garantiza que una
   * inmobiliaria no vea el equipo de otra: aunque este SQL no tuviera ningún
   * WHERE por tenant, la policy filtraría igual. Los guards son defensa en
   * profundidad, no la única línea.
   */
  /**
   * Sin paginar, **a propósito**.
   *
   * El plan Inicial permite 3 usuarios y el Medio 10; el Pro no tiene tope, pero
   * el límite real es la cantidad de gente que trabaja en la inmobiliaria. Es un
   * bound del mundo, no una apuesta: paginar acá sería ceremonia para una lista
   * que nunca pasa de dos dígitos.
   *
   * Si algún día una franquicia tiene cientos de usuarios, esta lista no es lo
   * primero que va a doler — pero entonces sí se pagina.
   */
  async listar(tenantId: string): Promise<EquipoConPolitica> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        usuario_id: string;
        nombre: string;
        email: string;
        rol: Rol;
        estado: string;
        comision_captador_pct: string | null;
        comision_cerrador_pct: string | null;
      }>(
        `SELECT m.usuario_id, u.nombre, u.email::text AS email, m.rol, m.estado,
                m.comision_captador_pct, m.comision_cerrador_pct
           FROM membresia m
           JOIN usuario u ON u.id = m.usuario_id
          ORDER BY u.nombre`,
      );

      const config = await leerConfig(ej, tenantId);

      return {
        miembros: rows.map((r) => ({
          usuarioId: r.usuario_id,
          nombre: r.nombre,
          email: r.email,
          rol: r.rol,
          estado: r.estado,
          comisionCaptadorPct: num(r.comision_captador_pct),
          comisionCerradorPct: num(r.comision_cerrador_pct),
        })),
        heredado: config.repartoInterno,
        totalVenta: round2(config.venta.compradora + config.venta.vendedora),
      };
    });
  }

  /**
   * El % de una persona. Los DOS campos van siempre y se escriben siempre.
   *
   * **Ésta es la excepción a la regla del PATCH parcial**, y está acá escrita
   * para que no la "arreglen": la regla del repo es que un PATCH no escriba
   * NULL sobre lo que no vino, porque cargar titulares borraba número,
   * ambientes y metros. Acá `null` **es un valor con significado** —heredá el
   * reparto de la inmobiliaria, tal como lo dice el COMMENT de la 017— así que
   * con `coalesce($2, comision_captador_pct)` nunca se podría volver de un
   * override a heredar: el campo quedaría clavado para siempre y el usuario
   * vería que borrar el número no hace nada.
   *
   * Por eso el DTO pide los dos campos como obligatorios-pero-nulables: el
   * front manda el estado completo de la fila, no un delta.
   */
  async guardarComisiones(
    tenantId: string,
    usuarioId: string,
    captador: number | null,
    cerrador: number | null,
  ): Promise<Miembro> {
    if (captador !== null && cerrador !== null && captador + cerrador > 100) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Captar y cerrar la misma operación no puede dar más del 100% de lo que le ' +
          'queda a la inmobiliaria: a la casa no le quedaría nada.',
        'Unprocessable Entity',
      );
    }

    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE membresia
            SET comision_captador_pct = $2, comision_cerrador_pct = $3
          WHERE usuario_id = $1`,
        [usuarioId, captador, cerrador],
      );
      if (!rowCount) {
        throw AppError.notFound('Esa persona no forma parte de la inmobiliaria.');
      }
    });

    // Fuera del withTenant a propósito: `listar` abre el suyo, y anidarlos
    // tomaría dos conexiones del pool para el mismo request.
    const { miembros } = await this.listar(tenantId);
    const m = miembros.find((x) => x.usuarioId === usuarioId);
    if (!m) throw AppError.notFound('Esa persona no forma parte de la inmobiliaria.');
    return m;
  }

  /**
   * El perfil de una persona del equipo: sus números, su cartera y su parte de
   * la inmobiliaria.
   *
   * **La regla que decide todo lo de acá**: un agente ve SUS montos, no los de
   * sus compañeros. Y eso no se sostiene sólo con filtrar por `beneficiario_id`,
   * porque con un equipo de dos asesores el total de la casa menos lo propio ES
   * lo del compañero. Un permiso que se esquiva restando no es un permiso.
   *
   * Por eso el bloque de la inmobiliaria tiene dos versiones:
   *   · titular, administración y contable ven el pozo de comisiones;
   *   · un agente ve VOLUMEN —operaciones, monto operado, contratos firmados—,
   *     que es lo que necesita para saber cómo viene la casa sin que eso sea
   *     una vía lateral a la plata de los demás.
   *
   * Un agente **sí** puede abrir el perfil de un compañero, y ve lo no
   * monetario: qué captó, qué contratos salieron de eso, cuántas operaciones
   * cerró. Los montos vienen en `null` con el motivo escrito, que es la regla
   * del playbook —un cero en una pantalla de plata es mentir—.
   */
  async perfil(
    tenantId: string,
    usuarioId: string,
    actor: { usuarioId: string; rol: Rol },
  ): Promise<PerfilAgente> {
    const propio = actor.usuarioId === usuarioId;
    const veMontos = propio || actor.rol !== 'agente';

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: persona } = await ej.query<{
        nombre: string; email: string; rol: Rol; estado: string;
        comision_captador_pct: string | null; comision_cerrador_pct: string | null;
        sucursal: string | null;
      }>(
        `SELECT u.nombre, u.email::text AS email, m.rol, m.estado,
                m.comision_captador_pct, m.comision_cerrador_pct, s.nombre AS sucursal
           FROM membresia m
           JOIN usuario u ON u.id = m.usuario_id
           LEFT JOIN sucursal s ON s.id = m.sucursal_id
          WHERE m.usuario_id = $1`,
        [usuarioId],
      );
      if (!persona.length) {
        throw AppError.notFound('Esa persona no forma parte de la inmobiliaria.');
      }
      const p = persona[0];
      const config = await leerConfig(ej, tenantId);

      // ── Sus comisiones, por moneda y estado. Nunca un total que las mezcle ──
      const comisiones = veMontos
        ? (
            await ej.query<{
              moneda: string; estado: string; total: string; lineas: string;
            }>(
              `SELECT c.moneda, c.estado, sum(c.monto) AS total, count(*)::text AS lineas
                 FROM comision c
                WHERE c.beneficiario_tipo = 'agente'
                  AND c.beneficiario_id = $1
                  AND c.estado <> 'anulada'
                GROUP BY c.moneda, c.estado
                ORDER BY c.moneda, c.estado`,
              [usuarioId],
            )
          ).rows.map((r) => ({
            moneda: r.moneda,
            estado: r.estado,
            total: Number(r.total),
            lineas: Number(r.lineas),
          }))
        : null;

      // ── Lo que captó ──
      const { rows: captadas } = await ej.query<FilaCaptada>(
        `SELECT p.id, p.codigo, p.calle, p.numero, p.localidad, p.tipo,
                (SELECT json_agg(json_build_object(
                    'tipo', o.tipo, 'precio', o.precio, 'moneda', o.moneda,
                    'estado', o.estado) ORDER BY o.tipo)
                   FROM operacion o WHERE o.propiedad_id = p.id) AS operaciones
           FROM propiedad p
          WHERE p.agente_captador_id = $1
          ORDER BY p.codigo`,
        [usuarioId],
      );

      // ── Los contratos de alquiler de las propiedades que captó ──
      const { rows: contratos } = await ej.query<{
        id: string; codigo: number; calle: string; numero: string | null;
        fecha_inicio: string; fecha_fin: string; monto_vigente: string;
        moneda: string; estado: string;
      }>(
        // `monto_vigente` NO es una columna: es el último ajuste ya vigente, o
        // el monto inicial si todavía no hubo ninguno. Se calcula igual que en
        // `SELECT_CONTRATO`; mostrar el inicial acá diría un alquiler viejo.
        `SELECT c.id, p.codigo, p.calle, p.numero,
                c.fecha_inicio::text, c.fecha_fin::text,
                coalesce(
                  (SELECT a.monto_nuevo FROM contrato_ajuste a
                    WHERE a.contrato_id = c.id
                      AND a.estado IN ('confirmado','notificado','aplicado')
                      AND a.vigente_desde <= current_date
                    ORDER BY a.vigente_desde DESC LIMIT 1),
                  c.monto_inicial) AS monto_vigente,
                c.moneda, c.estado
           FROM contrato_alquiler c
           JOIN propiedad p ON p.id = c.propiedad_id
          WHERE p.agente_captador_id = $1
          ORDER BY c.fecha_inicio DESC
          LIMIT 50`,
        [usuarioId],
      );

      // ── Las ventas en las que le tocó algo ──
      const { rows: ventas } = await ej.query<FilaVentaAgente>(
        `SELECT DISTINCT ON (v.id)
                v.id, v.precio_cierre, v.moneda, v.estado, v.fecha_escritura::text,
                p.codigo, p.calle, p.numero
           FROM comision c
           JOIN operacion_venta v ON v.id = c.venta_id
           JOIN operacion o ON o.id = v.operacion_id
           JOIN propiedad p ON p.id = o.propiedad_id
          WHERE c.beneficiario_tipo = 'agente' AND c.beneficiario_id = $1
            AND c.estado <> 'anulada'
          ORDER BY v.id, v.created_at DESC`,
        [usuarioId],
      );

      // ── La inmobiliaria ──
      const { rows: vol } = await ej.query<{
        ventas_cerradas: string; contratos_vigentes: string; propiedades: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM operacion_venta WHERE estado = 'escriturada')
             AS ventas_cerradas,
           (SELECT count(*)::text FROM contrato_alquiler WHERE estado = 'vigente')
             AS contratos_vigentes,
           (SELECT count(*)::text FROM propiedad) AS propiedades`,
      );

      const { rows: operado } = await ej.query<{ moneda: string; total: string; n: string }>(
        `SELECT moneda, sum(precio_cierre) AS total, count(*)::text AS n
           FROM operacion_venta WHERE estado = 'escriturada'
          GROUP BY moneda ORDER BY moneda`,
      );

      const casaComisiones = veMontos && actor.rol !== 'agente'
        ? (
            await ej.query<{ moneda: string; estado: string; total: string }>(
              `SELECT moneda, estado, sum(monto) AS total
                 FROM comision
                WHERE beneficiario_tipo = 'agente' AND estado <> 'anulada'
                GROUP BY moneda, estado ORDER BY moneda, estado`,
            )
          ).rows.map((r) => ({
            moneda: r.moneda, estado: r.estado, total: Number(r.total),
          }))
        : null;

      return {
        usuarioId,
        nombre: p.nombre,
        email: p.email,
        rol: p.rol,
        estado: p.estado,
        sucursal: p.sucursal,
        esPropio: propio,
        comisionCaptadorPct: num(p.comision_captador_pct),
        comisionCerradorPct: num(p.comision_cerrador_pct),
        heredado: config.repartoInterno,
        comisiones,
        comisionesMotivo: veMontos
          ? null
          : 'Sólo ves tus propios montos. Los de tus compañeros los ven el titular, ' +
            'administración y contaduría.',
        captadas: captadas.map((c) => ({
          id: c.id,
          etiqueta: `PROP-${String(c.codigo).padStart(4, '0')}`,
          direccion: [[c.calle, c.numero].filter(Boolean).join(' '), c.localidad]
            .filter(Boolean).join(', '),
          tipo: c.tipo,
          operaciones: (c.operaciones ?? []).map((o) => ({
            tipo: String(o.tipo),
            precio: o.precio === null ? null : Number(o.precio),
            moneda: String(o.moneda),
            estado: String(o.estado),
          })),
        })),
        contratos: contratos.map((c) => ({
          id: c.id,
          etiqueta: `PROP-${String(c.codigo).padStart(4, '0')}`,
          direccion: [c.calle, c.numero].filter(Boolean).join(' '),
          // Columnas `date`: se recorta el texto ISO. Un contrato del 01/01
          // pasado por `new Date()` se muestra del 31/12.
          desde: String(c.fecha_inicio).slice(0, 10),
          hasta: String(c.fecha_fin).slice(0, 10),
          monto: Number(c.monto_vigente),
          moneda: c.moneda,
          estado: c.estado,
        })),
        ventas: ventas.map((v) => ({
          id: v.id,
          etiqueta: `PROP-${String(v.codigo).padStart(4, '0')}`,
          direccion: [v.calle, v.numero].filter(Boolean).join(' '),
          precioCierre: Number(v.precio_cierre),
          moneda: v.moneda,
          estado: v.estado,
          fechaEscritura: v.fecha_escritura ? String(v.fecha_escritura).slice(0, 10) : null,
        })),
        inmobiliaria: {
          ventasCerradas: Number(vol[0].ventas_cerradas),
          contratosVigentes: Number(vol[0].contratos_vigentes),
          propiedades: Number(vol[0].propiedades),
          operado: operado.map((o) => ({
            moneda: o.moneda, total: Number(o.total), operaciones: Number(o.n),
          })),
          comisionesDeAgentes: casaComisiones,
          comisionesMotivo:
            casaComisiones === null
              ? 'El pozo de comisiones de los agentes lo ven el titular, administración ' +
                'y contaduría. Acá va el volumen de la inmobiliaria, que no es plata de ' +
                'nadie en particular.'
              : null,
        },
      };
    });
  }

  async listarInvitaciones(tenantId: string): Promise<Invitacion[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string;
        email: string;
        rol: Rol;
        expira_el: Date;
        aceptada_el: Date | null;
        cancelada_el: Date | null;
      }>(
        `SELECT id, email::text AS email, rol, expira_el, aceptada_el, cancelada_el
           FROM invitacion ORDER BY created_at DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        rol: r.rol,
        expiraEl: r.expira_el.toISOString(),
        estado: r.aceptada_el
          ? ('aceptada' as const)
          : r.cancelada_el
            ? ('cancelada' as const)
            : r.expira_el <= new Date()
              ? ('vencida' as const)
              : ('pendiente' as const),
      }));
    });
  }

  /**
   * Devuelve el token en claro UNA sola vez: en la base va el hash. Si se pierde,
   * no se puede recuperar — se cancela y se emite otra.
   *
   * El envío por mail todavía no existe (etapa 7, junto con el resto de las
   * notificaciones). Por ahora el owner copia el enlace y lo manda por donde
   * quiera. Un botón que dice "enviar" y no envía sería peor.
   */
  async invitar(
    tenantId: string,
    invitadoPor: string,
    email: string,
    rol: Rol,
  ): Promise<{ invitacionId: string; token: string; expiraEl: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiraEl = new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000);

    return this.db.withTenant(tenantId, async (ej) => {
      const yaEsta = await ej.query(
        `SELECT 1 FROM membresia m JOIN usuario u ON u.id = m.usuario_id
          WHERE u.email = $1`,
        [email],
      );
      if (yaEsta.rowCount) {
        throw new AppError(
          409,
          ErrorCode.EMAIL_EN_USO,
          'Esa persona ya forma parte de la inmobiliaria.',
          'Conflict',
        );
      }

      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO invitacion (tenant_id, email, rol, token_hash, invitado_por, expira_el)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, email, rol, this.tokens.hashear(token), invitadoPor, expiraEl],
        );
        return {
          invitacionId: rows[0].id,
          token,
          expiraEl: expiraEl.toISOString(),
        };
      } catch (err) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          throw new AppError(
            409,
            ErrorCode.INVITACION_INVALIDA,
            'Ya hay una invitación pendiente para ese correo.',
            'Conflict',
          );
        }
        throw err;
      }
    });
  }
}

/** pg devuelve `numeric` como string para no perder precisión. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
