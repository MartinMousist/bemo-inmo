-- 007 — Alquileres vivos: contratos, índices, ajustes, períodos, cobros y
-- liquidaciones.
--
-- Un contrato de alquiler no es un registro: es un MOTOR. Es la única entidad
-- del sistema que genera eventos hacia adelante en el tiempo sin que nadie la
-- toque. Todo lo de este archivo existe para que eso sea confiable.

-- ─────────────────────────────────────────────────────────────────────────────
-- indice_valor — IPC, ICL, UVA, ICP.
--
-- GLOBAL, sin tenant_id: el IPC de octubre es el mismo para todas las
-- inmobiliarias. Meterle tenant_id sería guardar el mismo número N veces y
-- permitir que dos inmobiliarias tengan "su" IPC distinto, que es justo lo que
-- no puede pasar cuando el número va en un aviso de aumento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE indice_valor (
  tipo         text NOT NULL CHECK (tipo IN ('ipc', 'icl', 'uva', 'icp')),
  periodo      date NOT NULL,              -- siempre el día 1 del mes
  valor        numeric(18, 6) NOT NULL CHECK (valor > 0),
  fuente       text NOT NULL,
  publicado_el date,
  cargado_el   timestamptz NOT NULL DEFAULT now(),
  cargado_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  PRIMARY KEY (tipo, periodo)
);

CREATE INDEX ix_indice_tipo_periodo ON indice_valor (tipo, periodo DESC);

ALTER TABLE indice_valor ENABLE ROW LEVEL SECURITY;

-- Lectura para todos: es dato público.
CREATE POLICY indice_lectura ON indice_valor FOR SELECT USING (true);
GRANT SELECT ON indice_valor TO app_role;
-- Sin INSERT ni UPDATE directos: se carga por app_indice_cargar(), que no
-- permite pisar un valor ya cargado. Ver el comentario de esa función.

-- ─────────────────────────────────────────────────────────────────────────────
-- contrato_alquiler
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contrato_alquiler (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id   uuid NOT NULL REFERENCES propiedad(id) ON DELETE RESTRICT,
  operacion_id   uuid REFERENCES operacion(id) ON DELETE SET NULL,

  fecha_inicio   date NOT NULL,
  fecha_fin      date NOT NULL,
  dia_vencimiento smallint NOT NULL DEFAULT 10
                 CHECK (dia_vencimiento BETWEEN 1 AND 28),

  monto_inicial  numeric(14, 2) NOT NULL CHECK (monto_inicial > 0),
  moneda         text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),

  -- Desde el DNU 70/2023 los contratos son de forma libre: cada uno con su
  -- índice y su periodicidad. Por eso esto va POR CONTRATO y no como una
  -- configuración de la inmobiliaria.
  indice         text NOT NULL DEFAULT 'ipc' CHECK (indice IN (
                   'ipc', 'icl', 'uva', 'icp', 'porcentaje_fijo', 'ninguno')),
  indice_porcentaje numeric(6, 3),   -- sólo si indice = porcentaje_fijo
  periodicidad_meses smallint NOT NULL DEFAULT 3
                 CHECK (periodicidad_meses BETWEEN 1 AND 24),
  mes_base       date NOT NULL,      -- desde qué período se mide el índice

  -- Decide si corre el ciclo mensual completo (cuotas, cobros, liquidación) o
  -- si la inmobiliaria sólo intermedió y cobra su comisión una vez.
  administrado   boolean NOT NULL DEFAULT true,

  deposito       numeric(14, 2),
  deposito_moneda text NOT NULL DEFAULT 'ARS' CHECK (deposito_moneda IN ('ARS', 'USD')),
  deposito_devuelto_el date,

  -- % que cobra la inmobiliaria sobre cada alquiler cobrado.
  honorarios_pct numeric(5, 2) NOT NULL DEFAULT 0
                 CHECK (honorarios_pct >= 0 AND honorarios_pct <= 100),
  punitorio_diario_pct numeric(6, 3) NOT NULL DEFAULT 0,

  estado         text NOT NULL DEFAULT 'por_iniciar' CHECK (estado IN (
                   'borrador', 'por_iniciar', 'vigente', 'vencido',
                   'rescindido', 'renovado')),
  contrato_anterior_id uuid REFERENCES contrato_alquiler(id) ON DELETE SET NULL,
  notas          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (fecha_fin > fecha_inicio),
  CHECK (indice <> 'porcentaje_fijo' OR indice_porcentaje IS NOT NULL)
);

CREATE INDEX ix_contrato_tenant ON contrato_alquiler (tenant_id, estado, fecha_fin);
CREATE INDEX ix_contrato_propiedad ON contrato_alquiler (propiedad_id);

CREATE TRIGGER contrato_touch BEFORE UPDATE ON contrato_alquiler
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

-- Una propiedad no puede tener dos contratos vivos solapados. Es un constraint
-- de base y NO un SELECT previo: ningún chequeo de aplicación sobrevive a dos
-- requests simultáneos.
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_sin_solape
  EXCLUDE USING gist (
    propiedad_id WITH =,
    daterange(fecha_inicio, fecha_fin, '[]') WITH &&
  ) WHERE (estado IN ('por_iniciar', 'vigente'));

ALTER TABLE contrato_alquiler ENABLE ROW LEVEL SECURITY;
CREATE POLICY contrato_aislamiento ON contrato_alquiler
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON contrato_alquiler TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- contrato_parte — locadores (con su % si hay condominio), locatarios, garantes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contrato_parte (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,
  persona_id  uuid NOT NULL REFERENCES persona(id) ON DELETE RESTRICT,
  rol         text NOT NULL CHECK (rol IN ('locador', 'locatario', 'garante', 'fiador')),
  porcentaje  numeric(5, 2),   -- sólo locadores en condominio
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, persona_id, rol)
);

CREATE INDEX ix_parte_persona ON contrato_parte (persona_id);

ALTER TABLE contrato_parte ENABLE ROW LEVEL SECURITY;
CREATE POLICY parte_aislamiento ON contrato_parte
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON contrato_parte TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- garantia
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE garantia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN (
                'propietaria', 'recibo_sueldo', 'seguro_caucion',
                'garante_solidario', 'deposito_ampliado', 'otra')),
  detalle     text,
  vence_el    date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE garantia ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantia_aislamiento ON garantia
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON garantia TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- contrato_ajuste — el aumento.
--
-- `memoria` congela TODO lo que se usó para calcularlo. Un ajuste confirmado es
-- INMUTABLE: si INDEC revisa el IPC tres meses después, el aumento que ya se
-- notificó no se recalcula. Por eso no se guarda una referencia al índice: se
-- guarda el valor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contrato_ajuste (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id    uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,

  vigente_desde  date NOT NULL,          -- el primer período con el monto nuevo
  periodo_base   date,                   -- mes del índice base
  periodo_actual date,                   -- mes del índice nuevo
  indice_tipo    text NOT NULL,
  valor_base     numeric(18, 6),
  valor_actual   numeric(18, 6),
  coeficiente    numeric(12, 6) NOT NULL CHECK (coeficiente > 0),

  monto_anterior numeric(14, 2) NOT NULL,
  monto_nuevo    numeric(14, 2) NOT NULL,
  moneda         text NOT NULL,

  memoria        jsonb NOT NULL DEFAULT '{}'::jsonb,

  estado         text NOT NULL DEFAULT 'proyectado' CHECK (estado IN (
                   'proyectado', 'confirmado', 'notificado', 'aplicado')),
  confirmado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  confirmado_el  timestamptz,
  notificado_el  timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contrato_id, vigente_desde)
);

CREATE INDEX ix_ajuste_contrato ON contrato_ajuste (contrato_id, vigente_desde DESC);
CREATE INDEX ix_ajuste_pendiente ON contrato_ajuste (tenant_id, estado, vigente_desde);

CREATE TRIGGER ajuste_touch BEFORE UPDATE ON contrato_ajuste
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

-- Un ajuste confirmado no se toca. Sólo avanza de estado y se le pone la fecha
-- de notificación; los números quedan congelados.
CREATE OR REPLACE FUNCTION app_ajuste_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> 'proyectado' THEN
    IF NEW.monto_nuevo <> OLD.monto_nuevo
       OR NEW.monto_anterior <> OLD.monto_anterior
       OR NEW.coeficiente <> OLD.coeficiente
       OR NEW.valor_base IS DISTINCT FROM OLD.valor_base
       OR NEW.valor_actual IS DISTINCT FROM OLD.valor_actual
       OR NEW.memoria <> OLD.memoria
       OR NEW.vigente_desde <> OLD.vigente_desde THEN
      RAISE EXCEPTION
        'Un ajuste ya confirmado no se puede recalcular. Anulalo y creá uno nuevo.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ajuste_congelado BEFORE UPDATE ON contrato_ajuste
  FOR EACH ROW EXECUTE FUNCTION app_ajuste_inmutable();

ALTER TABLE contrato_ajuste ENABLE ROW LEVEL SECURITY;
CREATE POLICY ajuste_aislamiento ON contrato_ajuste
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON contrato_ajuste TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- periodo_alquiler — la cuota del mes. Idempotente por (contrato, periodo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE periodo_alquiler (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id    uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,
  periodo        date NOT NULL,           -- día 1 del mes que se cobra
  vence_el       date NOT NULL,

  monto_alquiler numeric(14, 2) NOT NULL,
  expensas       numeric(14, 2) NOT NULL DEFAULT 0,
  otros          numeric(14, 2) NOT NULL DEFAULT 0,
  total          numeric(14, 2) NOT NULL,
  moneda         text NOT NULL,

  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                   'pendiente', 'parcial', 'pagado', 'vencido', 'condonado')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contrato_id, periodo)
);

CREATE INDEX ix_periodo_tenant ON periodo_alquiler (tenant_id, periodo DESC);
CREATE INDEX ix_periodo_impago ON periodo_alquiler (tenant_id, estado, vence_el)
  WHERE estado IN ('pendiente', 'parcial', 'vencido');

CREATE TRIGGER periodo_touch BEFORE UPDATE ON periodo_alquiler
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE periodo_alquiler ENABLE ROW LEVEL SECURITY;
CREATE POLICY periodo_aislamiento ON periodo_alquiler
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON periodo_alquiler TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- cobro
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cobro (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  periodo_id   uuid NOT NULL REFERENCES periodo_alquiler(id) ON DELETE CASCADE,
  monto        numeric(14, 2) NOT NULL CHECK (monto > 0),
  moneda       text NOT NULL,
  fecha        date NOT NULL DEFAULT current_date,
  medio        text NOT NULL DEFAULT 'transferencia' CHECK (medio IN (
                 'efectivo', 'transferencia', 'cheque', 'debito', 'otro')),
  comprobante  text,
  registrado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  liquidacion_id uuid,   -- FK más abajo: liquidacion se crea después
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_cobro_periodo ON cobro (periodo_id);
CREATE INDEX ix_cobro_sin_liquidar ON cobro (tenant_id, fecha)
  WHERE liquidacion_id IS NULL;

ALTER TABLE cobro ENABLE ROW LEVEL SECURITY;
CREATE POLICY cobro_aislamiento ON cobro
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON cobro TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- liquidacion — lo que se le rinde al propietario.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE liquidacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propietario_id  uuid NOT NULL REFERENCES persona(id) ON DELETE RESTRICT,
  periodo         date NOT NULL,

  total_bruto     numeric(14, 2) NOT NULL DEFAULT 0,
  total_honorarios numeric(14, 2) NOT NULL DEFAULT 0,
  total_gastos    numeric(14, 2) NOT NULL DEFAULT 0,
  total_neto      numeric(14, 2) NOT NULL DEFAULT 0,
  moneda          text NOT NULL DEFAULT 'ARS',

  estado          text NOT NULL DEFAULT 'borrador' CHECK (estado IN (
                    'borrador', 'cerrada', 'pagada')),
  cerrada_el      timestamptz,
  pagada_el       timestamptz,
  notas           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, propietario_id, periodo, moneda)
);

CREATE INDEX ix_liquidacion_periodo ON liquidacion (tenant_id, periodo DESC);

CREATE TRIGGER liquidacion_touch BEFORE UPDATE ON liquidacion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

-- Una liquidación cerrada no se modifica: se emite una nota de ajuste en el
-- período siguiente. Cambiar un número ya rendido al propietario es la forma
-- más rápida de perder su confianza.
CREATE OR REPLACE FUNCTION app_liquidacion_cerrada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('cerrada', 'pagada') THEN
    IF NEW.total_bruto <> OLD.total_bruto
       OR NEW.total_honorarios <> OLD.total_honorarios
       OR NEW.total_gastos <> OLD.total_gastos
       OR NEW.total_neto <> OLD.total_neto THEN
      RAISE EXCEPTION
        'La liquidación ya está cerrada. Emití una nota de ajuste en el período siguiente.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER liquidacion_congelada BEFORE UPDATE ON liquidacion
  FOR EACH ROW EXECUTE FUNCTION app_liquidacion_cerrada();

ALTER TABLE liquidacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY liquidacion_aislamiento ON liquidacion
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON liquidacion TO app_role;

CREATE TABLE liquidacion_linea (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  liquidacion_id uuid NOT NULL REFERENCES liquidacion(id) ON DELETE CASCADE,
  contrato_id    uuid REFERENCES contrato_alquiler(id) ON DELETE SET NULL,
  periodo_id     uuid REFERENCES periodo_alquiler(id) ON DELETE SET NULL,

  concepto       text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN (
                   'alquiler', 'honorarios', 'expensas', 'reparacion',
                   'impuesto', 'ajuste', 'otro')),
  -- +1 suma al propietario, -1 le descuenta. El signo explícito evita que el
  -- lector tenga que adivinar si un "honorario" viene en negativo o no.
  signo          smallint NOT NULL CHECK (signo IN (-1, 1)),
  monto          numeric(14, 2) NOT NULL CHECK (monto >= 0),
  detalle        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_linea_liquidacion ON liquidacion_linea (liquidacion_id);

ALTER TABLE liquidacion_linea ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_aislamiento ON liquidacion_linea
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON liquidacion_linea TO app_role;

ALTER TABLE cobro ADD CONSTRAINT cobro_liquidacion_fk
  FOREIGN KEY (liquidacion_id) REFERENCES liquidacion(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Carga de índices.
--
-- No permite PISAR un valor ya cargado. Los índices son globales: si una
-- inmobiliaria pudiera corregir el IPC de octubre, se lo cambiaría a todas. El
-- primero que carga un período correcto gana; corregir un valor mal cargado
-- requiere acceso de owner a la base, o sea una persona.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_indice_cargar(
  p_tipo         text,
  p_periodo      date,
  p_valor        numeric,
  p_fuente       text,
  p_usuario_id   uuid DEFAULT NULL,
  p_publicado_el date DEFAULT NULL
) RETURNS TABLE (insertado boolean, valor_vigente numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existente numeric;
BEGIN
  -- Siempre al día 1: un índice es mensual y "15 de octubre" no significa nada.
  p_periodo := date_trunc('month', p_periodo)::date;

  SELECT valor INTO v_existente
    FROM indice_valor WHERE tipo = p_tipo AND periodo = p_periodo;

  IF v_existente IS NOT NULL THEN
    RETURN QUERY SELECT false, v_existente;
    RETURN;
  END IF;

  INSERT INTO indice_valor (tipo, periodo, valor, fuente, publicado_el, cargado_por)
  VALUES (p_tipo, p_periodo, p_valor, p_fuente, p_publicado_el, p_usuario_id);

  RETURN QUERY SELECT true, p_valor;
END;
$$;

REVOKE EXECUTE ON FUNCTION app_indice_cargar(text, date, numeric, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_indice_cargar(text, date, numeric, text, uuid, date) TO app_role;
