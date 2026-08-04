import { calcularComisiones, cuadra } from '../src/ventas/comisiones.motor';

/**
 * La calculadora de comisiones, con casos de papel.
 *
 * Es la cuenta que genera discusiones adentro de la inmobiliaria todos los
 * meses. Si está mal, alguien cobra de menos y se entera tarde.
 */
describe('Motor de comisiones', () => {
  const casa = { usuarioId: 'u-cap', nombre: 'Ana Captadora', porcentaje: 25 };
  const cerrador = { usuarioId: 'u-cer', nombre: 'Bruno Cerrador', porcentaje: 25 };

  describe('nivel 1 — lo que cobra la operación', () => {
    it('3% a cada punta sobre USD 200.000', () => {
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 3, vendedora: 3 },
      });

      expect(r.totalOperacion).toBe(12000);
      const nivel1 = r.lineas.filter((l) => l.nivel === 1);
      expect(nivel1).toHaveLength(2);
      expect(nivel1.every((l) => l.monto === 6000)).toBe(true);
    });

    it('una punta en cero no genera línea', () => {
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 4, vendedora: 0 },
      });
      expect(r.lineas.filter((l) => l.nivel === 1)).toHaveLength(1);
      expect(r.totalOperacion).toBe(8000);
    });
  });

  describe('nivel 2 — reparto entre inmobiliarias', () => {
    it('50/50 en la punta vendedora', () => {
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 3, vendedora: 3 },
        externas: { vendedora: { nombre: 'Otra Inmobiliaria', porcentaje: 50 } },
      });

      expect(r.totalOperacion).toBe(12000);
      expect(r.totalExternas).toBe(3000);   // la mitad de los 6000 de esa punta
      // A la compradora no la tocó nadie.
      expect(r.totalCasa).toBe(9000);
      expect(cuadra(r)).toBe(true);
    });

    it('el resto se calcula por DIFERENCIA, no con (100 − pct)', () => {
      // Con un porcentaje que no divide redondo, restar el complemento pierde
      // centavos. Por diferencia, siempre cuadra.
      const r = calcularComisiones({
        base: 333333.33,
        moneda: 'ARS',
        puntas: { vendedora: 3 },
        externas: { vendedora: { nombre: 'Externa', porcentaje: 33.333 } },
      });
      expect(cuadra(r)).toBe(true);
    });
  });

  describe('nivel 3 — reparto puertas adentro', () => {
    it('captador 25% y cerrador 25%, la casa se queda con el 50%', () => {
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 3 },
        repartoInterno: { captador: casa, cerrador },
      });

      // 6000 de honorarios → 1500 + 1500 a los agentes, 3000 a la casa.
      expect(r.totalOperacion).toBe(6000);
      expect(r.totalAgentes).toBe(3000);
      expect(r.totalCasa).toBe(3000);
      expect(cuadra(r)).toBe(true);
    });

    it('el reparto interno se aplica DESPUÉS del externo, no sobre el total', () => {
      // Este es el error clásico: pagarle al agente el 25% del honorario bruto
      // cuando la mitad ya se fue a la otra inmobiliaria.
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { vendedora: 3 },
        externas: { vendedora: { nombre: 'Externa', porcentaje: 50 } },
        repartoInterno: { captador: casa },
      });

      expect(r.totalOperacion).toBe(6000);
      expect(r.totalExternas).toBe(3000);
      // 25% de los 3000 que quedaron, NO de los 6000.
      expect(r.totalAgentes).toBe(750);
      expect(r.totalCasa).toBe(2250);
      expect(cuadra(r)).toBe(true);
    });

    it('si el reparto interno suma 100, a la casa no le queda nada', () => {
      const r = calcularComisiones({
        base: 100000,
        moneda: 'USD',
        puntas: { compradora: 4 },
        repartoInterno: {
          captador: { ...casa, porcentaje: 50 },
          cerrador: { ...cerrador, porcentaje: 50 },
        },
      });
      expect(r.totalAgentes).toBe(4000);
      expect(r.totalCasa).toBe(0);
      expect(r.lineas.filter((l) => l.beneficiarioTipo === 'casa')).toHaveLength(0);
      expect(cuadra(r)).toBe(true);
    });

    it('el mismo agente captó y cerró: cobra las dos partes', () => {
      const mismo = { usuarioId: 'u-x', nombre: 'Carla Todo', porcentaje: 25 };
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 3 },
        repartoInterno: { captador: mismo, cerrador: mismo },
      });

      const suyas = r.lineas.filter((l) => l.beneficiarioId === 'u-x');
      expect(suyas).toHaveLength(2);
      expect(suyas.reduce((a, l) => a + l.monto, 0)).toBe(3000);
    });
  });

  describe('el reparto siempre cuadra', () => {
    it('caso completo: dos puntas, una externa y reparto interno', () => {
      const r = calcularComisiones({
        base: 187500,
        moneda: 'USD',
        puntas: { compradora: 3.5, vendedora: 2.5 },
        externas: { vendedora: { nombre: 'Colega', porcentaje: 40 } },
        repartoInterno: { captador: casa, cerrador },
      });

      expect(cuadra(r)).toBe(true);
      // Y cada línea de nivel 2 y 3 apunta a su nivel 1.
      for (const l of r.lineas.filter((x) => x.nivel > 1)) {
        expect(l.padre).toBeDefined();
        expect(r.lineas[l.padre!].nivel).toBe(1);
      }
    });

    it('con montos que no dividen redondo tampoco se pierde un peso', () => {
      for (const base of [123456.78, 999999.99, 1, 7777.77]) {
        const r = calcularComisiones({
          base,
          moneda: 'ARS',
          puntas: { compradora: 3.33, vendedora: 1.67 },
          externas: { compradora: { nombre: 'X', porcentaje: 37.5 } },
          repartoInterno: { captador: casa, cerrador },
        });
        expect({ base, cuadra: cuadra(r) }).toEqual({ base, cuadra: true });
      }
    });
  });

  it('sirve igual para alquileres', () => {
    // Un mes de alquiler como honorario al inquilino.
    const r = calcularComisiones({
      base: 485000,
      moneda: 'ARS',
      puntas: { locataria: 100 },
      repartoInterno: { captador: casa },
    });
    expect(r.totalOperacion).toBe(485000);
    expect(r.totalAgentes).toBe(121250);
    expect(cuadra(r)).toBe(true);
  });
});
