-- 003 — Identidad: usuarios, membresías, sesiones, invitaciones y auditoría.
--
-- El problema central de esta migración: login y signup ocurren SIN contexto de
-- tenant. Todavía no se sabe qué inmobiliaria es — eso justamente es lo que se
-- está por resolver. Así que esas rutas no pueden depender de RLS: van por
-- funciones SECURITY DEFINER acotadas, que son la única superficie por la que se
-- toca `usuario` y `sesion` sin contexto.

CREATE EXTENSION IF NOT EXISTS citext;

-- ─────────────────────────────────────────────────────────────────────────────
-- usuario — GLOBAL, sin tenant_id.
-- Una persona puede trabajar en dos inmobiliarias con el mismo mail.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE usuario (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  nombre        text NOT NULL CHECK (length(trim(nombre)) > 0),
  estado        text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER usuario_touch BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON usuario TO app_role;
-- La policy de `usuario` se crea más abajo: referencia `membresia`, y Postgres
-- valida la expresión al crear la policy, no al usarla.

-- ─────────────────────────────────────────────────────────────────────────────
-- membresia — la relación usuario ↔ inmobiliaria, con su rol.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE membresia (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  rol        text NOT NULL CHECK (rol IN ('owner', 'admin', 'agente', 'contable')),
  estado     text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'suspendida')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, usuario_id)
);

CREATE INDEX ix_membresia_usuario ON membresia (usuario_id);

CREATE TRIGGER membresia_touch BEFORE UPDATE ON membresia
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE membresia ENABLE ROW LEVEL SECURITY;

CREATE POLICY membresia_aislamiento ON membresia
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON membresia TO app_role;

-- Ahora sí: con contexto de tenant sólo se ven los usuarios de ese tenant, y sin
-- contexto no se ve ninguno. El login NO pasa por acá — pasa por
-- app_usuario_por_email(), que es SECURITY DEFINER, porque en ese momento
-- todavía no se sabe de qué inmobiliaria se trata.
CREATE POLICY usuario_del_tenant ON usuario
  USING (EXISTS (
    SELECT 1 FROM membresia m
    WHERE m.usuario_id = usuario.id
      AND m.tenant_id = app_current_tenant()
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- sesion — refresh tokens con rotación y detección de reuso.
--
-- `familia` encadena la línea de refrescos de un mismo login. Cuando un token se
-- usa, se marca y se emite otro en la misma familia. Si alguna vez vuelve a
-- aparecer un token YA USADO, es que alguien tiene una copia: se revocan todas
-- las sesiones del usuario, no sólo esa familia.
--
-- Sin GRANT para app_role: esta tabla se toca EXCLUSIVAMENTE por las funciones
-- SECURITY DEFINER de más abajo. El refresh llega sin contexto de tenant, así que
-- ninguna policy podría resolverlo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sesion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  familia         uuid NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  emitido_el      timestamptz NOT NULL DEFAULT now(),
  expira_el       timestamptz NOT NULL,
  usado_el        timestamptz,
  revocado_el     timestamptz,
  revocado_motivo text,
  ip              inet,
  user_agent      text
);

CREATE INDEX ix_sesion_usuario ON sesion (usuario_id);
CREATE INDEX ix_sesion_familia ON sesion (familia);

ALTER TABLE sesion ENABLE ROW LEVEL SECURITY;
-- Sin policies y sin grants: nadie llega por SQL directo.

-- ─────────────────────────────────────────────────────────────────────────────
-- invitacion — alta de usuarios dentro de una inmobiliaria.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE invitacion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  rol          text NOT NULL CHECK (rol IN ('owner', 'admin', 'agente', 'contable')),
  token_hash   text NOT NULL UNIQUE,
  invitado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  expira_el    timestamptz NOT NULL,
  aceptada_el  timestamptz,
  cancelada_el timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Una invitación pendiente por mail y por inmobiliaria.
CREATE UNIQUE INDEX ix_invitacion_pendiente ON invitacion (tenant_id, email)
  WHERE aceptada_el IS NULL AND cancelada_el IS NULL;

CREATE TRIGGER invitacion_touch BEFORE UPDATE ON invitacion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE invitacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitacion_aislamiento ON invitacion
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON invitacion TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- auditoria — append-only.
--
-- app_role tiene INSERT y SELECT, pero NO UPDATE ni DELETE: un registro de
-- auditoría que se puede editar no es auditoría. Se registran también las
-- DENEGACIONES, que son las que interesan cuando algo salió mal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE auditoria (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid REFERENCES tenant(id) ON DELETE SET NULL,
  usuario_id   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  accion       text NOT NULL,
  entidad_tipo text,
  entidad_id   text,
  resultado    text NOT NULL CHECK (resultado IN ('permitido', 'denegado')),
  ip           inet,
  user_agent   text,
  detalle      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_auditoria_tenant_fecha ON auditoria (tenant_id, created_at DESC);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- Lectura acotada al tenant. Los eventos sin tenant (login fallido de un mail
-- que no existe) no los ve nadie por esta vía: se consultan como owner.
CREATE POLICY auditoria_lectura ON auditoria
  FOR SELECT USING (tenant_id = app_current_tenant());

GRANT SELECT ON auditoria TO app_role;
-- Sin INSERT directo: se escribe por app_auditar(), que funciona con o sin
-- contexto de tenant. Si el logging dependiera del contexto, los eventos más
-- importantes —los que ocurren antes de tener contexto— no se registrarían.
