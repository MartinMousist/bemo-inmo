import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { TokensService, type Rol } from './tokens.service';

const COSTO_BCRYPT = 12;

export interface Contexto {
  ip?: string;
  userAgent?: string;
}

export interface Sesion {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nombre: string };
  tenant: { id: string; nombre: string };
  rol: Rol;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
  ) {}

  async registrar(
    datos: {
      inmobiliaria: string;
      provincia?: string;
      email: string;
      password: string;
      nombre: string;
      /** `inmobiliaria` u `gestor`. Ver `cuenta/modulos.motor.ts`. */
      tipo?: string;
    },
    ctx: Contexto,
  ): Promise<Sesion> {
    const hash = await bcrypt.hash(datos.password, COSTO_BCRYPT);

    let filas: Array<{ usuario_id: string; tenant_id: string }>;
    try {
      filas = await this.db.query(
        'SELECT * FROM app_signup($1, $2, $3, $4, $5)',
        [datos.inmobiliaria, datos.provincia ?? null, datos.email, hash, datos.nombre],
      );
    } catch (err) {
      if (codigoPg(err) === '23505') {
        throw new AppError(
          409,
          ErrorCode.EMAIL_EN_USO,
          'Ya existe una cuenta con ese correo.',
          'Conflict',
        );
      }
      throw err;
    }

    const { usuario_id, tenant_id } = filas[0];

    // El tipo se escribe DESPUÉS del alta y no adentro de `app_signup`.
    //
    // Esa función es `SECURITY DEFINER` —corre con privilegios elevados para
    // poder crear el tenant antes de que exista contexto de tenant— y agregarle
    // un parámetro por una preferencia de interfaz amplía la superficie de la
    // única función del sistema que puede escribir sin RLS. El UPDATE de acá
    // pasa por el rol de la app y hace exactamente lo mismo.
    //
    // La ventana entre las dos escrituras no la ve nadie: es la misma request y
    // la sesión se emite recién abajo.
    // Y va por `withTenant`, no por `db.query` pelado: `tenant` tiene RLS, y sin
    // contexto la policy no devuelve filas — el UPDATE no falla, no escribe
    // nada y el signup se guarda como inmobiliaria sin que nadie se entere. Es
    // la trampa que el proyecto ya tiene anotada: olvidarse un `withTenant`
    // rompe la feature, no filtra datos.
    if (datos.tipo && datos.tipo !== 'inmobiliaria') {
      await this.db.withTenant(tenant_id, (ej) =>
        ej.query('UPDATE tenant SET tipo = $2 WHERE id = $1', [tenant_id, datos.tipo]),
      );
    }

    await this.auditar(tenant_id, usuario_id, 'auth.signup', 'permitido', ctx, {
      tipo: datos.tipo ?? 'inmobiliaria',
    });
    return this.emitirSesion(usuario_id, tenant_id, ctx);
  }

  async login(email: string, password: string, ctx: Contexto): Promise<Sesion> {
    const usuarios = await this.db.query<{
      id: string;
      password_hash: string;
      nombre: string;
      estado: string;
    }>('SELECT * FROM app_usuario_por_email($1)', [email]);

    const usuario = usuarios[0];

    // Se compara SIEMPRE, exista el usuario o no. Si se cortara antes, la
    // diferencia de tiempo de respuesta delataría qué correos están registrados.
    const hashComparable = usuario?.password_hash ?? HASH_SEÑUELO;
    const coincide = await bcrypt.compare(password, hashComparable);

    if (!usuario || !coincide || usuario.estado !== 'activo') {
      await this.auditar(null, usuario?.id ?? null, 'auth.login', 'denegado', ctx, {
        email,
        motivo: !usuario ? 'inexistente' : !coincide ? 'password' : 'suspendido',
      });
      // Mensaje idéntico en los tres casos: decir "el usuario no existe" es
      // regalar un enumerador de cuentas.
      throw new AppError(
        401,
        ErrorCode.CREDENCIALES_INVALIDAS,
        'Correo o contraseña incorrectos.',
        'Unauthorized',
      );
    }

    const membresias = await this.db.query<{
      tenant_id: string;
      tenant_nombre: string;
      rol: Rol;
    }>('SELECT * FROM app_membresias_de_usuario($1)', [usuario.id]);

    if (membresias.length === 0) {
      await this.auditar(null, usuario.id, 'auth.login', 'denegado', ctx, {
        motivo: 'sin_membresias',
      });
      throw new AppError(
        403,
        ErrorCode.SIN_MEMBRESIA,
        'Tu cuenta no está asociada a ninguna inmobiliaria activa.',
        'Forbidden',
      );
    }

    // Con una sola membresía se entra directo. El selector de inmobiliaria para
    // usuarios con varias llega cuando exista un caso real: hoy no lo hay.
    const elegida = membresias[0];
    await this.auditar(elegida.tenant_id, usuario.id, 'auth.login', 'permitido', ctx);
    return this.emitirSesion(usuario.id, elegida.tenant_id, ctx);
  }

  /**
   * Rotación. Cada refresh consume su token y emite otro.
   *
   * La detección de reuso vive en `app_sesion_rotar` porque tiene que ser
   * atómica: si el atacante y el usuario legítimo refrescan a la vez, dos
   * chequeos en la aplicación pasarían los dos.
   */
  async refrescar(refreshToken: string, ctx: Contexto): Promise<Sesion> {
    const nuevo = this.tokens.generarRefresh();

    const filas = await this.db.query<{
      resultado: string;
      usuario_id: string | null;
      tenant_id: string | null;
      rol: Rol | null;
    }>('SELECT * FROM app_sesion_rotar($1, $2, $3, $4, $5)', [
      this.tokens.hashear(refreshToken),
      nuevo.hash,
      this.tokens.expiracionRefresh(),
      ctx.ip ?? null,
      ctx.userAgent ?? null,
    ]);

    const r = filas[0];

    if (r.resultado === 'reuso') {
      // La función ya revocó TODAS las sesiones del usuario y lo auditó.
      this.logger.warn(`Reuso de refresh token detectado — usuario ${r.usuario_id}`);
      throw new AppError(
        401,
        ErrorCode.SESION_COMPROMETIDA,
        'Se detectó un uso indebido de la sesión. Por seguridad se cerraron todas las sesiones.',
        'Unauthorized',
      );
    }

    if (r.resultado !== 'ok') {
      throw new AppError(
        401,
        ErrorCode.SESION_INVALIDA,
        'La sesión expiró o no es válida.',
        'Unauthorized',
      );
    }

    const datos = await this.datosDeSesion(r.usuario_id!, r.tenant_id!);

    return {
      accessToken: this.tokens.firmarAccess({
        sub: r.usuario_id!,
        tid: r.tenant_id!,
        rol: r.rol!,
      }),
      refreshToken: nuevo.token,
      ...datos,
      rol: r.rol!,
    };
  }

  async cerrarSesion(refreshToken: string | undefined, ctx: Contexto): Promise<void> {
    if (!refreshToken) return;
    await this.db.query('SELECT app_sesion_revocar($1)', [
      this.tokens.hashear(refreshToken),
    ]);
    await this.auditar(null, null, 'auth.logout', 'permitido', ctx);
  }

  async aceptarInvitacion(
    token: string,
    password: string,
    nombre: string,
    ctx: Contexto,
  ): Promise<Sesion> {
    const hash = await bcrypt.hash(password, COSTO_BCRYPT);

    const filas = await this.db.query<{
      resultado: string;
      usuario_id: string | null;
      tenant_id: string | null;
    }>('SELECT * FROM app_invitacion_aceptar($1, $2, $3)', [
      this.tokens.hashear(token),
      hash,
      nombre,
    ]);

    const r = filas[0];
    if (r.resultado !== 'ok') {
      throw new AppError(
        400,
        ErrorCode.INVITACION_INVALIDA,
        {
          invalida: 'La invitación no existe.',
          ya_aceptada: 'Esa invitación ya fue aceptada.',
          cancelada: 'La invitación fue cancelada.',
          expirada: 'La invitación venció. Pedí una nueva.',
        }[r.resultado] ?? 'La invitación no es válida.',
        'Bad Request',
      );
    }

    await this.auditar(
      r.tenant_id,
      r.usuario_id,
      'auth.invitacion_aceptada',
      'permitido',
      ctx,
    );
    return this.emitirSesion(r.usuario_id!, r.tenant_id!, ctx);
  }

  /** Quién soy: nombre del usuario y de la inmobiliaria, no sólo los ids. */
  async quienSoy(
    usuarioId: string,
    tenantId: string,
  ): Promise<{ usuario: { id: string; nombre: string }; tenant: { id: string; nombre: string } }> {
    return this.datosDeSesion(usuarioId, tenantId);
  }

  async auditar(
    tenantId: string | null,
    usuarioId: string | null,
    accion: string,
    resultado: 'permitido' | 'denegado',
    ctx: Contexto,
    detalle: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.db.query(
        'SELECT app_auditar($1, $2, $3, $4, NULL, NULL, $5, $6, $7)',
        [
          tenantId,
          usuarioId,
          accion,
          resultado,
          ctx.ip ?? null,
          ctx.userAgent ?? null,
          JSON.stringify(detalle),
        ],
      );
    } catch (err) {
      // Auditar no puede tumbar la operación, pero tampoco puede desaparecer
      // en silencio: si falla, queda en el log del servidor.
      this.logger.error(
        `No se pudo auditar ${accion}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async emitirSesion(
    usuarioId: string,
    tenantId: string,
    ctx: Contexto,
  ): Promise<Sesion> {
    const refresh = this.tokens.generarRefresh();

    await this.db.query('SELECT app_sesion_crear($1, $2, $3, $4, $5, $6)', [
      usuarioId,
      tenantId,
      refresh.hash,
      this.tokens.expiracionRefresh(),
      ctx.ip ?? null,
      ctx.userAgent ?? null,
    ]);

    const membresias = await this.db.query<{ tenant_id: string; rol: Rol }>(
      'SELECT * FROM app_membresias_de_usuario($1)',
      [usuarioId],
    );
    const rol = membresias.find((m) => m.tenant_id === tenantId)!.rol;

    const datos = await this.datosDeSesion(usuarioId, tenantId);

    return {
      accessToken: this.tokens.firmarAccess({ sub: usuarioId, tid: tenantId, rol }),
      refreshToken: refresh.token,
      ...datos,
      rol,
    };
  }

  private async datosDeSesion(
    usuarioId: string,
    tenantId: string,
  ): Promise<{ usuario: { id: string; nombre: string }; tenant: { id: string; nombre: string } }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: us } = await ej.query<{ nombre: string }>(
        'SELECT nombre FROM usuario WHERE id = $1',
        [usuarioId],
      );
      const { rows: ts } = await ej.query<{ nombre: string }>(
        'SELECT nombre FROM tenant WHERE id = $1',
        [tenantId],
      );
      return {
        usuario: { id: usuarioId, nombre: us[0]?.nombre ?? '' },
        tenant: { id: tenantId, nombre: ts[0]?.nombre ?? '' },
      };
    });
  }
}

/**
 * Hash de una contraseña que nadie tiene. Sirve para que `bcrypt.compare` haga
 * el mismo trabajo cuando el correo no existe: sin esto, un login contra un
 * correo inexistente responde mucho más rápido y eso permite enumerar cuentas.
 */
const HASH_SEÑUELO = '$2b$12$C6UzMDM.H6dfI/f/IKcEeODiOnGjPGZ/oCFcOGgD1uJPZ3wQyHRWy';

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
