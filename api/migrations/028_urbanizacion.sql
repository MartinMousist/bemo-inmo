-- 028 — Dónde está la propiedad, no sólo qué es.
--
-- Las 027 agregó lo que describe la UNIDAD (plantas, toilettes, disposición,
-- calefacción). Esta agrega lo que describe el LOTEO: si la propiedad está en un
-- barrio abierto o dentro de un country, un barrio privado o un condominio
-- cerrado, y con qué nombre — «Chacras Park», «La Reserva» — que es lo que
-- alguien tipea en el buscador cuando ya sabe qué complejo quiere.
--
-- ── Por qué es un atributo de la propiedad y no una tabla de complejos ──
--
-- Un `complejo` con sus propias filas —nombre, ubicación, amenities del
-- country— sería el modelo correcto el día que la inmobiliaria administre
-- VARIAS unidades del mismo loteo y necesite editar «tiene cancha de polo»
-- una sola vez para las quince. Hoy ninguna pantalla agrupa por complejo y
-- nadie pidió esa vista: dos columnas resuelven el filtro y la búsqueda sin
-- construir la tabla que ese caso todavía no necesita.
--
-- ── `condominio` no es lo mismo que la titularidad en condominio ──
--
-- La migración 006 ya usa "condominio" para cuando dos personas son
-- titulares de la MISMA propiedad (dos hermanos al 50%, ver `titularidad`).
-- Acá "condominio" es el tipo de URBANIZACIÓN: un conjunto chico de unidades
-- que comparte espacios comunes. Son dos conceptos del mismo mundo
-- inmobiliario que comparten nombre por convención del rubro, no por el
-- diseño de esta base — una propiedad puede estar en un condominio (loteo) Y
-- tener dos titulares en condominio (dueños) al mismo tiempo, sin relación
-- entre las dos cosas.

ALTER TABLE propiedad ADD COLUMN tipo_urbanizacion text
  CHECK (tipo_urbanizacion IN ('abierto', 'barrio_privado', 'country', 'condominio'));

-- Texto libre y no una FK a una tabla de complejos, por la razón de arriba.
-- `NULL` es «no se cargó», no «está en la calle» — esa afirmación la hace
-- `tipo_urbanizacion = 'abierto'`, que es un valor real y no el default.
ALTER TABLE propiedad ADD COLUMN nombre_complejo text CHECK (char_length(nombre_complejo) <= 120);
