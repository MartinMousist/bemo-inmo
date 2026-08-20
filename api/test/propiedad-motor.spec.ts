import { detectarPropiedad } from '../src/inbox/propiedad.motor';

/**
 * De qué propiedad habla un mensaje (etapa 18).
 *
 * Lo que se prueba, sobre todo, es lo que NO tiene que detectar. Enganchar la
 * propiedad equivocada le asigna la consulta al captador de otra unidad, que
 * contesta sobre algo que el cliente no preguntó — y nadie revisa un dato que
 * el sistema puso con seguridad.
 */
describe('Detectar la propiedad de un mensaje', () => {
  describe('el código', () => {
    it.each([
      ['Hola, me interesa PROP-0034', 34],
      ['consulta por prop 34', 34],
      ['PROP0034 sigue disponible?', 34],
      ['Vi la PROP-7 en el portal', 7],
      ['prop_0012', 12],
    ])('«%s» → %i', (texto, esperado) => {
      expect(detectarPropiedad(texto).codigo).toBe(esperado);
    });

    it('los ceros a la izquierda dan lo mismo', () => {
      expect(detectarPropiedad('PROP-0034').codigo)
        .toBe(detectarPropiedad('PROP-34').codigo);
    });
  });

  describe('lo que NO tiene que detectar', () => {
    it.each([
      'busco algo de 34 metros cuadrados',
      'tengo 2 nenes y un perro',
      'mi presupuesto son 340000 pesos',
      'llamame al 2615551234',
      'hola, buenas tardes',
      '',
    ])('«%s» no engancha nada', (texto) => {
      const r = detectarPropiedad(texto);
      expect(r.codigo).toBeNull();
      expect(r.id).toBeNull();
    });

    it('un número suelto NUNCA es un código', () => {
      // Es la decisión que más falsos positivos evita: sin el prefijo, media
      // conversación normal engancharía una propiedad al azar.
      expect(detectarPropiedad('34').codigo).toBeNull();
    });

    it('«prop 0» no existe: los códigos arrancan en 1', () => {
      expect(detectarPropiedad('prop 0').codigo).toBeNull();
    });

    it('un uuid suelto no alcanza', () => {
      // Puede ser cualquier cosa. Sólo vale dentro de un enlace nuestro.
      expect(detectarPropiedad('id 3f2504e0-4f89-41d3-9a0c-0305e82c3301').id).toBeNull();
    });
  });

  describe('el enlace', () => {
    it('saca el id de la ficha', () => {
      const r = detectarPropiedad(
        'Vi esto https://andes.test/propiedades/3f2504e0-4f89-41d3-9a0c-0305e82c3301 ¿sigue?',
      );
      expect(r.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    });

    it('también de una publicación', () => {
      expect(detectarPropiedad('/publicaciones/3F2504E0-4F89-41D3-9A0C-0305E82C3301').id)
        .toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    });

    it('el enlace le gana al código escrito', () => {
      // El enlace es exacto; el código depende de que esté bien tipeado.
      const r = detectarPropiedad('PROP-0099 → /propiedades/3f2504e0-4f89-41d3-9a0c-0305e82c3301');
      expect(r.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
      expect(r.codigo).toBeNull();
    });
  });
});
