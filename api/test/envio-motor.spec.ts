import {
  armarCaratula,
  armarMailto,
  armarWhatsapp,
  LIMITE_MAILTO_URL,
  LIMITE_WA_TEXTO,
  telefonoLegible,
} from '../src/plantillas/envio.motor';

/**
 * Casos de papel del motor de envío.
 *
 * Es un motor puro: no toca base ni red, así que se prueba con entradas
 * escritas a mano. Lo que se está cuidando acá son dos cosas que fallan en
 * silencio y caro:
 *
 *   · un `wa.me` mal armado no falla, ABRE el chat de otra persona, y del otro
 *     lado alguien lee el nombre del inquilino y la dirección de la propiedad;
 *   · un `mailto:` demasiado largo no falla, LLEGA CORTADO, y lo que recibe la
 *     otra parte es un contrato al que le falta la mitad de las cláusulas y que
 *     igual parece completo.
 */

const BASE = { texto: 'Hola', titulo: 'Pre-contrato de locación', referencia: 'Roca 55' };

describe('envio.motor · el teléfono', () => {
  it('lee un teléfono argentino escrito como lo escribe una persona', () => {
    const r = armarWhatsapp({ ...BASE, telefono: '261 615-2233' });
    expect(r.destino).toBe('5492616152233');
    expect(r.url).toContain('https://wa.me/5492616152233?text=');
  });

  it('no le duplica el 54 a un número que ya viene internacional', () => {
    expect(armarWhatsapp({ ...BASE, telefono: '+54 9 261 615 2233' }).destino)
      .toBe('5492616152233');
    expect(armarWhatsapp({ ...BASE, telefono: '0261 15 615-2233' }).destino)
      .toBe('5492616152233');
  });

  it('un número que no cierra en 10 dígitos no abre nada, y dice por qué', () => {
    const r = armarWhatsapp({ ...BASE, telefono: '4201100' });
    expect(r.url).toBeNull();
    expect(r.destino).toBeNull();
    expect(r.motivo).toContain('7 dígitos');
  });

  it('sin teléfono en la ficha lo dice con esas palabras', () => {
    expect(armarWhatsapp({ ...BASE, telefono: null }).motivo)
      .toContain('No tiene teléfono cargado');
  });

  /**
   * El plan de numeración argentino NO permite distinguir un fijo de un celular
   * mirando el número. Decir «este parece celular» sería inventar una certeza,
   * así que la advertencia va SIEMPRE y la pantalla la muestra al lado del
   * número que va a usar.
   */
  it('avisa siempre que no puede saber si es un fijo', () => {
    const r = armarWhatsapp({ ...BASE, telefono: '261 420-1100' });
    expect(r.url).not.toBeNull();
    expect(r.advertencia).toContain('celular o una línea fija');
  });

  it('el número se muestra en un formato que una persona puede revisar', () => {
    expect(telefonoLegible('5492616152233', '261')).toBe('+54 9 261 615-2233');
    expect(telefonoLegible('5491155442200', '11')).toBe('+54 9 11 5544-2200');
  });
});

describe('envio.motor · WhatsApp y su límite', () => {
  it('un aviso corto va completo: el texto entero viaja en el enlace', () => {
    const r = armarWhatsapp({ ...BASE, texto: 'x'.repeat(700), telefono: '261 615-2233' });
    expect(r.modo).toBe('completo');
    expect(r.motivo).toBeNull();
    expect(r.caracteres).toBe(700);
    expect(r.limite).toBe(LIMITE_WA_TEXTO);
    expect(decodeURIComponent(r.url!.split('?text=')[1])).toBe('x'.repeat(700));
  });

  it('en el borde exacto del límite todavía va completo', () => {
    const justo = armarWhatsapp({
      ...BASE, texto: 'x'.repeat(LIMITE_WA_TEXTO), telefono: '261 615-2233',
    });
    expect(justo.modo).toBe('completo');

    const unoMas = armarWhatsapp({
      ...BASE, texto: 'x'.repeat(LIMITE_WA_TEXTO + 1), telefono: '261 615-2233',
    });
    expect(unoMas.modo).toBe('adjunto');
  });

  it('un contrato de tres carillas va como adjunto, con su motivo y su número', () => {
    const r = armarWhatsapp({ ...BASE, texto: 'x'.repeat(7412), telefono: '261 615-2233' });
    expect(r.modo).toBe('adjunto');
    expect(r.caracteres).toBe(7412);
    expect(r.motivo).toContain('7.412');
    expect(r.motivo).toContain('4.000');
    // Y el enlace lleva la carátula, NO el contrato truncado.
    const cuerpo = decodeURIComponent(r.url!.split('?text=')[1]);
    expect(cuerpo).toBe(armarCaratula(BASE.titulo, BASE.referencia));
    expect(cuerpo).not.toContain('xxxx');
  });

  it('la carátula dice qué es y que el papel va aparte', () => {
    const c = armarCaratula('Pre-contrato de locación', 'Roca 55');
    expect(c).toContain('pre-contrato de locación');
    expect(c).toContain('Roca 55');
    expect(c).toContain('archivo adjunto');
  });
});

describe('envio.motor · el email y el límite del mailto:', () => {
  it('sin email cargado no arma nada y lo dice', () => {
    expect(armarMailto({ ...BASE, email: null }).motivo).toContain('No tiene email cargado');
  });

  it('algo que no tiene forma de dirección tampoco', () => {
    const r = armarMailto({ ...BASE, email: 'juan arroba correo' });
    expect(r.url).toBeNull();
    expect(r.motivo).toContain('no tiene forma de dirección');
  });

  it('el arroba NO se codifica: hay clientes que muestran %40 en el campo Para', () => {
    const r = armarMailto({ ...BASE, email: 'rmiranda@correo.test' });
    expect(r.url).toContain('mailto:rmiranda@correo.test?subject=');
    expect(r.url).not.toContain('%40');
  });

  it('un aviso corto entra entero y el asunto lleva la referencia', () => {
    const r = armarMailto({ ...BASE, texto: 'Hola, te aviso el aumento.', email: 'a@b.com' });
    expect(r.modo).toBe('completo');
    expect(r.motivo).toBeNull();
    expect(r.caracteres).toBeLessThanOrEqual(LIMITE_MAILTO_URL);
    expect(decodeURIComponent(r.url!.split('&body=')[1])).toBe('Hola, te aviso el aumento.');
    expect(decodeURIComponent(r.url!.split('?subject=')[1].split('&body=')[0]))
      .toBe('Pre-contrato de locación · Roca 55');
  });

  /**
   * El conteo va sobre la URL ENTERA y ya codificada, no sobre el texto pelado:
   * el destinatario y el asunto también ocupan, y `encodeURIComponent` infla el
   * cuerpo porque cada salto de línea son tres caracteres y cada acento seis.
   * Medir el texto pelado daría por bueno un mailto: que el cliente trunca.
   */
  it('mide la URL codificada, no el texto pelado', () => {
    // Sólo saltos de línea: 1 carácter que codificado son 3.
    const texto = '\n'.repeat(700);
    const r = armarMailto({ ...BASE, texto, email: 'a@b.com' });
    expect(r.caracteres).toBeGreaterThan(2100); // 700 × 3, más esquema y asunto
    expect(r.modo).toBe('adjunto');
  });

  it('el borde exacto del límite: uno menos entra, uno más no', () => {
    // Se busca el largo de texto que deja la URL justo en el límite.
    const largoDe = (n: number) => armarMailto({ ...BASE, texto: 'x'.repeat(n), email: 'a@b.com' }).caracteres;
    let n = 1;
    while (largoDe(n) <= LIMITE_MAILTO_URL) n++;

    expect(armarMailto({ ...BASE, texto: 'x'.repeat(n - 1), email: 'a@b.com' }).modo).toBe('completo');
    expect(armarMailto({ ...BASE, texto: 'x'.repeat(n), email: 'a@b.com' }).modo).toBe('adjunto');
  });

  it('un pre-contrato real no entra, y el motivo nombra los 2.048 de Outlook', () => {
    // 1.869 caracteres es lo que mide el pre-contrato de locación de un contrato
    // del seed, medido contra esta API. Codificado son unos 2.900.
    const r = armarMailto({ ...BASE, texto: 'Ácido\n'.repeat(311), email: 'a@b.com' });
    expect(r.modo).toBe('adjunto');
    expect(r.motivo).toContain('2.048');
    expect(r.motivo).toContain('archivo adjunto');
    // El cuerpo del enlace es la carátula, no el contrato partido al medio.
    expect(decodeURIComponent(r.url!.split('&body=')[1]))
      .toBe(armarCaratula(BASE.titulo, BASE.referencia));
  });
});
