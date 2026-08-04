import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

export interface EstadoPlan {
  plan: { codigo: string; nombre: string; modulos: string[] };
  estado: string;
  pruebaHasta: string | null;
  limites: Array<{ recurso: string; usado: number; maximo: number | null; permitido: boolean }>;
  /** ⚠️ Todavía no hay integración de cobro. Se dice, no se simula. */
  cobro: { integrado: false; detalle: string };
}

@Injectable()
export class PlanesService {
  constructor(private readonly db: DbService) {}

  async catalogo() {
    const filas = await this.db.query<{
      codigo: string; nombre: string; orden: number;
      max_usuarios: number | null; max_propiedades: number | null;
      max_portales: number | null; modulos: string[];
    }>('SELECT * FROM plan ORDER BY orden');

    return filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      maxUsuarios: f.max_usuarios,
      maxPropiedades: f.max_propiedades,
      maxPortales: f.max_portales,
      modulos: f.modulos,
      // Sin precio: el gate de la etapa 0 es que alguien diga un número
      // concreto. Publicar uno inventado sería justamente lo que no se hace.
      precio: null,
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

      const limites = [];
      for (const recurso of ['usuarios', 'propiedades']) {
        const { rows } = await ej.query<{
          permitido: boolean; usado: number; maximo: number | null;
        }>('SELECT * FROM app_limite_plan($1)', [recurso]);
        limites.push({
          recurso,
          usado: rows[0].usado,
          maximo: rows[0].maximo,
          permitido: rows[0].permitido,
        });
      }

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
