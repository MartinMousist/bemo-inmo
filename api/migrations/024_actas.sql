-- 024 — El acta de entrega: cómo estaba la unidad cuando se entregó.
--
-- Es la fuente número uno de conflicto de un alquiler. Al devolver el depósito
-- nadie se acuerda de cómo estaba la cocina hace tres años, y hoy eso se
-- resuelve con fotos en el WhatsApp de alguien que capaz ya no trabaja acá.
--
-- ── Dos actas por contrato, no una ──
--
-- El acta de ENTREGA y la de DEVOLUCIÓN son la misma estructura mirada en dos
-- momentos, y lo que vale es la COMPARACIÓN entre las dos. Por eso son filas de
-- la misma tabla con un `tipo` y no dos tablas: cualquier consulta que quiera
-- poner el mismo ambiente lado a lado se escribe una vez.

CREATE TABLE acta (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,

  tipo        text NOT NULL CHECK (tipo IN ('entrega', 'devolucion')),
  fecha       date NOT NULL DEFAULT current_date,

  -- Quién estuvo. Texto y no FK a persona: en la entrega puede firmar la madre
  -- del inquilino, y obligar a crear una ficha para eso convierte un trámite de
  -- diez minutos en carga de datos.
  presentes   text,
  observaciones text,

  -- Los medidores, que son la otra discusión clásica de la devolución.
  medidor_luz  text,
  medidor_gas  text,
  medidor_agua text,

  llaves_entregadas smallint CHECK (llaves_entregadas >= 0),

  /*
   * Firmada = INMUTABLE, por trigger, igual que un ajuste confirmado y una
   * liquidación cerrada.
   *
   * Un acta es prueba: si se pudiera editar después de que las dos partes la
   * firmaron, no prueba nada. Lo que se hace cuando aparece algo mal es una
   * observación nueva con su fecha, no cambiar la foto de lo que ya se firmó.
   */
  firmada_el  timestamptz,
  firmada_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  /* Quién firmó del otro lado, con lo que haya: nombre y aclaración. */
  firmada_inquilino text,

  creada_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Una entrega y una devolución por contrato. Un segundo acta del mismo tipo es
-- la pregunta «¿cuál vale?», que no tiene buena respuesta.
CREATE UNIQUE INDEX ix_acta_unica ON acta (contrato_id, tipo);
CREATE INDEX ix_acta_contrato ON acta (contrato_id);

CREATE TRIGGER acta_touch BEFORE UPDATE ON acta
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE acta ENABLE ROW LEVEL SECURITY;
CREATE POLICY acta_aislamiento ON acta
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON acta TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- El detalle: un renglón por ambiente.
--
-- `ambiente` es texto libre y no un enum. Un enum de ambientes parece prolijo y
-- se rompe con la primera unidad real: «lavadero», «altillo», «quincho», «patio
-- del fondo», «cochera 2». La comparación entre las dos actas se hace por el
-- nombre normalizado, que es lo que el servicio garantiza al copiar el acta de
-- entrega como plantilla de la de devolución.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE acta_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  acta_id    uuid NOT NULL REFERENCES acta(id) ON DELETE CASCADE,

  ambiente   text NOT NULL CHECK (length(trim(ambiente)) > 0),
  orden      smallint NOT NULL DEFAULT 0,

  estado     text NOT NULL DEFAULT 'bueno' CHECK (estado IN (
               'excelente', 'bueno', 'regular', 'malo')),
  detalle    text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_acta_item ON acta_item (acta_id, orden);

ALTER TABLE acta_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY acta_item_aislamiento ON acta_item
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON acta_item TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Las fotos. Mismo patrón que `garantia_documento` y `propiedad_foto`: la url
-- del objeto en S3, y el archivo se sube de verdad — nunca una url escrita a
-- mano, que daría una miniatura rota, o sea un dato falso en pantalla.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE acta_foto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  acta_item_id uuid NOT NULL REFERENCES acta_item(id) ON DELETE CASCADE,

  url          text NOT NULL,
  nombre_original text,
  subida_por   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_acta_foto ON acta_foto (acta_item_id);

ALTER TABLE acta_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY acta_foto_aislamiento ON acta_foto
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON acta_foto TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Firmada es inmutable.
--
-- Lo hace cumplir la BASE y no el servicio, por la misma razón que el ajuste
-- confirmado: un endpoint nuevo que se olvide del chequeo no puede romper una
-- prueba legal. El SQLSTATE es el mismo 'BE002' que ya usan el gasto rendido y
-- la liquidación cerrada, así que el front lo reconoce sin código nuevo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_acta_inmutable() RETURNS trigger AS $$
BEGIN
  IF OLD.firmada_el IS NOT NULL THEN
    -- Firmar es lo único que se puede hacer sobre un acta sin firmar, y ya está
    -- hecho: cualquier otro cambio se rechaza.
    RAISE EXCEPTION 'El acta ya está firmada y no se puede modificar.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acta_no_se_toca BEFORE UPDATE ON acta
  FOR EACH ROW EXECUTE FUNCTION app_acta_inmutable();

-- Los items y las fotos de un acta firmada tampoco: si se pudieran cambiar, el
-- acta sería inmutable sólo en su carátula.
CREATE OR REPLACE FUNCTION app_acta_hijo_inmutable() RETURNS trigger AS $$
DECLARE
  v_acta uuid;
  v_firmada timestamptz;
BEGIN
  v_acta := CASE TG_TABLE_NAME
              WHEN 'acta_item' THEN coalesce(NEW.acta_id, OLD.acta_id)
              ELSE (SELECT acta_id FROM acta_item
                     WHERE id = coalesce(NEW.acta_item_id, OLD.acta_item_id))
            END;

  SELECT firmada_el INTO v_firmada FROM acta WHERE id = v_acta;

  IF v_firmada IS NOT NULL THEN
    RAISE EXCEPTION 'El acta ya está firmada y no se puede modificar.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acta_item_no_se_toca
  BEFORE INSERT OR UPDATE OR DELETE ON acta_item
  FOR EACH ROW EXECUTE FUNCTION app_acta_hijo_inmutable();

CREATE TRIGGER acta_foto_no_se_toca
  BEFORE INSERT OR UPDATE OR DELETE ON acta_foto
  FOR EACH ROW EXECUTE FUNCTION app_acta_hijo_inmutable();
