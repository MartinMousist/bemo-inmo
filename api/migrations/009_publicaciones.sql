-- 009 — Publicaciones a portales.
--
-- El orden importa: PRIMERO el generador de aviso y el feed XML, que no
-- dependen de nadie, y DESPUÉS la integración con cada portal, que depende de
-- un convenio comercial que puede tardar meses. Nunca al revés: atar el roadmap
-- a una firma ajena es entregarle el control a otro.

CREATE TABLE publicacion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  operacion_id  uuid NOT NULL REFERENCES operacion(id) ON DELETE CASCADE,
  portal        text NOT NULL CHECK (portal IN (
                  'zonaprop', 'argenprop', 'mercadolibre', 'properati',
                  'inmoup', 'web_propia', 'otro')),

  estado        text NOT NULL DEFAULT 'borrador' CHECK (estado IN (
                  'borrador', 'lista', 'publicada', 'pausada', 'error', 'baja')),
  -- 'lista' = el aviso está armado y esperando que alguien lo pegue o que la
  -- integración lo levante. Es el estado normal mientras no haya convenio.

  external_id   text,
  url_publica   text,
  ultimo_sync   timestamptz,
  ultimo_error  text,

  -- El aviso congelado tal como se generó: título, descripción y atributos.
  -- Se guarda para poder comparar contra lo que quedó publicado.
  aviso         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (operacion_id, portal)
);

CREATE INDEX ix_publicacion_tenant ON publicacion (tenant_id, estado);

CREATE TRIGGER publicacion_touch BEFORE UPDATE ON publicacion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE publicacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY publicacion_aislamiento ON publicacion
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON publicacion TO app_role;

-- Token del feed XML público por inmobiliaria.
--
-- El feed tiene que ser accesible SIN sesión —un portal lo consume por HTTP— y
-- a la vez no puede ser adivinable, porque expone la cartera entera. Un token
-- aleatorio por tenant resuelve las dos cosas; rotarlo invalida el anterior.
ALTER TABLE tenant ADD COLUMN feed_token text;

CREATE UNIQUE INDEX ix_tenant_feed_token ON tenant (feed_token)
  WHERE feed_token IS NOT NULL;

/**
 * Devuelve el tenant dueño de un token de feed. SECURITY DEFINER porque el feed
 * se sirve sin sesión y por lo tanto sin contexto de tenant: es el mismo patrón
 * que el login.
 */
CREATE OR REPLACE FUNCTION app_tenant_por_feed_token(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id FROM tenant
   WHERE feed_token = p_token AND estado = 'activo';
$$;

REVOKE EXECUTE ON FUNCTION app_tenant_por_feed_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_por_feed_token(text) TO app_role;
