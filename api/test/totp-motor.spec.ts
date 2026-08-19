import {
  base32Decode, base32Encode, codigoEn, generarCodigosRecuperacion,
  generarSecreto, uriOtpauth, verificar,
} from '../src/auth/totp.motor';

/**
 * TOTP contra los vectores del RFC 6238.
 *
 * Es la razón por la que esto se pudo escribir a mano en vez de sumar una
 * dependencia: el estándar publica los códigos esperados para instantes
 * concretos, así que no se prueba «lo que me pareció», se prueba el estándar.
 *
 * El secreto de los vectores es el ASCII "12345678901234567890" — 20 bytes,
 * que es lo que pide SHA-1.
 */

const SECRETO_RFC = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP — motor', () => {
  describe('los vectores del RFC 6238', () => {
    // Del apéndice B del RFC, columna SHA1. Vienen a 8 dígitos; el sistema usa
    // 6, que son los últimos seis de los mismos ocho.
    const VECTORES: Array<[number, string]> = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ];

    it.each(VECTORES)('en t=%i el código es %s', (t, esperado) => {
      expect(codigoEn(SECRETO_RFC, t, 8)).toBe(esperado);
      expect(codigoEn(SECRETO_RFC, t)).toBe(esperado.slice(-6));
    });

    it('t=20000000000 no desborda', () => {
      // El contador va como entero de 64 bits. Con aritmética de `number` esto
      // pasaría igual hoy, pero el motor usa BigInt porque un desbordamiento
      // silencioso en un control de acceso no se deja para después.
      expect(codigoEn(SECRETO_RFC, 20_000_000_000, 8)).toBe('65353130');
    });
  });

  describe('base32', () => {
    it('ida y vuelta', () => {
      const datos = Buffer.from('12345678901234567890', 'ascii');
      expect(base32Decode(base32Encode(datos))).toEqual(datos);
    });

    it('acepta minúsculas, espacios y relleno — es lo que la gente pega', () => {
      const con = base32Encode(Buffer.from('hola mundo'));
      expect(base32Decode(con.toLowerCase())).toEqual(base32Decode(con));
      expect(base32Decode(`${con.slice(0, 4)} ${con.slice(4)}`)).toEqual(base32Decode(con));
    });

    it('un carácter que no existe en el alfabeto se rechaza', () => {
      // '1', '8', '0' y '9' NO están en base32: se confunden con I, B, O y g.
      expect(() => base32Decode('AAAA1AAA')).toThrow();
    });
  });

  describe('verificar', () => {
    const AHORA = 1_700_000_000;

    it('acepta el código del momento', () => {
      expect(verificar(SECRETO_RFC, codigoEn(SECRETO_RFC, AHORA), AHORA)).toBe(true);
    });

    it('acepta el paso anterior y el siguiente: los relojes se desfasan', () => {
      expect(verificar(SECRETO_RFC, codigoEn(SECRETO_RFC, AHORA - 30), AHORA)).toBe(true);
      expect(verificar(SECRETO_RFC, codigoEn(SECRETO_RFC, AHORA + 30), AHORA)).toBe(true);
    });

    it('NO acepta dos pasos: la ventana tiene un límite', () => {
      expect(verificar(SECRETO_RFC, codigoEn(SECRETO_RFC, AHORA - 90), AHORA)).toBe(false);
    });

    it('rechaza lo que no es un código de seis dígitos sin hacer cuentas', () => {
      for (const basura of ['', '123', '1234567', 'abcdef', '12 34 56 78']) {
        expect(verificar(SECRETO_RFC, basura, AHORA)).toBe(false);
      }
    });

    it('acepta espacios en el medio: se pega desde el teléfono', () => {
      const c = codigoEn(SECRETO_RFC, AHORA);
      expect(verificar(SECRETO_RFC, `${c.slice(0, 3)} ${c.slice(3)}`, AHORA)).toBe(true);
    });
  });

  describe('secretos y códigos de recuperación', () => {
    it('cada secreto es distinto y tiene 160 bits', () => {
      const a = generarSecreto();
      const b = generarSecreto();
      expect(a).not.toBe(b);
      expect(base32Decode(a)).toHaveLength(20);
    });

    it('la URI lleva el emisor dos veces, que es lo que leen las apps', () => {
      const uri = uriOtpauth('ABCD', 'ana@inmo.test');
      expect(uri).toContain('otpauth://totp/Bemo%20INMO%3Aana%40inmo.test');
      expect(uri).toContain('issuer=Bemo+INMO');
      expect(uri).toContain('secret=ABCD');
    });

    it('los códigos de recuperación son ocho, únicos y legibles', () => {
      const codigos = generarCodigosRecuperacion();
      expect(codigos).toHaveLength(8);
      expect(new Set(codigos).size).toBe(8);
      // 80 bits en cuatro grupos de cuatro.
      for (const c of codigos) expect(c).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
    });
  });
});
