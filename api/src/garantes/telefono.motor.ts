/**
 * Del teléfono que alguien tipeó en la ficha al número que WhatsApp entiende.
 * PURO: entra un texto, sale un número o un motivo. Sin red y sin base.
 *
 * Existe porque **un `wa.me` mal armado abre el chat de otra persona**. No
 * falla: abre. Manda el mensaje de la garantía de un alquiler a un número que
 * no tiene nada que ver, y del otro lado alguien lee el nombre del inquilino,
 * la dirección de la propiedad y el nombre de la inmobiliaria. Por eso, cuando
 * la cuenta no cierra, esto devuelve `null` con el motivo y la pantalla
 * deshabilita el botón — nunca "lo mejor que se pudo".
 *
 * ── El invariante que lo hace confiable ─────────────────────────────────────
 *
 * El número nacional argentino tiene **siempre 10 dígitos**: código de área
 * (2, 3 o 4) + abonado (8, 7 o 6). WhatsApp quiere `549` + esos 10 = 13.
 * Cualquier otra cosa es un número mal cargado, y decirlo es más barato que
 * adivinarlo.
 *
 * ── Los dos ceros que sobran ────────────────────────────────────────────────
 *
 * El `0` de larga distancia y el `15` de celular son de la telefonía fija
 * argentina y **no van** en el formato internacional: `0261 15 555-1234` y
 * `+54 9 261 555 1234` son la misma persona y tienen que llegar al mismo
 * `wa.me`. El `0` se saca por izquierda y es fácil. El `15` NO: aparece
 * después del código de área, y para ubicarlo hay que saber dónde termina el
 * área — que es de 2, 3 o 4 dígitos. De ahí la tabla cerrada de abajo. Un
 * `replace(/15/, '')` a los tapones le comería los dos dígitos del medio a
 * `11 1556-7788`, que es un número de CABA sin ningún 15 de celular, y dejaría
 * un `wa.me` de ocho dígitos que abre el chat de cualquiera.
 *
 * ── Lo que esto NO puede saber ──────────────────────────────────────────────
 *
 * Si es un fijo o un celular. El plan de numeración argentino no lo dice desde
 * afuera y la línea fija de una casa se ve exactamente igual que un celular. El
 * que avisa es WhatsApp cuando el chat no existe, y la pantalla no promete lo
 * contrario.
 */

/**
 * Códigos de área de 3 dígitos. Todo lo que no arranca con `11` ni está acá es
 * de 4 dígitos: es una lista cerrada porque el plan de numeración lo es.
 */
const AREAS_3 = new Set([
  // Buenos Aires
  '220', '221', '223', '230', '236', '237', '249', '291', '336', '348',
  // Cuyo
  '260', '261', '263', '264', '266',
  // Patagonia
  '280', '294', '297', '298', '299',
  // Litoral y centro
  '341', '342', '343', '345', '351', '353', '358',
  // Norte
  '362', '364', '370', '376', '379', '380', '381', '383', '385', '387', '388',
]);

/** Prefijo internacional de WhatsApp para un celular argentino: 54 + 9. */
const PREFIJO_WA = '549';

/** Los 10 dígitos nacionales: área + abonado. No hay excepciones. */
const LARGO_NACIONAL = 10;

export interface TelefonoNormalizado {
  /** Listo para `wa.me/{numero}`: 13 dígitos, `549` + los 10 nacionales. */
  numero: string | null;
  /** Por qué no se pudo. `null` cuando salió bien. Se muestra tal cual. */
  motivo: string | null;
  /** El código de área que se reconoció. Sirve para explicarlo en la UI. */
  area: string | null;
}

/** Cuántos dígitos ocupa el código de área de un número nacional. */
export function largoArea(nacional: string): number {
  if (nacional.startsWith('11')) return 2;
  if (AREAS_3.has(nacional.slice(0, 3))) return 3;
  return 4;
}

/**
 * De lo que sea que esté cargado al número internacional.
 *
 * El orden de los recortes importa y cada uno lleva su guarda de longitud: sin
 * ellas, un número nacional que arranca con `9` o con `0` —que no existen, pero
 * un dedo los escribe— se quedaría corto y saldría un `wa.me` de otra persona,
 * que es justo lo que esto viene a evitar.
 */
export function normalizarAr(telefono: string | null | undefined): TelefonoNormalizado {
  const crudo = (telefono ?? '').trim();
  let d = crudo.replace(/\D/g, '');

  if (!d) {
    return {
      numero: null,
      area: null,
      // Dos motivos distintos a propósito: «no cargó el teléfono» se arregla
      // pidiéndoselo, y «cargó algo que no tiene ni un dígito» se arregla
      // mirando la ficha. Una sola frase para los dos manda a buscar mal.
      motivo: crudo
        ? `Lo que está cargado como teléfono («${crudo}») no tiene ningún dígito.`
        : 'No tiene teléfono cargado en su ficha.',
    };
  }

  // `00` de salida internacional (así se marca desde un fijo argentino).
  if (d.startsWith('00')) d = d.slice(2);
  // Código de país. Sólo se saca si después queda algo con forma de número:
  // ningún área argentina empieza con 54, pero la guarda es gratis.
  if (d.startsWith('54') && d.length > LARGO_NACIONAL) d = d.slice(2);
  // El `9` de celular del formato internacional. Ninguna área empieza con 9.
  if (d.startsWith('9') && d.length > LARGO_NACIONAL) d = d.slice(1);
  // El `0` de larga distancia. Ninguna área empieza con 0.
  if (d.startsWith('0') && d.length > LARGO_NACIONAL) d = d.slice(1);

  // Recién acá se puede sacar el `15`: hace falta saber dónde termina el área.
  const area = largoArea(d);
  if (d.length === LARGO_NACIONAL + 2 && d.slice(area, area + 2) === '15') {
    d = d.slice(0, area) + d.slice(area + 2);
  }

  if (d.length !== LARGO_NACIONAL) {
    return {
      numero: null,
      area: null,
      motivo:
        `El teléfono cargado («${crudo}») queda en ${d.length} ${
          d.length === 1 ? 'dígito' : 'dígitos'
        } y un número argentino tiene 10 (código de área + abonado). ` +
        'Corregilo en la ficha de la persona para poder abrir el WhatsApp.',
    };
  }

  // Los códigos de área argentinos empiezan con 11, 2 o 3. Un 10 dígitos que
  // arranque con otra cosa no es de acá, y este motor sólo sabe de Argentina.
  if (!/^(11|2|3)/.test(d)) {
    return {
      numero: null,
      area: null,
      motivo:
        `El teléfono cargado («${crudo}») no arranca con un código de área ` +
        'argentino. Si es del exterior, el WhatsApp hay que abrirlo a mano.',
    };
  }

  return { numero: `${PREFIJO_WA}${d}`, area: d.slice(0, largoArea(d)), motivo: null };
}
