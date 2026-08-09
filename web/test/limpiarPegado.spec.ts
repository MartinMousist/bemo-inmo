import { describe, expect, it } from 'vitest';
import { envolverVariables, limpiarPegado } from '../src/dominio/limpiarPegado';

/**
 * Fixtures de portapapeles REAL de Word.
 *
 * No son ejemplos inventados: son la forma en que Word 365 y Word 2019 escriben
 * el `text/html` del portapapeles —los comentarios condicionales, la hoja de
 * estilos entera, los `mso-list`, el glifo de viñeta dibujado a mano y los
 * spans de identificador de revisión que parten una palabra al medio—.
 *
 * El test que justifica el archivo entero es «el {{ }} partido por un span de
 * revisión»: si ese caso falla, la variable queda como texto muerto y sale
 * **literal adentro del contrato que se firma**. Ya pasó una vez en este repo
 * con la sintaxis de Handlebars del esqueleto de «Nueva plantilla».
 */

/** El envoltorio que Word pone alrededor de todo lo que se copia. */
function comoWord(cuerpo: string, estilos = ''): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=Generator content="Microsoft Word 15">
<link rel=File-List href="file:///C:/Users/ana/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml">
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings>
</xml><![endif]-->
<style>
<!--
 /* Font Definitions */
 @font-face { font-family:Calibri; panose-1:2 15 5 2 2 2 4 3 2 4; }
 p.MsoNormal, li.MsoNormal { margin:0cm; font-size:11.0pt; font-family:"Calibri",sans-serif; }
 ${estilos}
-->
</style>
<!--[if gte mso 10]>
<style> table.MsoNormalTable { font-size:10.0pt; } </style>
<![endif]-->
</head>
<body lang=ES-AR style='word-wrap:break-word'>
<!--StartFragment-->
${cuerpo}
<!--EndFragment-->
</body>
</html>`;
}

describe('limpiarPegado() · portapapeles de Word', () => {
  it('tira la hoja de estilos entera, los meta y los comentarios condicionales', () => {
    const r = limpiarPegado(comoWord(
      `<p class=MsoNormal style='margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif'>` +
      `<span lang=ES-AR>CONTRATO DE LOCACIÓN</span></p>`,
    ));

    expect(r.html).toBe('<p>CONTRATO DE LOCACIÓN</p>');
    expect(r.html).not.toContain('Calibri');
    expect(r.html).not.toContain('mso');
    expect(r.html).not.toContain('font-face');
    expect(r.html).not.toContain('class=');
  });

  it('recorta por StartFragment: no se pega el <head> del documento', () => {
    const r = limpiarPegado(comoWord('<p>Sólo esto</p>'));
    expect(r.html).toBe('<p>Sólo esto</p>');
    expect(r.html).not.toContain('File-List');
  });

  it('se lleva los elementos con namespace de Office', () => {
    const r = limpiarPegado(comoWord('<p>Texto<o:p></o:p></p>'));
    expect(r.html).toBe('<p>Texto</p>');
  });

  /**
   * ⚠️ EL CASO QUE NO PUEDE FALLAR.
   *
   * Word parte `{{ contrato.monto }}` en varios spans por marcas de revisión
   * (`rsid`) y por el corrector ortográfico. Si `envolverVariables()` corriera
   * antes de desenvolver los spans, el chip no se arma y la variable queda como
   * texto muerto que el motor nunca sustituye.
   */
  it('rearma un {{ }} que Word partió en tres spans de revisión', () => {
    const r = limpiarPegado(comoWord(
      `<p class=MsoNormal>El precio es ` +
      `<span style='mso-bidi-font-weight:normal' lang=ES-AR>{{ contrato.</span>` +
      `<span style='mso-spacerun:yes' lang=ES-AR>monto | </span>` +
      `<span lang=ES-AR>moneda }}</span> por mes.</p>`,
    ));

    expect(r.html).toBe(
      '<p>El precio es <span data-var="contrato.monto" data-formato="moneda">' +
      '{{ contrato.monto | moneda }}</span> por mes.</p>',
    );
    expect(r.avisos).toEqual([]);
  });

  it('rescata un token con &nbsp; entre las llaves', () => {
    // El espacio duro de Word entre las llaves es la forma más silenciosa de
    // romper un token: en pantalla se ve idéntico y el motor no lo matchea.
    const r = limpiarPegado(comoWord(
      '<p>{{&nbsp;locatario.nombre&nbsp;}}</p>',
    ));
    expect(r.html).toBe(
      '<p><span data-var="locatario.nombre">{{ locatario.nombre }}</span></p>',
    );
  });

  it('un {{ sin cerrar NO se inventa: se avisa', () => {
    const r = limpiarPegado(comoWord('<p>Paga {{ contrato.monto por mes.</p>'));
    expect(r.html).toContain('{{ contrato.monto por mes.');
    expect(r.avisos.join(' ')).toContain('sin cerrar');
  });

  it('un formato que el motor no tiene se cae del chip', () => {
    const r = limpiarPegado(comoWord('<p>{{ contrato.monto | pesos }}</p>'));
    expect(r.html).toContain('{{ contrato.monto }}');
    expect(r.html).not.toContain('pesos');
  });

  // ── Listas ────────────────────────────────────────────────────────────────

  it('reconstruye tres niveles de viñetas de mso-list', () => {
    const r = limpiarPegado(comoWord(
      `<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span>` +
      `<span lang=ES-AR>Primero</span></p>` +
      `<p class=MsoListParagraphCxSpMiddle style='mso-list:l0 level2 lfo1'>` +
      `<span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span>` +
      `<span lang=ES-AR>Segundo, más adentro</span></p>` +
      `<p class=MsoListParagraphCxSpLast style='mso-list:l0 level3 lfo1'>` +
      `<span style='mso-list:Ignore'>§<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span>` +
      `<span lang=ES-AR>Tercero, más adentro todavía</span></p>`,
    ));

    expect(r.html).toBe(
      '<ul><li>Primero</li><ul><li>Segundo, más adentro</li>' +
      '<ul><li>Tercero, más adentro todavía</li></ul></ul></ul>',
    );
    // El glifo dibujado a mano no puede quedar como texto del ítem.
    expect(r.html).not.toContain('·<');
    expect(r.html).not.toMatch(/<li>[·o§]/);
    expect(r.avisos.join(' ')).toContain('viñeta');
  });

  it('una lista numerada de Word vuelve a ser <ol>', () => {
    const r = limpiarPegado(comoWord(
      `<p style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>1.<span>&nbsp; </span></span>` +
      `<span>Primera cláusula</span></p>` +
      `<p style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>2.<span>&nbsp; </span></span>` +
      `<span>Segunda cláusula</span></p>`,
    ));
    expect(r.html).toBe('<ol><li>Primera cláusula</li><li>Segunda cláusula</li></ol>');
  });

  it('la lista se cierra cuando vuelve un párrafo normal', () => {
    const r = limpiarPegado(comoWord(
      `<p style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·</span><span>Uno</span></p>` +
      `<p class=MsoNormal><span>Después de la lista.</span></p>`,
    ));
    expect(r.html).toBe('<ul><li>Uno</li></ul><p>Después de la lista.</p>');
  });

  it('las viñetas con una variable adentro mantienen su chip', () => {
    const r = limpiarPegado(comoWord(
      `<p style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·</span>` +
      `<span>{{ g.nombre </span><span>}}, documento {{ g.documento }}</span></p>`,
    ));
    expect(r.html).toBe(
      '<ul><li><span data-var="g.nombre">{{ g.nombre }}</span>, documento ' +
      '<span data-var="g.documento">{{ g.documento }}</span></li></ul>',
    );
  });

  // ── Tablas ────────────────────────────────────────────────────────────────

  it('una tabla se aplana Y SE AVISA: no se calla', () => {
    // Si no se avisa, alguien pega un cuadro de vencimientos y firma un
    // contrato al que le falta la grilla.
    const r = limpiarPegado(comoWord(
      '<table class=MsoNormalTable border=1><tr><td><p>Marzo</p></td>' +
      '<td><p>485.000</p></td></tr></table>',
    ));
    expect(r.avisos.join(' ')).toContain('tabla');
    expect(r.avisos.join(' ')).toContain('en desarrollo');
    expect(r.html).toContain('Marzo');
    expect(r.html).toContain('485.000');
  });

  // ── Espacios y saltos ─────────────────────────────────────────────────────

  it('los espacios duros vuelven a ser espacios normales', () => {
    const r = limpiarPegado(comoWord('<p>Uno&nbsp;&nbsp;dos</p>'));
    expect(r.html).toBe('<p>Uno  dos</p>');
  });

  it('colapsa las corridas de <br> que Word deja al final de cada párrafo', () => {
    const r = limpiarPegado(comoWord('<p>Uno<br><br><br><br>Dos</p>'));
    expect(r.html).toBe('<p>Uno<br><br>Dos</p>');
  });

  // ── El pegado interno ─────────────────────────────────────────────────────

  it('copiar y pegar DENTRO del editor no pasa por la limpieza', () => {
    // Si pasara, mover una cláusula condicional de lugar le sacaría el
    // andamio y la convertiría en texto suelto.
    const interno =
      '<div data-pm-slice="1 1 []"><div data-bloque="si" data-expr="garantes">' +
      '<p>Hay garantes</p></div></div>';
    expect(limpiarPegado(interno).html).toBe(interno);
  });

  // ── Texto plano pegado a mano ─────────────────────────────────────────────

  it('un pegado sin nada de Word no se rompe', () => {
    expect(limpiarPegado('<p>Texto simple</p>').html).toBe('<p>Texto simple</p>');
    expect(limpiarPegado('').html).toBe('');
  });
});

describe('envolverVariables()', () => {
  it('no toca las llaves que están adentro de un atributo', () => {
    const r = envolverVariables('<span data-var="x" title="{{ no }}">texto</span>');
    expect(r.html).toBe('<span data-var="x" title="{{ no }}">texto</span>');
  });

  it('cuenta las llaves sin cerrar sin contar los chips ya armados', () => {
    const r = envolverVariables('{{ contrato.monto }} y {{ roto');
    expect(r.rotos).toBe(1);
  });
});
