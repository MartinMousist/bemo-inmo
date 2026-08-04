import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { round2 } from '../alquileres/ajustes.motor';

/**
 * El portal del propietario.
 *
 * Es lo que más llamados ahorra: el dueño pregunta si le pagaron, y el dato ya
 * existe. Hasta ahora la respuesta era que alguien abriera el sistema, mirara y
 * lo dijera por teléfono.
 *
 * Cuatro decisiones que definen qué es esto:
 *
 * 1. **No es un usuario.** No tiene contraseña, no entra a la app, no ve nada de
 *    otras personas y no puede escribir un solo dato. Darle una membresía a un
 *    propietario sería meterlo adentro del sistema para que mire una pantalla.
 *
 * 2. **Sólo lo suyo.** Todas las consultas filtran por `propietario_id`. Que
 *    esté bajo el mismo tenant no alcanza: dentro de una inmobiliaria, un
 *    propietario no puede ver la cartera de otro.
 *
 * 3. **Se guarda el hash del token, no el token.** Si alguien se lleva la base,
 *    no se lleva los enlaces. Mismo criterio que las claves de API.
 *
 * 4. **Vence.** Estos enlaces se mandan por WhatsApp y quedan dando vueltas.
 *    Uno que no vence es un enlace para siempre.
 */

export interface AccesoCreado {
  id: string;
  /** Se devuelve UNA sola vez. Después queda sólo el hash. */
  token: string;
  ruta: string;
  expiraEl: string;
}

export interface VistaPropietario {
  inmobiliaria: string;
  propietario: string;
  generadoEl: string;
  propiedades: Array<{
    etiqueta: string;
    direccion: string;
    porcentaje: number | null;
    contrato: {
      inquilino: string | null;
      desde: string;
      hasta: string;
      montoVigente: number;
      moneda: string;
      estado: string;
      proximoAumento: { vigenteDesde: string; monto: number } | null;
    } | null;
    /** Las últimas cuotas, con lo cobrado y lo que falta. */
    cuotas: Array<{
      periodo: string;
      venceEl: string;
      total: number;
      cobrado: number;
      saldo: number;
      moneda: string;
      estado: string;
    }>;
  }>;
  liquidaciones: Array<{
    periodo: string;
    totalBruto: number;
    totalHonorarios: number;
    totalGastos: number;
    totalNeto: number;
    moneda: string;
    estado: string;
    lineas: Array<{ concepto: string; signo: 1 | -1; monto: number }>;
  }>;
}

/** 30 días. Suficiente para el ciclo mensual, corto para un enlace que circula. */
const DIAS_DE_VIDA = 30;

@Injectable()
export class PortalService {
  private readonly logger = new Logger('Portal');

  constructor(private readonly db: DbService) {}

  // ── Del lado de la inmobiliaria ────────────────────────────────────────────

  async crearAcceso(
    tenantId: string,
    personaId: string,
    usuarioId: string,
  ): Promise<AccesoCreado> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: pe } = await ej.query<{ id: string }>(
        'SELECT id FROM persona WHERE id = $1',
        [personaId],
      );
      if (!pe.length) throw AppError.notFound('No se encontró esa persona.');

      // Que sea propietario de algo. Un enlace para alguien que no tiene
      // propiedades muestra una pantalla vacía y no se entiende por qué.
      const { rows: tiene } = await ej.query(
        `SELECT 1 FROM titularidad WHERE persona_id = $1
          UNION ALL
         SELECT 1 FROM contrato_parte WHERE persona_id = $1 AND rol = 'locador'
          LIMIT 1`,
        [personaId],
      );
      if (!tiene.length) {
        throw new AppError(
          422,
          ErrorCode.ESTADO_INVALIDO,
          'Esa persona no figura como propietaria de ninguna propiedad, así que ' +
            'el enlace no le mostraría nada.',
          'Unprocessable Entity',
        );
      }

      // Se revoca lo anterior: dos enlaces vivos para la misma persona son dos
      // cosas que después hay que acordarse de dar de baja.
      await ej.query(
        `UPDATE acceso_propietario SET revocado_el = now()
          WHERE persona_id = $1 AND revocado_el IS NULL`,
        [personaId],
      );

      const token = randomBytes(32).toString('base64url');
      const expira = new Date();
      expira.setDate(expira.getDate() + DIAS_DE_VIDA);

      const { rows } = await ej.query<{ id: string; expira_el: Date }>(
        `INSERT INTO acceso_propietario
           (tenant_id, persona_id, token_hash, expira_el, creado_por)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, expira_el`,
        [tenantId, personaId, hash(token), expira, usuarioId],
      );

      return {
        id: rows[0].id,
        token,
        ruta: `/propietario/${token}`,
        expiraEl: rows[0].expira_el.toISOString(),
      };
    });
  }

  async listarAccesos(tenantId: string, personaId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; expira_el: Date; revocado_el: Date | null;
        ultimo_uso: Date | null; usos: number; created_at: Date;
      }>(
        `SELECT id, expira_el, revocado_el, ultimo_uso, usos, created_at
           FROM acceso_propietario
          WHERE persona_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [personaId],
      );

      // El token NO se puede volver a mostrar: sólo se guardó su hash. Si se
      // perdió, se genera otro.
      return rows.map((r) => ({
        id: r.id,
        expiraEl: r.expira_el.toISOString(),
        revocadoEl: r.revocado_el?.toISOString() ?? null,
        ultimoUso: r.ultimo_uso?.toISOString() ?? null,
        usos: r.usos,
        creadoEl: r.created_at.toISOString(),
        vigente: !r.revocado_el && r.expira_el > new Date(),
      }));
    });
  }

  async revocar(tenantId: string, accesoId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE acceso_propietario SET revocado_el = now()
          WHERE id = $1 AND revocado_el IS NULL`,
        [accesoId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese enlace, o ya estaba dado de baja.');
    });
  }

  // ── Del lado del propietario ───────────────────────────────────────────────

  /**
   * Resuelve el token y arma la vista.
   *
   * La resolución corre SIN contexto de tenant —quien abre el enlace no tiene
   * sesión— y por eso usa una función SECURITY DEFINER que sólo devuelve a qué
   * inmobiliaria y a qué persona corresponde. Recién con eso se fija el tenant y
   * se lee todo lo demás bajo RLS.
   */
  async vista(token: string): Promise<VistaPropietario> {
    // `db.query` y no `withTenant`: acá todavía NO hay tenant que fijar. Es
    // justamente lo que esta consulta resuelve.
    const r = await this.db.query<{
      tenant_id: string; persona_id: string; acceso_id: string;
    }>('SELECT * FROM app_resolver_acceso_propietario($1)', [hash(token)]);

    if (!r.length) {
      // Un token inválido y uno vencido dan lo MISMO. Distinguirlos le diría a
      // quien prueba enlaces al voleo cuáles existieron alguna vez.
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        'Este enlace no es válido o ya venció. Pedile uno nuevo a tu inmobiliaria.',
        'Not Found',
      );
    }

    const { tenant_id: tenantId, persona_id: personaId, acceso_id: accesoId } = r[0];

    await this.db.query('SELECT app_marcar_uso_acceso($1)', [accesoId]);

    return this.db.withTenant(tenantId, async (ej) => {
      const cabecera = await this.cabecera(ej, tenantId, personaId);
      return {
        ...cabecera,
        generadoEl: new Date().toISOString(),
        propiedades: await this.propiedadesDe(ej, personaId),
        liquidaciones: await this.liquidacionesDe(ej, personaId),
      };
    });
  }

  private async cabecera(ej: Ejecutor, tenantId: string, personaId: string) {
    const { rows } = await ej.query<{ inmobiliaria: string; propietario: string }>(
      `SELECT t.nombre AS inmobiliaria,
              trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS propietario
         FROM persona pe, tenant t
        WHERE pe.id = $1 AND t.id = $2`,
      [personaId, tenantId],
    );
    if (!rows.length) throw AppError.notFound('No se encontró la información.');
    return rows[0];
  }

  private async propiedadesDe(ej: Ejecutor, personaId: string) {
    const { rows } = await ej.query<FilaPropiedad>(
      `SELECT pr.id, pr.codigo,
              trim(pr.calle || ' ' || coalesce(pr.numero,'')) AS direccion,
              t.porcentaje,
              c.id AS contrato_id, c.fecha_inicio, c.fecha_fin, c.moneda, c.estado,
              coalesce(
                (SELECT a.monto_nuevo FROM contrato_ajuste a
                  WHERE a.contrato_id = c.id
                    AND a.estado IN ('confirmado','notificado','aplicado')
                    AND a.vigente_desde <= current_date
                  ORDER BY a.vigente_desde DESC LIMIT 1),
                c.monto_inicial) AS monto_vigente,
              (SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol = 'locatario'
                ORDER BY pe.apellido LIMIT 1) AS inquilino,
              -- Sólo los aumentos ya CONFIRMADOS: uno proyectado todavía puede
              -- cambiar, y mostrárselo al dueño es prometerle un número que no
              -- está decidido.
              (SELECT json_build_object('vigenteDesde', a.vigente_desde, 'monto', a.monto_nuevo)
                 FROM contrato_ajuste a
                WHERE a.contrato_id = c.id
                  AND a.estado IN ('confirmado','notificado')
                  AND a.vigente_desde > current_date
                ORDER BY a.vigente_desde LIMIT 1) AS proximo_aumento
         FROM titularidad t
         JOIN propiedad pr ON pr.id = t.propiedad_id
         LEFT JOIN contrato_alquiler c
           ON c.propiedad_id = pr.id AND c.estado = 'vigente'
        WHERE t.persona_id = $1
        ORDER BY pr.codigo`,
      [personaId],
    );

    const conContrato = rows.filter((f) => f.contrato_id).map((f) => f.contrato_id!);
    const cuotasPorContrato = await this.cuotasDe(ej, conContrato);

    return rows.map((f) => ({
      etiqueta: `PROP-${String(f.codigo).padStart(4, '0')}`,
      direccion: f.direccion,
      porcentaje: f.porcentaje === null ? null : Number(f.porcentaje),
      contrato: f.contrato_id
        ? {
            inquilino: f.inquilino || null,
            desde: iso(f.fecha_inicio!),
            hasta: iso(f.fecha_fin!),
            montoVigente: Number(f.monto_vigente),
            moneda: f.moneda!,
            estado: f.estado!,
            proximoAumento: f.proximo_aumento
              ? {
                  vigenteDesde: iso(String(f.proximo_aumento.vigenteDesde)),
                  monto: Number(f.proximo_aumento.monto),
                }
              : null,
          }
        : null,
      cuotas: cuotasPorContrato.get(f.contrato_id ?? '') ?? [],
    }));
  }

  /**
   * Las últimas seis cuotas de cada contrato, en UNA consulta.
   *
   * Una por contrato sería un N+1 en la pantalla que más se va a abrir de todo
   * el sistema: la abre cada propietario, no cada empleado.
   */
  private async cuotasDe(ej: Ejecutor, contratoIds: string[]) {
    const mapa = new Map<string, VistaPropietario['propiedades'][number]['cuotas']>();
    if (!contratoIds.length) return mapa;

    const { rows } = await ej.query<{
      contrato_id: string; periodo: string; vence_el: string;
      total: string; cobrado: string; moneda: string; estado: string;
    }>(
      `SELECT * FROM (
         SELECT p.contrato_id, p.periodo, p.vence_el, p.total, p.moneda, p.estado,
                coalesce((SELECT sum(co.monto) FROM cobro co
                           WHERE co.periodo_id = p.id AND co.imputacion = 'alquiler'), 0)
                  AS cobrado,
                row_number() OVER (PARTITION BY p.contrato_id ORDER BY p.periodo DESC) AS n
           FROM periodo_alquiler p
          WHERE p.contrato_id = ANY($1::uuid[])
       ) x
        WHERE x.n <= 6
        ORDER BY x.contrato_id, x.periodo DESC`,
      [contratoIds],
    );

    for (const r of rows) {
      const lista = mapa.get(r.contrato_id) ?? [];
      const total = Number(r.total);
      const cobrado = Number(r.cobrado);
      lista.push({
        periodo: iso(r.periodo),
        venceEl: iso(r.vence_el),
        total,
        cobrado,
        saldo: round2(total - cobrado),
        moneda: r.moneda,
        estado: r.estado,
      });
      mapa.set(r.contrato_id, lista);
    }
    return mapa;
  }

  private async liquidacionesDe(ej: Ejecutor, personaId: string) {
    const { rows } = await ej.query<{
      periodo: string; total_bruto: string; total_honorarios: string;
      total_gastos: string; total_neto: string; moneda: string; estado: string;
      lineas: Array<{ concepto: string; signo: number; monto: string }> | null;
    }>(
      // Sólo las CERRADAS y las pagadas: una en borrador todavía puede cambiar,
      // y mostrarle al dueño un número que después se mueve es peor que no
      // mostrarle nada.
      `SELECT l.periodo, l.total_bruto, l.total_honorarios, l.total_gastos,
              l.total_neto, l.moneda, l.estado,
              (SELECT json_agg(json_build_object(
                  'concepto', li.concepto, 'signo', li.signo, 'monto', li.monto)
                  ORDER BY li.signo DESC, li.created_at)
                 FROM liquidacion_linea li WHERE li.liquidacion_id = l.id) AS lineas
         FROM liquidacion l
        WHERE l.propietario_id = $1
          AND l.estado IN ('cerrada','pagada')
        ORDER BY l.periodo DESC
        LIMIT 12`,
      [personaId],
    );

    return rows.map((r) => ({
      periodo: iso(r.periodo),
      totalBruto: Number(r.total_bruto),
      totalHonorarios: Number(r.total_honorarios),
      totalGastos: Number(r.total_gastos),
      totalNeto: Number(r.total_neto),
      moneda: r.moneda,
      estado: r.estado,
      lineas: (r.lineas ?? []).map((l) => ({
        concepto: l.concepto,
        signo: Number(l.signo) as 1 | -1,
        monto: Number(l.monto),
      })),
    }));
  }
}

interface FilaPropiedad {
  id: string;
  codigo: number;
  direccion: string;
  porcentaje: string | null;
  contrato_id: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  moneda: string | null;
  estado: string | null;
  monto_vigente: string;
  inquilino: string | null;
  proximo_aumento: { vigenteDesde: string; monto: string } | null;
}

/** SHA-256. El token no se guarda: si alguien se lleva la base, no se lleva los enlaces. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iso(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}
