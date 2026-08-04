-- 011 — Planes, límites y sucursales.
--
-- La regla que hace que esto sirva: **los límites se aplican, no se muestran**.
-- Un plan que sólo existe en la pantalla de precios no es un plan, es un cartel.

CREATE TABLE plan (
  codigo          text PRIMARY KEY CHECK (codigo IN ('inicial', 'medio', 'pro', 'medida')),
  nombre          text NOT NULL,
  orden           smallint NOT NULL,
  max_usuarios    integer,      -- NULL = sin límite
  max_propiedades integer,
  max_portales    integer,
  modulos         text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Los límites y módulos salen de docs/spec.md §8. Están en la base y no
-- hardcodeados para poder cambiarlos sin desplegar.
INSERT INTO plan (codigo, nombre, orden, max_usuarios, max_propiedades, max_portales, modulos) VALUES
  ('inicial', 'Inicial', 1,    3,  100, 1,
     ARRAY['propiedades','personas','oportunidades','contratos','ajustes']),
  ('medio',   'Medio',   2,   10,  500, 3,
     ARRAY['propiedades','personas','oportunidades','contratos','ajustes',
           'cobranzas','liquidaciones','plantillas','comisiones','recordatorios']),
  ('pro',     'Pro',     3, NULL, NULL, NULL,
     ARRAY['propiedades','personas','oportunidades','contratos','ajustes',
           'cobranzas','liquidaciones','plantillas','comisiones','recordatorios',
           'multisucursal','campanias','api']),
  ('medida',  'A medida',4, NULL, NULL, NULL,
     ARRAY['propiedades','personas','oportunidades','contratos','ajustes',
           'cobranzas','liquidaciones','plantillas','comisiones','recordatorios',
           'multisucursal','campanias','api','marca_blanca']);

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_lectura ON plan FOR SELECT USING (true);
GRANT SELECT ON plan TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- suscripcion
--
-- ⚠️ NO hay integración de cobro todavía. `estado` refleja la realidad y no la
-- simula: 'prueba' mientras nadie pagó nada. No se registran pagos que no
-- ocurrieron ni se muestran tarjetas que no existen.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE suscripcion (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  plan_codigo   text NOT NULL REFERENCES plan(codigo),
  estado        text NOT NULL DEFAULT 'prueba' CHECK (estado IN (
                  'prueba', 'activa', 'morosa', 'cancelada')),
  prueba_hasta  date,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER suscripcion_touch BEFORE UPDATE ON suscripcion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE suscripcion ENABLE ROW LEVEL SECURITY;
CREATE POLICY suscripcion_aislamiento ON suscripcion
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, UPDATE ON suscripcion TO app_role;

-- Toda inmobiliaria existente arranca en el plan medio, en prueba.
INSERT INTO suscripcion (tenant_id, plan_codigo, prueba_hasta)
SELECT id, 'medio', current_date + 30 FROM tenant
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- sucursal — sólo con el módulo multisucursal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sucursal (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  direccion  text,
  telefono   text,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre)
);

CREATE TRIGGER sucursal_touch BEFORE UPDATE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE sucursal ENABLE ROW LEVEL SECURITY;
CREATE POLICY sucursal_aislamiento ON sucursal
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON sucursal TO app_role;

ALTER TABLE propiedad ADD COLUMN sucursal_id uuid REFERENCES sucursal(id) ON DELETE SET NULL;
ALTER TABLE membresia ADD COLUMN sucursal_id uuid REFERENCES sucursal(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- api_key — la API pública, sólo en Pro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE api_key (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  -- Se guarda el HASH, igual que los refresh tokens: un dump robado no da
  -- claves utilizables.
  clave_hash  text NOT NULL UNIQUE,
  prefijo     text NOT NULL,     -- para reconocerla en la UI sin revelarla
  creada_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  ultimo_uso  timestamptz,
  revocada_el timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_apikey_tenant ON api_key (tenant_id) WHERE revocada_el IS NULL;

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
CREATE POLICY apikey_aislamiento ON api_key
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON api_key TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Los límites, en la BASE.
--
-- Un límite que sólo vive en el código de la aplicación se saltea con un
-- request bien armado. Acá se aplica en el mismo lugar donde se escribe el dato.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_limite_plan(p_recurso text)
RETURNS TABLE (permitido boolean, usado integer, maximo integer, plan text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_plan   plan%ROWTYPE;
  v_usado  integer;
  v_max    integer;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, NULL::text;
    RETURN;
  END IF;

  SELECT p.* INTO v_plan
    FROM suscripcion s JOIN plan p ON p.codigo = s.plan_codigo
   WHERE s.tenant_id = v_tenant;

  IF NOT FOUND THEN
    -- Sin suscripción no se bloquea nada: es un problema de datos nuestro, no
    -- del usuario, y no puede impedirle trabajar.
    RETURN QUERY SELECT true, 0, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF p_recurso = 'usuarios' THEN
    SELECT count(*)::int INTO v_usado FROM membresia
      WHERE tenant_id = v_tenant AND estado = 'activa';
    v_max := v_plan.max_usuarios;
  ELSIF p_recurso = 'propiedades' THEN
    SELECT count(*)::int INTO v_usado FROM propiedad WHERE tenant_id = v_tenant;
    v_max := v_plan.max_propiedades;
  ELSE
    RETURN QUERY SELECT true, 0, NULL::integer, v_plan.codigo;
    RETURN;
  END IF;

  RETURN QUERY SELECT (v_max IS NULL OR v_usado < v_max), v_usado, v_max, v_plan.codigo;
END;
$$;

GRANT EXECUTE ON FUNCTION app_limite_plan(text) TO app_role;

/** ¿El plan del tenant incluye este módulo? */
CREATE OR REPLACE FUNCTION app_tiene_modulo(p_modulo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT p_modulo = ANY(p.modulos)
       FROM suscripcion s JOIN plan p ON p.codigo = s.plan_codigo
      WHERE s.tenant_id = app_current_tenant()),
    true);   -- sin suscripción, no se bloquea
$$;

GRANT EXECUTE ON FUNCTION app_tiene_modulo(text) TO app_role;

-- El tope de propiedades se aplica en un trigger, no sólo en el servicio: así
-- no hay forma de saltearlo desde ningún camino de código.
CREATE OR REPLACE FUNCTION app_exigir_limite_propiedades() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM app_limite_plan('propiedades');
  IF NOT l.permitido THEN
    RAISE EXCEPTION
      'Llegaste al tope de % propiedades del plan %. Pasá a un plan superior para cargar más.',
      l.maximo, l.plan
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER propiedad_limite_plan
  BEFORE INSERT ON propiedad
  FOR EACH ROW EXECUTE FUNCTION app_exigir_limite_propiedades();
