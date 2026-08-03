-- 002 — La inmobiliaria (tenant) y su aislamiento por RLS.
--
-- Es la única tabla de la etapa 1 a propósito. `usuario`, `membresia` y `sesion`
-- llegan en la etapa 2, junto con el código de auth que las lee. Crear una tabla
-- que ningún código usa es el error #3 del playbook: la feature no existe en la
-- práctica y nadie se entera hasta meses después.

CREATE TABLE tenant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL CHECK (length(trim(nombre)) > 0),
  cuit            text,
  provincia       text,
  moneda_default  text NOT NULL DEFAULT 'ARS' CHECK (moneda_default IN ('ARS', 'USD')),
  zona_horaria    text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado          text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tenant_touch
  BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_aislamiento ON tenant
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

GRANT SELECT, UPDATE ON tenant TO app_role;
-- Sin INSERT ni DELETE: crear o borrar una inmobiliaria no es una operación que
-- la app haga con el rol de request. El signup va por función SECURITY DEFINER
-- en la etapa 2, que es la que corre sin contexto de tenant.
