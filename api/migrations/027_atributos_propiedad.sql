-- 027 — Los atributos que el filtro de propiedades no tenía.
--
-- `propiedad` ya guardaba ambientes, dormitorios, baños, cocheras, antigüedad,
-- orientación y amenities desde la migración 006, y **ninguno se podía
-- filtrar**: el listado sólo filtraba por texto libre, tipo, operación, estado
-- y captador. Nadie carga un amenity tampoco — la columna existe y ningún
-- formulario la escribe. Es el error #3 del playbook otra vez: una columna que
-- existe y no lee nadie es una feature que no existe.
--
-- Esta migración agrega lo que faltaba para que ese dato se pueda buscar:
-- cuatro columnas nuevas (plantas, toilettes, disposición, calefacción) y un
-- catálogo cerrado para orientación, que hasta ahora era texto libre.
--
-- ── Por qué orientación pasa a catálogo y estado_conservacion no ──
--
-- Se pidió explícitamente poder filtrar por orientación («sur, norte»), y
-- filtrar por texto libre es filtrar por lo que cada quien tipeó: "Norte",
-- "norte ", "N" y "Orientación norte" son la misma propiedad y cuatro strings
-- distintos. `estado_conservacion` no se tocó porque nadie lo pidió — no se
-- migra lo que no hace falta.

-- ─────────────────────────────────────────────────────────────────────────────
-- Cuatro columnas nuevas.
-- ─────────────────────────────────────────────────────────────────────────────

-- Cantidad de plantas de la UNIDAD (un dúplex son 2, un PH de una planta es 1).
-- Sólo tiene sentido en casas, PH y algún departamento dúplex — no se restringe
-- por tipo con un CHECK porque el motor de atributos del front ya decide qué
-- se MUESTRA según el tipo, y una restricción acá duplicaría esa regla en dos
-- lugares que se pueden desincronizar.
ALTER TABLE propiedad ADD COLUMN plantas smallint CHECK (plantas BETWEEN 0 AND 50);

-- Baños sin ducha ni bañera. Va aparte de `banos` y no sumado: un departamento
-- con 2 baños y 1 toilette no son "3 baños" para quien pregunta específicamente
-- por el toilette, que es la pregunta que este campo existe para contestar.
ALTER TABLE propiedad ADD COLUMN toilettes smallint CHECK (toilettes BETWEEN 0 AND 20);

ALTER TABLE propiedad ADD COLUMN disposicion text
  CHECK (disposicion IN ('frente', 'contrafrente', 'lateral', 'interno'));

ALTER TABLE propiedad ADD COLUMN calefaccion text
  CHECK (calefaccion IN (
    'central', 'individual', 'radiadores', 'losa_radiante',
    'aire_frio_calor', 'a_lena', 'sin_calefaccion'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Orientación: de texto libre a catálogo.
--
-- Los ocho puntos cardinales, en minúscula y sin tilde — el mismo formato que
-- ya usan las filas sembradas ('norte', 'noreste', 'este', 'sur', 'oeste'), así
-- que el CHECK valida contra datos reales sin migrar ni una fila.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE propiedad ADD CONSTRAINT propiedad_orientacion_check
  CHECK (orientacion IS NULL OR orientacion IN (
    'norte', 'noreste', 'este', 'sureste',
    'sur', 'suroeste', 'oeste', 'noroeste'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Amenities: índice para "tiene TODOS estos" (`@>`), que es como zonaprop y
-- cualquier portal ofrece el filtro — no "tiene alguno", que devuelve de todo.
--
-- GIN y no btree: `amenities @> ARRAY['pileta','seguridad']` es una consulta de
-- contención de array, y btree no la resuelve sin escanear la tabla entera.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX ix_propiedad_amenities ON propiedad USING gin (amenities);
