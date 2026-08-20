/**
 * El bot de la bandeja: qué hacer con un mensaje que entra.
 *
 * Puro: sin base y sin red. Recibe el mensaje, las reglas de la cuenta y el
 * estado del hilo, y devuelve UNA decisión. Todo lo que decide se puede probar
 * con casos de papel, que es la única forma de tener confianza en algo que le
 * contesta solo a un cliente.
 *
 * ── La regla que ordena todo lo demás ──
 *
 * **Ante la duda, escala.** Escalar de más le cuesta a un asesor diez segundos
 * de mirar un chat que no hacía falta. No escalar cuando alguien pidió hablar
 * con una persona cuesta el cliente. Las dos equivocaciones no valen lo mismo,
 * así que el motor no las trata igual.
 *
 * ── Por qué palabras clave y no un modelo ──
 *
 * Porque esto decide si una persona atiende o no, y tiene que poder explicarse:
 * «se derivó porque dijo *asesor*». Un modelo que a veces no deriva y nadie
 * sabe por qué es peor que una lista de palabras que alguien puede corregir en
 * treinta segundos. Cuando haya un modelo, va DESPUÉS de esto y no en su lugar:
 * el atajo por palabra clave tiene que seguir ganando.
 */

export type AutorTipo = 'cliente' | 'agente' | 'bot' | 'sistema';

export interface ReglasBot {
  /** Lo que el cliente escribe para que lo atienda una persona. */
  palabrasDeSalida: string[];
  /** A qué equipo mandar según lo que diga. La primera que coincide gana. */
  ruteo: Array<{ palabras: string[]; equipo: string }>;
  /** Lo que el cliente escribe para confirmar algo (una visita, un turno). */
  palabrasDeConfirmacion: string[];
  /** Lo que el cliente escribe para cancelar. Se avisa igual que una confirmación. */
  palabrasDeCancelacion: string[];
  /** El saludo del primer mensaje de un hilo. Vacío = no saluda. */
  bienvenida?: string;
  /** Qué contestar cuando no coincide nada. Vacío = no contesta y escala. */
  sinCoincidencia?: string;
}

export interface EstadoHilo {
  /** Lo apagó una persona para este hilo. No vuelve solo. */
  botActivo: boolean;
  /** El agente contestó recién: el bot se calla hasta acá y VUELVE solo. */
  botPausadoHasta: Date | null;
  /** `true` si el hilo no tiene ningún mensaje todavía. */
  esPrimerMensaje: boolean;
  /** Si ya hay una persona a cargo, el bot no se mete. */
  asignado: boolean;
}

export type Decision =
  /** Contestar automáticamente. */
  | { accion: 'responder'; texto: string; motivo: string }
  /** Que lo atienda una persona, y avisar. */
  | { accion: 'escalar'; motivo: string; equipo: string | null; texto: string | null }
  /** El cliente confirmó o canceló algo: hay que avisarle a alguien. */
  | { accion: 'avisar'; clase: 'confirmacion' | 'cancelacion'; motivo: string; texto: string | null }
  /** No hacer nada. */
  | { accion: 'callar'; motivo: string };

/**
 * Normaliza para comparar: sin acentos, sin mayúsculas, sin signos.
 *
 * Sin esto «SÍ», «si» y «Sí!» son tres cosas distintas, y en un canal donde la
 * gente escribe desde el teléfono eso deja el bot mudo la mitad de las veces.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Aparece alguna de estas palabras como PALABRA, no como pedazo de otra?
 *
 * `incluye('hola', ['ola'])` tiene que dar false. Con un `includes` pelado,
 * «asesoramiento» dispararía la salida por «asesor» y «no» estaría adentro de
 * «nosotros»: el bot se volvería impredecible justo en los mensajes largos.
 */
export function contiene(texto: string, palabras: string[]): string | null {
  const t = ` ${normalizar(texto)} `;
  for (const p of palabras) {
    const n = normalizar(p);
    if (!n) continue;
    if (t.includes(` ${n} `)) return p;
  }
  return null;
}

/**
 * Las negaciones que dan vuelta el sentido.
 *
 * «no quiero hablar con un humano» NO es un pedido de humano. Se mira sólo la
 * ventana corta antes de la palabra, que es donde vive la negación en
 * castellano. No es análisis de lenguaje y no pretende serlo: es el caso
 * frecuente, y el resto cae del lado de escalar —que es el lado barato—.
 */
const NEGACIONES = ['no', 'nunca', 'tampoco', 'ni'];

/**
 * Dónde TERMINA el alcance de una negación.
 *
 * En castellano una negación no llega hasta el final del mensaje: la corta una
 * coma o una conjunción. «No hace falta un asesor, quiero alquilar» niega el
 * asesor y **no** niega el alquiler; son dos oraciones pegadas.
 *
 * Sin esto, un solo «no» al principio apagaba todas las palabras clave que
 * vinieran después y el bot dejaba de rutear mensajes perfectamente claros.
 * Pasó, y por eso hay un test con esa frase exacta.
 */
const PUNTUACION = /[,.;:!?\n]+/;
const CONJUNCIONES = /\b(?:y|pero|aunque|igual|asi que|entonces)\b/;

/**
 * Los pedazos del mensaje, cada uno con su propio alcance de negación.
 *
 * El orden importa y costó un test: la puntuación se corta sobre el texto
 * CRUDO, porque `normalizar` borra las comas. Cortando después, «no hace falta
 * un asesor, quiero alquilar» llegaba como una sola oración y el «no» del
 * principio se comía el «alquilar» del final.
 */
function segmentos(texto: string): string[] {
  return texto
    .split(PUNTUACION)
    .flatMap((parte) => normalizar(parte).split(CONJUNCIONES))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function estaNegado(texto: string, palabra: string): boolean {
  const n = normalizar(palabra).split(' ')[0];

  for (const seg of segmentos(texto)) {
    const t = seg.split(' ');
    const i = t.indexOf(n);
    if (i <= 0) continue;

    // Dentro del segmento, seis palabras hacia atrás. El corte por conjunción
    // ya hace casi todo el trabajo; la ventana es el respaldo para un mensaje
    // largo escrito de corrido, sin un solo signo de puntuación —que en
    // WhatsApp es la mitad de los mensajes—.
    if (t.slice(Math.max(0, i - 6), i).some((w) => NEGACIONES.includes(w))) return true;
  }
  return false;
}

export const REGLAS_POR_DEFECTO: ReglasBot = {
  // Lo que de verdad escribe alguien que se cansó del bot.
  palabrasDeSalida: [
    'humano', 'persona', 'asesor', 'agente', 'operador', 'vendedor',
    'hablar con alguien', 'atencion humana', 'quiero hablar',
  ],
  ruteo: [
    { palabras: ['alquilar', 'alquiler', 'arriendo', 'renta'], equipo: 'alquileres' },
    { palabras: ['comprar', 'compra', 'venta', 'vender'], equipo: 'ventas' },
    { palabras: ['pagar', 'pago', 'cuota', 'expensas', 'recibo', 'deuda'], equipo: 'administracion' },
    { palabras: ['arreglo', 'reparacion', 'roto', 'perdida', 'humedad', 'reclamo'], equipo: 'reclamos' },
  ],
  palabrasDeConfirmacion: ['confirmo', 'confirmado', 'dale', 'de acuerdo', 'acepto', 'listo', 'ok'],
  palabrasDeCancelacion: ['cancelo', 'cancelar', 'no puedo', 'reprogramar', 'posponer'],
  bienvenida:
    '¡Hola! Gracias por escribir. Contame en qué te puedo ayudar y te derivo con la persona indicada. '
    + 'Si preferís hablar directamente con alguien del equipo, escribí «asesor».',
  sinCoincidencia: '',
};

/**
 * La decisión.
 *
 * El orden de los chequeos ES la política, y está pensado para que ninguna
 * regla automática pueda tapar a una persona:
 *
 *   1. ¿Hay alguien atendiendo?        → el bot no existe
 *   2. ¿El cliente pidió una persona?  → escalar, aunque el bot supiera contestar
 *   3. ¿Confirmó o canceló algo?       → avisar a una persona
 *   4. ¿Se puede rutear?               → escalar al equipo que corresponde
 *   5. ¿Es el primer mensaje?          → saludar
 *   6. Nada de lo anterior             → escalar
 *
 * El paso 6 es la decisión de producto que más importa. Un bot que contesta «no
 * te entendí» y se queda ahí es el que hace que la gente deje de escribir. Si
 * el bot no sabe, **es trabajo para una persona**, y el sistema lo dice.
 */
export function decidir(
  mensaje: string,
  reglas: ReglasBot,
  estado: EstadoHilo,
  ahora: Date,
): Decision {
  if (!estado.botActivo) {
    return { accion: 'callar', motivo: 'El bot está apagado en esta conversación.' };
  }
  if (estado.botPausadoHasta && estado.botPausadoHasta > ahora) {
    return { accion: 'callar', motivo: 'Un agente contestó recién.' };
  }
  if (estado.asignado) {
    return { accion: 'callar', motivo: 'La conversación ya tiene una persona a cargo.' };
  }

  const salida = contiene(mensaje, reglas.palabrasDeSalida);
  if (salida && !estaNegado(mensaje, salida)) {
    return {
      accion: 'escalar',
      motivo: `El cliente pidió hablar con una persona («${salida}»).`,
      equipo: null,
      texto: 'Dale, ya te paso con alguien del equipo. Aguardame un momento.',
    };
  }

  const cancela = contiene(mensaje, reglas.palabrasDeCancelacion);
  if (cancela && !estaNegado(mensaje, cancela)) {
    return {
      accion: 'avisar',
      clase: 'cancelacion',
      motivo: `El cliente canceló o pidió reprogramar («${cancela}»).`,
      texto: 'Perfecto, lo anoto y te contactamos para reprogramar.',
    };
  }

  const confirma = contiene(mensaje, reglas.palabrasDeConfirmacion);
  if (confirma && !estaNegado(mensaje, confirma)) {
    return {
      accion: 'avisar',
      clase: 'confirmacion',
      motivo: `El cliente confirmó («${confirma}»).`,
      texto: '¡Genial! Queda confirmado. Cualquier cosa escribime por acá.',
    };
  }

  for (const r of reglas.ruteo) {
    const p = contiene(mensaje, r.palabras);
    if (p && !estaNegado(mensaje, p)) {
      return {
        accion: 'escalar',
        motivo: `Consulta de ${r.equipo} («${p}»).`,
        equipo: r.equipo,
        texto: null,
      };
    }
  }

  if (estado.esPrimerMensaje && reglas.bienvenida) {
    return { accion: 'responder', texto: reglas.bienvenida, motivo: 'Primer mensaje del hilo.' };
  }

  return {
    accion: 'escalar',
    motivo: 'El bot no supo qué hacer con el mensaje.',
    equipo: null,
    texto: reglas.sinCoincidencia || null,
  };
}
