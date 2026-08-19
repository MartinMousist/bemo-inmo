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

export type RolPortal = 'propietario' | 'inquilino';

/**
 * Lo que ve un inquilino con su enlace.
 *
 * **No es la vista del propietario con otros datos**: son dos preguntas
 * distintas. El dueño quiere saber cuánto le entra; el inquilino quiere saber
 * cuánto debe y hasta cuándo tiene contrato. Por eso los saldos van con el
 * signo al revés y no hay una sola mención a honorarios ni a liquidaciones —
 * lo que la inmobiliaria le cobra al dueño no es asunto suyo.
 */
export interface VistaInquilino {
  inmobiliaria: string;
  inquilino: string;
  generadoEl: string;
  contratos: Array<{
    propiedad: string;
    desde: string;
    hasta: string;
    montoActual: number;
    moneda: string;
  }>;
  /** Lo que debe, por moneda. Vacío es «al día», y la pantalla lo dice así. */
  saldo: Array<{ moneda: string; monto: number }>;
  cuotas: Array<{
    periodo: string;
    venceEl: string;
    total: number;
    cobrado: number;
    saldo: number;
    moneda: string;
    estado: string;
  }>;
  /** Si puede reportar un desperfecto: hace falta un contrato vigente. */
  puedeReportar: boolean;
}

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
    /**
     * Qué portal abre este enlace. Sin default a propósito: los dos muestran
     * plata de una persona y elegir por descuido cuál sería mostrarle a un
     * inquilino la liquidación de un propietario.
     */
    rol: RolPortal,
  ): Promise<AccesoCreado> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: pe } = await ej.query<{ id: string }>(
        'SELECT id FROM persona WHERE id = $1',
        [personaId],
      );
      if (!pe.length) throw AppError.notFound('No se encontró esa persona.');

      // Que tenga el rol que el enlace promete. Un acceso para alguien que no
      // lo tiene abre una pantalla vacía y nadie entiende por qué.
      //
      // La comprobación depende del rol —era sólo la de propietario hasta que
      // esta pieza pasó a servir a los dos— y usa la misma definición que
      // `CONJUNTO_ROL` de personas: un rol es una relación, no una columna.
      const { rows: tiene } = await ej.query(
        rol === 'propietario'
          ? `SELECT 1 FROM titularidad WHERE persona_id = $1
              UNION ALL
             SELECT 1 FROM contrato_parte WHERE persona_id = $1 AND rol = 'locador'
              LIMIT 1`
          : `SELECT 1 FROM contrato_parte
              WHERE persona_id = $1 AND rol = 'locatario' LIMIT 1`,
        [personaId],
      );
      if (!tiene.length) {
        throw new AppError(
          422,
          ErrorCode.ESTADO_INVALIDO,
          rol === 'propietario'
            ? 'Esa persona no figura como propietaria de ninguna propiedad, así que '
              + 'el enlace no le mostraría nada.'
            : 'Esa persona no figura como inquilina de ningún contrato, así que '
              + 'el enlace no le mostraría nada.',
          'Unprocessable Entity',
        );
      }

      // Se revoca lo anterior DEL MISMO ROL: alguien puede alquilar una unidad
      // y ser dueño de otra, y revocarle el enlace de propietario al generarle
      // el de inquilino le rompería el que ya estaba usando.
      await ej.query(
        `UPDATE acceso_portal SET revocado_el = now()
          WHERE persona_id = $1 AND rol = $2 AND revocado_el IS NULL`,
        [personaId, rol],
      );

      const token = randomBytes(32).toString('base64url');
      const expira = new Date();
      expira.setDate(expira.getDate() + DIAS_DE_VIDA);

      const { rows } = await ej.query<{ id: string; expira_el: Date }>(
        `INSERT INTO acceso_portal
           (tenant_id, persona_id, token_hash, expira_el, creado_por, rol)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expira_el`,
        [tenantId, personaId, hash(token), expira, usuarioId, rol],
      );

      return {
        id: rows[0].id,
        token,
        ruta: `/${rol}/${token}`,
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
           FROM acceso_portal
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
        `UPDATE acceso_portal SET revocado_el = now()
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
    // Por `resolver()`, que además comprueba el ROL.
    //
    // Cuando esta pieza servía a un solo portal, resolver el token alcanzaba.
    // Con dos, no: sin el chequeo de rol, un inquilino que cambia `/inquilino`
    // por `/propietario` en su propia URL abre la vista del dueño y le ve las
    // liquidaciones. Se encontró probando exactamente eso.
    const { tenantId, personaId, accesoId } = await this.resolver(token, 'propietario');

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

  /**
   * La vista del inquilino. Mismo token, misma resolución, otro contenido.
   *
   * Se comprueba el ROL del acceso: un enlace de propietario no abre esta
   * pantalla aunque el uuid sea válido. Sin ese chequeo, cambiar `/propietario`
   * por `/inquilino` en la URL mostraría la otra vista con el mismo token.
   */
  async vistaInquilino(token: string): Promise<VistaInquilino> {
    const { tenantId, personaId, accesoId } = await this.resolver(token, 'inquilino');
    await this.db.query('SELECT app_marcar_uso_acceso($1)', [accesoId]);

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: cab } = await ej.query<{ inmobiliaria: string; inquilino: string }>(
        `SELECT t.nombre AS inmobiliaria,
                trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) AS inquilino
           FROM tenant t, persona p WHERE t.id = $1 AND p.id = $2`,
        [tenantId, personaId],
      );

      const { rows: contratos } = await ej.query<{
        id: string; propiedad: string; desde: string; hasta: string;
        monto: string; moneda: string; vigente: boolean;
      }>(
        `SELECT c.id,
                pr.calle || coalesce(' ' || pr.numero, '') AS propiedad,
                c.fecha_inicio::text AS desde, c.fecha_fin::text AS hasta,
                c.monto_inicial::text AS monto, c.moneda,
                c.estado = 'vigente' AS vigente
           FROM contrato_alquiler c
           JOIN contrato_parte cp ON cp.contrato_id = c.id
           JOIN propiedad pr ON pr.id = c.propiedad_id
          WHERE cp.persona_id = $1 AND cp.rol = 'locatario'
          ORDER BY c.fecha_inicio DESC`,
        [personaId],
      );

      const ids = contratos.map((c) => c.id);
      // `cuotasDe` devuelve un Map por contrato —así lo usa la vista del
      // propietario, que las muestra agrupadas—. Acá se aplanan: el inquilino
      // ve UNA cuenta, aunque alquile dos unidades a la misma inmobiliaria.
      const porContrato = ids.length ? await this.cuotasDe(ej, ids) : new Map();
      const cuotas = [...porContrato.values()].flat();

      // El saldo se arma de las cuotas ya traídas y no con otra consulta: dos
      // consultas que suman lo mismo son dos números que se pueden desdecir.
      const porMoneda = new Map<string, number>();
      for (const q of cuotas) {
        if (q.saldo > 0) porMoneda.set(q.moneda, (porMoneda.get(q.moneda) ?? 0) + q.saldo);
      }

      return {
        inmobiliaria: cab[0]?.inmobiliaria ?? '',
        inquilino: cab[0]?.inquilino ?? '',
        generadoEl: new Date().toISOString(),
        contratos: contratos.map((c) => ({
          propiedad: c.propiedad,
          // `date` de Postgres: se recorta el texto, no se pasa por `Date`.
          desde: String(c.desde).slice(0, 10),
          hasta: String(c.hasta).slice(0, 10),
          montoActual: Number(c.monto),
          moneda: c.moneda,
        })),
        saldo: [...porMoneda.entries()]
          .map(([moneda, monto]) => ({ moneda, monto: Math.round(monto * 100) / 100 }))
          .sort((a, b) => a.moneda.localeCompare(b.moneda)),
        cuotas,
        puedeReportar: contratos.some((c) => c.vigente),
      };
    });
  }

  /**
   * Reportar un desperfecto desde el portal.
   *
   * Va por función de base: quien reporta no tiene sesión ni usuario, así que
   * no puede escribir en `reclamo` por el camino normal. La propiedad NO la
   * elige: sale de su contrato vigente, que es lo que hace que el reclamo
   * llegue identificado y lo que impide reportar sobre una unidad ajena.
   */
  async reportar(token: string, categoria: string, descripcion: string): Promise<{ id: string }> {
    const { accesoId } = await this.resolver(token, 'inquilino');
    try {
      const filas = await this.db.query<{ app_reclamo_desde_portal: string }>(
        'SELECT app_reclamo_desde_portal($1, $2, $3)',
        [accesoId, categoria, descripcion],
      );
      return { id: filas[0].app_reclamo_desde_portal };
    } catch (err) {
      if ((err as { code?: string }).code === 'BE003') {
        throw new AppError(
          409, ErrorCode.VALIDATION_FAILED,
          'No hay un contrato vigente asociado a este enlace.',
          'Conflict',
        );
      }
      throw err;
    }
  }

  /** Resuelve el token y comprueba que sea del portal que se está abriendo. */
  private async resolver(
    token: string,
    rol: RolPortal,
  ): Promise<{ tenantId: string; personaId: string; accesoId: string }> {
    const r = await this.db.query<{
      tenant_id: string; persona_id: string; acceso_id: string; rol: string;
    }>('SELECT * FROM app_resolver_acceso_portal($1)', [hash(token)]);

    // El rol se compara acá y no en la función: un enlace de propietario que
    // no abre la vista de inquilino tiene que dar EXACTAMENTE el mismo error
    // que un token inventado. Distinguirlos diría que ese token existe.
    if (!r.length || r[0].rol !== rol) {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        'Este enlace no es válido o ya venció. Pedile uno nuevo a tu inmobiliaria.',
        'Not Found',
      );
    }
    return { tenantId: r[0].tenant_id, personaId: r[0].persona_id, accesoId: r[0].acceso_id };
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
