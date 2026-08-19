import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) — el código de seis dígitos de Google Authenticator, Aegis,
 * 1Password y cualquier otra.
 *
 * ── Por qué a mano y no con una librería ──
 *
 * Son cuarenta líneas de HMAC-SHA1 y aritmética, con vectores de prueba
 * oficiales publicados en el propio RFC. Una dependencia para esto es una
 * dependencia más en la cadena de suministro de un sistema que maneja plata de
 * terceros —justo lo que la etapa 17.3 fue a mirar— a cambio de código que se
 * lee de una sentada y que está verificado contra el estándar, no contra lo que
 * a mí me pareció.
 *
 * Puro a propósito: sin base de datos y sin red, como el resto de los motores.
 * Se puede probar con los vectores del RFC sin levantar nada.
 */

/** SHA-1 y 6 dígitos: es lo único que TODA app de autenticación soporta. */
const DIGITOS = 6;
const PASO_SEGUNDOS = 30;

/**
 * Cuántos pasos hacia atrás y hacia adelante se aceptan.
 *
 * Uno, o sea ±30 segundos. El reloj de un teléfono se desfasa, y alguien que
 * empieza a tipear a los 28 segundos del paso termina en el siguiente. Con cero
 * el segundo factor «falla solo» de a ratos, y lo que se aprende de eso es a
 * desactivarlo.
 *
 * Más ventana no: cada paso extra multiplica por dos los códigos válidos a la
 * vez.
 */
const VENTANA = 1;

/** Alfabeto base32 de RFC 4648. Es lo que leen los códigos QR de `otpauth://`. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Un secreto nuevo. 20 bytes = 160 bits, que es el tamaño del bloque de SHA-1:
 * más no agrega entropía útil, menos la quita.
 */
export function generarSecreto(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';

  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Lo que sobra se completa con ceros a la derecha.
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];

  return salida;
}

export function base32Decode(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];

  for (const c of limpio) {
    const i = BASE32.indexOf(c);
    if (i === -1) throw new Error(`Carácter inválido en base32: ${c}`);
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * El código para un instante dado.
 *
 * `segundos` va explícito en vez de leer el reloj adentro: es lo que hace que
 * los vectores del RFC se puedan correr como test, y lo que evita un motor que
 * sólo se puede probar esperando treinta segundos.
 */
export function codigoEn(secretoBase32: string, segundos: number, digitos = DIGITOS): string {
  const contador = Math.floor(segundos / PASO_SEGUNDOS);

  // El contador va como entero de 64 bits big-endian. `BigInt` y no aritmética
  // de números: arriba de 2^53 un `number` pierde precisión, y aunque el año
  // 2286 quede lejos, un desbordamiento silencioso en un control de acceso no
  // es algo que se deje pasar «porque falta».
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(contador));

  const hmac = createHmac('sha1', base32Decode(secretoBase32)).update(buffer).digest();

  // Truncamiento dinámico del RFC 4226: los últimos 4 bits dicen dónde empezar
  // a leer, y el bit más alto se descarta para que el número no salga negativo.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/**
 * ¿Es válido este código?
 *
 * La comparación es en tiempo constante. Un `===` sobre seis dígitos filtra por
 * tiempo cuántos coinciden desde el principio, y con seis dígitos y reintentos
 * eso es la diferencia entre un millón de pruebas y sesenta.
 */
export function verificar(
  secretoBase32: string,
  codigo: string,
  segundos: number,
  ventana = VENTANA,
): boolean {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;

  for (let d = -ventana; d <= ventana; d++) {
    const esperado = codigoEn(secretoBase32, segundos + d * PASO_SEGUNDOS);
    if (igualEnTiempoConstante(esperado, limpio)) return true;
  }
  return false;
}

function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * La URI que se pinta como QR.
 *
 * El `issuer` va dos veces —como prefijo de la etiqueta y como parámetro—
 * porque las apps de autenticación no se pusieron de acuerdo en cuál leer, y
 * con una sola algunas muestran «(sin nombre)».
 */
export function uriOtpauth(secreto: string, email: string, emisor = 'Bemo INMO'): string {
  const etiqueta = encodeURIComponent(`${emisor}:${email}`);
  const params = new URLSearchParams({
    secret: secreto,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}

/**
 * Códigos de recuperación: la salida para cuando el teléfono se pierde.
 *
 * Sin esto, perder el teléfono es perder la cuenta —y la respuesta real de una
 * inmobiliaria a eso sería pedirnos que le desactivemos el segundo factor por
 * teléfono, que es exactamente el agujero que el segundo factor vino a tapar.
 */
export function generarCodigosRecuperacion(cuantos = 8): string[] {
  return Array.from({ length: cuantos }, () => {
    // 10 bytes = 80 bits, en 16 caracteres base32.
    //
    // No son 40 bits por una razón concreta: en la base se guardan hasheados
    // con SHA-256 sin sal —igual que los refresh, y por el mismo motivo: son
    // aleatorios, no hay diccionario que atacar y hay que poder buscarlos por
    // hash—. Pero con 40 bits, quien se lleve un dump puede recorrer el espacio
    // entero y quedarse con la llave de recuperación de todos. Con 80 no.
    const c = base32Encode(randomBytes(10)).slice(0, 16);
    return c.match(/.{4}/g)!.join('-');
  });
}
