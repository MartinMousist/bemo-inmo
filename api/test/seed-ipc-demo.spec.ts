import { completarSerie } from '../src/database/seed';

/**
 * La serie de IPC demo del seed, con casos de papel.
 *
 * Esto parece un detalle de datos de ejemplo y **es plata**. `indice_valor` es
 * global —no está scopeada por inmobiliaria— y `app_indice_cargar` no pisa nada,
 * así que una serie demo cargada a ciegas puede quedar intercalada con valores
 * reales en otra escala. Un ajuste que caiga justo ahí calcula el coeficiente
 * entre dos escalas distintas: con los números de la base de desarrollo —IPC
 * 116,53 al lado de un demo de 8.400— el alquiler bajaría un 98%.
 *
 * Por eso el relleno se ANCLA a lo que ya existe, y por eso se prueba acá.
 */
describe('Serie de IPC demo', () => {
  const meses = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'];

  it('sin ningún valor previo arranca en 100 y crece con el paso', () => {
    const s = completarSerie(meses, new Map(), 1.021);
    expect(s.get('2026-01-01')).toBe(100);
    expect(s.get('2026-02-01')).toBe(102.1);
    // Cada mes se redondea a dos decimales ANTES de servir de base al siguiente,
    // igual que toda la plata del sistema: por eso da 108,67 y no 108,75.
    expect(s.get('2026-05-01')).toBe(108.67);
  });

  it('respeta exactamente los valores que ya estaban', () => {
    const previos = new Map([['2026-03-01', 8412.5]]);
    const s = completarSerie(meses, previos, 1.021);
    expect(s.get('2026-03-01')).toBe(8412.5);
  });

  /**
   * El caso que motiva todo: un valor real en escala 8.412 en el medio de la
   * ventana. La serie tiene que quedar en ESA escala, no en 100.
   */
  it('hacia atrás divide desde el más viejo conocido, sin cambiar de escala', () => {
    const s = completarSerie(meses, new Map([['2026-03-01', 8412.5]]), 1.021);
    expect(s.get('2026-02-01')).toBe(8239.47); // 8412,5 / 1,021
    expect(s.get('2026-01-01')).toBe(8070);    // 8239,47 / 1,021
    // Y ni por asomo cerca de 100: la escala es la del valor real.
    expect(s.get('2026-01-01')!).toBeGreaterThan(1000);
  });

  it('hacia adelante multiplica desde el más nuevo conocido', () => {
    const s = completarSerie(meses, new Map([['2026-03-01', 100]]), 1.021);
    expect(s.get('2026-04-01')).toBe(102.1);
    expect(s.get('2026-05-01')).toBe(104.24);
  });

  /**
   * Un agujero entre dos valores reales se interpola entre ESOS DOS, no con el
   * paso demo: si no, el mes del medio saldría de una escala y el siguiente de
   * otra, y el salto quedaría concentrado en un solo coeficiente.
   */
  it('un agujero entre dos conocidos se interpola entre ellos', () => {
    const s = completarSerie(
      meses,
      new Map([['2026-01-01', 100], ['2026-05-01', 200]]),
      1.021,
    );
    expect(s.get('2026-01-01')).toBe(100);
    expect(s.get('2026-05-01')).toBe(200);
    // Cuatro pasos iguales de 200^(1/4): 118,92 · 141,42 · 168,18.
    expect(s.get('2026-02-01')).toBe(118.92);
    expect(s.get('2026-03-01')).toBe(141.42);
    expect(s.get('2026-04-01')).toBe(168.18);
  });

  it('la serie completa es monótona: ningún coeficiente sale negativo ni absurdo', () => {
    const s = completarSerie(
      meses,
      new Map([['2026-03-01', 106.12], ['2026-04-01', 108.24]]),
      1.021,
    );
    const valores = meses.map((m) => s.get(m)!);
    for (let i = 1; i < valores.length; i++) {
      expect(valores[i]).toBeGreaterThan(valores[i - 1]);
      // Un coeficiente mensual sano no se va ni al doble ni a la mitad.
      expect(valores[i] / valores[i - 1]).toBeLessThan(1.5);
      expect(valores[i] / valores[i - 1]).toBeGreaterThan(1);
    }
  });
});
