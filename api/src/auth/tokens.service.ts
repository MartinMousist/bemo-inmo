import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
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

  verificarAccess(token: string): Claims {
    // `algorithms` explícito: sin esto un atacante puede firmar con "none" o
    // degradar el algoritmo y el token se acepta igual.
    const payload = jwt.verify(token, this.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string') throw new Error('payload inesperado');
    return { sub: payload.sub as string, tid: payload.tid, rol: payload.rol };
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
