-- 043 · La Red entre inmobiliarias, y el envío de propiedades a un cliente
--
-- ═══ LA RED ═══
--
-- ── Por qué esto es delicado y no una feature más ──
--
-- Todo el sistema se apoya en que una inmobiliaria NO ve lo de otra. Eso lo
-- sostiene RLS en 57 tablas y la etapa 17 entera. La Red pide exactamente lo
-- contrario: que un asesor de Andes vea una propiedad del Plata.
--
-- La forma barata sería relajar la política de `propiedad`. Sería un error
-- irreversible: una política laxa no se puede volver a apretar sin auditar cada
-- consulta que se escribió mientras tanto.
--
-- ── Cómo se resuelve ──
--
-- RLS **no se toca**. La Red es UNA función `SECURITY DEFINER` que:
--
--   1. Devuelve sólo lo marcado con `red_compartida = true`. El default es
--      `false`: compartir es un acto, no un estado heredado.
--   2. Devuelve una PROYECCIÓN RECORTADA. Nunca `notas_internas`, nunca el
--      titular, nunca el captador. Un colega necesita saber qué es, dónde está
--      y cuánto sale; quién es el dueño no es asunto suyo.
--   3. Excluye la inmobiliaria que consulta: sus propias unidades ya las ve por
--      el camino normal, y mezclarlas haría creer que hay más red de la que hay.
--
-- Si mañana hay que cerrar la Red, se borra la función y no queda ni una
-- política aflojada.
--
-- ── La comisión ──
--
-- `red_comision_pct` es lo que la inmobiliaria dueña OFRECE a quien traiga el
-- comprador. Es una oferta publicada, no un acuerdo: el trato se cierra entre
-- las dos y este número es el punto de partida de esa charla.

BEGIN;

ALTER TABLE propiedad
  ADD COLUMN red_compartida    boolean NOT NULL DEFAULT false,
  ADD COLUMN red_comision_pct  numeric(5,2)
    CHECK (red_comision_pct IS NULL OR (red_comision_pct >= 0 AND red_comision_pct <= 100)),
  ADD COLUMN red_compartida_el timestamptz;

CREATE INDEX ix_propiedad_red ON propiedad (red_compartida) WHERE red_compartida;

/**
 * Buscar en la Red.
 *
 * SECURITY DEFINER: tiene que cruzar el borde del tenant, y es el ÚNICO lugar
 * del sistema que lo hace. Por eso el filtro `red_compartida` va adentro y no
 * lo puede quitar quien la llama.
 *
 * `p_tenant` es quien busca, para excluir lo propio.
 */
CREATE OR REPLACE FUNCTION app_red_buscar(
  p_tenant     uuid,
  p_operacion  text DEFAULT NULL,
  p_tipo       text DEFAULT NULL,
  p_localidad  text DEFAULT NULL,
  p_precio_min numeric DEFAULT NULL,
  p_precio_max numeric DEFAULT NULL,
  p_limite     int DEFAULT 50
)
RETURNS TABLE (
  propiedad_id   uuid,
  codigo         text,
  tipo           text,
  -- La calle sí; el NÚMERO no. Un colega necesita saber la zona para ofrecerla;
  -- la puerta exacta es del dueño y se pasa cuando hay una visita acordada.
  calle          text,
  localidad      text,
  provincia      text,
  ambientes      integer,
  dormitorios    integer,
  banos          integer,
  sup_total      numeric,
  operacion      text,
  precio         numeric,
  moneda         text,
  comision_pct   numeric,
  inmobiliaria   text,
  inmobiliaria_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.id,
         'PROP-' || lpad(p.codigo::text, 4, '0'),
         p.tipo, p.calle, p.localidad, p.provincia,
         p.ambientes, p.dormitorios, p.banos, p.sup_total,
         o.tipo, o.precio, o.moneda,
         p.red_comision_pct,
         t.nombre, t.id
    FROM propiedad p
    JOIN tenant t     ON t.id = p.tenant_id
    JOIN operacion o  ON o.propiedad_id = p.id AND o.estado = 'disponible'
   WHERE p.red_compartida
     -- Lo propio se excluye: ya se ve por el camino normal, y mezclarlo haría
     -- creer que hay más red de la que hay.
     AND p.tenant_id <> p_tenant
     AND (p_operacion  IS NULL OR o.tipo = p_operacion)
     AND (p_tipo       IS NULL OR p.tipo = p_tipo)
     AND (p_localidad  IS NULL OR p.localidad ILIKE '%' || p_localidad || '%')
     AND (p_precio_min IS NULL OR o.precio >= p_precio_min)
     AND (p_precio_max IS NULL OR o.precio <= p_precio_max)
   ORDER BY p.red_comision_pct DESC NULLS LAST, o.precio
   LIMIT least(coalesce(p_limite, 50), 100);
$$;

REVOKE ALL ON FUNCTION app_red_buscar(uuid, text, text, text, numeric, numeric, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_red_buscar(uuid, text, text, text, numeric, numeric, int) TO app_role;

/** Cuántas propiedades hay en la Red. Para no prometer un catálogo vacío. */
CREATE OR REPLACE FUNCTION app_red_total(p_tenant uuid)
RETURNS TABLE (propiedades bigint, inmobiliarias bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*), count(DISTINCT p.tenant_id)
    FROM propiedad p
    JOIN operacion o ON o.propiedad_id = p.id AND o.estado = 'disponible'
   WHERE p.red_compartida AND p.tenant_id <> p_tenant;
$$;
GRANT EXECUTE ON FUNCTION app_red_total(uuid) TO app_role;

-- ═══ EL ENVÍO A UN CLIENTE ═══
--
-- Una selección de propiedades que se le manda a alguien por WhatsApp o mail,
-- con un enlace que NO pide sesión. Es lo que reemplaza mandar seis capturas de
-- pantalla sueltas.
--
-- ── Lo que lo hace útil de verdad ──
--
-- **Se sabe si lo abrió.** Sin eso es un PDF más; con eso el asesor sabe a
-- quién llamar hoy. Es la misma idea del enlace rastreable de los documentos,
-- que este repo ya construyó en la etapa 14.

CREATE TABLE envio_propiedades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  -- Global y único: el enlace llega sin sesión y esto es lo que dice de qué
  -- inmobiliaria es. Mismo criterio que el token de los webhooks.
  token          text NOT NULL UNIQUE,

  persona_id     uuid,
  contacto_nombre text,
  titulo         text,
  mensaje        text,

  -- Vencimiento: un enlace con precios que vive para siempre termina mostrando
  -- valores de hace dos años como si fueran de hoy.
  vence_el       date NOT NULL DEFAULT (current_date + 90),

  abierto_el     timestamptz,
  vistas         integer NOT NULL DEFAULT 0,

  creado_por     uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
    ON DELETE SET NULL (persona_id)
);

CREATE TABLE envio_propiedad_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  envio_id     uuid NOT NULL,
  propiedad_id uuid NOT NULL,
  orden        integer NOT NULL DEFAULT 0,

  UNIQUE (tenant_id, id),
  UNIQUE (envio_id, propiedad_id),
  FOREIGN KEY (tenant_id, envio_id)     REFERENCES envio_propiedades (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_envio_tenant ON envio_propiedades (tenant_id, created_at DESC);
CREATE INDEX ix_envio_item ON envio_propiedad_item (envio_id, orden);

ALTER TABLE envio_propiedades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE envio_propiedad_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY envio_del_tenant ON envio_propiedades
  USING (tenant_id = app_current_tenant());
CREATE POLICY envio_item_del_tenant ON envio_propiedad_item
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON envio_propiedades, envio_propiedad_item TO app_role;

CREATE TRIGGER tg_envio_updated BEFORE UPDATE ON envio_propiedades
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

CREATE CONSTRAINT TRIGGER tg_envio_creado_por_del_tenant
  AFTER INSERT OR UPDATE OF creado_por ON envio_propiedades
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('creado_por');

/**
 * Abrir un envío desde el enlace público.
 *
 * SECURITY DEFINER porque llega SIN contexto de inmobiliaria —de cuál es, es
 * justo lo que viene a averiguar—. Cuenta la visita en la misma llamada: leer y
 * después marcar sería dos viajes y una condición de carrera.
 */
CREATE OR REPLACE FUNCTION app_envio_abrir(p_token text)
RETURNS TABLE (envio_id uuid, tenant_id uuid, titulo text, mensaje text,
               inmobiliaria text, vencido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_vencido boolean;
BEGIN
  SELECT e.id, e.tenant_id, e.vence_el < current_date
    INTO v_id, v_tenant, v_vencido
    FROM envio_propiedades e WHERE e.token = p_token;

  IF v_id IS NULL THEN RETURN; END IF;

  -- La visita se cuenta aunque esté vencido: que alguien intente abrirlo
  -- también es información —el cliente sigue interesado y el enlace caducó—.
  UPDATE envio_propiedades e
     SET vistas = e.vistas + 1,
         abierto_el = coalesce(e.abierto_el, now())
   WHERE e.id = v_id;

  RETURN QUERY
    SELECT e.id, e.tenant_id, e.titulo, e.mensaje, t.nombre, v_vencido
      FROM envio_propiedades e JOIN tenant t ON t.id = e.tenant_id
     WHERE e.id = v_id;
END $$;

GRANT EXECUTE ON FUNCTION app_envio_abrir(text) TO app_role;

COMMIT;
