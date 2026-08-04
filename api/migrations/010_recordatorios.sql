-- 010 — Recordatorios y eventos programados.
--
-- Es lo que convierte al sistema en algo que trabaja solo: en vez de que
-- alguien mire una lista todos los días, el sistema avisa.

CREATE TABLE evento_programado (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  tipo          text NOT NULL CHECK (tipo IN (
                  'contrato_por_vencer', 'ajuste_por_aplicar', 'cuota_impaga',
                  'reserva_por_vencer', 'visita_agendada', 'garantia_por_vencer')),

  entidad_tipo  text NOT NULL,
  entidad_id    uuid NOT NULL,

  dispara_el    date NOT NULL,
  canal         text NOT NULL DEFAULT 'app' CHECK (canal IN ('app', 'email', 'whatsapp')),
  destinatario_persona_id uuid REFERENCES persona(id) ON DELETE SET NULL,
  destinatario_usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL,

  titulo        text NOT NULL,
  detalle       text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                  'pendiente', 'enviado', 'fallido', 'cancelado', 'visto')),
  intentos      smallint NOT NULL DEFAULT 0,
  ultimo_error  text,
  enviado_el    timestamptz,
  visto_el      timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Un evento por (tipo, entidad, fecha). Es lo que hace que el generador sea
  -- idempotente: correrlo dos veces el mismo día no duplica avisos.
  UNIQUE (tipo, entidad_id, dispara_el, canal)
);

CREATE INDEX ix_evento_pendiente ON evento_programado (tenant_id, dispara_el)
  WHERE estado = 'pendiente';
CREATE INDEX ix_evento_bandeja ON evento_programado (tenant_id, estado, dispara_el DESC);

CREATE TRIGGER evento_touch BEFORE UPDATE ON evento_programado
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE evento_programado ENABLE ROW LEVEL SECURITY;
CREATE POLICY evento_aislamiento ON evento_programado
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON evento_programado TO app_role;

-- A cuántos días antes avisar, por tipo de evento. Configurable por
-- inmobiliaria: 90/60/30 sirve para un contrato pero no para una cuota.
ALTER TABLE tenant ADD COLUMN avisos jsonb NOT NULL DEFAULT
  '{"contrato_por_vencer": [90, 60, 30],
    "ajuste_por_aplicar": [30, 15],
    "reserva_por_vencer": [7, 3],
    "garantia_por_vencer": [30],
    "cuota_impaga": [0, 5, 15]}'::jsonb;
