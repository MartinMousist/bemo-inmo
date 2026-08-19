import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';

export type Rol = 'owner' | 'admin' | 'agente' | 'contable';

export interface Claims {
  /** usuario */
  sub: string;
  /** inmobiliaria */
  tid: string;
  rol: Rol;
}

@Injectable()
export class TokensService {
  private readonly env = loadEnv();

  firmarAccess(claims: Claims): string {
    return jwt.sign(claims, this.env.JWT_SECRET, {
      expiresIn: `${this.env.ACCESS_TTL_MIN}m`,
      algorithm: 'HS256',
    });
  }

  /**
   * Verifica contra el secreto actual y, si hay rotación en curso, contra el
   * anterior.
   *
   * El orden importa: primero el nuevo, que es con el que están firmados casi
   * todos. El viejo se prueba sólo cuando el nuevo falló, así que en régimen
   * normal —sin `JWT_SECRET_ANTERIOR`— esto es exactamente lo que era.
   *
   * Un token inválido falla contra los dos y sale el mismo error de siempre: no
   * se distingue «firmado con el viejo» de «basura», porque hacia afuera es la
   * misma respuesta.
   */
  verificarAccess(token: string): Claims {
    const secretos = [this.env.JWT_SECRET, this.env.JWT_SECRET_ANTERIOR].filter(
      (s): s is string => Boolean(s),
    );

    let ultimoError: unknown;
    for (const secreto of secretos) {
      try {
        // `algorithms` explícito: sin esto un atacante puede firmar con "none" o
        // degradar el algoritmo y el token se acepta igual.
        const payload = jwt.verify(token, secreto, { algorithms: ['HS256'] });
        if (typeof payload === 'string') throw new Error('payload inesperado');
        return { sub: payload.sub as string, tid: payload.tid, rol: payload.rol };
      } catch (err) {
        ultimoError = err;
      }
    }
    throw ultimoError;
  }

  /**
   * El pase intermedio entre «la contraseña estaba bien» y «mandá el código».
   *
   * ── Por qué NO es un access token con un claim adentro ──
   *
   * Se firma con una clave DERIVADA del secreto, no con el secreto. Así un
   * desafío no puede verificar como token de acceso ni al revés: no depende de
   * que alguien se acuerde de mirar un campo `typ`, que es la clase de chequeo
   * que se pierde en el próximo refactor. Las dos claves salen del mismo
   * `JWT_SECRET`, así que rotar sigue siendo cambiar una variable.
   *
   * Cinco minutos: es lo que tarda alguien en abrir la app del teléfono, no lo
   * que tarda en irse a almorzar.
   */
  firmarDesafio2fa(usuarioId: string): string {
    return jwt.sign({ sub: usuarioId }, this.claveDesafio(this.env.JWT_SECRET), {
      expiresIn: '5m',
      algorithm: 'HS256',
    });
  }

  /** Devuelve el id del usuario, o tira si el pase no vale o venció. */
  verificarDesafio2fa(token: string): string {
    const secretos = [this.env.JWT_SECRET, this.env.JWT_SECRET_ANTERIOR].filter(
      (s): s is string => Boolean(s),
    );

    let ultimoError: unknown;
    for (const secreto of secretos) {
      try {
        const payload = jwt.verify(token, this.claveDesafio(secreto), {
          algorithms: ['HS256'],
        });
        if (typeof payload === 'string') throw new Error('payload inesperado');
        return payload.sub as string;
      } catch (err) {
        ultimoError = err;
      }
    }
    throw ultimoError;
  }

  private claveDesafio(secreto: string): string {
    return createHmac('sha256', secreto).update('desafio-2fa').digest('hex');
  }

  /**
   * Refresh token opaco. 256 bits de entropía.
   *
   * En la base sólo se guarda el hash: si alguien se lleva un dump, no se lleva
   * sesiones utilizables. SHA-256 sin salt a propósito — el token ya es aleatorio
   * y de alta entropía, así que no hay diccionario que atacar, y necesitamos
   * poder buscarlo por hash en un índice único.
   */
  generarRefresh(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashear(token) };
  }

  hashear(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  expiracionRefresh(): Date {
    return new Date(Date.now() + this.env.REFRESH_TTL_DIAS * 24 * 60 * 60 * 1000);
  }
}
