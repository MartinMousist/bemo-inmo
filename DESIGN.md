# DESIGN.md — sistema de diseño de Bemo INMO

Fuente de verdad visual. Ningún componente define un color propio.

---

## 0. Bemo INMO dentro de BEMO

BEMO es el grupo; cada producto es una vertical. El sistema de diseño vive en dos capas.

**Capa familia** — idéntica en todos los productos, hoy en `web/src/styles/familia.css`:
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
| Bemo INMO | teal `#0e7c86` | fríos, matiz verde |
| (futuro) | uno del rango libre | derivado del acento |

⚠️ **Desde el 2026-08-05 los dos productos comparten paleta completa**, por
decisión del dueño. Es una excepción consciente al modelo de arriba: la capa
producto queda vacía y BEMO pasa a ser una sola identidad visual en vez de una
familia con verticales distinguibles. Si algún día hay que volver a
diferenciarlos, el costo sigue siendo **un token** (`--accent` y sus derivados
`-hover`, `-tint`, `-line`, `-ink`), que es exactamente para lo que existe la
separación en dos capas.

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
  **Matizado el 2026-08-09** con la cartera en tarjetas: la tabla sigue siendo el
  default de las tres pantallas de propiedades y no se va. Las tarjetas son una
  SEGUNDA vista, con otro uso —mostrarle la cartera a alguien— y con diez datos
  por unidad, no seis. Ver el Decisions Log.

## 2. A contramano de la categoría

| La categoría hace | Bemo INMO hace |
|---|---|
| Portales: naranja, verde pasto, amarillo. Vibrante, de aviso clasificado. | Neutros sobrios + un solo acento. |
| CRMs inmobiliarios: azul corporativo brillante o violeta SaaS. | Teal petróleo, apagado, nada corporativo. |
| Íconos de casita, llave, techo. Fotos de familias con cajas de mudanza. | Cero ilustración. Tipografía y datos. |
| Tarjetas grandes con mucho aire y poca información. | Tablas densas por defecto. Y cuando hay tarjetas, con diez datos adentro y no tres. |

La referencia mental no es "app inmobiliaria". Es **un documento bien
tipografiado**: neutros sobrios, un acento, números en columna, sin adornos.

## 3. Tokens

Un solo archivo de variables CSS (`web/src/styles/tokens.css`). Ningún
componente define un color. **La paleta es la de Bemo MED**, adoptada entera el
2026-08-05.

- **Acento**: `#0e7c86` · hover `#0b656d` · tint `#e1f1f2` · borde tint `#bfe0e2`.
- **Neutros**: fondo `#fbfbfa` · superficie `#ffffff` · superficie-2 `#f5f3ee` ·
  superficie-3 `#efece5` · líneas `#e7e5e1` / `#d8d5cf` · tinta `#14201f` ·
  ink-2 `#33403f` · muted `#5b6766`.
- **Semánticos**: success `#2e7d5b` · warning `#b5760a` · error `#b23a32`.
- **Oscuro**: fondo `#0b1211` · superficie `#141f1e` · superficie-2 `#1c2a28` ·
  líneas `#2a3b39` · tinta `#e9efed` · teal desaturado `#4fa9b1`.
- **Espaciado** base 4: 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48).
- **Radios**: sm 6 · md 8 · lg 12. Nada burbuja.
- **Motion**: micro 90ms · short 170ms · medium 280ms.
- **`--on-accent`**: blanco en claro, `#06201f` en oscuro — el teal claro pide
  texto oscuro encima.

### Dos correcciones a la paleta de MED, ambas medidas

Adoptarla al pie de la letra habría metido tres fallos de contraste:

| Par | MED | Medido | Corrección |
|---|---|---|---|
| `--muted-2` sobre `--surface-2` | `#8a9694` | **2,75:1** | `#626d6b` → 4,83:1 |
| `--muted-2` oscuro sobre `--surface-2` | `#6f807e` | **3,59:1** | `#8b9c99` → 5,18:1 |
| Semántico sobre su propio tint | usa el color base | 4,25 / 4,33 / **3,34** | variantes `-ink` → 5,83 / 4,88 / 5,01 |

Lo del `--muted-2` este repo ya lo había corregido una vez calculando (de 3,01 a
4,56): copiar el valor de MED lo habría deshecho.

Lo de los semánticos es el patrón que **MED ya tiene resuelto para el acento**
—su `--teal-ink` es distinto de su `--teal`— y que allá quedó sin extender a
success y warning. Acá existen `--accent-ink`, `--success-ink`, `--warning-ink`
y `--danger-ink`, y son los que usan chips y alerts.

### Superficie oscura de portada

`--tinta`, `--tinta-2`, `--tinta-3` **no son colores nuevos**: son los neutros
del tema oscuro de MED usados en tema claro, para el hero y el bloque de Planes.
La portada no inventa paleta.

### Modo oscuro

`[data-theme='dark']` redefine los mismos tokens. Dos cosas que casi todos se
olvidan:

- **`--on-accent` pasa a un tono oscuro.**
- **Un script inline en el `<head>` aplica el tema antes del primer pintado**,
  leyendo `localStorage` y `prefers-color-scheme`. Sin eso hay un destello
  blanco en cada carga.

## 4. Tipografía

**Capa familia**: la tipografía es lo que más hace que dos productos se lean como hermanos,
más aún que el color. Se define una vez para todo BEMO y no varía por producto.

✅ **Resuelta el 2026-08-05: INMO adopta las de Bemo MED.** Eran Newsreader +
IBM Plex Sans/Mono acá y General Sans + Geist + Geist Mono allá. Se unificó
hacia MED por decisión del dueño del producto. La tipografía es lo que más hace
que dos productos se lean como hermanos, más aún que el color, y por eso no
puede variar por producto.

Dos familias y una mono. Ninguna es Inter ni Space Grotesk — son el default de todo y el
resultado se ve genérico.

| Rol | Familia | Uso |
|---|---|---|
| Display / títulos | **General Sans** (500/600) | H1-H4, títulos de pantalla y de portada. Grotesca limpia con identidad propia; evita el Inter/Space Grotesk genérico. Se carga por **Fontshare**. |
| UI / cuerpo / labels | **Geist** (400/500/600) | Todo lo demás: body, labels, botones, tablas. |
| Datos y cifras | **Geist Mono** (400/500) | Montos en columna, coeficientes, códigos, memorias de cálculo. Siempre con `tabular-nums`. |

```css
--font-title: 'General Sans', ui-sans-serif, system-ui, sans-serif;
--font-ui:    'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono:  'Geist Mono', ui-monospace, SFMono-Regular, monospace;
```

Carga: General Sans → `https://api.fontshare.com/v2/css?f[]=general-sans@500,600&display=swap`.
Geist y Geist Mono → Google Fonts. Dos orígenes, los dos con `preconnect`.

**Escala: 12 / 14 (cuerpo) / 16 / 17 / 20 / 24.** Títulos peso 600, cuerpo 400.
`h1` 24 · `h2` 17 · `h3` 15 · `h4` 13 · `.text-lg` 20 (título de tarjeta o
diálogo). La portada usa una escala mayor aparte: se mira de lejos.

⚠️ **General Sans se carga en 500 y 600 solamente.** Pedir `font-weight: 400`
hace que el navegador lo sintetice y sale peor que el 500. Los títulos van a 600.

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

> **Revisada el 2026-08-04.** La versión original prohibía gradientes, sombras de
> realce y animaciones de entrada. Se relajó por decisión explícita del dueño del
> producto. Lo que sigue prohibido, sigue prohibido — y lo que se habilitó viene
> con condiciones, no con vía libre.

Lo que **no** se hace, sin excepciones:

- Violeta SaaS, y el naranja/verde chillón de los portales inmobiliarios.
- Tres tarjetas con íconos dentro de círculos de colores.
- Todo centrado.
- Redondeo uniforme tipo burbuja (juguete = menos confiable).
- Foto de stock, ilustración genérica, blob decorativo, **íconos de casita/llave/techo**.
- Copy con `¡…!` y emoji. Tono declarativo.
- Partículas, scroll secuestrado, parallax que pelea con la rueda del mouse.
- Spinners centrados que saltan el layout — van skeletons.
- Datos de muestra que parezcan reales sin decir que son de muestra.
- Mapas de Google en cada tarjeta de un listado: se cobra por carga. Static Maps en
  listados, mapa interactivo sólo bajo demanda.

Lo que **sí** se puede, con condiciones:

| Se habilitó | La condición |
|---|---|
| Movimiento de entrada (`v-revelar`) | Una sola vez, corto, y **apagado entero** con `prefers-reduced-motion` — apagado, no atenuado. Si el JS no corre, todo visible. |
| Elevación al pasar el cursor (`.elevar`) | Sólo en lo que es clicable o se está ofreciendo. Una tarjeta que se levanta y no lleva a ningún lado miente. |
| Gradientes | Como **iluminación**, no como decoración: halos muy tenues sobre superficies grandes. Sin blobs, sin formas, sin bordes brillantes. |
| Sombras fuertes (`--sh-3`) | De hover y de portada. En reposo dentro de la app siguen `sh-1`/`sh-2`. |
| Fondo oscuro (`--tinta`) | Portada y panel de ingreso. La app operativa sigue en papel. |

**La regla que no se relajó**: todo texto sobre las superficies nuevas se mide.
El naranja de marca sobre tinta daba menos de 4,5 y hubo que crear
`--marca-sobre-tinta` (7,81). Los rótulos de las tarjetas del hero quedaron en
2,81 usando el gris de papel sobre fondo oscuro, y se corrigieron. **Ninguna de
las dos cosas se veía mal a ojo.**

---

## Escala tipográfica

| Nivel | Tamaño | Qué es |
|---|---|---|
| `h1` | 28px | Título de pantalla. Uno por vista |
| `.text-lg` | 20px | Título principal de una **tarjeta o diálogo**: "Entrar", "Crear cuenta", el nombre del plan |
| `h2` | 15px | Título de **sección** dentro de una pantalla: "Titulares", "Operaciones", "Cuotas" |
| `h3` | 13px | Subsección |

El `h2` de tarjeta sigue siendo `h2` **por jerarquía de documento** — hay un `h1`
antes— y lleva `.text-lg` para el tamaño. La etiqueta la decide la estructura,
no el tamaño; el tamaño lo decide la clase.

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
| 2026-08-04 | La capa familia existe de verdad: `web/src/styles/familia.css`. `tokens.css` queda con variables solamente. | Estaba escrita como promesa desde el 02/08 y en el código no existía: la forma de los componentes vivía en 2830 líneas de `<style scoped>` repartidas en 59 archivos, con `.alert` copiado **idéntico en 27 pantallas**, `.segmented` en 8 y `.campo` en 13. Cada copia era una oportunidad de que dos pantallas del mismo producto no se parecieran. Reconstruida sobre `design.css` de Bemo MED, que es donde esta capa ya estaba resuelta. |
| 2026-08-04 | De MED se tomó la **estructura** (qué componentes existen y con qué anatomía), no los valores. | Los tokens y las reglas anti-slop del §6 mandan por encima del original. De ahí tres divergencias deliberadas y anotadas en el archivo: el chip va rectangular y no píldora (§6 prohíbe el redondeo burbuja), el avatar va cuadrado y no círculo (el registro es "documento", no "red social") y el `.segmented` se unificó hacia **la forma que INMO ya usaba** —barra unida con divisores— y no hacia la de MED. El objetivo era una sola definición; la de MED no era mejor, era distinta. |
| 2026-08-04 | El bloque de estado vacío se llama `.estado-vacio`, no `.vacio`. | En siete pantallas `.vacio` ya significaba otra cosa: el renglón apagado que dice "no hay movimientos". Dos nombres iguales con dos formas distintas es justo lo que esta capa vino a terminar. |
| 2026-08-05 | La barra lateral se puede plegar a 64px, y la preferencia se **guarda**. | Es una decisión de espacio de trabajo, no un estado de sesión: quien plegó la barra en un portátil de 13" para ver la cartera completa no quiere volver a plegarla en cada carga. El control va en la topbar y no dentro de la barra, porque plegada quedaría a 64px de ancho y sin etiqueta. Dos cosas que el CSS de MED no cubre: el wordmark **deja de renderizarse** en vez de ocultarse con `display: none` (oculto seguía en el árbol de accesibilidad), y los ítems llevan `aria-label` porque al ocultar el `<span>` el enlace se quedaba sin nombre accesible. Con los títulos de grupo ocultos se agrega una línea entre grupos: es la información que el título llevaba. |
| 2026-08-05 | INMO adopta también la **forma de los componentes** de MED. | Botones (tamaños, `:active`, sombra del secundario), sidebar, topbar, navegación, buscador, chips y avatares. Esto **revierte las tres divergencias** que se habían dejado documentadas el 04/08: el chip vuelve a ser píldora, el avatar vuelve a ser círculo y el segmentado vuelve a pastillas sobre riel. Los argumentos de entonces siguen siendo válidos —`--r-full` es redondeo burbuja y §6 lo desaconseja— pero pesan menos que tener una sola capa familia de verdad, que es el punto del modelo de dos capas. Con esto la capa familia deja de ser "reconstruida a partir de MED" y pasa a ser la misma. |
| 2026-08-05 | **INMO adopta la paleta y la tipografía completas de Bemo MED.** | Decisión del dueño. Tipografía: General Sans + Geist + Geist Mono, que cierra la divergencia que §4 tenía abierta. Color: teal `#0e7c86` y los neutros de MED, en la app y en la portada. La capa producto queda vacía y BEMO pasa a ser una identidad visual única. Volver a diferenciar los productos cuesta un token, que es para lo que existe la separación en dos capas. |
| 2026-08-05 | La paleta se adoptó **con dos correcciones medidas**, no al pie de la letra. | `--muted-2` de MED da 2,75:1 sobre `--surface-2` (3,59 en oscuro) y este repo ya lo había corregido una vez calculando: adoptarlo tal cual deshacía ese arreglo. Y los semánticos sobre su propio tint daban 4,25 / 4,33 / 3,34 — MED ya resuelve eso para el acento con `--teal-ink` pero no lo extiende a success y warning. De ahí las variantes `-ink`. |
| 2026-08-05 | La rampa `--papel*` de la portada se **elimina**. | Existía para separar superficies cuando los neutros eran los cálidos de INMO. Con la paleta de MED la portada usa `--bg` / `--surface-3` / `--line` como la app: menos tokens, una sola rampa. |
| 2026-08-05 | `.landing` redefine **`--surface-3`** a `#e8e4db`, y nada más. | Al pasar a la paleta de MED el salto entre tarjeta y fondo volvió a caer a 1,18:1, que de cerca alcanza y de lejos se lee como un solo campo plano. En vez de reponer una rampa entera, se redefine UN token dentro del scope de la portada: la tarjeta pasa a 1,27:1 y el borde entre secciones a 1,23:1 (era 1,07). La app no se entera, y en oscuro se devuelve el valor del sistema porque ahí ya separaba bien (1,33:1). **El límite lo puso el contraste, no el gusto**: un escalón más hondo (`#e5e1d6`) dejaba `--muted` en 4,49:1, cuatro centésimas por debajo de AA. Y al medirlo apareció otro que no había previsto: `--muted-2` a 10px en el rótulo "Hoy" daba 4,22 y subió a `--muted`. |
| 2026-08-05 | General Sans se pide en **600**, nunca en 400. | Fontshare la sirve en 500 y 600. Un `font-weight: 400` lo sintetiza el navegador y sale peor que el 500. Las reglas de portada que venían de Newsreader (peso 400 + `font-optical-sizing`) se migraron. |
| 2026-08-09 | La cartera de propiedades tiene una **segunda vista en tarjetas**, con la tabla como default. | §1 dice que la densidad es una virtud, y sigue siendo cierto para el uso primario: el administrador que revisa 30 propiedades quiere la tabla. Pero hay un segundo uso real —dar vuelta la pantalla y mostrarle la cartera a un cliente— donde la foto y el precio pesan más que la densidad, y para eso una tabla no sirve. No es la tarjeta que §2 prohíbe: mete diez datos por unidad y cuatro columnas a 1200px. La preferencia se guarda (`dominio/vista.ts`) y es UNA sola para las tres pantallas, como el sidebar plegado. Lo que NO entró a la tarjeta son los honorarios editables: es la vista que se le muestra a un tercero. |
| 2026-08-09 | «Estado» de una operación pasa a llamarse **«Situación»**, y su etiqueta depende del tipo de operación. | `cerrada` es «Vendida» en una venta y **«Alquilada»** en un alquiler: ahí ese estado es la unidad OCUPADA, o sea la que está generando plata. Por leer la palabra al revés, la cartera de alquiler llegó a mostrar «3 de 13». La etiqueta vivía en tres lugares y el tono del chip en tres más, y no coincidían: `cerrada` se pintaba de rojo en dos pantallas y neutra en la tercera. Ahora salen de `etiquetaSituacion()` y `tonoSituacion()`, con el tipo de operación **obligatorio** para que `vue-tsc` encuentre los call sites que un `grep` no distingue. `cerrada` es neutra: una venta cerrada es el mejor resultado posible. |
| 2026-08-09 | Un dato que falta **no se muestra como cero**, y `0` no se muestra igual que `NULL`. | Un terreno no tiene dormitorios y una cochera no tiene baños: esos íconos no existen en esa tarjeta. Un `0` sí es un dato de compra —«sin cochera»— y esconderlo lo confunde con «no lo cargaron»; un `NULL` dice «s/d» en `--warning-ink`, que es lo único de la tarjeta que pide una acción. La regla vive en `dominio/atributos.ts` con un test por cada tipo real de la base, y no en `v-if`s del template, que es como termina repartida y divergiendo. |
| 2026-08-04 | La portada tiene su **propia rampa de superficies** (`--papel`, `--papel-hondo`, `--papel-linea`, `--papel-muted`). | La rampa de la app está calibrada para tablas densas y ahí funciona. En la portada estaba **medido** que no: `--bg` con una tarjeta `--surface` encima da **1,04:1**, la sección alterna contra el fondo **1,07:1** y el borde de la tarjeta **1,28:1**. O sea que la tarjeta, la sección y el borde no existían — sólo texto flotando sobre un campo crema uniforme. Ésa es la causa medida de "se ve lavado". Con `--papel` la tarjeta pasa a 1,21:1 y con `--papel-hondo` a 1,35:1. Los tokens los consume **sólo** `.landing`. |
| 2026-08-04 | Dos anclas oscuras y no una: **Planes baja a `--tinta`**. | Entre el hero y el pie había 1.500px de crema sin un solo momento de contraste. El bloque que peor se veía es el que más tiene que pesar. Efecto lateral que resuelve una queja entera: sobre tinta el verde de `--success` en los tildes ni siquiera es una opción. **Sin halo de iluminación**, a diferencia del hero: con badge naranja y botón naranja al lado, repetir la firma volvía el bloque lo más cálido de una marca cuyo acento es azul. |
| 2026-08-04 | La tarjeta de plan deja de fingir que tiene precio. | Cuatro defectos con una raíz. El badge era un `<p>` en el flujo y empujaba todo ~24px: las tres tarjetas **nunca** alineaban. "A convenir" iba en serif 24px tinta —la tipografía, el tamaño y el lugar de un precio, tres veces—: no decía una mentira, la dibujaba; ahora baja al pie en versalitas. El lugar del precio lo ocupa la **capacidad en mono tabular**, que es el único número real que diferencia un plan. Y `flex: 1` en la lista metía el hueco entre planes de 4 y 5 ítems **adentro** de la lista; ahora el aire sobrante queda afuera del divisor y se lee como pie. |
| 2026-08-04 | Newsreader se queda; lo que estaba mal era el **uso**. | Es variable (eje `opsz` 6..72, ya cargada) y se usaba a peso 500 en toda la escala: a 42px el 500 empasta la mancha, y por eso los títulos se veían blandos. Peso 400 de 24px para arriba con `font-optical-sizing: auto`. El cuerpo de portada sube de 13-14px a 16px: 14px es la densidad que §1 pide para ver 30 contratos, y es la densidad equivocada para una página que vende. |
| 2026-08-04 | Tres fallos de contraste **preexistentes**, encontrados calculando. | `.pasos .n` en `--marca` sobre `--surface-2` daba **3,06:1**; la regla de 2px en `--marca-linea`, **1,38:1** (mínimo 3 para un objeto gráfico); y `--muted` sobre `--papel-hondo` habría dado 4,24. De ahí `--marca-texto` (#954822) y los grises propios de portada. Ninguno se veía mal a ojo. |
| 2026-08-04 | §6 se relaja: entran movimiento de entrada, elevación al hover, gradientes de iluminación y fondo oscuro. | Decisión explícita del dueño del producto. Se relajó con condiciones escritas, no en general: cada permiso tiene su límite en la tabla del §6. Lo que **no** se movió es la obligación de medir contraste — y valió la pena, porque las dos cosas que fallaron (naranja sobre tinta, rótulos de tarjeta) se veían bien a ojo. |
| 2026-08-04 | La portada estrena hero sobre `--tinta`, con el naranja de marca como botón principal. | Dos cosas al mismo tiempo: el fondo oscuro es la superficie más contrastada que tiene el producto —ya probada en el panel de ingreso— y sobre ella el acento azul del producto no contrasta (2,1:1), así que el naranja deja de ser sólo firma y pasa a ser la acción. Es la respuesta a "los colores están apagados" sin tocar el acento de la app. |
| 2026-08-04 | `h2` baja de 20px a **15px** y el título de tarjeta pasa a `.text-lg`. | Diez pantallas pisaban el `h2` con siete tamaños distintos, y la razón era que el token servía a dos papeles: título de sección (30 de los 38 `h2` del producto) y título de tarjeta o diálogo (6). Con un token por papel, los diez overrides desaparecen. Trampa encontrada al hacerlo: un `h3` scoped es (0,1,1) y le gana a `.text-lg`, que es una clase global (0,1,0) — hubo que sacar el override, no sólo agregar la clase. |
| 2026-08-04 | Cuando la familia y el producto discrepaban, ganó **el producto**. | `.btn.sm` es 4px/12px (lo que usaban 8 pantallas) y no 6px/13px como en MED: acá `sm` es el botón de acción dentro de una fila de tabla densa y tiene que caber. `.btn:disabled` va en `opacity .6` (once pantallas) y no `.5`. Traer el valor de MED "porque es la familia" habría cambiado ochenta botones para peor. |
| 2026-08-04 | `.fuerte` sube la **tinta**, no el peso. | Es lo que las siete pantallas que ya lo usaban hacían, y tienen razón: en una tabla de importes, poner en negrita la columna que importa engorda la mancha y se pierde el efecto. Subir el contraste destaca igual y no rompe la grilla. |
| 2026-08-04 | Lo que varía por pantalla va como **modificador**, no como regla suelta. | `.table-sticky` (encabezado pegado), `.table-clicable` (la fila navega), `.segmented.scroll` (barra de filtros angosta), `.campo.suave` (etiqueta de filtro, no de formulario). Antes cada pantalla lo resolvía con su propio bloque y por eso divergían. |
| 2026-08-04 | `CommandPalette` usa las clases de la familia (`.velo`, `.paleta`, `.paleta-input`, `.paleta-grupo`, `.paleta-item`). | Tenía las mismas cinco piezas con nombres propios —`.campo`, `.lista`, `.item`— y `.campo` ahí era una fila horizontal: el mismo nombre que el campo de formulario, con otra forma. Le quedan tres reglas propias. |
| 2026-08-04 | El encabezado de tabla pegado es **opt-in**. | Puesto por default choca con la topbar, que también es pegada y va en z-index más alto: el encabezado no queda a la vista, queda tapado. Se ancla a `--topbar-h`, token nuevo. |
| 2026-08-04 | La topbar pasa a pegada y translúcida, como la de MED. | Con listados largos, perder de vista de qué inmobiliaria son los números que estás mirando es lo que un producto multi-tenant no se puede permitir. La sidebar se pegó por lo mismo: cinco grupos de navegación y scrollear hasta el contrato 80 no puede dejar al usuario sin menú. |
