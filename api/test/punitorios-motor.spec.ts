import { calcularPunitorio, diasEntre } from '../src/alquileres/punitorios.motor';

/**
 * Casos de papel del interés por mora.
 *
 * Los números son redondos a propósito: si algo no cuadra, se ve dónde sin
 * abrir una calculadora. Es el mismo criterio que la suite del motor de ajustes.
 */
describe('Motor de punitorios', () => {
  const base = {
    saldo: 400_000,
    moneda: 'ARS',
    venceEl: '2026-03-10',
    tasaDiariaPct: 0.1,
  };

  describe('días de mora', () => {
    it('cuenta desde el vencimiento, sin incluirlo', () => {
      // Vencer hoy no es estar en mora hoy: el día de vencimiento es el último
      // día para pagar. Un día de más son mil pesos de más por cada millón.
      expect(calcularPunitorio({ ...base, hasta: '2026-03-10' }).diasDeMora).toBe(0);
      expect(calcularPunitorio({ ...base, hasta: '2026-03-11' }).diasDeMora).toBe(1);
      expect(calcularPunitorio({ ...base, hasta: '2026-04-10' }).diasDeMora).toBe(31);
    });

    it('no cuenta días negativos si la cuota todavía no venció', () => {
      const r = calcularPunitorio({ ...base, hasta: '2026-03-01' });
      expect(r.diasDeMora).toBe(0);
      expect(r.monto).toBe(0);
      expect(r.explicacion).toMatch(/no está vencida/);
    });

    it('cruza fin de mes y año bisiesto sin correrse un día', () => {
      // 2028 es bisiesto: del 28/02 al 01/03 hay DOS días, no uno.
      expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2);
      // 2026 no lo es.
      expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
      // Cambio de año.
      expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
    });

    it('no se corre por zona horaria', () => {
      // Un `YYYY-MM-DD` es una fecha de calendario, no un instante. Pasarlo por
      // `new Date()` le inventa medianoche UTC y en Argentina (UTC-3) se corre
      // al día anterior. Ya pasó una vez en este proyecto, con un contrato.
      expect(diasEntre('2026-01-01', '2026-01-02')).toBe(1);
      expect(diasEntre('2026-01-01', '2026-01-01')).toBe(0);
    });
  });

  describe('el monto', () => {
    it('es interés SIMPLE: días × tasa × capital', () => {
      // 400.000 × 0,1% × 10 días = 4.000. Compuesto daría 4.018,04, un número
      // que el inquilino no puede rehacer con una calculadora.
      const r = calcularPunitorio({ ...base, hasta: '2026-03-20' });
      expect(r.diasDeMora).toBe(10);
      expect(r.monto).toBe(4000);
    });

    it('corre sobre el SALDO impago, no sobre el total de la cuota', () => {
      // Pagó la mitad: el interés corre sobre lo que falta. Cobrarlo sobre el
      // total de una cuota parcialmente saldada es cobrar de más.
      const completo = calcularPunitorio({ ...base, hasta: '2026-03-20' });
      const mitad = calcularPunitorio({ ...base, saldo: 200_000, hasta: '2026-03-20' });

      expect(mitad.monto).toBe(2000);
      expect(mitad.monto).toBe(completo.monto / 2);
    });

    it('redondea a dos decimales, al más cercano', () => {
      // 123.456,78 × 0,05% × 7 = 432,09873 → 432,10
      const r = calcularPunitorio({
        ...base,
        saldo: 123_456.78,
        tasaDiariaPct: 0.05,
        hasta: '2026-03-17',
      });
      expect(r.diasDeMora).toBe(7);
      expect(r.monto).toBe(432.1);

      // Al más cercano y NO truncando: 699,9999… es 700,00, no 699,99. Truncar
      // sería quedarse siempre con un centavo del inquilino, y en una cartera
      // de 200 cuotas eso se nota y no se puede explicar.
      const casi = calcularPunitorio({
        ...base,
        saldo: 333_333.33,
        tasaDiariaPct: 0.07,
        hasta: '2026-03-13',
      });
      expect(casi.monto).toBe(700);
    });

    it('siempre devuelve como mucho dos decimales', () => {
      // Un monto con más de dos decimales no se puede cobrar ni imprimir.
      for (const saldo of [1, 7.77, 999.99, 123_456.78, 1_000_000]) {
        for (const dias of [1, 3, 17, 91]) {
          const hasta = new Date(Date.UTC(2026, 2, 10 + dias)).toISOString().slice(0, 10);
          const m = calcularPunitorio({ ...base, saldo, tasaDiariaPct: 0.137, hasta }).monto;
          expect(Math.round(m * 100)).toBe(Number((m * 100).toFixed(0)));
          expect(m).toBe(Number(m.toFixed(2)));
        }
      }
    });

    it('es cero cuando el contrato no pactó punitorio', () => {
      const r = calcularPunitorio({ ...base, tasaDiariaPct: 0, hasta: '2026-06-10' });
      expect(r.monto).toBe(0);
      expect(r.explicacion).toMatch(/no tiene punitorio pactado/);
    });

    it('es cero cuando no queda saldo, aunque haya vencido hace meses', () => {
      const r = calcularPunitorio({ ...base, saldo: 0, hasta: '2026-09-10' });
      expect(r.monto).toBe(0);
      expect(r.explicacion).toMatch(/Sin saldo impago/);
    });

    it('nunca devuelve un monto negativo', () => {
      const r = calcularPunitorio({ ...base, saldo: -5000, hasta: '2026-06-10' });
      expect(r.monto).toBe(0);
    });
  });

  describe('la memoria de cálculo', () => {
    it('trae la cuenta completa en una línea, con los números que la rehacen', () => {
      // La regla del dominio: un punitorio que el usuario no puede explicarle al
      // inquilino no se cobra, se discute.
      const r = calcularPunitorio({ ...base, hasta: '2026-03-20' });

      expect(r.explicacion).toBe(
        '10 día(s) de mora · 0,10% diario · ARS 400.000,00 × 0,10% × 10 = ARS 4.000,00',
      );
    });

    it('guarda todo lo necesario para recalcularlo años después', () => {
      const r = calcularPunitorio({ ...base, hasta: '2026-03-20' });

      expect(r.memoria).toEqual({
        saldo: 400_000,
        tasaDiariaPct: 0.1,
        diasDeMora: 10,
        venceEl: '2026-03-10',
        hasta: '2026-03-20',
      });
    });

    it('usa el formato es-AR: miles con punto y decimales con coma', () => {
      const r = calcularPunitorio({ ...base, saldo: 1_234_567.89, hasta: '2026-03-11' });
      expect(r.explicacion).toContain('ARS 1.234.567,89');
      expect(r.explicacion).not.toContain('1,234,567.89');
    });
  });
});
