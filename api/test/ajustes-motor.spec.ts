import {
  AjusteImposible,
  calcularAjuste,
  fechasDeAjuste,
  periodosDeAjuste,
  redondear,
  round2,
  sumarMeses,
} from '../src/alquileres/ajustes.motor';

/**
 * El motor de ajustes, con casos hechos a mano.
 *
 * Es el único archivo de tests que no toca la base: entra data, sale un número.
 * Si esta cuenta está mal, el aviso que le llega al inquilino está mal, y eso
 * es lo único que este producto no se puede permitir.
 */
describe('Motor de ajustes', () => {
  describe('por índice publicado', () => {
    it('calcula el coeficiente como actual / base', () => {
      // IPC ago/25 = 100,00 · nov/25 = 108,47 → coeficiente 1,0847
      const r = calcularAjuste({
        montoVigente: 485000,
        moneda: 'ARS',
        indice: 'ipc',
        valorBase: 100,
        valorActual: 108.47,
        periodoBase: 'ago/25',
        periodoActual: 'nov/25',
      });

      expect(r.coeficiente).toBe(1.0847);
      expect(r.montoNuevo).toBe(526079.5);
      expect(r.variacionPct).toBe(8.47);
    });

    it('no arrastra el error de coma flotante', () => {
      // 485000 * 1.0847 da 526079.49999999994 en punto flotante. Si eso llega
      // a la liquidación, no cuadra contra lo que la inmobiliaria calculó.
      const r = calcularAjuste({
        montoVigente: 485000,
        moneda: 'ARS',
        indice: 'ipc',
        valorBase: 10000,
        valorActual: 10847,
      });
      expect(r.montoSinRedondear).toBe(526079.5);
      expect(Number.isInteger(r.montoSinRedondear * 100)).toBe(true);
    });

    it('redondea al múltiplo pedido y lo dice en la explicación', () => {
      const r = calcularAjuste({
        montoVigente: 485000,
        moneda: 'ARS',
        indice: 'ipc',
        valorBase: 100,
        valorActual: 108.47,
        redondeoA: 100,
      });

      expect(r.montoSinRedondear).toBe(526079.5);
      expect(r.montoNuevo).toBe(526100);
      expect(r.explicacion).toContain('Redondeado a 100');
    });

    it('la explicación trae la cuenta completa, no sólo el resultado', () => {
      const r = calcularAjuste({
        montoVigente: 300000,
        moneda: 'ARS',
        indice: 'icl',
        valorBase: 2.5,
        valorActual: 3,
        periodoBase: 'may/25',
        periodoActual: 'nov/25',
      });

      // Un aumento que el usuario no puede explicarle al inquilino no sirve.
      expect(r.explicacion).toContain('ICL');
      expect(r.explicacion).toContain('may/25');
      expect(r.explicacion).toContain('nov/25');
      expect(r.explicacion).toContain('300.000,00');
      expect(r.explicacion).toContain('360.000,00');
    });

    it('la memoria congela todos los valores usados', () => {
      const r = calcularAjuste({
        montoVigente: 100000,
        moneda: 'ARS',
        indice: 'uva',
        valorBase: 1000,
        valorActual: 1250,
        periodoBase: 'jun/25',
        periodoActual: 'dic/25',
      });

      // Si INDEC o el BCRA revisan el índice después, el ajuste ya notificado
      // NO se recalcula. Por eso se guarda el valor, no una referencia.
      expect(r.memoria).toMatchObject({
        metodo: 'indice',
        indice: 'uva',
        valorBase: 1000,
        valorActual: 1250,
        coeficiente: 1.25,
        montoAnterior: 100000,
        montoNuevo: 125000,
        calculadoCon: 'ajustes.motor@1',
      });
    });

    it('sin el valor de un período no estima: falla y dice cuál falta', () => {
      expect(() =>
        calcularAjuste({
          montoVigente: 100000,
          moneda: 'ARS',
          indice: 'ipc',
          valorBase: 100,
          valorActual: null,
        }),
      ).toThrow(AjusteImposible);

      try {
        calcularAjuste({
          montoVigente: 100000,
          moneda: 'ARS',
          indice: 'ipc',
          valorBase: 100,
          valorActual: null,
        });
      } catch (e) {
        expect((e as AjusteImposible).motivo).toBe('sin_valores');
        expect((e as Error).message).toContain('IPC');
      }
    });
  });

  describe('por porcentaje fijo', () => {
    it('8,5% da coeficiente 1,085', () => {
      const r = calcularAjuste({
        montoVigente: 200000,
        moneda: 'ARS',
        indice: 'porcentaje_fijo',
        indicePorcentaje: 8.5,
      });
      expect(r.coeficiente).toBe(1.085);
      expect(r.montoNuevo).toBe(217000);
    });

    it('sin porcentaje cargado, falla', () => {
      expect(() =>
        calcularAjuste({
          montoVigente: 200000,
          moneda: 'ARS',
          indice: 'porcentaje_fijo',
          indicePorcentaje: null,
        }),
      ).toThrow(/porcentaje/i);
    });
  });

  it('un contrato sin actualización no se ajusta', () => {
    expect(() =>
      calcularAjuste({ montoVigente: 100000, moneda: 'ARS', indice: 'ninguno' }),
    ).toThrow(/fijo por todo el plazo/);
  });

  describe('fechas de ajuste', () => {
    it('trimestral sobre un contrato de 3 años da 11 ajustes', () => {
      // A los 3, 6, 9 … 33 meses. A los 36 ya terminó el contrato.
      const f = fechasDeAjuste('2026-01-01', '2028-12-31', 3);
      expect(f).toHaveLength(11);
      expect(f[0]).toBe('2026-04-01');
      expect(f.at(-1)).toBe('2028-10-01');
    });

    it('cuatrimestral respeta la periodicidad', () => {
      const f = fechasDeAjuste('2026-03-01', '2028-02-29', 4);
      expect(f[0]).toBe('2026-07-01');
      expect(f[1]).toBe('2026-11-01');
    });

    it('un contrato más corto que la periodicidad no tiene ajustes', () => {
      expect(fechasDeAjuste('2026-01-01', '2026-02-28', 3)).toEqual([]);
    });

    it('el ajuste que cae justo al vencimiento no se incluye', () => {
      // Ajustar el mes en que el contrato termina no tiene sentido.
      const f = fechasDeAjuste('2026-01-01', '2026-06-30', 6);
      expect(f).toEqual([]);
    });
  });

  /**
   * La cadena entera. Vivía suelta adentro de `proyectarAjustes()` mezclada con
   * consultas a la base, así que estas dos reglas —el mes anterior, y que cada
   * ajuste arranque donde terminó el anterior— no se podían probar con papel.
   */
  describe('periodosDeAjuste', () => {
    it('el índice es el del MES ANTERIOR al ajuste', () => {
      // El IPC de un mes lo publica INDEC a mediados del siguiente: el de «este
      // mes» nunca está a tiempo.
      const c = periodosDeAjuste('2025-08-01', '2027-08-01', 4, '2025-07-01', '2026-12-01');
      expect(c[0]).toEqual({
        vigenteDesde: '2025-12-01', periodoBase: '2025-07-01', periodoActual: '2025-11-01',
      });
    });

    it('cada ajuste arranca donde terminó el anterior', () => {
      // Si el segundo midiera otra vez desde el mes_base del contrato, contaría
      // dos veces la misma inflación y el alquiler se multiplicaría.
      const c = periodosDeAjuste('2025-11-01', '2028-11-01', 3, '2025-10-01', '2026-11-01');
      expect(c.map((p) => [p.vigenteDesde, p.periodoBase, p.periodoActual])).toEqual([
        ['2026-02-01', '2025-10-01', '2026-01-01'],
        ['2026-05-01', '2026-01-01', '2026-04-01'],
        ['2026-08-01', '2026-04-01', '2026-07-01'],
        ['2026-11-01', '2026-07-01', '2026-10-01'],
      ]);
    });

    it('se planta en el límite, no en el fin del contrato', () => {
      // Un contrato de tres años no proyecta doce aumentos de una: más allá del
      // límite los índices ni siquiera existen.
      const largo = periodosDeAjuste('2025-01-01', '2028-01-01', 3, '2024-12-01', '2026-11-01');
      const sinLimite = fechasDeAjuste('2025-01-01', '2028-01-01', 3);
      expect(largo.length).toBeLessThan(sinLimite.length);
      expect(largo[largo.length - 1].vigenteDesde).toBe('2026-10-01');
    });

    it('el que cae justo en el límite entra; el siguiente no', () => {
      const c = periodosDeAjuste('2025-11-01', '2028-11-01', 3, '2025-10-01', '2026-08-01');
      expect(c.map((p) => p.vigenteDesde)).toEqual(['2026-02-01', '2026-05-01', '2026-08-01']);
    });

    it('un contrato más corto que su periodicidad no ajusta nunca', () => {
      expect(periodosDeAjuste('2026-01-01', '2026-06-30', 6, '2025-12-01', '2027-01-01'))
        .toEqual([]);
    });
  });

  describe('utilidades', () => {
    it('sumarMeses cruza el año', () => {
      expect(sumarMeses('2026-11-01', 3)).toBe('2027-02-01');
      expect(sumarMeses('2026-01-01', -1)).toBe('2025-12-01');
    });

    it('redondear a 0 no redondea', () => {
      expect(redondear(526079.5, 0)).toBe(526079.5);
    });

    it('redondear a 1000', () => {
      expect(redondear(526079.5, 1000)).toBe(526000);
      expect(redondear(526579.5, 1000)).toBe(527000);
    });

    it('round2 corta en dos decimales', () => {
      expect(round2(526079.49999999994)).toBe(526079.5);
      expect(round2(0.1 + 0.2)).toBe(0.3);
    });
  });
});
