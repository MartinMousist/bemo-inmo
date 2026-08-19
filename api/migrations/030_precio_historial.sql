-- 030 — Qué precio tuvo una operación, y desde cuándo.
--
-- Hoy `operacion.precio` guarda el precio ACTUAL y nada más. «¿Bajó dos veces
-- en dos meses?» y «¿hace cuánto que está en el mismo número?» son preguntas
-- que se hacen todo el tiempo al decidir si una propiedad se quemó en el
-- mercado, y no hay con qué contestarlas: el valor anterior se pisa.
--
-- ── Por qué un trigger y no el servicio ──
--
-- El precio se escribe desde varios lugares: la ficha, la edición de la
-- operación, el importador CSV y el seed. Registrar el cambio en el servicio
-- deja afuera a los otros tres, y el día que se agregue un quinto camino nadie
-- se va a acordar. El trigger corta donde se escribe el dato — el mismo
-- criterio con el que el límite del plan vive en la base y no en el código.
--
-- ── Lo que NO guarda, y por qué ──
--
-- **No guarda quién lo cambió.** El contexto de sesión de esta base lleva sólo
-- `app.current_tenant_id` (ver `db.service.ts`): un trigger no tiene forma de
-- saber el usuario. Escribir una columna `cambiado_por` que siempre quede en
-- NULL sería peor que no tenerla — parecería un dato que se puede consultar.
-- Si algún día hace falta, se agrega el usuario al contexto de sesión y ahí sí.

CREATE TABLE operacion_precio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  operacion_id  uuid NOT NULL REFERENCES operacion(id) ON DELETE CASCADE,

  -- Nullable igual que `operacion.precio`: una operación puede publicarse sin
  -- precio («consultar»), y ese también es un estado del historial.
  precio        numeric(14, 2),
  moneda        text NOT NULL,

  desde         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_precio_historial ON operacion_precio (operacion_id, desde DESC);

ALTER TABLE operacion_precio ENABLE ROW LEVEL SECURITY;
CREATE POLICY precio_historial_aislamiento ON operacion_precio
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT ON operacion_precio TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- El registro, en el mismo lugar donde se escribe el precio.
--
-- `IS DISTINCT FROM` y no `<>`: con NULL de por medio, `<>` devuelve NULL y el
-- cambio de «sin precio» a «USD 100.000» —que es el más interesante de todos—
-- no se registraría.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_registrar_precio() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.precio IS DISTINCT FROM OLD.precio
     OR NEW.moneda IS DISTINCT FROM OLD.moneda THEN
    INSERT INTO operacion_precio (tenant_id, operacion_id, precio, moneda)
    VALUES (NEW.tenant_id, NEW.id, NEW.precio, NEW.moneda);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER operacion_precio_historial
  AFTER INSERT OR UPDATE OF precio, moneda ON operacion
  FOR EACH ROW EXECUTE FUNCTION app_registrar_precio();

-- Las operaciones que ya existen arrancan su historia con el precio de hoy.
-- Sin esto, una propiedad cargada hace seis meses aparecería «sin historial» y
-- se leería como «nunca cambió de precio», que es una afirmación que no podemos
-- hacer: lo cierto es que antes no se registraba.
INSERT INTO operacion_precio (tenant_id, operacion_id, precio, moneda, desde)
SELECT tenant_id, id, precio, moneda, created_at FROM operacion;
