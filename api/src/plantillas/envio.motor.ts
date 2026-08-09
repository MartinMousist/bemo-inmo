/**
 * Del documento generado al enlace que abre el canal del usuario.
 *
 * PURO: entra un texto y un destinatario, sale una URL o un motivo. Sin base y
 * sin red — como `ajustes`, `punitorios`, `comisiones`, `aviso`, `plantillas`,
 * `situacion` y `telefono`. Acá van las reglas y acá se prueban con casos de
 * papel, que es lo único que da seguridad sobre un enlace que nadie mira antes
 * de apretar.
 *
 * ── Lo que este motor NO hace ───────────────────────────────────────────────
 *
 * **No manda nada.** Arma el `https://wa.me/…` o el `mailto:…` que el navegador
 * del usuario abre con el texto ya cargado. La persona todavía tiene que apretar
 * enviar, y puede no hacerlo. Por eso lo que se registra después se llama
 * «abierto» y no «enviado»: ver el comentario de `documento_envio` en la
 * migración 020.
 *
 * ── La regla que justifica todo lo demás: el largo ──────────────────────────
 *
 * Un pre-contrato **no entra** en un `mailto:`. Medido hoy contra esta API, no
 * estimado: el pre-contrato de locación de un contrato del seed renderiza 1.869
 * caracteres, que codificados con `encodeURIComponent` son 2.911 — porque cada
 * salto de línea son tres caracteres (`%0A`) y cada acento seis (`%C3%A9`). El
 * aviso de aumento son 609 → 930, y el de vencimiento 475 → 701.
 *
 * O sea que un aviso entra cómodo y un pre-contrato no, y una plantilla escrita
 * por una inmobiliaria de verdad —tres carillas, unos 7.000 caracteres— no entra
 * ni en WhatsApp. Truncar en silencio sería lo peor posible: lo que llega es un
 * contrato al que le falta la mitad de las cláusulas y que igual parece
 * completo. Por eso el largo decide el MODO —`completo` o `adjunto`— y el motivo
 * se devuelve escrito para que la pantalla lo diga **antes** de que alguien
 * apriete.
 */

import { normalizarAr } from '../garantes/telefono.motor';

/**
 * Tope seguro para la URL entera de un `mailto:`.
 *
 * El límite duro son **2.048 caracteres**: es lo que aguanta el shell de Windows
 * al pasarle el `mailto:` al cliente de correo, y es también el tope del Outlook
 * clásico. El Outlook nuevo lo subió a 8.192 y Gmail ronda los 4.096 ya
 * codificados, pero el número que hay que respetar es el del peor cliente, no el
 * del mejor: el que se corta es el destinatario, no nosotros.
 *
 * 1.900 y no 2.048 porque el conteo de acá es sobre la URL entera —esquema,
 * destinatario, asunto y cuerpo— y conviene un margen: hay clientes que le
 * agregan parámetros al abrirlo.
 */
export const LIMITE_MAILTO_URL = 1900;

/**
 * Tope del cuerpo de un mensaje de WhatsApp.
 *
 * WhatsApp corta el mensaje en **4.096 caracteres**. Acá se miden los caracteres
 * del texto sin codificar, que es lo que WhatsApp cuenta; la URL codificada es
 * más larga pero el navegador la banca sin problema. 4.000 deja lugar para lo
 * que el usuario escriba arriba del mensaje antes de mandarlo.
 */
export const LIMITE_WA_TEXTO = 4000;

export type CanalEnvio = 'whatsapp' | 'email' | 'impresion' | 'descarga' | 'copia';

export interface EntradaEnvio {
  /** El texto final del documento, tal como se va a mandar. */
  texto: string;
  /** Cómo se llama: «Pre-contrato de locación». Va en el asunto y la carátula. */
  titulo: string;
  /** «Arístides Villanueva 345». Sin ella la carátula no dice de qué se trata. */
  referencia?: string | null;
  /** El teléfono tal como está cargado, o el que corrigió la persona. */
  telefono?: string | null;
  email?: string | null;
}

export interface Preparado {
  canal: 'whatsapp' | 'email';
  /** `completo`: el texto viaja en la URL. `adjunto`: va como archivo. */
  modo: 'completo' | 'adjunto';
  /** `null` cuando no se pudo armar; entonces `motivo` explica por qué. */
  url: string | null;
  /** Adónde va: el número en formato internacional o el mail. Se muestra. */
  destino: string | null;
  /** El destino escrito como lo lee una persona. Para confirmarlo antes de abrir. */
  destinoLegible: string | null;
  /** Cuántos caracteres pesa lo que se midió. */
  caracteres: number;
  limite: number;
  /** Qué se midió: el cuerpo del mensaje o la URL entera. Va a la pantalla. */
  medido: string;
  /** Por qué va con carátula, o por qué no se pudo armar. Se muestra tal cual. */
  motivo: string | null;
  /** No impide mandar, pero hay que decirlo. Ej: no se sabe si es un fijo. */
  advertencia: string | null;
}

/**
 * La carátula del modo `adjunto`.
 *
 * Corta a propósito: es lo único que va a viajar en el mensaje, y tiene que
 * decir qué es y que el papel va aparte. Sin la segunda frase, del otro lado
 * llega un «te paso el pre-contrato» sin ningún pre-contrato.
 */
export function armarCaratula(titulo: string, referencia?: string | null): string {
  const de = referencia ? ` de ${referencia}` : '';
  return (
    `Te paso ${titulo.toLowerCase()}${de}. ` +
    'Va como archivo adjunto en este mismo mensaje: es largo y no entra en el texto.'
  );
}

/**
 * El número, escrito como lo lee una persona: `+54 9 261 615-2233`.
 *
 * Existe porque la pantalla tiene que **mostrar el número que va a usar** antes
 * de abrir nada. Un `wa.me` mal armado no falla: abre el chat de otra persona, y
 * del otro lado alguien lee el nombre del inquilino y la dirección de la
 * propiedad. Trece dígitos pegados no se revisan; con esta forma sí.
 */
export function telefonoLegible(internacional: string, area: string | null): string {
  // 549 + área + abonado. El abonado se parte en dos para poder leerlo.
  const nacional = internacional.slice(3);
  const a = area ?? nacional.slice(0, 3);
  const abonado = nacional.slice(a.length);
  const corte = Math.max(3, abonado.length - 4);
  return `+54 9 ${a} ${abonado.slice(0, corte)}-${abonado.slice(corte)}`;
}

/**
 * WhatsApp.
 *
 * La advertencia sobre fijo/celular va SIEMPRE, no sólo cuando algo huele mal:
 * el plan de numeración argentino no permite distinguir una línea fija de un
 * celular mirando el número, así que decir «este parece celular» sería inventar
 * una certeza. Es la misma honestidad que ya está escrita en `telefono.motor.ts`.
 */
export function armarWhatsapp(e: EntradaEnvio): Preparado {
  const tel = normalizarAr(e.telefono);

  const base: Preparado = {
    canal: 'whatsapp',
    modo: 'completo',
    url: null,
    destino: null,
    destinoLegible: null,
    caracteres: e.texto.length,
    limite: LIMITE_WA_TEXTO,
    medido: 'caracteres del mensaje',
    motivo: null,
    advertencia: null,
  };

  if (!tel.numero) return { ...base, motivo: tel.motivo };

  const entra = e.texto.length <= LIMITE_WA_TEXTO;
  const cuerpo = entra ? e.texto : armarCaratula(e.titulo, e.referencia);

  return {
    ...base,
    modo: entra ? 'completo' : 'adjunto',
    url: `https://wa.me/${tel.numero}?text=${encodeURIComponent(cuerpo)}`,
    destino: tel.numero,
    destinoLegible: telefonoLegible(tel.numero, tel.area),
    motivo: entra
      ? null
      : `El documento tiene ${fmt(e.texto.length)} caracteres y WhatsApp corta el ` +
        `mensaje en ${fmt(LIMITE_WA_TEXTO)}. Va como archivo adjunto y el mensaje ` +
        'lleva sólo una carátula: así llega entero o no llega, nunca por la mitad.',
    advertencia:
      'El sistema no puede saber si ese número es un celular o una línea fija: el ' +
      'plan de numeración argentino no lo dice. Si es un fijo, WhatsApp va a abrir ' +
      'un chat que no existe.',
  };
}

/**
 * Email.
 *
 * Acá el límite se mide sobre la **URL entera** y no sobre el texto, porque lo
 * que se corta es la URL: el destinatario y el asunto también ocupan, y el
 * cuerpo va codificado —o sea, alrededor de 1,5 veces su largo—. Medir el texto
 * pelado daría por bueno un `mailto:` que el cliente de correo va a truncar.
 */
export function armarMailto(e: EntradaEnvio): Preparado {
  const email = (e.email ?? '').trim();

  const base: Preparado = {
    canal: 'email',
    modo: 'completo',
    url: null,
    destino: null,
    destinoLegible: null,
    caracteres: 0,
    limite: LIMITE_MAILTO_URL,
    medido: 'caracteres de la URL, ya codificada',
    motivo: null,
    advertencia: null,
  };

  if (!email) {
    return { ...base, motivo: 'No tiene email cargado en su ficha.' };
  }
  // Una validación mínima y explícita. No se persigue el RFC 5322: lo único que
  // rompe el `mailto:` es que no haya arroba o que tenga espacios.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ...base,
      motivo: `Lo que está cargado como email («${email}») no tiene forma de dirección.`,
    };
  }

  const asunto = e.referencia ? `${e.titulo} · ${e.referencia}` : e.titulo;
  // El `@` se devuelve tal cual. `encodeURIComponent` lo convierte en `%40`, que
  // es válido según el RFC y que sin embargo algunos clientes de correo muestran
  // literalmente en el campo Para —«juan%40correo.com»— y el mail no sale. Lo
  // demás sí se codifica: un `?` o un `&` en la dirección partiría la URL.
  const armar = (cuerpo: string) =>
    `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` +
    `?subject=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpo)}`;

  const completa = armar(e.texto);
  if (completa.length <= LIMITE_MAILTO_URL) {
    return {
      ...base,
      modo: 'completo',
      url: completa,
      destino: email,
      destinoLegible: email,
      caracteres: completa.length,
    };
  }

  const conCaratula = armar(armarCaratula(e.titulo, e.referencia));
  return {
    ...base,
    modo: 'adjunto',
    url: conCaratula,
    destino: email,
    destinoLegible: email,
    caracteres: completa.length,
    motivo:
      `El documento tiene ${fmt(e.texto.length)} caracteres y la URL del ` +
      `mailto: queda en ${fmt(completa.length)} una vez codificada (cada salto de ` +
      'línea son tres caracteres y cada acento seis). Outlook clásico y el shell ' +
      `de Windows la cortan a los 2.048, así que iría partida al medio. Va como ` +
      'archivo adjunto y el mail lleva sólo una carátula.',
  };
}

function fmt(n: number): string {
  return n.toLocaleString('es-AR');
}
