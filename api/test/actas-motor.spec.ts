import { comparar, normalizar, type ItemActa } from '../src/actas/actas.motor';

/**
 * La comparación entre las dos actas. Puro, sin base ni red: es la regla que
 * decide si se le descuenta algo a alguien del depósito, y tiene que poder
 * probarse sola.
 */
describe('Comparación de actas', () => {
  const item = (ambiente: string, estado: ItemActa['estado'], detalle?: string): ItemActa =>
    ({ ambiente, estado, detalle });

  describe('cómo se cruzan los ambientes', () => {
    it('«Baño», «baño» y «BANO» son el mismo ambiente', () => {
      // La misma persona lo escribe distinto en dos visitas con seis meses de
      // diferencia. Sin normalizar, el comparativo muestra el baño dos veces,
      // cada una con la mitad de la información.
      expect(normalizar('Baño')).toBe(normalizar('BANO'));
      expect(normalizar('  Living   Comedor ')).toBe('living comedor');
    });

    it('cruza por el nombre normalizado y no duplica', () => {
      const r = comparar([item('Cocina', 'bueno')], [item('  cocina ', 'bueno')]);
      expect(r.items).toHaveLength(1);
      expect(r.items[0].veredicto).toBe('igual');
    });
  });

  describe('el veredicto', () => {
    it('de bueno a malo empeoró, y dice cuánto', () => {
      const r = comparar([item('Cocina', 'bueno')], [item('Cocina', 'malo')]);
      expect(r.items[0].veredicto).toBe('empeoro');
      expect(r.items[0].escalones).toBe(2);
      expect(r.items[0].resumen).toBe('Bueno → Malo.');
      expect(r.empeoraron).toBe(1);
    });

    it('lo que volvió mejor no se cuenta como daño', () => {
      const r = comparar([item('Pintura', 'regular')], [item('Pintura', 'excelente')]);
      expect(r.items[0].veredicto).toBe('mejoro');
      expect(r.empeoraron).toBe(0);
    });

    it('igual es igual aunque el estado sea malo en los dos', () => {
      const r = comparar([item('Patio', 'malo')], [item('Patio', 'malo')]);
      expect(r.items[0].veredicto).toBe('igual');
      expect(r.empeoraron).toBe(0);
    });
  });

  describe('lo que no se puede comparar', () => {
    it('un ambiente que sólo está en la devolución NO es «empeoró»', () => {
      // Es exactamente lo que esta feature viene a evitar: reclamarle a alguien
      // por el estado de algo que nunca se documentó al entregar.
      const r = comparar([], [item('Altillo', 'malo')]);
      expect(r.items[0].veredicto).toBe('sin-comparacion');
      expect(r.empeoraron).toBe(0);
      expect(r.items[0].resumen).toContain('no hay con qué compararlo');
    });

    it('un ambiente que estaba y no se revisó al devolver se dice, no se calla', () => {
      const r = comparar([item('Cochera', 'bueno')], [item('Cocina', 'bueno')]);
      const cochera = r.items.find((i) => i.ambiente === 'Cochera')!;
      expect(cochera.veredicto).toBe('no-devuelto');
      expect(cochera.resumen).toContain('No se revisó');
    });
  });

  describe('el titular', () => {
    it('sin daños lo dice en una línea', () => {
      const r = comparar(
        [item('Cocina', 'bueno'), item('Baño', 'bueno')],
        [item('Cocina', 'bueno'), item('Baño', 'excelente')],
      );
      expect(r.titular).toBe('La unidad volvió como se entregó.');
    });

    it('con daños dice cuántos, en singular y en plural', () => {
      const uno = comparar([item('Cocina', 'bueno')], [item('Cocina', 'malo')]);
      expect(uno.titular).toBe('1 ambiente volvió peor de como se entregó.');

      const dos = comparar(
        [item('Cocina', 'bueno'), item('Baño', 'bueno')],
        [item('Cocina', 'malo'), item('Baño', 'regular')],
      );
      expect(dos.titular).toBe('2 ambientes volvieron peor de como se entregaron.');
    });

    it('sin ambientes no inventa un veredicto', () => {
      expect(comparar([], []).titular).toBe('Todavía no hay ambientes cargados.');
    });

    it('avisa cuando hay ambientes sin acta de entrega', () => {
      const r = comparar([item('Cocina', 'bueno')], [item('Cocina', 'bueno'), item('Altillo', 'malo')]);
      expect(r.titular).toContain('no estaba');
      expect(r.sinComparacion).toBe(1);
    });
  });

  it('el orden de salida es el del recorrido de la entrega', () => {
    // Es como se caminó la casa la primera vez. Los que aparecen sólo en la
    // devolución van al final.
    const r = comparar(
      [item('Living', 'bueno'), item('Cocina', 'bueno')],
      [item('Cocina', 'bueno'), item('Altillo', 'bueno'), item('Living', 'bueno')],
    );
    expect(r.items.map((i) => i.ambiente)).toEqual(['Living', 'Cocina', 'Altillo']);
  });
});
