-- 023 — Las plantillas dejan de ser texto plano y pasan a HTML con formato.
--
-- (La 022 se la llevó `022_tipo_de_cuenta.sql`, del lote que corría en
--  paralelo. Una migración aplicada es inmutable y los números no se reciclan.)
--
-- Hasta hoy una plantilla es un `text` que se edita en un textarea
-- monoespaciado y se imprime dentro de un `<pre>`. Eso alcanza para probar el
-- motor y no alcanza para un contrato: el papel que firma una persona no sale
-- en Courier, sale con negritas, títulos, viñetas y márgenes. Y la inmobiliaria
-- que hoy redacta en Word no puede traer su modelo sin perder todo el formato.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué una COLUMNA de formato y no olfatear un '<'
--
-- Porque olfatear es adivinar, y de esa adivinanza dependen tres cosas que se
-- ven: si la vista imprimible usa `v-html` o `<pre>`, qué baja el `.txt` y con
-- qué número se decide si un envío va completo o adjunto. Un contrato en texto
-- plano que mencione «menor a 30 m2» y traiga un `<` daría «html» y saldría con
-- las etiquetas a la vista. Un dato que decide la presentación de un papel
-- legal se guarda, no se deduce.
--
-- El default es 'texto' a propósito: TODA fila existente queda como está hasta
-- que el paso de TypeScript del `migrate` la convierta de verdad. Una migración
-- que declarara 'html' sin convertir el contenido dejaría el `<pre>` mostrando
-- texto plano que el resto del sistema cree que es HTML.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE plantilla_doc
  ADD COLUMN contenido_formato text NOT NULL DEFAULT 'texto'
    CHECK (contenido_formato IN ('texto', 'html')),
  -- El texto tal como estaba antes de convertirlo.
  --
  -- No es paranoia de respaldo: convertir es REESCRIBIR UN TEXTO LEGAL. Si el
  -- conversor se come un salto de línea del bloque de firmas o de una cláusula,
  -- el contrato sale distinto, y la única forma de que alguien pueda darse
  -- cuenta es poder mirar el original. La pantalla de Plantillas lo muestra —
  -- «Convertida desde texto plano el dd/mm/aaaa · ver el original»—, porque una
  -- columna que nadie lee es el error #3 del playbook.
  ADD COLUMN contenido_texto_original text,
  ADD COLUMN convertida_el timestamptz;

COMMENT ON COLUMN plantilla_doc.contenido_formato IS
  'texto = el textarea monoespaciado de siempre. html = el editor con formato. Se guarda y NO se deduce mirando si el contenido tiene un <.';
COMMENT ON COLUMN plantilla_doc.contenido_texto_original IS
  'El contenido tal como estaba antes de la conversión a HTML. Se lee desde la pantalla: convertir es reescribir un texto legal y tiene que poder auditarse.';


-- ─────────────────────────────────────────────────────────────────────────────
-- El documento generado congela SU formato, igual que `plantilla_nombre`.
--
-- Misma regla, mismo motivo: un papel que salió monoespaciado salió así, y la
-- vista imprimible tiene que poder reproducirlo seis meses después aunque la
-- plantilla de la que salió ya se haya convertido a HTML. Si el formato se
-- leyera de `plantilla_doc`, convertir una plantilla cambiaría cómo se ve un
-- documento que ya recibió la otra parte.
--
-- ⚠️ Los documentos YA GENERADOS **no se convierten**, ni acá ni en el paso de
-- TypeScript. Además del argumento de arriba está el trigger
-- `documento_congelado` de la 020: cualquier UPDATE masivo sobre `texto_final`
-- de un documento ya enviado levanta check_violation y voltea la migración
-- entera. Se muestran como salieron.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documento_generado
  ADD COLUMN formato text NOT NULL DEFAULT 'texto'
    CHECK (formato IN ('texto', 'html'));

COMMENT ON COLUMN documento_generado.formato IS
  'Congelado al generar, como plantilla_nombre. Un documento que salió en texto plano se sigue mostrando en texto plano aunque su plantilla ya se haya convertido a HTML.';


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS y permisos.
--
-- Las dos tablas ya tienen su policy y su GRANT (008 y 020) y las columnas
-- nuevas los heredan: una policy es de la TABLA, no de la columna, y el GRANT
-- sin lista de columnas alcanza a las que se agreguen después. Se deja escrito
-- porque el test de seguridad que recorre pg_class pidiendo policy en todo lo
-- que tenga `tenant_id` tiene que seguir en verde, y la pregunta «¿le falta
-- RLS a esto?» aparece sola al leer una migración que sólo hace ALTER.
-- ─────────────────────────────────────────────────────────────────────────────
