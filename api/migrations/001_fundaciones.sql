-- 001 — Fundaciones: extensiones, contexto de tenant y permisos base.
-- Corre como el rol OWNER. Ver db/init/01-app-role.sh para los roles.

-- btree_gist habilita constraints EXCLUDE que mezclan igualdad y rangos.
-- Se usa desde la etapa 4 para impedir contratos de alquiler solapados sobre
-- la misma propiedad. Va acá porque crear extensiones requiere privilegios
-- que el rol de app no tiene ni va a tener.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Devuelve el tenant de la transacción en curso, o NULL si no se fijó.
--
-- `current_setting(..., true)` con missing_ok = true devuelve NULL en vez de
-- reventar cuando la variable no existe. Es deliberado: sin contexto de tenant
-- la función da NULL, y `tenant_id = NULL` es NULL, que no es TRUE — así que las
-- policies no dejan pasar NINGUNA fila. El default sin contexto es "no ves nada",
-- no "ves todo". Hay un test que lo prueba.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO app_role;

-- Toca updated_at en cada UPDATE. Se engancha por trigger en cada tabla.
CREATE OR REPLACE FUNCTION app_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
