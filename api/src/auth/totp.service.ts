import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import {
  generarCodigosRecuperacion, generarSecreto, uriOtpauth, verificar,
} from './totp.motor';

export interface EstadoTotp {
  activo: boolean;
  confirmadoEl: string | null;
  codigosSinUsar: number;
}

@Injectable()
export class TotpService {
  constructor(private readonly db: DbService) {}

  /** Segundos desde época. Va acá y no en el motor: el motor es puro. */
  private ahora(): number {
    return Math.floor(Date.now() / 1000);
  }

  private hash(codigo: string): string {
    // Se normaliza antes de hashear: la gente escribe con o sin guiones y en
    // minúscula. Sin esto, un código correcto tecleado a mano no entra nunca.
    return createHash('sha256')
      .update(codigo.replace(/[\s-]/g, '').toUpperCase())
      .digest('hex');
  }

  async estado(usuarioId: string): Promise<EstadoTotp> {
    const filas = await this.db.query<{
      activo: boolean;
      confirmado_el: Date | null;
      codigos_sin_usar: number;
    }>('SELECT * FROM app_totp_estado($1)', [usuarioId]);

    const f = filas[0];
    return {
      activo: f?.activo ?? false,
      confirmadoEl: f?.confirmado_el ? f.confirmado_el.toISOString() : null,
      codigosSinUsar: f?.codigos_sin_usar ?? 0,
    };
  }

  /**
   * Paso 1: se genera el secreto y se guarda SIN confirmar.
   *
   * Sin confirmar a propósito: entre que se escanea el QR y se escribe el
   * primer código puede fallar cualquier cosa —el reloj del teléfono, la app
   * equivocada, un cierre de pestaña—. Si se activara acá, quien abandone a la
   * mitad queda afuera de su propia cuenta sin haber hecho nada mal.
   */
  async iniciar(tenantId: string, usuarioId: string): Promise<{ secreto: string; uri: string }> {
    // El email sale de la base y no del token: el token no lo lleva, y ponerlo
    // ahí sería agrandar el JWT para todos por una pantalla que se usa una vez.
    const email = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ email: string }>(
        'SELECT email FROM usuario WHERE id = $1', [usuarioId],
      );
      return rows[0]?.email ?? 'usuario';
    });

    const secreto = generarSecreto();
    await this.db.query('SELECT app_totp_iniciar($1, $2)', [usuarioId, secreto]);
    return { secreto, uri: uriOtpauth(secreto, email) };
  }

  /**
   * Paso 2: se prueba que el teléfono realmente genera el código.
   *
   * Devuelve los códigos de recuperación UNA sola vez. No se pueden volver a
   * ver: en la base están hasheados, así que ni nosotros los tenemos.
   */
  async confirmar(
    tenantId: string,
    usuarioId: string,
    codigo: string,
  ): Promise<{ codigosRecuperacion: string[] }> {
    const secreto = await this.secretoSinConfirmar(tenantId, usuarioId);

    if (!verificar(secreto, codigo, this.ahora())) {
      throw new AppError(
        422,
        ErrorCode.CODIGO_INVALIDO,
        'Ese código no es correcto. Revisá que la hora del teléfono esté en automático.',
        'Unprocessable Entity',
      );
    }

    const codigos = generarCodigosRecuperacion();
    await this.db.query('SELECT app_totp_confirmar($1, $2)', [
      usuarioId,
      codigos.map((c) => this.hash(c)),
    ]);

    return { codigosRecuperacion: codigos };
  }

  /**
   * Apagarlo exige un código vigente, no sólo estar logueado.
   *
   * Si alcanzara con la sesión, quien se robe una sesión abierta apaga el
   * segundo factor y se queda con la cuenta — y el segundo factor no habría
   * servido para nada.
   */
  async desactivar(usuarioId: string, codigo: string): Promise<void> {
    const filas = await this.db.query<{ secreto: string }>(
      'SELECT * FROM app_totp_activo($1)', [usuarioId],
    );
    const secreto = filas[0]?.secreto;

    if (!secreto) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'No tenés el segundo factor activo.', 'Unprocessable Entity',
      );
    }

    const valido =
      verificar(secreto, codigo, this.ahora()) ||
      (await this.consumirRecuperacion(usuarioId, codigo));

    if (!valido) {
      throw new AppError(
        422, ErrorCode.CODIGO_INVALIDO,
        'Ese código no es correcto.', 'Unprocessable Entity',
      );
    }

    await this.db.query('SELECT app_totp_desactivar($1)', [usuarioId]);
  }

  /** ¿Este usuario tiene que presentar un código para entrar? */
  async exigeSegundoFactor(usuarioId: string): Promise<string | null> {
    const filas = await this.db.query<{ secreto: string }>(
      'SELECT * FROM app_totp_activo($1)', [usuarioId],
    );
    return filas[0]?.secreto ?? null;
  }

  /**
   * El código del login: vale el del teléfono o uno de recuperación.
   *
   * Los dos caminos en la misma puerta porque para quien entra son la misma
   * cosa —un código que escribe en la misma casilla— y separarlos obligaría a
   * elegir «perdí el teléfono» ANTES de saber si el código anda.
   */
  async validarCodigo(usuarioId: string, secreto: string, codigo: string): Promise<boolean> {
    if (verificar(secreto, codigo, this.ahora())) return true;
    return this.consumirRecuperacion(usuarioId, codigo);
  }

  private async consumirRecuperacion(usuarioId: string, codigo: string): Promise<boolean> {
    const filas = await this.db.query<{ app_totp_usar_recuperacion: boolean }>(
      'SELECT app_totp_usar_recuperacion($1, $2)', [usuarioId, this.hash(codigo)],
    );
    return filas[0]?.app_totp_usar_recuperacion ?? false;
  }

  /**
   * El secreto todavía sin confirmar, leído bajo RLS.
   *
   * Sin función SECURITY DEFINER a diferencia del login: acá SÍ hay contexto de
   * inmobiliaria —la persona ya está autenticada— y la política de `usuario`
   * la deja verse a sí misma por su membresía. Es la regla del repo: si RLS
   * alcanza, RLS.
   */
  private async secretoSinConfirmar(tenantId: string, usuarioId: string): Promise<string> {
    const secreto = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ totp_secreto: string | null }>(
        'SELECT totp_secreto FROM usuario WHERE id = $1', [usuarioId],
      );
      return rows[0]?.totp_secreto ?? null;
    });

    if (!secreto) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Primero hay que empezar el alta del segundo factor.',
        'Unprocessable Entity',
      );
    }
    return secreto;
  }
}
