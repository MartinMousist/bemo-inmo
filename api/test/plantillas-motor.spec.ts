import { renderizar, variablesDe } from '../src/plantillas/plantillas.motor';

/**
 * Motor de plantillas.
 *
 * Lo que se prueba acá termina en un contrato que alguien firma. Un monto mal
 * formateado o un dato que desaparece en silencio no es un bug de texto.
 */
describe('Motor de plantillas', () => {
  const ctx = {
    moneda: 'ARS',
    contrato: { monto: 485000, inicio: '2026-01-01', fin: '2028-12-31' },
    locador: { nombre: 'Marta Silva' },
    locatario: { nombre: 'Camila Rossi' },
    garantes: [{ nombre: 'Jorge Ferreyra' }, { nombre: 'Ana Paz' }],
    sinGarantes: [],
  };

  it('reemplaza variables anidadas', () => {
    const r = renderizar('Locador: {{ locador.nombre }}', ctx);
    expect(r.texto).toBe('Locador: Marta Silva');
    expect(r.faltantes).toEqual([]);
  });

  it('un dato faltante deja un hueco VISIBLE, no un vacío', () => {
    // En un contrato, que falte un dato tiene que saltar a la vista antes de
    // firmarlo. Un string vacío pasa desapercibido.
    const r = renderizar('Escribano: {{ escribano.nombre }}', ctx);
    expect(r.texto).toBe('Escribano: «escribano.nombre»');
    expect(r.faltantes).toEqual(['escribano.nombre']);
  });

  describe('formatos', () => {
    it('moneda usa la del contexto y el formato argentino', () => {
      expect(renderizar('{{ contrato.monto | moneda }}', ctx).texto)
        .toBe('ARS 485.000,00');
      expect(renderizar('{{ contrato.monto | moneda }}', { ...ctx, moneda: 'USD' }).texto)
        .toBe('USD 485.000,00');
    });

    it('fecha en dd/mm/aaaa y en texto', () => {
      expect(renderizar('{{ contrato.inicio | fecha }}', ctx).texto).toBe('01/01/2026');
      expect(renderizar('{{ contrato.inicio | fecha_larga }}', ctx).texto)
        .toBe('1 de enero de 2026');
    });

    it('el monto en letras, que es lo que exige un contrato', () => {
      expect(renderizar('{{ contrato.monto | letras }}', ctx).texto)
        .toBe('cuatrocientos ochenta y cinco mil');
    });

    it.each([
      [0, 'cero'],
      [1, 'uno'],
      [15, 'quince'],
      [21, 'veintiuno'],
      [30, 'treinta'],
      [31, 'treinta y uno'],
      [100, 'cien'],
      [101, 'ciento uno'],
      [1000, 'mil'],
      [1001, 'mil uno'],
      [2000, 'dos mil'],
      [485000, 'cuatrocientos ochenta y cinco mil'],
      [1000000, 'un millón'],
      [2500000, 'dos millones quinientos mil'],
    ])('%s en letras es "%s"', (n, esperado) => {
      expect(renderizar('{{ n | letras }}', { n }).texto).toBe(esperado);
    });
  });

  describe('estructuras', () => {
    it('el condicional incluye o saca el bloque', () => {
      const p = '{% si garantes %}Con garantes.{% fin %}';
      expect(renderizar(p, ctx).texto).toBe('Con garantes.');
      expect(renderizar(p, { garantes: [] }).texto).toBe('');
    });

    it('una lista vacía es falsa', () => {
      expect(renderizar('{% si sinGarantes %}X{% fin %}', ctx).texto).toBe('');
    });

    it('recorre una lista', () => {
      const r = renderizar('{% para g en garantes %}[{{ g.nombre }}]{% fin %}', ctx);
      expect(r.texto).toBe('[Jorge Ferreyra][Ana Paz]');
    });

    it('las estructuras se pueden anidar', () => {
      const p = '{% si garantes %}{% para g en garantes %}<{{ g.nombre }}>{% fin %}{% fin %}';
      expect(renderizar(p, ctx).texto).toBe('<Jorge Ferreyra><Ana Paz>');
    });

    it('una estructura sin cerrar no rompe todo el documento', () => {
      // Se deja el texto crudo y se sigue: perder el contrato entero por una
      // llave mal escrita sería peor que mostrar el error en su lugar.
      const r = renderizar('Antes {% si garantes %}sin cerrar', ctx);
      expect(r.texto).toContain('Antes');
    });
  });

  it('NO ejecuta código: sólo reemplaza', () => {
    // La plantilla la edita el titular desde un textarea. Si el motor evaluara
    // expresiones, ese textarea sería una consola con permisos del servidor.
    const r = renderizar('{{ constructor }}|{{ __proto__ }}|{{ a.constructor.name }}', {
      a: { b: 1 },
    });
    expect(r.texto).not.toContain('function');
    expect(r.texto).not.toContain('Object');
    expect(r.texto).toBe('«constructor»|«__proto__»|«a.constructor.name»');
  });

  it('lista las variables que usa una plantilla', () => {
    const p = 'Hola {{ locador.nombre }}, monto {{ contrato.monto | moneda }} y {{ x }}';
    expect(variablesDe(p)).toEqual(['contrato.monto', 'locador.nombre', 'x']);
  });
});
