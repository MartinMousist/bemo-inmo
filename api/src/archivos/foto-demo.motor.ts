import { crc32, deflateSync } from 'node:zlib';

/**
 * La foto de muestra de una propiedad del seed, generada byte a byte.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * La cartera en tarjetas necesita fotos o no se ve nada de lo que hace: el
 * recorte 4:3, el `object-fit: cover`, el `loading="lazy"`, el peso de la
 * primera carga. Un placeholder en las 34 propiedades prueba el placeholder, no
 * la tarjeta.
 *
 * ── Por qué generada y no descargada ────────────────────────────────────────
 *
 * Tres cosas que no se negocian y que una foto bajada de internet rompe:
 *
 * 1. **No son fotos de nadie.** Una imagen de una propiedad real es de alguien
 *    —del fotógrafo, de la inmobiliaria, del dueño— y meterla en el repo de un
 *    producto que se vende es un problema, no un detalle.
 * 2. **El seed no toca la red.** Ya corre en cada arranque de dev con
 *    `SEED_ON_BOOT`; que dependa de que un CDN conteste sería cambiar una demo
 *    incompleta por un arranque que a veces tarda dos minutos.
 * 3. **Sin dependencias nuevas.** `sharp` es un binario nativo: instalarlo en el
 *    contenedor para dibujar un rectángulo es el error #7 esperando el próximo
 *    reinicio. Acá alcanza con `node:zlib`, que ya está.
 *
 * ── Por qué dice que es de muestra, en la imagen ────────────────────────────
 *
 * Igual que `seeds/archivos/documento-demo.png` dice DOCUMENTO DE EJEMPLO. La
 * regla de honestidad del playbook (§4) es «nada de datos falsos en la
 * interfaz», y una foto de una casa que nadie sacó, en la ficha de una
 * propiedad, es exactamente eso. La imagen lleva IMAGEN DE MUESTRA impreso
 * adentro, sobre una placa sólida, para que nadie confunda la miniatura de la
 * demo con la propiedad de un cliente.
 *
 * ── Por qué 4:3 ─────────────────────────────────────────────────────────────
 *
 * Es el recorte de la tarjeta. La primera versión era 3:2 y el `object-fit:
 * cover` de la grilla se comía el rótulo de abajo — o sea que la única parte
 * que dice que la imagen es de muestra desaparecía justo en la pantalla para la
 * que se hizo.
 *
 * ── Determinista, y por eso el seed es idempotente ──────────────────────────
 *
 * Mismo `{codigo, tipo}` ⇒ mismos bytes. No hay `Math.random()` ni `Date.now()`
 * adentro: los colores y la disposición salen de un hash del código. Correr el
 * seed dos veces no sube dos imágenes distintas de la misma propiedad, y un
 * test puede afirmar la igualdad byte a byte.
 */

const ANCHO = 1200;
const ALTO = 900;

export interface DatosFotoDemo {
  /** El código de la propiedad, tal como se muestra: `PROP-0016`. */
  codigo: string;
  /** El tipo en palabras, para el rótulo: `Casa`, `Terreno`. */
  tipo: string;
  /**
   * Cuál de las fotos de esa propiedad es. Entra en el hash y en nada más.
   *
   * Una propiedad de verdad tiene varias fotos y la ficha las muestra en fila:
   * con una sola por propiedad, el carrusel de la ficha y el reordenar-portada
   * quedan sin nada que probar. El rótulo NO la nombra —«PROP-0016 · CASA» y
   * punto—: el número de vista es del seed, no de la propiedad.
   */
  vista?: number;
}

/* ── Tipografía de mapa de bits 5×7 ────────────────────────────────────────

   Una fuente propia de 40 glifos y no una librería: dibujar dos renglones de
   mayúsculas no justifica una dependencia, y con `sharp` descartado tampoco
   hay quien rasterice una TTF. Sólo mayúsculas, dígitos y tres signos, que es
   todo lo que el rótulo usa. Las vocales con tilde se pasan a su forma sin
   tilde antes de dibujar (GALPÓN ⇒ GALPON): agregar cinco glifos para una
   palabra es más código que la pérdida.                                      */
const GLIFOS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const SIN_TILDE: Record<string, string> = {
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
};

type Rgb = [number, number, number];

/**
 * Un hash chico y estable del código.
 *
 * No sirve para nada criptográfico y no pretende: lo único que hace falta es
 * que dos propiedades distintas no salgan idénticas y que la misma propiedad
 * salga siempre igual. `Math.random()` rompería lo segundo, que es lo que hace
 * idempotente al seed.
 */
function semilla(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** HSL → RGB, con H en grados y S/L en 0..1. */
function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1]: Rgb =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/** Un lienzo RGB plano, con las cuatro primitivas que la composición usa. */
class Lienzo {
  readonly datos: Buffer;

  constructor(readonly ancho: number, readonly alto: number) {
    this.datos = Buffer.alloc(ancho * alto * 3);
  }

  pixel(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) return;
    const i = (y * this.ancho + x) * 3;
    this.datos[i] = c[0];
    this.datos[i + 1] = c[1];
    this.datos[i + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.pixel(i, j, c);
  }

  /** Degradado vertical entre dos colores. La «iluminación» del cielo. */
  degradado(y0: number, y1: number, a: Rgb, b: Rgb): void {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      const c: Rgb = [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ];
      this.rect(0, y, this.ancho, 1, c);
    }
  }

  texto(s: string, x: number, y: number, escala: number, c: Rgb): number {
    let cursor = x;
    for (const bruto of s.toUpperCase()) {
      const ch = SIN_TILDE[bruto] ?? bruto;
      const g = GLIFOS[ch] ?? GLIFOS[' '];
      for (let fila = 0; fila < 7; fila++) {
        for (let col = 0; col < 5; col++) {
          if (g[fila][col] === '1') {
            this.rect(cursor + col * escala, y + fila * escala, escala, escala, c);
          }
        }
      }
      cursor += 6 * escala;
    }
    return cursor - x - escala;
  }
}

/** Ancho en píxeles de un texto a una escala dada. Para centrar la placa. */
function anchoTexto(s: string, escala: number): number {
  return s.length * 6 * escala - escala;
}

/**
 * La composición: horizonte, volúmenes apoyados, una franja y la placa.
 *
 * Es geometría a propósito, no un dibujo de una casa: DESIGN.md §6 prohíbe los
 * íconos de casita/llave/techo y una ilustración genérica sería lo mismo en
 * grande. Lo que la imagen tiene que comunicar es «acá va una foto» y «esto es
 * de muestra», y para eso alcanza con color y forma.
 */
export function generarFotoDemo(d: DatosFotoDemo): Buffer {
  const s = semilla(`${d.codigo}|${d.tipo}|${d.vista ?? 0}`);
  const tono = s % 360;

  const lienzo = new Lienzo(ANCHO, ALTO);

  // Cielo: degradado suave del mismo tono, de claro a apenas más saturado.
  lienzo.degradado(0, ALTO, hsl(tono, 0.22, 0.86), hsl(tono, 0.3, 0.62));

  // Suelo.
  const horizonte = 600 + ((s >>> 3) % 60);
  lienzo.rect(0, horizonte, ANCHO, ALTO - horizonte, hsl(tono + 24, 0.18, 0.34));
  lienzo.rect(0, horizonte, ANCHO, 4, hsl(tono + 24, 0.2, 0.26));

  // La franja: una banda horizontal sobre el cielo, que es lo que impide que la
  // mitad de arriba quede como un campo plano. Va ANTES de los volúmenes: si se
  // pinta después les pasa por encima y deja de leerse como algo que está
  // atrás — el primer intento la cruzaba por el medio y parecía un glitch.
  const banda = 110 + ((s >>> 11) % 120);
  lienzo.rect(0, banda, ANCHO, 46, hsl(tono - 18, 0.3, 0.74));

  // Seis volúmenes apoyados en el horizonte, de alturas y anchos derivados del
  // hash. Angostos y con aire entre algunos: la primera versión los hacía de
  // 200-500px y llenaban el ancho entero, así que la imagen se leía como cuatro
  // bandas de color planas y no como algo apoyado en un suelo.
  let x = 40 + (s % 60);
  for (let i = 0; i < 6; i++) {
    const r = (s >>> (i * 4)) % 89;
    const w = 90 + (r % 6) * 34;
    const h = 110 + ((r * 7) % 11) * 34;
    const claro = 0.46 - (i % 3) * 0.07;
    lienzo.rect(x, horizonte - h, w, h, hsl(tono + i * 9, 0.26, claro));
    // Un canto más claro arriba: separa un volumen del que tiene atrás sin
    // dibujar una línea, que a este tamaño se vería como el contorno de una
    // ilustración.
    lienzo.rect(x, horizonte - h, w, 7, hsl(tono + i * 9, 0.26, claro + 0.12));
    // El avance puede ser mayor o menor que el ancho: a veces queda un hueco de
    // cielo y a veces se solapan. Los dos casos hacen falta para que no se lea
    // como una serie regular.
    x += w + ((r % 5) * 44 - 70);
  }

  // ── La placa ───────────────────────────────────────────────────────────
  // Sólida, no translúcida: sobre un fondo que cambia con cada propiedad, un
  // texto sobre transparencia no tiene un contraste que se pueda afirmar. Con
  // la placa sólida el par es siempre el mismo y se puede medir una vez.
  const l1 = 'IMAGEN DE MUESTRA';
  const l2 = `${d.codigo} · ${d.tipo}`;
  const e1 = 3;
  const e2 = 5;
  const pad = 28;
  const ancho = Math.max(anchoTexto(l1, e1), anchoTexto(l2, e2)) + pad * 2;
  const alto = 7 * e1 + 18 + 7 * e2 + pad * 2;
  const px = 56;
  const py = ALTO - alto - 56;

  const fondoPlaca: Rgb = [17, 26, 25];
  lienzo.rect(px, py, ancho, alto, fondoPlaca);
  // Filete del tono de la propiedad, arriba: dice que la placa es parte de la
  // imagen y no una marca de agua pegada encima.
  lienzo.rect(px, py, ancho, 5, hsl(tono, 0.4, 0.6));

  // `#93a3a1` sobre `#111a19` da 6,7:1; blanco sobre lo mismo, 17,4:1. Los dos
  // pasan AA con margen, medidos y no mirados.
  lienzo.texto(l1, px + pad, py + pad, e1, [147, 163, 161]);
  lienzo.texto(l2, px + pad, py + pad + 7 * e1 + 18, e2, [255, 255, 255]);

  return codificarPng(lienzo);
}

/* ── PNG ───────────────────────────────────────────────────────────────────

   Truecolor de 8 bits (tipo 2), un IDAT, filtro 0 en todas las filas. No hay
   filtros adaptativos ni entrelazado: la imagen es geometría plana y el deflate
   ya la deja en 8-9 KB. Optimizar más sería optimizar sin medir, que es la
   variante del error #4 que este repo ya se cobró una vez.                    */
function chunk(tipo: string, datos: Buffer): Buffer {
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const suma = Buffer.alloc(4);
  // `crc32` es de `node:zlib` (Node ≥ 20.15) y no una implementación nuestra:
  // el CRC de PNG es el mismo polinomio que ya trae el runtime, y una copia
  // propia sería treinta líneas para reimplementar algo que está probado.
  suma.writeUInt32BE(crc32(cuerpo) >>> 0);
  return Buffer.concat([largo, cuerpo, suma]);
}

function codificarPng(lienzo: Lienzo): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lienzo.ancho, 0);
  ihdr.writeUInt32BE(lienzo.alto, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // color type 2 = truecolor RGB
  ihdr[10] = 0; // compresión deflate
  ihdr[11] = 0; // filtro adaptativo estándar
  ihdr[12] = 0; // sin entrelazado

  // Cada scanline lleva adelante su byte de filtro. Con 0 —«sin filtro»— el
  // resto de la fila son los bytes crudos.
  const paso = lienzo.ancho * 3;
  const crudo = Buffer.alloc((paso + 1) * lienzo.alto);
  for (let y = 0; y < lienzo.alto; y++) {
    crudo[y * (paso + 1)] = 0;
    lienzo.datos.copy(crudo, y * (paso + 1) + 1, y * paso, (y + 1) * paso);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Nivel fijo: el default de zlib podría cambiar entre versiones de Node y
    // con él los bytes de salida. El seed es idempotente por comparar filas en
    // la base, pero el test que afirma determinismo byte a byte no tendría
    // sentido si el nivel flotara.
    chunk('IDAT', deflateSync(crudo, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
