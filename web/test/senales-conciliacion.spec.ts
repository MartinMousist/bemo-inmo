import { describe, expect, it } from 'vitest';
import {
  senalesComunes, senalesDe, senalesPropias,
  type SugerenciaConSenales,
} from '../src/dominio/senales-conciliacion';

const sug = (exacto: boolean, ...senales: string[]): SugerenciaConSenales => ({ exacto, senales });

describe('Qué señal ayuda a elegir una candidata', () => {
  /**
   * El caso real que motivó esto: Camila Rossi con cinco meses impagos, todos
   * por ARS 553.000. Las cinco candidatas decían lo mismo.
   */
  it('lo que dicen TODAS sube al grupo; abajo queda lo que distingue', () => {
    const cinco = [
      sug(true, 'La referencia la nombra', 'A 5 días del vencimiento'),
      sug(true, 'La referencia la nombra'),
      sug(true, 'La referencia la nombra'),
      sug(true, 'La referencia la nombra'),
      sug(true, 'La referencia la nombra'),
    ];

    expect(senalesComunes(cinco)).toEqual(['Monto exacto', 'La referencia la nombra']);

    // Sólo la primera conserva algo propio, y es justo lo que hay que leer.
    expect(senalesPropias(cinco, cinco[0])).toEqual(['A 5 días del vencimiento']);
    expect(senalesPropias(cinco, cinco[1])).toEqual([]);
  });

  it('con una sola candidata no hay nada en común: sus señales se quedan', () => {
    // Si «común» se calculara igual con una sola, su única señal se iría al
    // renglón del grupo y la fila quedaría muda.
    const una = [sug(true, 'La referencia la nombra')];
    expect(senalesComunes(una)).toEqual([]);
    expect(senalesPropias(una, una[0])).toEqual(['Monto exacto', 'La referencia la nombra']);
  });

  it('si ninguna coincide en nada, no se inventa un renglón de grupo', () => {
    const dos = [sug(false, 'A 5 días del vencimiento'), sug(true, 'Ya pagó desde esta cuenta')];
    expect(senalesComunes(dos)).toEqual([]);
  });

  it('«Monto exacto» viaja como una señal más, o no se detectaría el empate', () => {
    // Venía del motor como un booleano aparte y la pantalla lo dibujaba como
    // chip. Fuera de la lista, «todas coinciden en el monto» era invisible.
    expect(senalesDe(sug(true))).toEqual(['Monto exacto']);
    expect(senalesDe(sug(false))).toEqual([]);
    // Y no se duplica si el motor ya lo mandó adentro.
    expect(senalesDe(sug(true, 'Monto exacto'))).toEqual(['Monto exacto']);
  });

  it('el orden del motor se respeta: están de más fuerte a más débil', () => {
    const dos = [
      sug(false, 'Ya pagó desde esta cuenta', 'La referencia la nombra'),
      sug(false, 'Ya pagó desde esta cuenta', 'La referencia la nombra'),
    ];
    expect(senalesComunes(dos)).toEqual(['Ya pagó desde esta cuenta', 'La referencia la nombra']);
  });
});
