import { ordenSeguro } from '../src/common/orden';

/**
 * `ordenSeguro`.
 *
 * Es un motor puro y se prueba como tal: entra data, sale un fragmento de SQL.
 *
 * Existe por una razón concreta y peligrosa: **`ORDER BY` no acepta bind
 * parameters**. Un `porPagina` se manda como `$1` y no hay riesgo; una columna
 * de ordenamiento hay que concatenarla sí o sí, y ahí es donde entra una
 * inyección si el valor viene del cliente sin filtrar.
 *
 * La lista blanca no es una validación más: es la única defensa.
 */
describe('ordenSeguro', () => {
  const COLUMNAS = { saldo: 'adeudado', vence: 'c.fecha_fin' };
  const DEFECTO = 'c.fecha_fin';

  it('traduce una clave conocida a su columna', () => {
    expect(ordenSeguro(COLUMNAS, DEFECTO, 'saldo', 'asc')).toBe('adeudado ASC NULLS LAST');
    expect(ordenSeguro(COLUMNAS, DEFECTO, 'saldo', 'desc')).toBe('adeudado DESC NULLS LAST');
  });

  it('sin orden pedido devuelve el de la pantalla', () => {
    expect(ordenSeguro(COLUMNAS, DEFECTO)).toBe(DEFECTO);
    expect(ordenSeguro(COLUMNAS, DEFECTO, undefined, 'desc')).toBe(DEFECTO);
  });

  it('una clave que no está en la lista NO llega al SQL', () => {
    // Éste es el test que importa. Cualquier cosa que no esté en la lista cae
    // al orden por defecto en vez de concatenarse.
    for (const veneno of [
      'password',
      'c.id; DROP TABLE contrato_alquiler',
      "1; SELECT * FROM usuario--",
      'adeudado, (SELECT password_hash FROM usuario LIMIT 1)',
      '__proto__',
      'constructor',
    ]) {
      expect(ordenSeguro(COLUMNAS, DEFECTO, veneno, 'asc')).toBe(DEFECTO);
    }
  });

  it('una dirección inventada cae en ASC, no se interpola', () => {
    // `dir` sí está validado por `@IsIn` en el DTO, pero el motor no confía en
    // que alguien más haya validado: es lo único que lo separa del SQL.
    expect(ordenSeguro(COLUMNAS, DEFECTO, 'saldo', 'DESC; DROP' as never))
      .toBe('adeudado ASC NULLS LAST');
  });

  it('siempre NULLS LAST, en las dos direcciones', () => {
    // Una fila sin dato no es "la más chica": ponerla arriba al ordenar
    // descendente llena la primera pantalla de guiones.
    expect(ordenSeguro(COLUMNAS, DEFECTO, 'vence', 'asc')).toContain('NULLS LAST');
    expect(ordenSeguro(COLUMNAS, DEFECTO, 'vence', 'desc')).toContain('NULLS LAST');
  });
});
