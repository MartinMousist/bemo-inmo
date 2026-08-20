-- 041 · La conversación se engancha a una propiedad, y el canal se aprueba
--
-- Dos decisiones de producto tomadas con Martín:
--
--   1. Un mensaje que pregunta por una propiedad queda VINCULADO a esa
--      propiedad, y cuando entra por el número general se le asigna al que la
--      captó. El que captó conoce la unidad, conoce al dueño y ya tiene el
--      vínculo: mandársela a otro es empezar la relación de cero.
--
--   2. Cada asesor carga SU número, pero no queda activo hasta que el titular
--      lo aprueba. Un canal es una credencial que habilita a escribirle a los
--      clientes en nombre de la inmobiliaria; que cualquiera lo prenda solo es
--      demasiado, y que el titular tenga que cargar diez tokens ajenos es
--      demasiado poco.

BEGIN;

-- ── 1. El vínculo con la propiedad ────────────────────────────────────────
--
-- Nulo es lo normal: la mayoría de los mensajes no hablan de una propiedad
-- puntual. Se llena cuando se detecta el código en el texto, y el asesor lo
-- puede corregir —detectar mal y no poder arreglarlo sería peor que no
-- detectar—.
ALTER TABLE conversacion
  ADD COLUMN propiedad_id uuid,
  ADD CONSTRAINT conversacion_propiedad_fkey
    FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id)
    ON DELETE SET NULL (propiedad_id);

CREATE INDEX ix_conversacion_propiedad
  ON conversacion (tenant_id, propiedad_id) WHERE propiedad_id IS NOT NULL;

-- ── 2. La aprobación del canal ────────────────────────────────────────────
--
-- `aprobada_el IS NULL` = cargado y esperando. No recibe ni envía: un canal a
-- medio aprobar que igual contesta no es una aprobación, es un cartel.
ALTER TABLE canal_cuenta
  ADD COLUMN aprobada_el  timestamptz,
  ADD COLUMN aprobada_por uuid REFERENCES usuario(id) ON DELETE SET NULL;

-- Los que ya existen quedan aprobados: los cargó el titular, que era el único
-- que podía. Dejarlos pendientes apagaría canales que hoy andan.
UPDATE canal_cuenta SET aprobada_el = created_at WHERE aprobada_el IS NULL;

COMMIT;
