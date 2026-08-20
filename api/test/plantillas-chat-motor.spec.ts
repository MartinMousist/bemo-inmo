import { aplicarVariables, previsualizar, VARIABLES } from '../src/inbox/plantillas.motor';

/**
 * Las variables de una respuesta rápida (etapa 18).
 *
 * Lo que se prueba es qué pasa con lo que NO se puede resolver, que es el único
 * caso que puede terminar en un mensaje mandado a un cliente.
 */
describe('Respuestas rápidas — variables', () => {
  const datos = { nombre: 'Lucía', inmobiliaria: 'Andes', agente: 'Ana' };

  it('reemplaza lo que conoce', () => {
    const r = aplicarVariables('Hola {nombre}, te escribe {agente} de {inmobiliaria}.', datos);
    expect(r.texto).toBe('Hola Lucía, te escribe Ana de Andes.');
    expect(r.faltantes).toEqual([]);
  });

  it('tolera espacios y mayúsculas', () => {
    // `{ Nombre }` escrito a las apuradas tiene que andar igual: si fallara en
    // silencio, la plantilla saldría con el marcador puesto y nadie entendería
    // por qué.
    expect(aplicarVariables('Hola { Nombre }', datos).texto).toBe('Hola Lucía');
  });

  it('lo que no puede resolver lo DEJA A LA VISTA y lo avisa', () => {
    // «Hola , ¿cómo estás?» con el hueco en el medio se manda sin que nadie lo
    // note. El marcador puesto, no.
    const r = aplicarVariables('Hola {nombre}, soy {agente}.', { agente: 'Ana' });
    expect(r.texto).toBe('Hola {nombre}, soy Ana.');
    expect(r.faltantes).toEqual(['nombre']);
  });

  it('un nombre vacío cuenta como faltante, no como nombre', () => {
    const r = aplicarVariables('Hola {nombre}', { nombre: '   ' });
    expect(r.faltantes).toEqual(['nombre']);
  });

  it('una variable inventada se marca como typo, no como faltante', () => {
    // Son dos problemas distintos: una falta el dato, la otra está mal escrita
    // en la plantilla. Mezclarlas manda a buscar el error donde no está.
    const r = aplicarVariables('Hola {nombre}, tu {propiedad} está lista.', datos);
    expect(r.desconocidas).toEqual(['propiedad']);
    expect(r.faltantes).toEqual([]);
    expect(r.texto).toContain('{propiedad}');
  });

  it('una plantilla sin variables pasa igual', () => {
    const r = aplicarVariables('Gracias por escribir.', datos);
    expect(r.texto).toBe('Gracias por escribir.');
  });

  describe('la vista previa', () => {
    it('usa valores de ejemplo y no los de un cliente real', () => {
      // Quien edita una plantilla no tiene una conversación abierta; mostrarle
      // datos de alguien cualquiera «para que se vea cómo queda» expone a un
      // tercero sin motivo.
      const r = previsualizar('Hola {nombre}, soy {agente}.');
      expect(r.texto).toBe('Hola Lucía, soy Ana Torres.');
      expect(r.faltantes).toEqual([]);
    });

    it('marca los typos mientras se escribe', () => {
      expect(previsualizar('Hola {nombree}').desconocidas).toEqual(['nombree']);
    });

    it('todas las variables declaradas tienen ejemplo', () => {
      // Sin ejemplo, la vista previa mostraría el marcador y parecería un error.
      for (const v of VARIABLES) expect(v.ejemplo.trim()).not.toBe('');
    });
  });
});
