-- 008 — Cierre de ventas y comisiones.
--
-- La venta TERMINA: reserva → boleto → escritura → comisión → fin. Por eso vive
-- aparte del alquiler, que empieza donde la venta se acaba.

CREATE TABLE operacion_venta (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  operacion_id   uuid NOT NULL REFERENCES operacion(id) ON DELETE RESTRICT,
  comprador_id   uuid REFERENCES persona(id) ON DELETE SET NULL,

  precio_cierre  numeric(14, 2) NOT NULL CHECK (precio_cierre > 0),
  moneda         text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('ARS', 'USD')),

  fecha_reserva    date,
  fecha_boleto     date,
  fecha_escritura  date,
  escribania       text,

  estado         text NOT NULL DEFAULT 'en_curso' CHECK (estado IN (
                   'en_curso', 'boleto', 'escriturada', 'caida')),
  motivo_caida   text,
  notas          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Una sola venta viva por operación. Si se cae, se puede empezar otra.
CREATE UNIQUE INDEX ix_venta_viva ON operacion_venta (operacion_id)
  WHERE estado <> 'caida';

CREATE INDEX ix_venta_tenant ON operacion_venta (tenant_id, estado);

CREATE TRIGGER venta_touch BEFORE UPDATE ON operacion_venta
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE operacion_venta ENABLE ROW LEVEL SECURITY;
CREATE POLICY venta_aislamiento ON operacion_venta
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON operacion_venta TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- comision
--
-- Hay TRES repartos encadenados y confundirlos es lo que hace que estas cuentas
-- den mal:
--
--   nivel 1 — cuánto cobra la operación: honorarios a cada punta
--   nivel 2 — cómo se reparte entre inmobiliarias cuando hay una de cada lado
--   nivel 3 — cómo se reparte puertas adentro: captador, cerrador y la casa
--
-- Cada fila es UNA porción de un nivel. `nivel` dice cuál, y `padre_id`
-- encadena: una comisión de nivel 3 apunta a la de nivel 2 de la que sale.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE comision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  -- Una comisión cuelga de una venta O de un contrato de alquiler.
  venta_id       uuid REFERENCES operacion_venta(id) ON DELETE CASCADE,
  contrato_id    uuid REFERENCES contrato_alquiler(id) ON DELETE CASCADE,
  padre_id       uuid REFERENCES comision(id) ON DELETE CASCADE,

  nivel          smallint NOT NULL CHECK (nivel IN (1, 2, 3)),
  punta          text CHECK (punta IN (
                   'compradora', 'vendedora', 'locataria', 'locadora')),

  base_monto     numeric(14, 2) NOT NULL CHECK (base_monto >= 0),
  moneda         text NOT NULL,
  porcentaje     numeric(7, 4) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
  monto          numeric(14, 2) NOT NULL CHECK (monto >= 0),

  beneficiario_tipo text NOT NULL CHECK (beneficiario_tipo IN (
                      'operacion', 'casa', 'agente', 'inmobiliaria_externa')),
  beneficiario_id   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  beneficiario_nombre text,

  concepto       text NOT NULL,
  estado         text NOT NULL DEFAULT 'proyectada' CHECK (estado IN (
                   'proyectada', 'devengada', 'cobrada', 'anulada')),
  cobrada_el     date,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Cuelga de una venta o de un contrato, no de las dos ni de ninguna.
  CHECK ((venta_id IS NULL) <> (contrato_id IS NULL)),
  -- Un agente como beneficiario tiene que tener id; una externa, nombre.
  CHECK (beneficiario_tipo <> 'agente' OR beneficiario_id IS NOT NULL),
  CHECK (beneficiario_tipo <> 'inmobiliaria_externa' OR beneficiario_nombre IS NOT NULL)
);

CREATE INDEX ix_comision_venta ON comision (venta_id);
CREATE INDEX ix_comision_contrato ON comision (contrato_id);
CREATE INDEX ix_comision_agente ON comision (tenant_id, beneficiario_id, estado)
  WHERE beneficiario_tipo = 'agente';

CREATE TRIGGER comision_touch BEFORE UPDATE ON comision
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE comision ENABLE ROW LEVEL SECURITY;
CREATE POLICY comision_aislamiento ON comision
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON comision TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- plantilla_doc — pre-contratos y avisos con variables.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE plantilla_doc (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN (
               'pre_contrato_alquiler', 'pre_contrato_venta', 'reserva',
               'aviso_aumento', 'aviso_vencimiento', 'recibo', 'liquidacion', 'otro')),
  nombre     text NOT NULL,
  contenido  text NOT NULL,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_plantilla_tipo ON plantilla_doc (tenant_id, tipo) WHERE activa;

CREATE TRIGGER plantilla_touch BEFORE UPDATE ON plantilla_doc
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE plantilla_doc ENABLE ROW LEVEL SECURITY;
CREATE POLICY plantilla_aislamiento ON plantilla_doc
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON plantilla_doc TO app_role;

-- Configuración de comisiones por inmobiliaria. Los porcentajes por defecto
-- varían por provincia y por tipo de operación, así que NO van hardcodeados.
ALTER TABLE tenant ADD COLUMN comisiones jsonb NOT NULL DEFAULT
  '{"venta": {"compradora": 3, "vendedora": 3},
    "alquiler": {"locataria": 0, "locadora": 0},
    "repartoInterno": {"captador": 25, "cerrador": 25}}'::jsonb;
