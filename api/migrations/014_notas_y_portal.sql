-- 014 — Notas de seguimiento y acceso del propietario.
--
-- Dos cosas que hoy viven fuera del sistema:
--
--   · El ida y vuelta con el inquilino, que vive en WhatsApp — que es
--     exactamente de donde este producto viene a sacarlo. Cuando la persona que
--     manejaba ese contrato se va, la conversación se va con ella.
--
--   · El propietario, que llama por teléfono para preguntar si le pagaron. Es
--     el llamado más frecuente que recibe una inmobiliaria, y el dato ya existe.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Notas de seguimiento
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE nota (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  -- Genérica a propósito: la misma nota sirve para un contrato, una propiedad,
  -- una persona o una oportunidad. Una tabla por entidad serían cuatro tablas
  -- iguales y cuatro pantallas iguales.
  --
  -- No hay FK: es polimórfica y una FK polimórfica no se puede hacer cumplir.
  -- Es la misma decisión que se tomó al sacar `persona_rol` en la etapa 3. Lo
  -- que sí se hace cumplir es el tenant, que es lo que protege datos ajenos.
  entidad_tipo text NOT NULL CHECK (entidad_tipo IN (
                 'contrato_alquiler', 'propiedad', 'persona', 'oportunidad')),
  entidad_id   uuid NOT NULL,

  texto        text NOT NULL CHECK (length(btrim(texto)) > 0),

  -- Qué pasó, para poder filtrar "sólo los reclamos" sin leer todo.
  tipo         text NOT NULL DEFAULT 'nota' CHECK (tipo IN (
                 'nota', 'llamado', 'whatsapp', 'email', 'visita', 'reclamo')),

  -- Una nota puede quedar como pendiente: "llamar el lunes". Es lo que la
  -- convierte en seguimiento y no en un cuaderno.
  recordar_el  date,
  resuelta_el  timestamptz,

  autor_id     uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_nota_entidad ON nota (tenant_id, entidad_tipo, entidad_id, created_at DESC);
-- Las pendientes con fecha: es la consulta del inicio.
CREATE INDEX ix_nota_pendiente ON nota (tenant_id, recordar_el)
  WHERE recordar_el IS NOT NULL AND resuelta_el IS NULL;

CREATE TRIGGER nota_touch BEFORE UPDATE ON nota
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE nota ENABLE ROW LEVEL SECURITY;
CREATE POLICY nota_aislamiento ON nota
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON nota TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Acceso del propietario
-- ─────────────────────────────────────────────────────────────────────────────

-- Un enlace de sólo lectura para que el dueño vea sus liquidaciones y el estado
-- de cobranza de su propiedad. Es el llamado más frecuente que recibe una
-- inmobiliaria, y el dato ya existe.
--
-- **No es un usuario.** No tiene contraseña, no entra a la app, no ve nada de
-- otras personas y no puede tocar un solo dato. Darle una membresía a un
-- propietario sería meterlo adentro del sistema para que mire una pantalla.
CREATE TABLE acceso_propietario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  persona_id   uuid NOT NULL REFERENCES persona(id) ON DELETE CASCADE,

  -- Se guarda el HASH, no el token. Si alguien se lleva la base, no se lleva
  -- los enlaces. Mismo criterio que las claves de API de la etapa 9.
  token_hash   text NOT NULL UNIQUE,

  -- Un enlace que no vence es un enlace para siempre, y estos se mandan por
  -- WhatsApp. Se renueva cuando hace falta.
  expira_el    timestamptz NOT NULL,
  revocado_el  timestamptz,
  ultimo_uso   timestamptz,
  usos         integer NOT NULL DEFAULT 0,

  creado_por   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_acceso_persona ON acceso_propietario (tenant_id, persona_id)
  WHERE revocado_el IS NULL;

ALTER TABLE acceso_propietario ENABLE ROW LEVEL SECURITY;
CREATE POLICY acceso_aislamiento ON acceso_propietario
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON acceso_propietario TO app_role;

-- La resolución del token corre SIN contexto de tenant: quien abre el enlace no
-- tiene sesión, así que no hay tenant que fijar todavía. Por eso es SECURITY
-- DEFINER y devuelve el tenant, que es lo que después se usa para fijarlo.
--
-- Sólo resuelve; no devuelve ningún dato de la persona ni de la inmobiliaria.
-- Un token inválido y uno vencido dan lo mismo: nada.
CREATE OR REPLACE FUNCTION app_resolver_acceso_propietario(p_hash text)
RETURNS TABLE (tenant_id uuid, persona_id uuid, acceso_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.tenant_id, a.persona_id, a.id
    FROM acceso_propietario a
   WHERE a.token_hash = p_hash
     AND a.revocado_el IS NULL
     AND a.expira_el > now();
$$;

REVOKE ALL ON FUNCTION app_resolver_acceso_propietario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolver_acceso_propietario(text) TO app_role;

-- Registrar el uso también va por función: la policy de RLS no aplica todavía
-- —no hay tenant fijado en el momento de resolver— y sin esto el contador
-- quedaría siempre en cero.
CREATE OR REPLACE FUNCTION app_marcar_uso_acceso(p_id uuid) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE acceso_propietario
     SET ultimo_uso = now(), usos = usos + 1
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION app_marcar_uso_acceso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_marcar_uso_acceso(uuid) TO app_role;
