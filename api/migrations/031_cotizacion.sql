-- 031 — El tipo de cambio, con su fecha y su fuente.
--
-- Hay operaciones en USD y liquidaciones en ARS, y hasta hoy **no había un tipo
-- de cambio en ninguna parte del sistema**. Alguien lo ponía a mano en una
-- calculadora aparte y después nadie podía explicar de dónde salió ese número —
-- que es exactamente lo que la regla «todo cálculo lleva su memoria» prohíbe.
--
-- ── Diaria, no mensual ──
--
-- Es la diferencia con `indice_valor`, que va al día 1 del mes porque el IPC es
-- mensual. Un tipo de cambio del 15 de octubre significa algo, y el del 16 es
-- otro número.
--
-- ── Por qué hay cotizaciones GLOBALES y también POR INMOBILIARIA ──
--
-- Las oficiales del BCRA son dato público: van con `tenant_id IS NULL` y las lee
-- todo el mundo, igual que los índices. Si una inmobiliaria pudiera corregir el
-- dólar oficial del martes, se lo cambiaría a todas.
--
-- Pero **el oficial no es el tipo de cambio con el que se vende una propiedad en
-- Argentina**. El que se usa de verdad —MEP, «blue», el que se pacte— no lo
-- publica ninguna API oficial, y ponerlo nosotros sería inventar un número en un
-- sistema que liquida plata de terceros. Entonces: se puede cargar a mano, y esa
-- cotización es DE esa inmobiliaria. Es la misma decisión que ya se tomó con el
-- IPC —automático donde hay fuente confiable, manual donde no, nunca inventado—
-- sólo que acá el valor manual además es una decisión comercial propia.

CREATE TABLE cotizacion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = oficial, dato público. Con valor = la que usa esa inmobiliaria.
  tenant_id    uuid REFERENCES tenant(id) ON DELETE CASCADE,

  tipo         text NOT NULL CHECK (tipo IN (
                 'oficial_minorista', 'oficial_mayorista', 'propia')),
  fecha        date NOT NULL,
  -- Cuántos ARS vale UN dólar. El par va fijo: es el único que este mercado usa.
  valor        numeric(18, 6) NOT NULL CHECK (valor > 0),

  fuente       text NOT NULL,
  cargado_el   timestamptz NOT NULL DEFAULT now(),
  cargado_por  uuid REFERENCES usuario(id) ON DELETE SET NULL
);

-- Una por tipo y por día. Dos índices parciales y no un UNIQUE con tenant_id
-- adentro: en Postgres, NULL nunca es igual a NULL, así que un UNIQUE
-- (tenant_id, tipo, fecha) dejaría cargar el oficial del martes veinte veces.
CREATE UNIQUE INDEX ix_cotizacion_oficial ON cotizacion (tipo, fecha)
  WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX ix_cotizacion_propia ON cotizacion (tenant_id, tipo, fecha)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX ix_cotizacion_fecha ON cotizacion (tipo, fecha DESC);

ALTER TABLE cotizacion ENABLE ROW LEVEL SECURITY;

-- Se lee lo público Y lo propio. Lo de la inmobiliaria de al lado, no.
CREATE POLICY cotizacion_lectura ON cotizacion FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant());

-- Escribir, sólo lo propio: el oficial entra por `app_cotizacion_cargar()`,
-- que es SECURITY DEFINER, igual que los índices.
CREATE POLICY cotizacion_escritura ON cotizacion FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT ON cotizacion TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Carga de la cotización OFICIAL. No permite pisar un valor ya cargado, por el
-- mismo motivo que los índices: es global, y corregirlo se lo cambia a todos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_cotizacion_cargar(
  p_tipo   text,
  p_fecha  date,
  p_valor  numeric,
  p_fuente text
) RETURNS TABLE (insertado boolean, valor_vigente numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existente numeric;
BEGIN
  SELECT valor INTO v_existente
    FROM cotizacion
   WHERE tenant_id IS NULL AND tipo = p_tipo AND fecha = p_fecha;

  IF v_existente IS NOT NULL THEN
    RETURN QUERY SELECT false, v_existente;
    RETURN;
  END IF;

  INSERT INTO cotizacion (tenant_id, tipo, fecha, valor, fuente)
  VALUES (NULL, p_tipo, p_fecha, p_valor, p_fuente);

  RETURN QUERY SELECT true, p_valor;
END;
$$;
