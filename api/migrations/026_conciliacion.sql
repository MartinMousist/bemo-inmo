-- 026 — Conciliación bancaria: cruzar el extracto con las cuotas.
--
-- Donde se va el tiempo de una inmobiliaria no es cargando contratos: es el 1 de
-- cada mes, cruzando transferencias con inquilinos. Hoy cada cobro se tipea a
-- mano leyendo el homebanking en otra pestaña.
--
-- ── La regla que ordena todo este archivo ──
--
-- **El sistema PROPONE, una persona CONFIRMA.** Ningún movimiento se imputa
-- solo. Un cobro mal imputado no se descubre el día que se imputa: se descubre
-- a fin de mes, cuando la liquidación al propietario sale con el número de otro
-- —y para entonces ya se pagó—. Por eso `movimiento_bancario` guarda la
-- SUGERENCIA y el cobro se crea recién cuando alguien la acepta.

-- ─────────────────────────────────────────────────────────────────────────────
-- El extracto importado.
--
-- Se guarda el archivo entero como filas, incluidas las que no son cobros
-- —comisiones del banco, transferencias salientes, un depósito del dueño—.
-- Importar sólo lo que parece un cobro haría que «este movimiento no aparece»
-- fuera indistinguible de «lo importé y no lo imputé», que son dos problemas
-- muy distintos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE extracto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  banco       text,
  cuenta      text,
  nombre_archivo text,
  /* Rango que cubre el archivo, calculado al importar: es lo que permite decir
     «ya importaste marzo» antes de volver a importarlo. */
  desde       date,
  hasta       date,

  filas       integer NOT NULL DEFAULT 0,
  importado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_extracto_tenant ON extracto (tenant_id, created_at DESC);

ALTER TABLE extracto ENABLE ROW LEVEL SECURITY;
CREATE POLICY extracto_aislamiento ON extracto
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON extracto TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Cada movimiento del extracto.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE movimiento_bancario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  extracto_id uuid NOT NULL REFERENCES extracto(id) ON DELETE CASCADE,

  fecha       date NOT NULL,
  /* Positivo entra, negativo sale. Se guarda con signo y no en dos columnas:
     un extracto real trae las dos cosas mezcladas y separarlas al importar es
     interpretar antes de tiempo. */
  monto       numeric(14, 2) NOT NULL,
  moneda      text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),

  descripcion text NOT NULL DEFAULT '',
  /* Lo que el banco llame referencia, operación o comprobante. Es la mejor
     pista para el cruce después del monto. */
  referencia  text,
  /* El CBU/CUIT/alias del ordenante, cuando el banco lo informa. Es la pista
     MÁS fuerte de todas: identifica a la persona, no al importe. */
  contraparte text,

  /*
   * La huella del movimiento, para no importar dos veces el mismo.
   *
   * Se calcula al importar sobre fecha + monto + descripción + referencia. No
   * puede ser sólo la referencia: hay bancos que no la traen, y dos alquileres
   * iguales del mismo día serían el mismo movimiento.
   */
  huella      text NOT NULL,

  estado      text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                'pendiente',   -- Importado y sin resolver.
                'imputado',    -- Se creó un cobro a partir de él.
                'ignorado')),  -- No es un cobro: comisión, IVA, transferencia propia.
  motivo_ignorado text,

  /* El cobro que salió de acá. Es la trazabilidad que hace auditable la
     conciliación: de un cobro se puede volver al renglón del banco. */
  cobro_id    uuid REFERENCES cobro(id) ON DELETE SET NULL,

  resuelto_el timestamptz,
  resuelto_por uuid REFERENCES usuario(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia del import: el mismo movimiento no entra dos veces aunque
-- alguien suba el archivo de marzo por segunda vez. Es la misma decisión que
-- toma el seed y que la ingesta de índices.
CREATE UNIQUE INDEX ix_movimiento_huella ON movimiento_bancario (tenant_id, huella);
CREATE INDEX ix_movimiento_pendiente ON movimiento_bancario (tenant_id, estado, fecha DESC);
CREATE INDEX ix_movimiento_extracto ON movimiento_bancario (extracto_id);

CREATE TRIGGER movimiento_touch BEFORE UPDATE ON movimiento_bancario
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE movimiento_bancario ENABLE ROW LEVEL SECURITY;
CREATE POLICY movimiento_aislamiento ON movimiento_bancario
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON movimiento_bancario TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- El CBU/alias de una persona, para que la segunda vez sea automática.
--
-- La primera transferencia de alguien hay que imputarla a mano. Al hacerlo se
-- guarda de qué contraparte vino, y desde ahí el sistema la reconoce sola: es
-- lo que convierte la conciliación de «revisar treinta renglones» en «revisar
-- los tres que no reconoce».
--
-- Va en su tabla y no en `persona` porque una persona paga desde más de una
-- cuenta —la suya, la de la empresa, la del padre que le hace la transferencia—
-- y todas son la misma persona.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contraparte_conocida (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  persona_id  uuid NOT NULL REFERENCES persona(id) ON DELETE CASCADE,

  /* Normalizada: sin espacios, en minúscula. El banco la escribe distinto
     según el mes. */
  contraparte text NOT NULL,

  veces       integer NOT NULL DEFAULT 1,
  ultima_el   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ix_contraparte ON contraparte_conocida (tenant_id, contraparte);
CREATE INDEX ix_contraparte_persona ON contraparte_conocida (persona_id);

ALTER TABLE contraparte_conocida ENABLE ROW LEVEL SECURITY;
CREATE POLICY contraparte_aislamiento ON contraparte_conocida
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON contraparte_conocida TO app_role;
