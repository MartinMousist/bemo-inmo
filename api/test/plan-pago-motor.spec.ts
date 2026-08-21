import {
  analizarInversion, armarPresupuesto, PlanInvalido, sumarMeses, validarPlan,
  type PlanPago,
} from '../src/emprendimientos/plan-pago.motor';

/**
 * El plan de pago de una unidad en pozo (etapa 19).
 *
 * Acá un error de redondeo no es un pixel: es plata en un boleto que alguien
 * firma por tres años. Se prueba sobre todo lo que un Excel hace mal en
 * silencio.
 */

const PLAN: PlanPago = {
  nombre: '30 + 36',
  anticipoPct: 30,
  cuotas: 36,
  refuerzos: [{ cuota: 12, pct: 5 }, { cuota: 24, pct: 5 }],
  contraEntregaPct: 10,
  indice: 'cac',
  moneda: 'USD',
};

describe('Plan de pago en pozo — motor', () => {
  describe('la invariante del 100%', () => {
    it('las líneas suman EXACTAMENTE el precio', () => {
      // Es lo único que no puede fallar. Si suman 98, la desarrolladora regala
      // dos puntos sin enterarse; si suman 102, el comprador lo descubre en la
      // cuota doce.
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      const suma = p.lineas.reduce((a, l) => a + l.monto, 0);
      expect(Math.abs(suma - 100_000)).toBeLessThan(0.5);
      expect(p.total).toBeCloseTo(100_000, 0);
    });

    it('rechaza un plan cuyos fijos pasan el 100%', () => {
      const roto = { ...PLAN, anticipoPct: 60, contraEntregaPct: 50 };
      expect(validarPlan(roto).join(' ')).toContain('no dejan lugar');
      expect(() => armarPresupuesto(100_000, roto, '2026-03-10')).toThrow(PlanInvalido);
    });

    it('sin cuotas, los fijos tienen que dar 100 justo', () => {
      const contado = { ...PLAN, cuotas: 0, refuerzos: [], anticipoPct: 90, contraEntregaPct: 5 };
      expect(validarPlan(contado).join(' ')).toContain('suman 95%');
    });

    it('un plan de contado válido pasa', () => {
      const contado: PlanPago = {
        ...PLAN, cuotas: 0, refuerzos: [], anticipoPct: 100, contraEntregaPct: 0,
      };
      expect(validarPlan(contado)).toEqual([]);
      const p = armarPresupuesto(80_000, contado, '2026-03-10');
      expect(p.lineas).toHaveLength(1);
      expect(p.total).toBe(80_000);
    });
  });

  describe('los refuerzos', () => {
    it('caen en su cuota, además de la cuota normal', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      const enDoce = p.lineas.filter((l) => l.numero === 12);
      expect(enDoce.map((l) => l.concepto).sort()).toEqual(['cuota', 'refuerzo']);
      // Mismo vencimiento: se pagan juntos.
      expect(enDoce[0].vence).toBe(enDoce[1].vence);
    });

    it('un refuerzo fuera del rango de cuotas se rechaza', () => {
      const roto = { ...PLAN, refuerzos: [{ cuota: 99, pct: 5 }] };
      expect(validarPlan(roto).join(' ')).toContain('el plan tiene 36');
    });

    it('dos refuerzos en la misma cuota se rechazan', () => {
      const roto = { ...PLAN, refuerzos: [{ cuota: 12, pct: 5 }, { cuota: 12, pct: 3 }] };
      expect(validarPlan(roto).join(' ')).toContain('dos refuerzos en la misma cuota');
    });
  });

  describe('las fechas', () => {
    it('las cuotas caen el mismo día de cada mes', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      const c1 = p.lineas.find((l) => l.concepto === 'cuota' && l.numero === 1);
      expect(c1!.vence).toBe('2026-04-10');
    });

    it('el 31 de enero + 1 mes es el 28 de febrero, no el 3 de marzo', () => {
      // `new Date` desborda solo y correría TODAS las cuotas siguientes.
      expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
      expect(sumarMeses('2024-01-31', 1)).toBe('2024-02-29'); // bisiesto
    });

    it('cruza el año sin perderse', () => {
      expect(sumarMeses('2026-11-15', 3)).toBe('2027-02-15');
    });

    it('la entrega NO tiene fecha: depende de la obra', () => {
      // Poner una fecha acá sería prometer una entrega que nadie firmó.
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      const entrega = p.lineas.find((l) => l.concepto === 'contra_entrega');
      expect(entrega!.vence).toBeNull();
    });
  });

  describe('qué se ajusta y qué no', () => {
    it('el anticipo NUNCA se ajusta: se paga hoy', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(p.lineas.find((l) => l.concepto === 'anticipo')!.ajustable).toBe(false);
    });

    it('las cuotas sí, cuando el plan tiene índice', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(p.lineas.find((l) => l.concepto === 'cuota')!.ajustable).toBe(true);
      expect(p.advertenciaAjuste).toContain('CAC');
      expect(p.advertenciaAjuste).toContain('no se puede proyectar');
    });

    it('un plan en dólares sin índice no promete ningún ajuste', () => {
      const p = armarPresupuesto(100_000, { ...PLAN, indice: 'ninguno' }, '2026-03-10');
      expect(p.advertenciaAjuste).toBe('');
      expect(p.lineas.every((l) => !l.ajustable)).toBe(true);
    });
  });

  describe('los números que mira quien compra', () => {
    it('dice cuánto hay que poner para entrar', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(p.anticipo).toBe(30_000);
    });

    it('separa lo que se paga durante la obra de lo de la entrega', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(p.contraEntrega).toBe(10_000);
      expect(p.antesDeEntrega).toBeCloseTo(90_000, 0);
    });

    it('la memoria de cálculo explica de dónde sale cada parte', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(p.formula).toContain('30% de anticipo');
      expect(p.formula).toContain('36 cuotas');
      expect(p.formula).toContain('100%');
    });
  });

  describe('la mirada del inversor', () => {
    it('calcula el precio por metro', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(analizarInversion(p, 50, null).precioPorM2).toBe(2000);
    });

    it('dice cuánto se expone antes de tener nada', () => {
      // Es la pregunta que distingue una inversión de una apuesta: cuánta plata
      // hay puesta en algo que todavía no existe.
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(analizarInversion(p, 50, null).expuestoAntesDeEntregaPct).toBeCloseTo(90, 0);
    });

    it('compara contra una unidad terminada', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      const i = analizarInversion(p, 50, 130_000);
      expect(i.ahorroVsTerminado).toBeCloseTo(30_000, 0);
      expect(i.ahorroVsTerminadoPct).toBeCloseTo(23.08, 1);
    });

    it('sin superficie no inventa un precio por metro', () => {
      const p = armarPresupuesto(100_000, PLAN, '2026-03-10');
      expect(analizarInversion(p, null, null).precioPorM2).toBeNull();
    });
  });

  it('un precio de cero o negativo se rechaza', () => {
    expect(() => armarPresupuesto(0, PLAN, '2026-03-10')).toThrow(PlanInvalido);
    expect(() => armarPresupuesto(-5, PLAN, '2026-03-10')).toThrow(PlanInvalido);
  });
});
