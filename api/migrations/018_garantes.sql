-- 018 — Garantes: quiénes son, qué presentaron y qué dice el BCRA de ellos.
--
-- `garantia` existe desde la 007 con RLS y sus seis tipos, y **ningún código la
-- leía ni la escribía**: el error #3 del playbook en su forma más pura. Encima
-- `recordatorios` ya tenía el evento `garantia_por_vencer` esperándola.
--
-- Le faltaban tres cosas para ser el circuito que una inmobiliaria usa:
--   · QUIÉN es el garante. Había `detalle text` — el nombre escrito a mano.
--   · QUÉ presentó: el DNI y los recibos de sueldo, como archivos de verdad.
--   · SI está limpio en el BCRA, y cuándo se lo consultó.

-- ─────────────────────────────────────────────────────────────────────────────
-- El garante es una persona del sistema, no un texto.
--
-- `ON DELETE RESTRICT` y no CASCADE: borrar a alguien que garantiza un contrato
-- vigente tiene que fallar y hacer ruido. La garantía es parte del respaldo
-- legal del contrato y desaparecer en silencio no es una opción.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE garantia
  ADD COLUMN persona_id uuid REFERENCES persona(id) ON DELETE RESTRICT,
  ADD COLUMN firmo_el   date,

  -- ── El control del BCRA, CONGELADO ────────────────────────────────────────
  -- Se guarda lo que la Central de Deudores respondió el día que se consultó, no
  -- un puntero para volver a preguntar. Es la misma regla que un ajuste por
  -- índice: la decisión se tomó con ESE dato, y si el BCRA lo revisa el mes que
  -- viene, el contrato ya se firmó. Sin esto, "por qué lo aceptamos" no tiene
  -- respuesta seis meses después.
  ADD COLUMN bcra_cuit          text,
  ADD COLUMN bcra_denominacion  text,
  -- La PEOR situación entre todas las entidades que lo informaron. 1 = normal.
  -- NULL = todavía no se consultó, que no es lo mismo que "sin deudas".
  ADD COLUMN bcra_situacion     smallint CHECK (bcra_situacion BETWEEN 1 AND 6),
  -- Período que informó el BCRA, formato AAAAMM.
  ADD COLUMN bcra_periodo       text,
  ADD COLUMN bcra_consultado_el timestamptz,
  -- La respuesta entera, entidad por entidad, para poder mostrar el detalle y
  -- explicar el veredicto sin volver a salir a internet.
  ADD COLUMN bcra_detalle       jsonb;

COMMENT ON COLUMN garantia.bcra_situacion IS
  'Peor situación informada (1 normal … 6 irrecuperable por disposición técnica). NULL = sin consultar.';

CREATE INDEX ix_garantia_contrato ON garantia (contrato_id);
CREATE INDEX ix_garantia_persona ON garantia (tenant_id, persona_id);

-- Una persona no puede garantizar dos veces el mismo contrato: sería contar dos
-- veces el mismo respaldo al verificar si el contrato llegó al mínimo.
CREATE UNIQUE INDEX ix_garantia_unica ON garantia (contrato_id, persona_id)
  WHERE persona_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Los documentos del garante.
--
-- Tabla propia y no `detalle text`: son archivos en S3 con su url, igual que
-- las fotos de una propiedad, y hay que poder borrar uno sin tocar los otros.
--
-- Los tipos están acotados a propósito. El circuito real es siempre el mismo
-- —las dos caras del DNI y los tres últimos recibos de sueldo— y un `tipo` libre
-- convertiría la verificación de "¿está completo?" en adivinanza. `otro` queda
-- para el resto (un contrato de trabajo, una escritura) sin romper esa cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE garantia_documento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  garantia_id     uuid NOT NULL REFERENCES garantia(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN (
                    'dni_frente', 'dni_dorso',
                    'recibo_1', 'recibo_2', 'recibo_3',
                    'otro')),
  url             text NOT NULL,
  nombre_original text,
  subido_por      uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Uno por tipo: volver a subir el frente del DNI reemplaza al anterior en vez
-- de dejar dos y que nadie sepa cuál es el bueno. `otro` puede repetirse.
CREATE UNIQUE INDEX ix_garantia_doc_tipo ON garantia_documento (garantia_id, tipo)
  WHERE tipo <> 'otro';
CREATE INDEX ix_garantia_doc ON garantia_documento (garantia_id);

ALTER TABLE garantia_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantia_doc_aislamiento ON garantia_documento
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON garantia_documento TO app_role;
