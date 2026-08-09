import {
  NBSP,
  aplanarDocumento,
  chip,
  htmlATexto,
  textoAHtml,
  tokensRotos,
  FORMATOS_VALIDOS,
} from '../src/plantillas/plantillas.html';
import { sanitizarPlantilla } from '../src/plantillas/plantillas.sanitizar';
import {
  NOMBRES_DE_FORMATO, renderizar, variablesDe,
} from '../src/plantillas/plantillas.motor';
import { PLANTILLAS_POR_DEFECTO } from '../src/plantillas/plantillas.defecto';
import { PlantillasService } from '../src/plantillas/plantillas.service';
import { CATALOGO_BLOQUES, CATALOGO_VARIABLES } from '../src/plantillas/plantillas.variables';

/**
 * El editor de plantillas, probado donde se puede probar de verdad: sin base y
 * sin red, con casos de papel. Es la misma familia que `ajustes-motor`,
 * `punitorios-motor`, `comisiones-motor` y `envio-motor`.
 *
 * Los dos tests que justifican el archivo entero:
 *
 * 1. **El diff de render.** Se renderiza cada plantilla real de
 *    `plantillas.defecto.ts` en su versión de texto plano y en su versión
 *    convertida a HTML, y se exige que el texto resultante diga LO MISMO. Si
 *    difiere en una palabra, el conversor está reescribiendo un contrato.
 * 2. **El `<script>` no sobrevive**, ni pegado en la plantilla ni cargado como
 *    apellido de una persona — que es el agujero de verdad, porque entra
 *    DESPUÉS del sanitizador.
 */

/** El contexto de ejemplo del servicio: el mismo con el que previsualiza la app. */
const EJEMPLO = PlantillasService.ejemplo;

/**
 * Compara dos textos por lo que importa en un contrato: las palabras y las
 * líneas con contenido.
 *
 * Las líneas en blanco NO se comparan, y es una decisión, no una comodidad: al
 * pasar a HTML un `{% si %}` inline abre su propio bloque, y un bloque es un
 * corte de párrafo. Eso puede agregar o sacar una línea vacía entre dos
 * cláusulas. Lo que no puede cambiar es una palabra, un número, un signo de
 * puntuación ni el orden de las líneas — y eso es lo que se compara.
 */
function lineasConTexto(s: string): string[] {
  return s.split('\n').map((l) => l.replace(/[ \t]+$/g, '')).filter((l) => l.trim() !== '');
}

describe('Editor de plantillas · texto ↔ HTML', () => {
  describe('textoAHtml()', () => {
    it('una línea en blanco separa párrafos y un salto simple es un <br>', () => {
      expect(textoAHtml('Uno\nDos\n\nTres')).toBe('<p>Uno<br>Dos</p><p>Tres</p>');
    });

    it('las viñetas «  · » vuelven a ser una lista de verdad', () => {
      expect(textoAHtml('Firman:\n  · Ana\n  · Beto\n')).toBe(
        '<p>Firman:</p><ul><li>Ana</li><li>Beto</li></ul>',
      );
    });

    it('escapa el HTML del texto legal: un «<» no puede abrir una etiqueta', () => {
      expect(textoAHtml('Superficie < 30 m2 & sin cochera')).toBe(
        '<p>Superficie &lt; 30 m2 &amp; sin cochera</p>',
      );
    });

    it('envuelve cada {{ }} en su chip, con el formato en el atributo', () => {
      expect(textoAHtml('Paga {{ contrato.monto | moneda }}.')).toBe(
        '<p>Paga <span data-var="contrato.monto" data-formato="moneda">' +
        '{{ contrato.monto | moneda }}</span>.</p>',
      );
    });

    it('un formato que el motor no tiene NO se guarda en el chip', () => {
      // Guardarlo dejaría un chip que promete un formato inexistente; el motor
      // lo ignora en silencio e imprime el valor crudo.
      expect(textoAHtml('{{ contrato.monto | pesos }}')).toContain('{{ contrato.monto }}');
      expect(textoAHtml('{{ contrato.monto | pesos }}')).not.toContain('pesos');
    });

    it('los tokens de estructura quedan ADENTRO de su div, pegados a los bordes', () => {
      const html = textoAHtml('{% si garantes %}Hay garantes.{% fin %}');
      expect(html).toBe(
        '<div data-bloque="si" data-expr="garantes">{% si garantes %}' +
        '<p>Hay garantes.</p>{% fin %}</div>',
      );
    });

    it('un {% para %} guarda el ítem y la lista por separado', () => {
      const html = textoAHtml('{% para g en garantes %}  · {{ g.nombre }}\n{% fin %}');
      expect(html).toContain('data-bloque="para" data-item="g" data-lista="garantes"');
      expect(html).toContain('{% para g en garantes %}');
      expect(html).toContain('{% fin %}</div>');
    });

    it('el borrado de un bloque en falso deja HTML BALANCEADO', () => {
      // Es el motivo entero de que los tokens vivan adentro del div. Con el
      // token suelto entre párrafos, el motor se llevaría un </p> de un lado.
      const html = textoAHtml(
        'Antes.\n\n{% si contrato.deposito %}SEXTA — DEPÓSITO.\nEntrega…\n\n{% fin %}Después.',
      );
      const salida = renderizar(html, { contrato: { deposito: null } }, { escaparHtml: true }).texto;
      expect(salida).toBe(
        '<p>Antes.</p><div data-bloque="si" data-expr="contrato.deposito"></div><p>Después.</p>',
      );
      // Etiquetas balanceadas: tantas aperturas de <p> como cierres.
      expect((salida.match(/<p>/g) ?? []).length).toBe((salida.match(/<\/p>/g) ?? []).length);
      expect((salida.match(/<div/g) ?? []).length).toBe((salida.match(/<\/div>/g) ?? []).length);
    });

    it('un {% fin %} de más queda como texto y no se come nada', () => {
      const html = textoAHtml('Hola {% fin %} chau');
      expect(html).toBe('<p>Hola {% fin %} chau</p>');
      expect(tokensRotos(html)).toHaveLength(1);
    });

    it('un {% si %} sin cierre queda como texto y su contenido no se pierde', () => {
      const html = textoAHtml('{% si garantes %}Texto que no se puede perder.');
      expect(html).toContain('{% si garantes %}');
      expect(html).toContain('Texto que no se puede perder.');
      expect(tokensRotos(html).length).toBeGreaterThan(0);
    });

    it('conserva el indentado del bloque de firmas con espacios duros', () => {
      const html = textoAHtml('    A            B');
      expect(html).toContain(NBSP);
      // Sin `trim()`: lo que se está probando es justamente la sangría inicial.
      expect(htmlATexto(html)).toBe('    A            B\n');
    });

    it('NUNCA mete un espacio duro adentro de un {{ }}', () => {
      // Un NBSP entre las llaves hace que el motor no matchee y que
      // `{{ contrato.monto }}` salga LITERAL adentro del contrato firmado.
      const html = textoAHtml('   {{ contrato.monto }}   {{ contrato.deposito }}');
      const tokens = html.match(/\{\{[^}]*\}\}/g) ?? [];
      expect(tokens).toHaveLength(2);
      for (const t of tokens) expect(t).not.toContain(NBSP);
      expect(variablesDe(html).sort()).toEqual(['contrato.deposito', 'contrato.monto']);
    });

    it('es determinista: dos corridas dan byte por byte lo mismo', () => {
      const t = PLANTILLAS_POR_DEFECTO[0].contenido;
      expect(textoAHtml(t)).toBe(textoAHtml(t));
    });
  });

  describe('htmlATexto()', () => {
    it('los <br> y los </p> vuelven a ser saltos de línea', () => {
      expect(htmlATexto('<p>Uno<br>Dos</p><p>Tres</p>')).toBe('Uno\nDos\n\nTres\n');
    });

    it('las listas vuelven a ser «  · »', () => {
      expect(htmlATexto('<ul><li>Ana</li><li>Beto</li></ul>')).toBe('  · Ana\n  · Beto\n');
    });

    it('un <script> que se hubiera filtrado no aporta texto al mensaje', () => {
      expect(htmlATexto('<p>Hola</p><script>alert(1)</script>')).toBe('Hola\n');
    });

    it('decodifica entidades: el mensaje de WhatsApp no lleva &amp;', () => {
      expect(htmlATexto('<p>Luz &amp; gas &lt; 30%</p>')).toBe('Luz & gas < 30%\n');
    });
  });

  /**
   * ── EL DIFF DE RENDER ────────────────────────────────────────────────────
   *
   * Convertir es reescribir un texto legal. Este test es el único que puede
   * decir que no se rompió nada: renderiza las CUATRO plantillas reales contra
   * el mismo contexto, en texto plano y en HTML, y exige que digan lo mismo.
   */
  describe('el diff de render sobre las plantillas reales', () => {
    const contexto = {
      ...EJEMPLO,
      cobro: {
        monto: 485000, moneda: 'ARS', fecha: '2026-03-05',
        medio: 'transferencia bancaria', comprobante: '0001-00004521',
        concepto: 'alquiler', periodo: '2026-03-01', venceEl: '2026-03-10',
        totalCuota: 485000, saldo: 0, esParcial: false,
        registradoPor: 'Sofía Aguirre', periodoTexto: 'marzo de 2026',
      },
    };

    for (const p of PLANTILLAS_POR_DEFECTO) {
      it(`«${p.nombre}» dice exactamente lo mismo antes y después de convertir`, () => {
        const enTexto = renderizar(p.contenido, contexto).texto;
        const enHtml = renderizar(textoAHtml(p.contenido), contexto, { escaparHtml: true }).texto;
        const proyectado = htmlATexto(aplanarDocumento(enHtml));

        expect(lineasConTexto(proyectado)).toEqual(lineasConTexto(enTexto));
      });

      it(`«${p.nombre}» convertida no deja ni un token roto`, () => {
        expect(tokensRotos(textoAHtml(p.contenido))).toEqual([]);
      });

      it(`«${p.nombre}» convertida pide las mismas variables`, () => {
        expect(variablesDe(textoAHtml(p.contenido))).toEqual(variablesDe(p.contenido));
      });

      it(`«${p.nombre}» sobrevive al sanitizador sin cambiar`, () => {
        // Si el sanitizador tocara la salida del conversor, la plantilla
        // guardada no sería la que se probó acá arriba.
        const html = textoAHtml(p.contenido);
        expect(sanitizarPlantilla(html).html).toBe(html);
        expect(sanitizarPlantilla(html).avisos).toEqual([]);
      });
    }

    it('el pre-contrato en HTML se sigue MIDIENDO como texto plano', () => {
      // Sin esta proyección, `envio.motor.ts` mediría las etiquetas y TODO
      // pre-contrato pasaría a «adjunto» con un motivo que cita un número falso.
      const p = PLANTILLAS_POR_DEFECTO[0].contenido;
      const enTexto = renderizar(p, contexto).texto;
      const enHtml = renderizar(textoAHtml(p), contexto, { escaparHtml: true }).texto;

      const largoCrudo = enHtml.length;
      const largoProyectado = htmlATexto(aplanarDocumento(enHtml)).length;

      // El HTML crudo pesa bastante más: es exactamente el problema.
      expect(largoCrudo).toBeGreaterThan(enTexto.length * 1.3);
      // La proyección vuelve al orden de magnitud del texto original (±5%).
      expect(Math.abs(largoProyectado - enTexto.length) / enTexto.length).toBeLessThan(0.05);
    });
  });

  // ── Seguridad ──────────────────────────────────────────────────────────────

  describe('sanitizarPlantilla()', () => {
    const limpio = (s: string) => sanitizarPlantilla(s).html;

    it('un <script> no sobrevive, ni su contenido', () => {
      const r = limpio('<p>Hola</p><script>fetch("/v1/personas")</script>');
      expect(r).toBe('<p>Hola</p>');
      expect(r).not.toContain('fetch');
      expect(r.toLowerCase()).not.toContain('script');
    });

    it('un onerror se cae aunque la etiqueta sea permitida', () => {
      expect(limpio('<p onerror="alert(1)">Hola</p>')).toBe('<p>Hola</p>');
    });

    it('una <img> con onerror desaparece entera', () => {
      const r = limpio('<p>Antes<img src=x onerror="alert(1)">Después</p>');
      expect(r).toBe('<p>AntesDespués</p>');
      expect(r).not.toContain('onerror');
    });

    it('un javascript: no tiene dónde vivir: no hay <a> ni esquemas', () => {
      const r = limpio('<p><a href="javascript:alert(1)">tocá acá</a></p>');
      expect(r).toBe('<p>tocá acá</p>');
      expect(r).not.toContain('javascript');
    });

    it('style y class se caen: la tipografía la fija el sistema de diseño', () => {
      const r = limpio('<p style="font-family:Calibri;font-size:11pt" class="MsoNormal">Hola</p>');
      expect(r).toBe('<p>Hola</p>');
    });

    it('un <iframe> no sobrevive', () => {
      expect(limpio('<p>a</p><iframe src="https://x"></iframe>')).toBe('<p>a</p>');
    });

    it('lo que viene después de un </html> tampoco entra', () => {
      const r = limpio('<p>a</p></html><script>alert(1)</script>');
      expect(r).not.toContain('alert');
    });

    it('conserva el formato que sí se permite', () => {
      expect(limpio('<h2>Título</h2><p><strong>fuerte</strong> y <em>cursiva</em></p>')).toBe(
        '<h2>Título</h2><p><strong>fuerte</strong> y <em>cursiva</em></p>',
      );
    });

    it('una tabla se aplana: sin tablas en v1, y se dice en pantalla', () => {
      const r = limpio('<table><tr><td>Marzo</td><td>485000</td></tr></table>');
      expect(r).not.toContain('<table');
      expect(r).toContain('Marzo');
      expect(r).toContain('485000');
    });

    it('re-deriva data-var DESDE el texto, no al revés', () => {
      // El atributo mentía; manda lo que el motor va a sustituir.
      const r = limpio('<span data-var="locador.nombre">{{ contrato.monto | moneda }}</span>');
      expect(r).toBe(
        '<span data-var="contrato.monto" data-formato="moneda">' +
        '{{ contrato.monto | moneda }}</span>',
      );
    });

    it('un {{ }} suelto escrito a mano se convierte solo en chip', () => {
      expect(limpio('<p>{{ locatario.nombre }}</p>')).toBe(
        '<p><span data-var="locatario.nombre">{{ locatario.nombre }}</span></p>',
      );
    });

    it('rescata un token partido por un &nbsp; en vez de perderlo', () => {
      const r = sanitizarPlantilla(
        `<span data-var="contrato.monto">{{${NBSP}contrato.monto${NBSP}|${NBSP}moneda }}</span>`,
      );
      expect(r.html).toContain('{{ contrato.monto | moneda }}');
      expect(r.html).not.toContain(NBSP);
    });

    it('un chip partido de verdad vuelve a ser texto Y se avisa', () => {
      const r = sanitizarPlantilla('<span data-var="contrato.monto">{{ contrato.mon</span>');
      expect(r.html).not.toContain('data-var');
      expect(r.html).toContain('{{ contrato.mon');
      expect(r.avisos.join(' ')).toContain('partida');
    });

    it('un formato inventado se saca y se avisa: el motor lo ignoraría callado', () => {
      const r = sanitizarPlantilla(
        '<span data-var="contrato.monto" data-formato="pesos">{{ contrato.monto | pesos }}</span>',
      );
      expect(r.html).toBe(
        '<span data-var="contrato.monto">{{ contrato.monto }}</span>',
      );
      expect(r.avisos.join(' ')).toContain('pesos');
    });

    it('reescribe los tokens del bloque desde sus atributos, sin duplicarlos', () => {
      const r = limpio(
        '<div data-bloque="si" data-expr="garantes">{% si garantes %}<p>a</p>{% fin %}</div>',
      );
      expect(r).toBe(
        '<div data-bloque="si" data-expr="garantes">{% si garantes %}<p>a</p>{% fin %}</div>',
      );
      expect((r.match(/\{% si/g) ?? []).length).toBe(1);
    });

    it('un bloque que llega SIN tokens los recupera de los atributos', () => {
      // Es lo que manda el editor: ProseMirror no serializa texto suelto
      // adentro de un nodo de bloque.
      const r = limpio('<div data-bloque="si" data-expr="garantes"><p>a</p></div>');
      expect(r).toBe(
        '<div data-bloque="si" data-expr="garantes">{% si garantes %}<p>a</p>{% fin %}</div>',
      );
    });

    it('un data-expr que no es una ruta se degrada a div común y se avisa', () => {
      const r = sanitizarPlantilla('<div data-bloque="si" data-expr="1);drop"><p>a</p></div>');
      expect(r.html).toBe('<div><p>a</p></div>');
      expect(r.avisos.join(' ')).toContain('no entiende');
    });

    it('un PUT crudo con <script> adentro de un chip no deja nada ejecutable', () => {
      const r = limpio(
        '<span data-var="x"><script>alert(1)</script>{{ locador.nombre }}</span>',
      );
      expect(r).not.toContain('alert');
      expect(r).toContain('data-var="locador.nombre"');
    });
  });

  describe('renderizar(…, { escaparHtml })', () => {
    it('es ADITIVO: sin la opción, el comportamiento no cambia', () => {
      const ctx = { p: { nombre: 'A & B < C' } };
      expect(renderizar('{{ p.nombre }}', ctx).texto).toBe('A & B < C');
    });

    it('el apellido de una persona con <img onerror> NO se ejecuta', () => {
      // ⚠️ Éste es el agujero de verdad, y el sanitizador NO lo ve: el valor
      // entra DESPUÉS de sanitizar, lo cargó un usuario del sistema, y el
      // resultado termina en un v-html de la vista imprimible.
      const ctx = { locatario: { nombre: '<img src=x onerror="alert(1)">Rossi' } };
      const r = renderizar(
        '<p><span data-var="locatario.nombre">{{ locatario.nombre }}</span></p>',
        ctx,
        { escaparHtml: true },
      );
      expect(r.texto).not.toContain('<img');
      expect(r.texto).toContain('&lt;img');
      // Y el texto sigue siendo legible para la persona que lee el contrato.
      expect(htmlATexto(aplanarDocumento(r.texto))).toBe('<img src=x onerror="alert(1)">Rossi\n');
    });

    it('escapa también adentro de una lista', () => {
      const ctx = { garantes: [{ nombre: '<b>Ferreyra</b>' }] };
      const r = renderizar(
        '<div data-bloque="para" data-item="g" data-lista="garantes">' +
        '{% para g en garantes %}<p>{{ g.nombre }}</p>{% fin %}</div>',
        ctx,
        { escaparHtml: true },
      );
      expect(r.texto).toContain('&lt;b&gt;Ferreyra&lt;/b&gt;');
    });
  });

  describe('tokensRotos()', () => {
    it('una plantilla sana no tiene ninguno', () => {
      expect(tokensRotos('<p>' + chip('contrato.monto', 'moneda') + '</p>')).toEqual([]);
    });

    it('detecta el token con basura adentro', () => {
      const r = tokensRotos('<p>{{ contrato monto }}</p>');
      expect(r).toHaveLength(1);
      expect(r[0].motivo).toContain('impreso tal cual');
    });

    it('detecta las llaves sin cerrar', () => {
      expect(tokensRotos('<p>{{ contrato.monto</p>')[0].token).toBe('{{');
    });

    it('detecta el formato inventado', () => {
      expect(tokensRotos('{{ contrato.monto | pesos }}')[0].motivo).toContain('pesos');
    });

    it('detecta un {% si %} suelto fuera de su bloque', () => {
      const r = tokensRotos('<p>{% si garantes %}</p><p>algo</p>');
      expect(r).toHaveLength(1);
      expect(r[0].motivo).toContain('suelto');
    });
  });

  describe('aplanarDocumento()', () => {
    it('saca el andamio y deja el texto', () => {
      expect(
        aplanarDocumento(
          '<div data-bloque="si" data-expr="g"><p>Hay ' +
          '<span data-var="x">Ana</span></p></div>',
        ),
      ).toBe('<p>Hay Ana</p>');
    });

    it('un bloque que quedó vacío desaparece entero', () => {
      expect(aplanarDocumento('<p>a</p><div data-bloque="si" data-expr="g"></div><p>b</p>'))
        .toBe('<p>a</p><p>b</p>');
    });
  });

  // ── El catálogo dice la verdad ─────────────────────────────────────────────

  describe('el catálogo de variables contra el contexto real', () => {
    /** Todas las rutas hoja del contexto de ejemplo. */
    function hojas(o: unknown, prefijo = ''): string[] {
      if (o === null || typeof o !== 'object') return prefijo ? [prefijo] : [];
      if (Array.isArray(o)) return []; // las listas se recorren con {% para %}
      return Object.entries(o as Record<string, unknown>)
        .flatMap(([k, v]) => hojas(v, prefijo ? `${prefijo}.${k}` : k));
    }

    const delContexto = new Set(hojas(EJEMPLO));
    const delCatalogo = new Set(CATALOGO_VARIABLES.filter((v) => !v.soloEn).map((v) => v.ruta));

    it('todo lo que el menú ofrece EXISTE en el contexto', () => {
      // Sin esto, el menú ofrece «Piso», la persona lo inserta y el contrato
      // sale con ««propiedad.piso»» entre comillas angulares.
      const inventadas = [...delCatalogo].filter((r) => !delContexto.has(r));
      expect(inventadas).toEqual([]);
    });

    it('todo lo que el contexto tiene está en el menú', () => {
      // La otra dirección: un campo que existe y no se ofrece es un campo que
      // sólo conoce quien leyó el código.
      const escondidas = [...delContexto].filter((r) => !delCatalogo.has(r));
      expect(escondidas).toEqual([]);
    });

    it('los formatos sugeridos son formatos que el motor tiene', () => {
      for (const v of CATALOGO_VARIABLES) {
        for (const f of v.formatos) {
          expect(NOMBRES_DE_FORMATO).toContain(f);
        }
      }
    });

    it('la lista de formatos del conversor y la del motor son la misma', () => {
      expect([...FORMATOS_VALIDOS].sort()).toEqual([...NOMBRES_DE_FORMATO].sort());
    });

    it('las listas que ofrecen los bloques existen y SON listas', () => {
      for (const b of CATALOGO_BLOQUES.filter((x) => x.clase === 'para' && !x.soloEn)) {
        expect(Array.isArray((EJEMPLO as Record<string, unknown>)[b.expr])).toBe(true);
      }
    });

    it('cada bloque genera un HTML que el motor entiende', () => {
      for (const b of CATALOGO_BLOQUES) {
        const html = b.clase === 'si'
          ? textoAHtml(`{% si ${b.expr} %}x{% fin %}`)
          : textoAHtml(`{% para ${b.item} en ${b.expr} %}x{% fin %}`);
        expect(tokensRotos(html)).toEqual([]);
        expect(sanitizarPlantilla(html).html).toBe(html);
      }
    });
  });
});
