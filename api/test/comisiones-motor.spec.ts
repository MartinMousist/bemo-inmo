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

  // ── Compartir con otra inmobiliaria ────────────────────────────────────────

  describe('compartir la comisión', () => {
    it.each([
      [50, 3000, 750, 2250],
      [60, 3600, 600, 1800],
      [40, 2400, 900, 2700],
    ])(
      'con el %i%% para la otra agencia: externa %i, agente %i, casa %i',
      (fraccion, aExterna, aAgente, aLaCasa) => {
        const r = calcularComisiones({
          base: 200000,
          moneda: 'USD',
          puntas: { vendedora: 3 },
          externas: { vendedora: { nombre: 'Colega SRL', porcentaje: fraccion } },
          repartoInterno: { captador: casa },
        });

        expect(r.totalOperacion).toBe(6000);
        expect(r.totalExternas).toBe(aExterna);
        // Lo que se lleva el agente BAJA cuando se comparte, porque el nivel 3
        // se aplica sobre lo que queda de la punta y no sobre el bruto. No es
        // obvio, y es lo que la pantalla tiene que mostrar antes de tildar la
        // casilla: alguien puede firmar un 50/50 creyendo que su comisión no se
        // toca.
        expect(r.totalAgentes).toBe(aAgente);
        expect(r.totalCasa).toBe(aLaCasa);
        expect(cuadra(r)).toBe(true);
      },
    );

    it('compartir una punta que NO cobra no emite ninguna línea', () => {
      // Es el caso que el servicio corta con un 422 antes de llegar acá: el
      // motor calcula `0 × 50% = 0`, no emite fila, y el reparto sale prolijo
      // con la agencia con la que se acordó 50/50 ausente. Nadie lo ve hasta
      // que la otra inmobiliaria reclama.
      const r = calcularComisiones({
        base: 200000,
        moneda: 'USD',
        puntas: { compradora: 3, vendedora: 0 },
        externas: { vendedora: { nombre: 'Fantasma SRL', porcentaje: 50 } },
      });

      expect(r.totalExternas).toBe(0);
      expect(r.lineas.filter((l) => l.beneficiarioTipo === 'inmobiliaria_externa'))
        .toHaveLength(0);
    });

    it('la ficha del catálogo viaja en la línea, y el nombre también', () => {
      // Las dos cosas y no una: el `externaId` sirve para sumar después cuánto
      // se le pagó a cada agencia, y el nombre queda CONGELADO porque una
      // comisión ya cobrada no cambia de acreedor si alguien renombra la ficha.
      const r = calcularComisiones({
        base: 100000,
        moneda: 'USD',
        puntas: { vendedora: 3 },
        externas: {
          vendedora: { nombre: 'Del Oeste', porcentaje: 50, externaId: 'ext-1' },
        },
      });

      const linea = r.lineas.find((l) => l.beneficiarioTipo === 'inmobiliaria_externa');
      expect(linea?.externaId).toBe('ext-1');
      expect(linea?.beneficiarioNombre).toBe('Del Oeste');
    });

    it('dos puntas compartidas con agencias distintas', () => {
      const r = calcularComisiones({
        base: 300000,
        moneda: 'USD',
        puntas: { compradora: 3, vendedora: 3 },
        externas: {
          compradora: { nombre: 'Una', porcentaje: 50 },
          vendedora: { nombre: 'Otra', porcentaje: 25 },
        },
        repartoInterno: { captador: casa },
      });

      expect(r.totalOperacion).toBe(18000);
      expect(r.totalExternas).toBe(4500 + 2250);
      const nombres = r.lineas
        .filter((l) => l.beneficiarioTipo === 'inmobiliaria_externa')
        .map((l) => l.beneficiarioNombre);
      expect(nombres.sort()).toEqual(['Otra', 'Una']);
      expect(cuadra(r)).toBe(true);
    });
  });

  // ── La memoria de cálculo ──────────────────────────────────────────────────

  describe('la memoria de cálculo', () => {
    it('cada línea explica de dónde sale su número', () => {
      const r = calcularComisiones({
        base: 162000,
        moneda: 'USD',
        puntas: { vendedora: 3 },
        repartoInterno: { captador: casa },
      });

      const nivel1 = r.lineas.find((l) => l.nivel === 1);
      expect(nivel1?.memoria).toBe('USD 162.000 × 3 % = USD 4.860');

      const agente = r.lineas.find((l) => l.beneficiarioTipo === 'agente');
      expect(agente?.memoria).toBe('USD 4.860 × 25 % = USD 1.215');
    });

    it('la línea de la casa se explica como un RESTO, no como un porcentaje', () => {
      // Escribirla «× 50 % =» sería mentir sobre cómo se calculó, aunque el
      // número dé: el resto sale por diferencia justamente para que no se
      // pierda ni se invente un centavo con el redondeo.
      const r = calcularComisiones({
        base: 100000,
        moneda: 'ARS',
        puntas: { vendedora: 3 },
        repartoInterno: { captador: casa },
      });

      const laCasa = r.lineas.find((l) => l.beneficiarioTipo === 'casa');
      expect(laCasa?.memoria).toContain('−');
      expect(laCasa?.memoria).toContain('ARS 2.250');
    });
  });
});
