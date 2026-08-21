import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DbService } from '../database/db.service';
import { MODULOS } from '../cuenta/modulos.motor';
import { AppError, ErrorCode } from '../common/app-error';

export interface EstadoPlan {
  plan: { codigo: string; nombre: string; modulos: string[] };
  estado: string;
  pruebaHasta: string | null;
  limites: Array<{ recurso: string; usado: number; maximo: number | null; permitido: boolean }>;
  /** ⚠️ Todavía no hay integración de cobro. Se dice, no se simula. */
  cobro: { integrado: false; detalle: string };
}

/** El catálogo por clave, para no recorrerlo en cada fila. */
const CATALOGO = new Map(MODULOS.map((m) => [m.clave, m]));

@Injectable()
export class PlanesService {
  constructor(private readonly db: DbService) {}

  async catalogo() {
    const filas = await this.db.query<{
      codigo: string; familia: string; nombre: string; orden: number;
      resumen: string | null; para_quien: string | null;
      precio_usd: string | null;
      max_usuarios: number | null; max_propiedades: number | null;
      max_portales: number | null; max_contratos: number | null;
      max_sucursales: number | null; max_canales: number | null;
      max_envios_mes: number | null; max_red_compartidas: number | null;
      modulos: string[];
    // Gestión primero: alfabéticamente sale antes que «inmobiliaria», y además
    // es el orden correcto — es la puerta de entrada al sistema.
    }>('SELECT * FROM plan ORDER BY familia, orden');

    return filas.map((f) => ({
      codigo: f.codigo,
      // `gestion` o `inmobiliaria`. No son cuatro tamaños del mismo producto:
      // son dos productos, y la página de precios los muestra separados.
      familia: f.familia,
      nombre: f.nombre,
      resumen: f.resumen,
      paraQuien: f.para_quien,
      maxUsuarios: f.max_usuarios,
      maxPropiedades: f.max_propiedades,
      maxPortales: f.max_portales,
      maxContratos: f.max_contratos,
      maxSucursales: f.max_sucursales,
      maxCanales: f.max_canales,
      maxEnviosMes: f.max_envios_mes,
      maxRedCompartidas: f.max_red_compartidas,
      /**
       * Los módulos ENRIQUECIDOS, no las claves sueltas.
       *
       * Antes esto devolvía `['liquidaciones', 'portal', …]` y cada pantalla se
       * arreglaba sola: la landing tenía la lista escrita a mano y «Tu plan»
       * tenía su propio diccionario de nombres. Ya habían divergido —la landing
       * seguía ofreciendo «Inicial, Medio y Pro», que dejaron de existir en la
       * migración 046— y ninguna de las dos sabía si lo que prometía existe.
       *
       * Un tilde en una página de precios es una promesa. Ahora el nombre, el
       * detalle y el estado salen de UN lugar, `cuenta/modulos.motor.ts`, que
       * es el mismo que decide qué se ve en el menú.
       */
      modulos: f.modulos.map((clave) => {
        const m = CATALOGO.get(clave);
        return {
          clave,
          nombre: m?.nombre ?? clave,
          detalle: m?.detalle ?? '',
          // Sin estado declarado se asume `pronto`, no `listo`: si alguien
          // agrega un módulo y se olvida de decir si funciona, la página de
          // precios prefiere prometer de menos.
          estado: m?.estado ?? 'pronto',
          nota: m?.nota ?? null,
        };
      }),
      /**
       * El precio sale de la BASE, y hoy está vacío.
       *
       * El gate de la etapa 0 es que alguien diga un número concreto; hasta
       * entonces la página dice «A convenir». Antes esto era un `null` escrito a
       * mano en el código, así que ni siquiera cargando la columna aparecía
       * nada: la propuesta está en docs/planes.md con su UPDATE listo, y ahora
       * ese UPDATE alcanza para publicarlo.
       */
      precio: f.precio_usd === null ? null : Number(f.precio_usd),
    }));
  }

  async estado(tenantId: string): Promise<EstadoPlan> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: s } = await ej.query<{
        plan_codigo: string; nombre: string; modulos: string[];
        estado: string; prueba_hasta: string | null;
      }>(
        `SELECT s.plan_codigo, p.nombre, p.modulos, s.estado, s.prueba_hasta
           FROM suscripcion s JOIN plan p ON p.codigo = s.plan_codigo
          WHERE s.tenant_id = $1`,
        [tenantId],
      );
      if (!s.length) throw AppError.notFound('Esta cuenta no tiene una suscripción.');

      // Los dos recursos en una sola consulta, con LATERAL. Son sólo dos hoy,
      // pero el patrón "una consulta por elemento de una lista" es el que hay
      // que no dejar crecer: el día que haya seis límites, son seis viajes.
      const { rows: limites } = await ej.query<{
        recurso: string; permitido: boolean; usado: number; maximo: number | null;
      }>(
        `SELECT r.recurso, l.permitido, l.usado, l.maximo
           FROM unnest($1::text[]) AS r(recurso),
                LATERAL app_limite_plan(r.recurso) AS l
          ORDER BY array_position($1::text[], r.recurso)`,
        [['usuarios', 'propiedades']],
      );

      return {
        plan: { codigo: s[0].plan_codigo, nombre: s[0].nombre, modulos: s[0].modulos },
        estado: s[0].estado,
        pruebaHasta: s[0].prueba_hasta,
        limites,
        cobro: {
          integrado: false as const,
          detalle:
            'Todavía no hay medio de pago integrado. Los planes y sus límites ya funcionan; ' +
            'el cobro se coordina fuera del sistema.',
        },
      };
    });
  }

  /** ¿El plan incluye este módulo? Lo usan los guards y la UI. */
  async tieneModulo(tenantId: string, modulo: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ tiene: boolean }>(
        'SELECT app_tiene_modulo($1) AS tiene',
        [modulo],
      );
      return rows[0].tiene;
    });
  }

  async exigirModulo(tenantId: string, modulo: string): Promise<void> {
    if (!(await this.tieneModulo(tenantId, modulo))) {
      throw new AppError(
        403,
        ErrorCode.MODULO_NO_INCLUIDO,
        `El módulo "${modulo}" no está incluido en tu plan.`,
        'Forbidden',
      );
    }
  }

  // ── Sucursales (módulo multisucursal) ──────────────────────────────────────

  async listarSucursales(tenantId: string) {
    await this.exigirModulo(tenantId, 'multisucursal');
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT id, nombre, direccion, telefono, activa,
                (SELECT count(*)::int FROM propiedad p WHERE p.sucursal_id = s.id) AS propiedades
           FROM sucursal s ORDER BY nombre`,
      );
      return rows;
    });
  }

  async crearSucursal(tenantId: string, dto: { nombre: string; direccion?: string }) {
    await this.exigirModulo(tenantId, 'multisucursal');
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rows } = await ej.query<{ id: string }>(
          'INSERT INTO sucursal (tenant_id, nombre, direccion) VALUES ($1,$2,$3) RETURNING id',
          [tenantId, dto.nombre, dto.direccion ?? null],
        );
        return { id: rows[0].id, nombre: dto.nombre };
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(409, ErrorCode.EN_USO, 'Ya existe una sucursal con ese nombre.', 'Conflict');
        }
        throw err;
      }
    });
  }

  // ── API pública (módulo api) ───────────────────────────────────────────────

  async listarClaves(tenantId: string) {
    await this.exigirModulo(tenantId, 'api');
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT id, nombre, prefijo, ultimo_uso AS "ultimoUso",
                revocada_el AS "revocadaEl", created_at AS "creadaEl"
           FROM api_key ORDER BY created_at DESC`,
      );
      return rows;
    });
  }

  /**
   * La clave se devuelve UNA sola vez, en claro. Después sólo queda el hash.
   * Si se pierde, se revoca y se emite otra — no hay forma de recuperarla, y
   * eso es lo correcto.
   */
  async crearClave(tenantId: string, nombre: string, usuarioId: string) {
    await this.exigirModulo(tenantId, 'api');
    return this.db.withTenant(tenantId, async (ej) => {
      const clave = `bemo_${randomBytes(24).toString('base64url')}`;
      const hash = createHash('sha256').update(clave).digest('hex');

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO api_key (tenant_id, nombre, clave_hash, prefijo, creada_por)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, nombre, hash, clave.slice(0, 12), usuarioId],
      );

      return {
        id: rows[0].id,
        nombre,
        clave,
        aviso: 'Guardala ahora: no se vuelve a mostrar.',
      };
    });
  }

  async revocarClave(tenantId: string, id: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'UPDATE api_key SET revocada_el = now() WHERE id = $1 AND revocada_el IS NULL',
        [id],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa clave, o ya estaba revocada.');
      return { id, revocada: true };
    });
  }
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
