import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService } from '../database/db.service';
import { TokensService, type Rol } from '../auth/tokens.service';
import { AppError, ErrorCode } from '../common/app-error';

export interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  estado: string;
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
  async listar(tenantId: string): Promise<Miembro[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        usuario_id: string;
        nombre: string;
        email: string;
        rol: Rol;
        estado: string;
      }>(
        `SELECT m.usuario_id, u.nombre, u.email::text AS email, m.rol, m.estado
           FROM membresia m
           JOIN usuario u ON u.id = m.usuario_id
          ORDER BY u.nombre`,
      );
      return rows.map((r) => ({
        usuarioId: r.usuario_id,
        nombre: r.nombre,
        email: r.email,
        rol: r.rol,
        estado: r.estado,
      }));
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
