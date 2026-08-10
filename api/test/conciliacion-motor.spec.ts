import {
  cruzar, huellaDe, normalizarContraparte, pareceRuido,
  type CuotaCandidata, type MovimientoParaCruce,
} from '../src/conciliacion/conciliacion.motor';

/**
 * El cruce entre el extracto del banco y las cuotas. Puro, sin base ni red.
 *
 * Es la regla que decide **a qué contrato se le imputa la plata de alguien**.
 * Un error acá no se ve el día que pasa: se ve a fin de mes, cuando la
 * liquidación al propietario sale con el número de otro y ya se pagó.
 */
describe('Conciliación bancaria', () => {
  const cuota = (over: Partial<CuotaCandidata> = {}): CuotaCandidata => ({
    id: 'c1', contratoId: 'k1', saldo: 514682, moneda: 'ARS',
    venceEl: '2026-08-10', periodo: '2026-08-01',
    etiquetaPropiedad: 'PROP-0001', inquilino: 'Camila Rossi', inquilinoId: 'p1',
    contrapartesConocidas: [],
    ...over,
  });

  const mov = (over: Partial<MovimientoParaCruce> = {}): MovimientoParaCruce => ({
    fecha: '2026-08-10', monto: 514682, moneda: 'ARS',
    descripcion: 'TRANSFERENCIA RECIBIDA', referencia: null, contraparte: null,
    ...over,
  });

  describe('qué se cruza y qué no', () => {
    it('un egreso no se cruza nunca', () => {
      // Un débito no puede ser el pago de un alquiler, y proponerlo sería ruido
      // en la única pantalla donde el ruido cuesta plata.
      const r = cruzar(mov({ monto: -20000 }), [cuota()]);
      expect(r.sugerencias).toEqual([]);
    });

    it('la moneda descarta, no resta puntos', () => {
      // Un movimiento en pesos no paga una cuota en dólares por más que el
      // número se parezca.
      const r = cruzar(mov({ moneda: 'ARS' }), [cuota({ moneda: 'USD' })]);
      expect(r.sugerencias).toEqual([]);
    });

    it('lo que no llega al mínimo no se muestra', () => {
      // Monto que no coincide y fecha lejana: es ruido que hace scrollear.
      const r = cruzar(mov({ monto: 12345, fecha: '2026-03-01' }), [cuota()]);
      expect(r.sugerencias).toEqual([]);
    });
  });

  describe('las señales', () => {
    it('monto exacto y fecha justa alcanzan para sugerir', () => {
      const r = cruzar(mov(), [cuota()]);
      expect(r.sugerencias).toHaveLength(1);
      expect(r.sugerencias[0].senales).toContain('Monto exacto');
      expect(r.sugerencias[0].senales).toContain('Justo el día que vencía');
      expect(r.sugerencias[0].exacto).toBe(true);
    });

    it('la contraparte conocida es la señal más fuerte', () => {
      // Identifica a la PERSONA, no al importe: por eso pesa más que el monto.
      const conCuenta = cuota({ contrapartesConocidas: ['20304050607'] });
      const conocida = cruzar(mov({ contraparte: '20-30405060-7' }), [conCuenta]);
      const anonima = cruzar(mov(), [conCuenta]);

      expect(conocida.sugerencias[0].puntaje)
        .toBeGreaterThan(anonima.sugerencias[0].puntaje);
      expect(conocida.sugerencias[0].senales).toContain('Ya pagó desde esta cuenta');
    });

    it('el código de propiedad o el apellido en la referencia suman', () => {
      const conCodigo = cruzar(mov({ referencia: 'ALQ PROP-0001 AGOSTO' }), [cuota()]);
      expect(conCodigo.sugerencias[0].senales).toContain('La referencia lo nombra');

      const conApellido = cruzar(
        mov({ descripcion: 'TRANSF DE ROSSI CAMILA' }), [cuota()],
      );
      expect(conApellido.sugerencias[0].senales).toContain('La referencia lo nombra');
    });

    it('un peso de diferencia sigue siendo el mismo monto', () => {
      // Un peso es redondeo. Más que eso ya es un pago parcial, que es otro
      // caso con su propia decisión.
      expect(cruzar(mov({ monto: 514681 }), [cuota()]).sugerencias[0].exacto).toBe(true);
      expect(cruzar(mov({ monto: 510000 }), [cuota()]).sugerencias[0].exacto).toBe(false);
    });

    it('un pago parcial del día del vencimiento SÍ se sugiere', () => {
      // El caso que hizo subir el peso de «monto aproximado» de 12 a 22: con el
      // valor viejo esto sumaba 22, no llegaba al mínimo y el movimiento quedaba
      // sin ninguna sugerencia. Un inquilino que redondea para abajo es lo más
      // común que hay.
      const r = cruzar(mov({ monto: 510000 }), [cuota()]);
      expect(r.sugerencias).toHaveLength(1);
      expect(r.sugerencias[0].senales).toContain('Monto casi exacto');
    });

    it('un monto parecido en otra fecha NO alcanza', () => {
      // La contracara: sin la señal de la fecha, «se parece el número» es
      // demasiado poco para proponer a quién imputarle la plata.
      const r = cruzar(mov({ monto: 510000, fecha: '2026-05-02' }), [cuota()]);
      expect(r.sugerencias).toEqual([]);
    });
  });

  describe('cuándo el sistema dice que está seguro', () => {
    it('una sola candidata fuerte es clara', () => {
      const r = cruzar(
        mov({ contraparte: '20304050607', referencia: 'PROP-0001' }),
        [cuota({ contrapartesConocidas: ['20304050607'] })],
      );
      expect(r.clara).toBe(true);
    });

    it('DOS candidatas empatadas NO son claras, aunque las dos sean altas', () => {
      // Es el caso que importa: tres inquilinos con el mismo alquiler que vence
      // el mismo día. Elegir por el usuario cuando el sistema no sabe es la
      // forma más rápida de imputarle el alquiler de uno al contrato de otro.
      const r = cruzar(mov(), [
        cuota({ id: 'a', inquilino: 'Camila Rossi' }),
        cuota({ id: 'b', contratoId: 'k2', inquilino: 'Jorge Ferreyra' }),
      ]);

      expect(r.sugerencias).toHaveLength(2);
      expect(r.sugerencias[0].puntaje).toBe(r.sugerencias[1].puntaje);
      expect(r.clara).toBe(false);
    });

    it('con una que le saca distancia a la otra, vuelve a ser clara', () => {
      const r = cruzar(mov({ contraparte: '20304050607' }), [
        cuota({ id: 'a', contrapartesConocidas: ['20304050607'] }),
        cuota({ id: 'b', contratoId: 'k2', inquilino: 'Jorge Ferreyra' }),
      ]);
      expect(r.sugerencias[0].cuotaId).toBe('a');
      expect(r.clara).toBe(true);
    });
  });

  describe('el motivo, para leer sin pensar', () => {
    it('exacto dice a quién le cubre el mes', () => {
      expect(cruzar(mov(), [cuota()]).sugerencias[0].motivo)
        .toBe('Cubre la cuota de 2026-08 de Camila Rossi.');
    });

    it('de menos dice cuánto falta, no «no coincide»', () => {
      const r = cruzar(mov({ monto: 510000 }), [cuota()]);
      expect(r.sugerencias[0].motivo).toContain('quedarían');
      expect(r.sugerencias[0].motivo).toContain('4.682');
    });

    it('de más también se dice: puede ser el alquiler con los punitorios', () => {
      const r = cruzar(mov({ monto: 520000 }), [cuota()]);
      expect(r.sugerencias[0].motivo).toContain('Supera');
    });
  });

  describe('la huella, para no importar dos veces', () => {
    it('el mismo movimiento da la misma huella', () => {
      expect(huellaDe(mov())).toBe(huellaDe(mov()));
    });

    it('dos inquilinos que pagan lo mismo el mismo día NO colapsan', () => {
      // Sin la descripción en la huella, el segundo cobro desaparecería al
      // importar: la fila se descartaría por duplicada y esa plata no existiría.
      const a = huellaDe(mov({ descripcion: 'TRANSF DE ROSSI' }));
      const b = huellaDe(mov({ descripcion: 'TRANSF DE FERREYRA' }));
      expect(a).not.toBe(b);
    });

    it('la descripción se normaliza: el banco cambia mayúsculas y espacios', () => {
      expect(huellaDe(mov({ descripcion: 'Transf.  Recibida' })))
        .toBe(huellaDe(mov({ descripcion: 'TRANSF.  RECIBIDA' })));
    });
  });

  describe('lo que no es un cobro', () => {
    it('reconoce el ruido típico de un extracto', () => {
      expect(pareceRuido(mov({ descripcion: 'IVA COMISION MANTENIMIENTO' }))).toBe(true);
      expect(pareceRuido(mov({ descripcion: 'IMPUESTO LEY 25413' }))).toBe(true);
      expect(pareceRuido(mov({ monto: -5000 }))).toBe(true);
    });

    it('una transferencia común no es ruido', () => {
      expect(pareceRuido(mov())).toBe(false);
    });
  });

  it('la contraparte se normaliza: el banco la escribe distinto cada mes', () => {
    expect(normalizarContraparte('20-30405060-7'))
      .toBe(normalizarContraparte('20 30405060 7'));
    expect(normalizarContraparte(null)).toBe('');
  });
});
