# DESIGN.md — sistema de diseño de Bemo INMO

Fuente de verdad visual. Ningún componente define un color propio.

---

## 0. Bemo INMO dentro de BEMO

BEMO es el grupo; cada producto es una vertical. El sistema de diseño vive en dos capas.

**Capa familia** — idéntica en todos los productos, vive en `@bemo/ui`:
- La rampa de luminosidad de los neutros: los mismos nueve escalones en todos lados.
- Escala de espaciado (base 4), radios, sombras, tiempos de transición, anillo de foco.
- Las tres familias tipográficas y la escala de tamaños.
- La forma de los componentes: altura de botón, densidad de tabla, chips, modales.

**Capa marca (grupo BEMO)** — el isotipo:
- La **"B" blanca sobre un cuadrado naranja** de esquinas suaves (`--marca: #d2703f`).
  Es el mismo signo para todas las verticales; sólo cambia el wordmark que lo acompaña.
- El naranja es color de **firma**, no de interfaz: aparece en el logo, el favicon, la
  portada y los acentos de navegación pública. **Nunca** como color de acción en la app.

**Capa producto** — lo único que cambia:
- **El acento.** Uno solo. Es la identidad del producto.
- **El matiz de los neutros**: mismos valores de luminosidad, hue rotado hacia el acento.
- El registro del copy y las reglas de dominio.

| Producto | Acento | Matiz de neutros |
|---|---|---|
| Bemo MED | teal `#0e7c86` | fríos, matiz verde |
| Bemo INMO | azul tinta `#1e3a5f` | cálidos, papel |
| (futuro) | uno del rango libre | derivado del acento |

Por qué así: el 95% de una interfaz son neutros, espaciado y forma. Si eso es idéntico,
dos productos de BEMO se reconocen como hermanos aunque el acento sea distinto — y sumar
un producto nuevo cuesta **un color**, no un rediseño.

**Regla dura**: ningún producto agrega un token a la capa familia sin que los demás lo
adopten. Si Bemo INMO necesita algo, o va a la familia para todos, o se resuelve con los
tokens que ya existen.

---

## 1. El ancla: **exacto**

Una palabra, y todo lo demás se subordina a ella.

El usuario de Bemo INMO está manejando plata que no es suya y contratos que tienen efecto
legal. Lo que necesita sentir no es alegría ni velocidad: necesita creer que **el número
está bien y que puede explicarlo**. Cada decisión visual se evalúa contra eso.

Es la variante inmobiliaria del ancla de la familia: Bemo MED se ancló en *confiable*;
acá "exacto" es la misma promesa aplicada a plata en vez de a salud.

Consecuencias directas del ancla:
- Los números son ciudadanos de primera clase: tabulares, alineados, con su moneda.
- Toda cifra calculada puede abrirse y mostrar de dónde salió.
- Nada decorativo compite con el dato.
- La densidad es una virtud: un administrador quiere ver 30 contratos, no 6 tarjetas.

## 2. A contramano de la categoría

| La categoría hace | Bemo INMO hace |
|---|---|
| Portales: naranja, verde pasto, amarillo. Vibrante, de aviso clasificado. | Neutros de papel + un acento de tinta oscura. |
| CRMs inmobiliarios: azul corporativo brillante o violeta SaaS. | Azul de estilográfica, muy oscuro, casi neutro. |
| Íconos de casita, llave, techo. Fotos de familias con cajas de mudanza. | Cero ilustración. Tipografía y datos. |
| Tarjetas grandes con mucho aire y poca información. | Tablas densas, legibles, con jerarquía real. |

La referencia mental no es "app inmobiliaria". Es **un documento notarial bien
tipografiado**: papel cálido, tinta oscura, números en columna, sin adornos.

## 3. Tokens

Un solo archivo de variables CSS. Ningún componente define un color.

```css
:root {
  /* ── Neutros cálidos (papel). El 95% de la interfaz ── */
  --bg:          #fbfaf8;
  --surface:     #ffffff;
  --surface-2:   #f4f2ee;
  --surface-3:   #ebe8e2;
  --line:        #e6e3dd;
  --line-strong: #d5d1c9;

  --ink:     #1a1815;   /* texto principal, casi negro cálido */
  --ink-2:   #3a3630;
  --muted:   #6b6560;
  --muted-2: #928b83;

  /* ── Acento: uno solo. Azul de estilográfica ── */
  --accent:       #1e3a5f;
  --accent-hover: #162c48;
  --accent-tint:  #e8edf3;
  --accent-line:  #c3d0de;
  --on-accent:    #ffffff;

  /* ── Semánticos, apagados ── */
  --success:      #2f6b4f;  --success-tint: #e6f0ea;  --success-line: #bfd9cc;
  --warning:      #9a6b0f;  --warning-tint: #f7efdd;  --warning-line: #e3d2ab;
  --danger:       #a33a2e;  --danger-tint:  #f7e8e5;  --danger-line:  #e6c5bf;

  /* ── Radios: nada de redondeo burbuja ── */
  --r-sm: 6px;  --r-md: 8px;  --r-lg: 12px;

  /* ── Espaciado, base 4 ── */
  --s-xs: 4px;  --s-sm: 8px;  --s-md: 12px;  --s-lg: 16px;
  --s-xl: 24px; --s-2xl: 32px; --s-3xl: 48px;

  /* ── Elevación mínima ── */
  --sh-1: 0 1px 2px rgba(26,24,21,.05);
  --sh-2: 0 4px 12px rgba(26,24,21,.08);

  /* ── Foco siempre visible ── */
  --ring: 0 0 0 3px rgba(30,58,95,.18);

  /* ── Velocidad = confianza ── */
  --t-micro: 90ms;  --t-short: 170ms;
}
```

### Modo oscuro

`[data-theme='dark']` redefine los mismos tokens. Dos cosas que casi todos se olvidan:

- **`--on-accent` pasa a un tono oscuro.** En oscuro el acento se aclara, y un acento
  claro con texto blanco no contrasta.
- **Un script inline en el `<head>` aplica el tema antes del primer pintado**, leyendo
  `localStorage` y `prefers-color-scheme`. Sin eso hay un destello blanco en cada carga.

```css
[data-theme='dark'] {
  --bg: #161513;  --surface: #1e1d1a;  --surface-2: #262421;  --surface-3: #302d29;
  --line: #34312c; --line-strong: #46423b;
  --ink: #f0ede7; --ink-2: #d6d1c9; --muted: #9d968c; --muted-2: #746e66;

  --accent: #8fb3d9;  --accent-hover: #a6c4e4;
  --accent-tint: #1c2a3a;  --accent-line: #35506e;
  --on-accent: #10203a;          /* ← oscuro, no blanco */

  --success: #6fbe97; --warning: #d9ab55; --danger: #d98878;
  --ring: 0 0 0 3px rgba(143,179,217,.22);
}
```

## 4. Tipografía

**Capa familia**: la tipografía es lo que más hace que dos productos se lean como hermanos,
más aún que el color. Se define una vez para todo BEMO y no varía por producto.

⚠️ **Pendiente**: no está registrado qué familias usa Bemo MED. Si difieren de estas, hay
que unificar — la propuesta es que la familia adopte estas tres, porque el par
serif-editorial + sans-con-mono-hermana sirve igual al registro clínico y al financiero,
y tener Sans y Mono de la misma familia es una ventaja real en cualquier tabla de números.

Dos familias y una mono. Ninguna es Inter ni Space Grotesk — son el default de todo y el
resultado se ve genérico.

| Rol | Familia | Uso |
|---|---|---|
| Títulos | **Newsreader** | H1-H3, títulos de pantalla, portadas de documentos. Serif editorial, sobria. Da el registro "documento". |
| UI | **IBM Plex Sans** | Todo lo demás: labels, body, botones, tablas. |
| Números | **IBM Plex Mono** | Montos en columna, coeficientes, códigos de contrato, memorias de cálculo. |

```css
--font-title: 'Newsreader', Georgia, serif;
--font-ui:    'IBM Plex Sans', system-ui, sans-serif;
--font-mono:  'IBM Plex Mono', ui-monospace, monospace;
```

- Body **14px**, `line-height: 1.5`.
- `font-variant-numeric: tabular-nums` en **toda** columna con números. No es opcional.
- Títulos de pantalla en Newsreader 24-28px, peso 500, sin mayúsculas forzadas.
- Nada de `text-transform: uppercase` salvo en labels de tabla, y ahí con `letter-spacing: .04em` y 11px.

## 5. Reglas del dominio (específicas de Bemo INMO)

Estas mandan por encima de cualquier preferencia estética.

**Dinero**
- Alineado a la derecha, `--font-mono`, `tabular-nums`.
- **Siempre con moneda explícita**: `ARS 450.000` / `USD 92.000`. Nunca un `$` ambiguo:
  en este producto ARS y USD aparecen en la misma tabla.
- Separador de miles `.` y decimal `,` (formato es-AR).
- Los negativos en `--danger` y entre paréntesis en contextos de liquidación.

**Cálculos**
- Toda cifra derivada lleva un affordance para abrir su memoria de cálculo. El formato
  canónico es una línea legible:
  `IPC ago/25 → nov/25 · coef. 1,0847 · ARS 450.000 × 1,0847 = ARS 488.115`
- La memoria se muestra en `--font-mono` sobre `--surface-2`.

**Fechas**
- `dd/mm/aaaa` siempre. Períodos como `nov/25`.
- Vencimientos con semáforo por proximidad usando los semánticos: >30d neutro,
  30-8d `--warning`, ≤7d `--danger`, vencido `--danger` sólido.

**Estados**
- `StatusChip` con tint + line del semántico, nunca color sólido salvo en el estado
  terminal negativo (vencido, rescindido).

## 6. Reglas anti-slop

Lo que **no** se hace, sin excepciones:

- Gradientes, glassmorphism, sombras de colores, bordes brillantes.
- Violeta SaaS, y el naranja/verde de los portales inmobiliarios.
- Tres tarjetas con íconos dentro de círculos de colores.
- Todo centrado.
- Redondeo uniforme tipo burbuja (juguete = menos confiable).
- Foto de stock, ilustración genérica, blob decorativo, **íconos de casita/llave/techo**.
- Copy con `¡…!` y emoji. Tono declarativo.
- Animaciones de entrada, partículas, tarjetas que flotan.
- Spinners centrados que saltan el layout — van skeletons.
- Mapas de Google en cada tarjeta de un listado: se cobra por carga. Static Maps en
  listados, mapa interactivo sólo bajo demanda.

---

## Decisions Log

| Fecha | Decisión | Razón |
|---|---|---|
| 2026-08-02 | Ancla en "exacto", no en "confiable" ni "moderno". | El producto mueve plata de terceros. El criterio de decisión útil es si el número se entiende y se puede explicar, no si la pantalla se ve linda. |
| 2026-08-02 | Acento azul tinta `#1e3a5f`, oscuro y desaturado. | La categoría se reparte entre el naranja de los portales y el azul brillante de los CRMs. Un azul casi neutro no se parece a ninguno de los dos y deja libre todo el rango cálido para los semánticos, sin colisiones con `--danger`. |
| 2026-08-02 | Neutros cálidos (papel), no grises fríos. | Refuerza el registro "documento" y contrasta con el acento frío. |
| 2026-08-02 | Newsreader + IBM Plex Sans/Mono. | Serif editorial para el registro documental; Plex Sans y Mono comparten métricas, lo que hace que las columnas de números y el texto convivan sin saltos. Inter y Space Grotesk quedan descartadas por default de la industria. |
| 2026-08-02 | Moneda explícita obligatoria en todo monto. | ARS y USD conviven en la misma tabla (alquileres en pesos, ventas en dólares). Un `$` ambiguo acá es un error de plata, no de diseño. |
| 2026-08-02 | Densidad por sobre aire. | El usuario primario es un administrador mirando 200 contratos, no un visitante mirando 6 propiedades. |
| 2026-08-02 | El producto pasa a llamarse **Bemo INMO**, dentro del grupo BEMO. | Marca de familia: un grupo reconocible amortiza reputación y material de venta entre verticales. |
| 2026-08-02 | Sistema de diseño en dos capas: familia (neutros, espaciado, forma, tipografía) y producto (sólo el acento y el matiz). | Es la regla "un acento, neutros para todo lo demás" del playbook, escalada a una familia de productos. Sumar una vertical cuesta un color. |
| 2026-08-02 | Los neutros comparten la **rampa de luminosidad** entre productos, pero cada uno rota el hue hacia su acento. | Valores idénticos harían que el ink teal de MED desentone con el azul tinta de INMO. Compartir la rampa da coherencia; rotar el hue da identidad. Es la coherencia estructural la que se lee como familia, no el valor hexadecimal. |
