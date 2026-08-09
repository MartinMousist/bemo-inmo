import { generarFotoDemo } from '../src/archivos/foto-demo.motor';

/**
 * El generador de las fotos de muestra del seed.
 *
 * Es un motor puro —entra un objeto, sale un Buffer— y por eso se prueba sin
 * base, sin app y sin red. Lo que importa acá no es que la imagen se vea linda:
 * es que sea un PNG de verdad, que salga siempre igual y que pase por la MISMA
 * puerta por la que entra la foto que sube un usuario. Si alguna de las tres
 * falla, el seed sube basura al bucket y la cartera queda con imágenes rotas.
 */

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lee ancho y alto del IHDR, que son los bytes 16..23 de un PNG. */
function dimensiones(png: Buffer): { ancho: number; alto: number } {
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

describe('generarFotoDemo', () => {
  it('devuelve un PNG con la firma auténtica', () => {
    const b = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    expect(b.subarray(0, 8)).toEqual(FIRMA_PNG);
    // El IHDR va inmediatamente después de la firma, y su tipo son cuatro
    // bytes ASCII. Sin él, un visor no sabe ni el tamaño.
    expect(b.subarray(12, 16).toString('ascii')).toBe('IHDR');
    // Y termina con IEND: un PNG sin el chunk de cierre lo muestran algunos
    // navegadores y lo rechazan otros, que es peor que romperse siempre.
    expect(b.subarray(b.length - 8, b.length - 4).toString('ascii')).toBe('IEND');
  });

  it('mide 1200×900, que es el 4:3 de la tarjeta', () => {
    // El recorte de la grilla es 4:3. Con 3:2 el `object-fit: cover` se comía
    // la placa de abajo, o sea justo la parte que dice IMAGEN DE MUESTRA.
    const { ancho, alto } = dimensiones(generarFotoDemo({ codigo: 'PROP-0001', tipo: 'Casa' }));
    expect(ancho).toBe(1200);
    expect(alto).toBe(900);
    expect(ancho / alto).toBeCloseTo(4 / 3, 5);
  });

  it('es determinista: el mismo input da los mismos bytes', () => {
    // Es lo que hace idempotente al seed. Con `Math.random()` adentro, cada
    // arranque de dev subiría 60 imágenes nuevas al bucket.
    const a = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    const b = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    expect(a.equals(b)).toBe(true);
  });

  it('dos propiedades distintas no dan la misma imagen', () => {
    const a = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    const b = generarFotoDemo({ codigo: 'PROP-0017', tipo: 'Casa' });
    expect(a.equals(b)).toBe(false);
  });

  it('dos vistas de la misma propiedad tampoco', () => {
    // La ficha muestra las fotos en fila: dos copias del mismo PNG no probarían
    // ni el carrusel ni el cambio de portada.
    const a = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa', vista: 0 });
    const b = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa', vista: 1 });
    expect(a.equals(b)).toBe(false);
  });

  it('un tipo con tilde no rompe el rótulo', () => {
    // GALPÓN se dibuja como GALPON: la tipografía de mapa de bits tiene 40
    // glifos y ninguno acentuado. Lo que no puede pasar es que explote o que
    // deje un hueco por cada tilde.
    expect(() => generarFotoDemo({ codigo: 'PROP-0009', tipo: 'Galpón' })).not.toThrow();
  });

  it('pesa mucho menos que el límite de la ruta de fotos', () => {
    // `BODY_LIMIT` y el máximo de `AlmacenamientoService` son 8 MB, y el seed
    // sube estas imágenes por esa misma puerta. El número real ronda los 10 KB;
    // el test fija un techo holgado para que un cambio en la composición que
    // multiplique el peso por cien se note acá y no en el bucket.
    const b = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    expect(b.length).toBeLessThan(200 * 1024);
    expect(b.length).toBeGreaterThan(1024);
  });

  it('pasa la validación por firma de bytes de AlmacenamientoService', () => {
    // El servicio NO mira el Content-Type ni la extensión: mira los primeros
    // bytes. Es la misma comprobación, copiada del servicio a propósito — si
    // alguna vez se endurece allá, este test la sigue afirmando acá.
    const b = generarFotoDemo({ codigo: 'PROP-0016', tipo: 'Casa' });
    const esPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    expect(esPng).toBe(true);
    expect(b.length).toBeGreaterThan(0);
    expect(b.length).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
