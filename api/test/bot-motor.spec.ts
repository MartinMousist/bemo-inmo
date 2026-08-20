import {
  contiene, decidir, estaNegado, normalizar, REGLAS_POR_DEFECTO,
  type EstadoHilo,
} from '../src/inbox/bot.motor';

/**
 * El bot de la bandeja (etapa 18).
 *
 * Lo que se prueba no es «contesta»: es a QUIÉN le deja el trabajo. Un bot que
 * se queda con una conversación que necesitaba una persona es la forma más
 * cara de fallar que tiene esta feature.
 */

const AHORA = new Date('2026-08-20T15:00:00Z');

const HILO: EstadoHilo = {
  botActivo: true,
  botPausadoHasta: null,
  esPrimerMensaje: false,
  asignado: false,
};

const d = (msg: string, estado: Partial<EstadoHilo> = {}) =>
  decidir(msg, REGLAS_POR_DEFECTO, { ...HILO, ...estado }, AHORA);

describe('Bot de la bandeja — motor', () => {
  describe('normalizar', () => {
    it('saca acentos, mayúsculas y signos', () => {
      expect(normalizar('¿SÍ, Está Ahí?')).toBe('si esta ahi');
    });

    it('«SÍ» y «si» son la misma palabra', () => {
      // En un canal donde se escribe desde el teléfono, tratarlas distinto
      // deja el bot mudo la mitad de las veces.
      expect(normalizar('Sí')).toBe(normalizar('si'));
    });
  });

  describe('contiene', () => {
    it('encuentra la palabra', () => {
      expect(contiene('quiero hablar con un asesor', ['asesor'])).toBe('asesor');
    });

    it('NO la encuentra adentro de otra palabra', () => {
      // Con un `includes` pelado, «asesoramiento» dispararía la salida a humano
      // y el bot se volvería impredecible justo en los mensajes largos.
      expect(contiene('busco asesoramiento contable', ['asesor'])).toBeNull();
      expect(contiene('hola', ['ola'])).toBeNull();
      expect(contiene('nosotros vamos', ['no'])).toBeNull();
    });

    it('encuentra frases de varias palabras', () => {
      expect(contiene('quiero hablar con alguien ya', ['hablar con alguien']))
        .toBe('hablar con alguien');
    });
  });

  describe('estaNegado', () => {
    it('«no quiero hablar con un asesor» está negado', () => {
      expect(estaNegado('no quiero hablar con un asesor', 'asesor')).toBe(true);
    });

    it('«quiero un asesor» no lo está', () => {
      expect(estaNegado('quiero un asesor', 'asesor')).toBe(false);
    });

    it('la coma corta el alcance de la negación', () => {
      // «No hace falta un asesor, quiero alquilar» niega el asesor y NO niega
      // el alquiler: son dos oraciones pegadas. Sin este corte, un solo «no» al
      // principio apagaba todas las palabras clave que vinieran después.
      expect(estaNegado('no hace falta un asesor, quiero alquilar', 'asesor')).toBe(true);
      expect(estaNegado('no hace falta un asesor, quiero alquilar', 'alquilar')).toBe(false);
    });

    it('la conjunción también lo corta, sin necesidad de puntuación', () => {
      // En WhatsApp la mitad de los mensajes no tienen un solo signo.
      expect(estaNegado('no me contestaron y quiero un asesor', 'asesor')).toBe(false);
    });

    it('una negación lejana NO cuenta', () => {
      // «no me contestaron el lunes, quiero un asesor» sí pide un asesor. Mirar
      // la oración entera haría que cualquier «no» apague la escalada.
      expect(estaNegado('no me contestaron el lunes y quiero un asesor', 'asesor')).toBe(false);
    });
  });

  describe('cuando hay una persona en el medio, el bot no existe', () => {
    it('apagado a mano: se calla', () => {
      expect(d('hola', { botActivo: false }).accion).toBe('callar');
    });

    it('pausado porque un agente contestó recién: se calla', () => {
      const r = d('hola', { botPausadoHasta: new Date(AHORA.getTime() + 60_000) });
      expect(r.accion).toBe('callar');
    });

    it('pero la pausa VENCE sola', () => {
      // Es la diferencia entre las dos columnas: apagarlo a mano sobrevive al
      // reloj; la pausa por respuesta de un agente no.
      const r = d('hola', { botPausadoHasta: new Date(AHORA.getTime() - 60_000) });
      expect(r.accion).not.toBe('callar');
    });

    it('ya asignado a alguien: se calla', () => {
      expect(d('hola', { asignado: true }).accion).toBe('callar');
    });
  });

  describe('las palabras de salida', () => {
    it.each([
      'quiero hablar con un humano',
      'pasame con un asesor',
      'necesito una persona',
      'ATENCION HUMANA por favor',
      'me pasás con un operador?',
    ])('«%s» escala', (msg) => {
      const r = d(msg);
      expect(r.accion).toBe('escalar');
      if (r.accion === 'escalar') expect(r.texto).toContain('ya te paso');
    });

    it('ganan aunque el mensaje también se pudiera rutear', () => {
      // Pedir una persona no se negocia: si además dijo «alquiler», no importa.
      // El ruteo automático nunca puede tapar un pedido explícito.
      const r = d('quiero alquilar pero prefiero hablar con un asesor');
      expect(r.accion).toBe('escalar');
      if (r.accion === 'escalar') expect(r.motivo).toContain('pidió hablar con una persona');
    });

    it('negadas NO escalan por esa vía', () => {
      const r = d('no hace falta un asesor, quiero alquilar');
      expect(r.accion).toBe('escalar');
      if (r.accion === 'escalar') expect(r.equipo).toBe('alquileres');
    });
  });

  describe('el ruteo por tema', () => {
    it.each([
      ['busco algo para alquilar en Godoy Cruz', 'alquileres'],
      ['quiero comprar un depto', 'ventas'],
      ['no me llegó el recibo de la cuota', 'administracion'],
      ['se rompió la caldera, hay una perdida de agua', 'reclamos'],
    ])('«%s» → %s', (msg, equipo) => {
      const r = d(msg);
      expect(r.accion).toBe('escalar');
      if (r.accion === 'escalar') expect(r.equipo).toBe(equipo);
    });
  });

  describe('confirmaciones y cancelaciones', () => {
    it('confirmar avisa a una persona', () => {
      const r = d('dale, confirmo la visita');
      expect(r.accion).toBe('avisar');
      if (r.accion === 'avisar') expect(r.clase).toBe('confirmacion');
    });

    it('cancelar también, y no se confunde con confirmar', () => {
      const r = d('no puedo ir mañana, hay que reprogramar');
      expect(r.accion).toBe('avisar');
      if (r.accion === 'avisar') expect(r.clase).toBe('cancelacion');
    });

    it('la cancelación se evalúa ANTES que la confirmación', () => {
      // «no puedo, cancelo» tiene las dos: si ganara la confirmación, el
      // sistema avisaría exactamente lo contrario de lo que pasó.
      const r = d('cancelo, no puedo');
      expect(r.accion).toBe('avisar');
      if (r.accion === 'avisar') expect(r.clase).toBe('cancelacion');
    });
  });

  describe('lo que no entiende', () => {
    it('el primer mensaje se saluda', () => {
      const r = d('hola qué tal', { esPrimerMensaje: true });
      expect(r.accion).toBe('responder');
    });

    it('lo que no matchea NO se contesta con «no te entendí»: escala', () => {
      // Es la decisión de producto más importante del motor. Un bot que
      // contesta «no te entendí» y se queda ahí es el que hace que la gente
      // deje de escribir. Si el bot no sabe, es trabajo para una persona.
      const r = d('estoy con el tema del lote de mi tía');
      expect(r.accion).toBe('escalar');
      if (r.accion === 'escalar') {
        expect(r.equipo).toBeNull();
        expect(r.motivo).toContain('no supo');
      }
    });

    it('un mensaje vacío también escala en vez de quedar colgado', () => {
      expect(d('').accion).toBe('escalar');
    });
  });
});
