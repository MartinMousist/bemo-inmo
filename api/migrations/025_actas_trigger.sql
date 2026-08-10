-- 025 — Un trigger por tabla para la inmutabilidad del acta.
--
-- La 024 usaba UNA función para `acta_item` y `acta_foto`, resolviendo de qué
-- acta se trata con un `CASE TG_TABLE_NAME`. No funciona, y el error es
-- instructivo:
--
--     record "new" has no field "acta_item_id"
--
-- PL/pgSQL resuelve los campos de `NEW`/`OLD` al **evaluar la expresión**, no
-- al elegir la rama del CASE: aunque `TG_TABLE_NAME = 'acta_item'` tome el
-- THEN, la rama del ELSE menciona `NEW.acta_item_id` y ese campo no existe en
-- `acta_item`. Un CASE de SQL no es una guarda de tipos.
--
-- Se parte en dos funciones, una por tabla. Es más código y es lo correcto:
-- cada una habla de los campos que su tabla tiene.
--
-- Se arregla en una migración nueva y no editando la 024 porque **una migración
-- aplicada es inmutable** — el migrador compara el hash y falla si cambió, para
-- que dev y producción no terminen con esquemas distintos.

DROP TRIGGER IF EXISTS acta_item_no_se_toca ON acta_item;
DROP TRIGGER IF EXISTS acta_foto_no_se_toca ON acta_foto;
DROP FUNCTION IF EXISTS app_acta_hijo_inmutable();

/* Los ambientes de un acta firmada. */
CREATE OR REPLACE FUNCTION app_acta_item_inmutable() RETURNS trigger AS $$
DECLARE
  v_firmada timestamptz;
BEGIN
  SELECT firmada_el INTO v_firmada
    FROM acta WHERE id = coalesce(NEW.acta_id, OLD.acta_id);

  IF v_firmada IS NOT NULL THEN
    RAISE EXCEPTION 'El acta ya está firmada y no se puede modificar.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

/* Las fotos: un salto más, porque cuelgan del ambiente y no del acta. */
CREATE OR REPLACE FUNCTION app_acta_foto_inmutable() RETURNS trigger AS $$
DECLARE
  v_firmada timestamptz;
BEGIN
  SELECT a.firmada_el INTO v_firmada
    FROM acta_item i JOIN acta a ON a.id = i.acta_id
   WHERE i.id = coalesce(NEW.acta_item_id, OLD.acta_item_id);

  IF v_firmada IS NOT NULL THEN
    RAISE EXCEPTION 'El acta ya está firmada y no se puede modificar.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acta_item_no_se_toca
  BEFORE INSERT OR UPDATE OR DELETE ON acta_item
  FOR EACH ROW EXECUTE FUNCTION app_acta_item_inmutable();

CREATE TRIGGER acta_foto_no_se_toca
  BEFORE INSERT OR UPDATE OR DELETE ON acta_foto
  FOR EACH ROW EXECUTE FUNCTION app_acta_foto_inmutable();
