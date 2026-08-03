-- 006 — La espina compartida: personas, propiedades, operaciones, oportunidades.
--
-- Es el ~70% del sistema que sirve igual para venta y para alquiler. Todo lo
-- previo al cierre es el mismo circuito; recién después divergen (la venta
-- termina, el alquiler empieza).
--
-- CAMBIO RESPECTO DEL SPEC: no existe la tabla `persona_rol`. El spec la
-- planteaba polimórfica (entidad_tipo + entidad_id), y una FK polimórfica no se
-- puede hacer cumplir: nada impide apuntar a una fila que no existe. Los roles
-- de una persona se DERIVAN de las relaciones reales — titular de una propiedad,
-- interesado en una oportunidad, y más adelante locatario de un contrato o
-- comprador de una venta. Un dato derivado no se desincroniza.

-- Correlativo de propiedades por inmobiliaria: "PROP-0001" y no un uuid en la
-- ficha. Vive en tenant y se incrementa con UPDATE ... RETURNING, que es atómico.
ALTER TABLE tenant ADD COLUMN prox_codigo_propiedad integer NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- persona — física o jurídica. Una sola por documento y por inmobiliaria.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE persona (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tipo        text NOT NULL DEFAULT 'fisica' CHECK (tipo IN ('fisica', 'juridica')),
  nombre      text NOT NULL CHECK (length(trim(nombre)) > 0),
  apellido    text,
  doc_tipo    text CHECK (doc_tipo IN ('dni', 'cuit', 'cuil', 'pasaporte', 'le', 'lc')),
  doc_numero  text,
  email       citext,
  telefono    text,
  domicilio   text,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Parcial: muchas personas se cargan sin documento (un interesado que llamó por
-- teléfono). El índice no puede impedir que haya varias sin documento.
CREATE UNIQUE INDEX ix_persona_documento ON persona (tenant_id, doc_tipo, doc_numero)
  WHERE doc_numero IS NOT NULL;

-- Búsqueda por nombre sin acentos ni mayúsculas.
CREATE INDEX ix_persona_busqueda ON persona
  USING gin (to_tsvector('simple', coalesce(nombre, '') || ' ' || coalesce(apellido, '')));

CREATE TRIGGER persona_touch BEFORE UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE persona ENABLE ROW LEVEL SECURITY;
CREATE POLICY persona_aislamiento ON persona
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON persona TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- propiedad
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE propiedad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo        integer NOT NULL,

  calle         text NOT NULL,
  numero        text,
  piso          text,
  depto         text,
  localidad     text,
  provincia     text,
  cp            text,

  -- Se geocodifica UNA vez al guardar y se persiste. Google Maps se cobra por
  -- carga: resolver la dirección en cada render sería pagar lo mismo mil veces.
  lat            numeric(10, 7),
  lng            numeric(10, 7),
  geocode_fuente text,
  geocode_el     timestamptz,

  tipo          text NOT NULL CHECK (tipo IN (
                  'departamento', 'casa', 'ph', 'local', 'oficina',
                  'galpon', 'terreno', 'cochera', 'campo')),
  sup_total     numeric(10, 2),
  sup_cubierta  numeric(10, 2),
  ambientes     smallint,
  dormitorios   smallint,
  banos         smallint,
  cocheras      smallint,
  antiguedad    smallint,
  orientacion   text,
  estado_conservacion text,
  amenities     text[] NOT NULL DEFAULT '{}',

  descripcion    text,
  notas_internas text,
  agente_captador_id uuid REFERENCES usuario(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, codigo)
);

CREATE INDEX ix_propiedad_tenant ON propiedad (tenant_id, created_at DESC);

CREATE TRIGGER propiedad_touch BEFORE UPDATE ON propiedad
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE propiedad ENABLE ROW LEVEL SECURITY;
CREATE POLICY propiedad_aislamiento ON propiedad
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON propiedad TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- titularidad — condominio. Dos hermanos al 50% es lo normal, no la excepción.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE titularidad (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id uuid NOT NULL REFERENCES propiedad(id) ON DELETE CASCADE,
  persona_id   uuid NOT NULL REFERENCES persona(id) ON DELETE RESTRICT,
  porcentaje   numeric(5, 2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (propiedad_id, persona_id)
);

CREATE INDEX ix_titularidad_persona ON titularidad (persona_id);

ALTER TABLE titularidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY titularidad_aislamiento ON titularidad
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON titularidad TO app_role;

-- La suma tiene que dar 100. Se valida con un trigger DEFERRABLE al final de la
-- transacción: durante un reemplazo de titulares la suma pasa por estados
-- intermedios inválidos, y un CHECK por fila lo haría imposible.
CREATE OR REPLACE FUNCTION app_validar_titularidad() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_propiedad uuid := coalesce(NEW.propiedad_id, OLD.propiedad_id);
  v_suma numeric(6, 2);
  v_existe boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM propiedad WHERE id = v_propiedad) INTO v_existe;
  IF NOT v_existe THEN
    RETURN NULL;  -- la propiedad se borró; el CASCADE ya limpió las filas
  END IF;

  SELECT coalesce(sum(porcentaje), 0) INTO v_suma
    FROM titularidad WHERE propiedad_id = v_propiedad;

  -- Cero es válido: una propiedad puede cargarse antes de saber quién es dueño.
  IF v_suma <> 0 AND v_suma <> 100 THEN
    RAISE EXCEPTION 'La titularidad suma %%%, tiene que sumar 100%%', v_suma
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER titularidad_suma_100
  AFTER INSERT OR UPDATE OR DELETE ON titularidad
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_validar_titularidad();

-- ─────────────────────────────────────────────────────────────────────────────
-- operacion — una propiedad puede estar en venta Y en alquiler a la vez, con
-- precios y estados independientes. Modelar esto como un campo `tipo_operacion`
-- en propiedad es el error clásico: obliga a cargar la propiedad dos veces.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE operacion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id   uuid NOT NULL REFERENCES propiedad(id) ON DELETE CASCADE,
  tipo           text NOT NULL CHECK (tipo IN ('venta', 'alquiler', 'alquiler_temporario')),

  precio         numeric(14, 2) CHECK (precio IS NULL OR precio >= 0),
  moneda         text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  expensas       numeric(14, 2),
  expensas_moneda text NOT NULL DEFAULT 'ARS' CHECK (expensas_moneda IN ('ARS', 'USD')),

  estado         text NOT NULL DEFAULT 'borrador' CHECK (estado IN (
                   'borrador', 'disponible', 'reservada', 'cerrada', 'suspendida')),
  fecha_publicacion date,
  exclusividad_hasta date,
  comision_config jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Una sola operación viva por tipo y propiedad. Cerradas puede haber muchas
-- (la misma propiedad se alquila una y otra vez a lo largo de los años).
CREATE UNIQUE INDEX ix_operacion_viva ON operacion (propiedad_id, tipo)
  WHERE estado <> 'cerrada';

CREATE INDEX ix_operacion_tenant ON operacion (tenant_id, estado, tipo);

CREATE TRIGGER operacion_touch BEFORE UPDATE ON operacion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE operacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY operacion_aislamiento ON operacion
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON operacion TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- propiedad_foto
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE propiedad_foto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id uuid NOT NULL REFERENCES propiedad(id) ON DELETE CASCADE,
  url          text NOT NULL,
  orden        smallint NOT NULL DEFAULT 0,
  es_portada   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ix_foto_portada ON propiedad_foto (propiedad_id)
  WHERE es_portada;
CREATE INDEX ix_foto_propiedad ON propiedad_foto (propiedad_id, orden);

ALTER TABLE propiedad_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY foto_aislamiento ON propiedad_foto
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON propiedad_foto TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- oportunidad — el lead. `operacion_id` es nullable a propósito: alguien puede
-- estar buscando "dos ambientes en Godoy Cruz" sin una propiedad concreta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE oportunidad (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  persona_id     uuid NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  operacion_id   uuid REFERENCES operacion(id) ON DELETE SET NULL,
  agente_id      uuid REFERENCES usuario(id) ON DELETE SET NULL,

  origen         text NOT NULL DEFAULT 'otro' CHECK (origen IN (
                   'portal', 'web', 'whatsapp', 'telefono', 'referido',
                   'cartel', 'redes', 'otro')),
  portal_origen  text,
  estado         text NOT NULL DEFAULT 'nueva' CHECK (estado IN (
                   'nueva', 'contactada', 'calificada', 'visita',
                   'negociacion', 'ganada', 'perdida')),
  motivo_perdida text,

  interes        text CHECK (interes IN ('venta', 'alquiler')),
  presupuesto_min numeric(14, 2),
  presupuesto_max numeric(14, 2),
  moneda         text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  notas          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_oportunidad_tenant ON oportunidad (tenant_id, estado, created_at DESC);
CREATE INDEX ix_oportunidad_agente ON oportunidad (agente_id);

CREATE TRIGGER oportunidad_touch BEFORE UPDATE ON oportunidad
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE oportunidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY oportunidad_aislamiento ON oportunidad
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON oportunidad TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- visita
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE visita (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  oportunidad_id uuid NOT NULL REFERENCES oportunidad(id) ON DELETE CASCADE,
  operacion_id   uuid REFERENCES operacion(id) ON DELETE SET NULL,
  agente_id      uuid REFERENCES usuario(id) ON DELETE SET NULL,
  fecha_hora     timestamptz NOT NULL,
  estado         text NOT NULL DEFAULT 'agendada' CHECK (estado IN (
                   'agendada', 'realizada', 'cancelada', 'ausente')),
  feedback       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_visita_fecha ON visita (tenant_id, fecha_hora);

CREATE TRIGGER visita_touch BEFORE UPDATE ON visita
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE visita ENABLE ROW LEVEL SECURITY;
CREATE POLICY visita_aislamiento ON visita
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON visita TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- reserva — la seña. Una sola activa por operación, garantizado por índice
-- parcial: dos requests simultáneos no pueden reservar lo mismo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE reserva (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  operacion_id uuid NOT NULL REFERENCES operacion(id) ON DELETE CASCADE,
  persona_id   uuid NOT NULL REFERENCES persona(id) ON DELETE RESTRICT,
  monto        numeric(14, 2) NOT NULL CHECK (monto > 0),
  moneda       text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  fecha        date NOT NULL DEFAULT current_date,
  vence_el     date,
  estado       text NOT NULL DEFAULT 'activa' CHECK (estado IN (
                 'activa', 'convertida', 'caida', 'vencida')),
  notas        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ix_reserva_activa ON reserva (operacion_id) WHERE estado = 'activa';

CREATE TRIGGER reserva_touch BEFORE UPDATE ON reserva
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE reserva ENABLE ROW LEVEL SECURITY;
CREATE POLICY reserva_aislamiento ON reserva
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON reserva TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Correlativo atómico de propiedades.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_proximo_codigo_propiedad() RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v integer;
BEGIN
  -- UPDATE ... RETURNING toma el lock de la fila: dos altas simultáneas en la
  -- misma inmobiliaria se serializan y nunca reciben el mismo número.
  UPDATE tenant
     SET prox_codigo_propiedad = prox_codigo_propiedad + 1
   WHERE id = app_current_tenant()
  RETURNING prox_codigo_propiedad - 1 INTO v;

  IF v IS NULL THEN
    RAISE EXCEPTION 'sin contexto de inmobiliaria' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION app_proximo_codigo_propiedad() TO app_role;
