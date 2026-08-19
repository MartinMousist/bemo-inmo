-- 029 — La clave del objeto, para poder servirlo firmado.
--
-- `garantia_documento` y `acta_foto` guardaban sólo la `url` pública. Con el
-- bucket separado en `publico/` y `privado/` (ver el compose), esos objetos
-- dejan de tener una URL que sirva siempre: se piden firmados y con vencimiento
-- corto, y para firmarlos hace falta la CLAVE, no la URL.
--
-- ── Por qué no se hace backfill en SQL ──
--
-- La clave se puede derivar de la url —es todo lo que sigue a `S3_PUBLIC_URL/`—
-- pero ese prefijo vive en una variable de entorno, no en la base: un UPDATE
-- que lo hardcodee acá queda mal en cuanto alguien cambie el endpoint, y peor,
-- quedaría escrito en una migración que ya no se puede tocar.
--
-- Las filas viejas quedan con `clave` en NULL y el servicio la deriva al vuelo
-- con `claveDeUrl()`, que ya existía para poder borrar. Es la misma función,
-- una sola definición, y las filas nuevas la traen escrita.
--
-- `url` NO se borra: sigue siendo el registro de dónde estuvo el archivo, y es
-- de lo que se deriva la clave de las filas viejas.

ALTER TABLE garantia_documento ADD COLUMN clave text;
ALTER TABLE acta_foto ADD COLUMN clave text;

COMMENT ON COLUMN garantia_documento.clave IS
  'Clave del objeto en S3. NULL en filas anteriores a la 029: se deriva de url.';
COMMENT ON COLUMN acta_foto.clave IS
  'Clave del objeto en S3. NULL en filas anteriores a la 029: se deriva de url.';
