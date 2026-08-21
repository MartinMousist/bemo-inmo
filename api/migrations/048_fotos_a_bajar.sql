-- 048 · La cola de fotos por bajar
--
-- ═══ POR QUÉ UNA COLA Y NO BAJARLAS EN EL MOMENTO ═══
--
-- Importar una cartera de doscientas propiedades con ocho fotos cada una son
-- MIL SEISCIENTOS pedidos HTTP a un servidor ajeno. Hacerlos adentro del request
-- del importador tiene tres problemas, y cualquiera de los tres alcanza:
--
--   1. El request muere por timeout mucho antes de terminar, y quien importó no
--      sabe si su cartera entró o no.
--   2. Cada descarga tendría una transacción abierta esperando a un servidor que
--      no controlamos. Con diez importaciones en paralelo, el pool se termina.
--   3. Una sola foto lenta —o un CDN caído— arrastra la importación entera.
--
-- Con la cola, la importación termina en segundos: escribe las filas y devuelve.
-- Las fotos llegan después, de a poco, y la pantalla de la propiedad dice
-- cuántas faltan.
--
-- ── Por qué las filas se BORRAN al bajarlas bien ══
--
-- Esta tabla es una cola, no un historial: lo que quedó bien ya vive en
-- `propiedad_foto`. Guardar además la fila cumplida haría que la tabla crezca
-- para siempre con datos que no responden ninguna pregunta.
--
-- Lo que SÍ queda es lo que falló definitivamente, con su motivo, porque eso hay
-- que poder mirarlo: «no bajó ninguna foto» sin decir por qué es peor que no
-- intentarlo.

BEGIN;

CREATE TABLE foto_pendiente (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id  uuid NOT NULL,

  url           text NOT NULL,
  orden         smallint NOT NULL DEFAULT 0,

  -- Los intentos se cuentan para no reintentar para siempre contra un CDN que
  -- ya dijo 404. Tres alcanza para cubrir un corte de red y no tanto como para
  -- martillar a un servidor ajeno.
  intentos      smallint NOT NULL DEFAULT 0,
  ultimo_error  text,

  estado        text NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'fallida')),

  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Cuándo se intentó por última vez. El worker espera antes de reintentar: sin
  -- esto, una foto que falla se reintentaría en cada vuelta del ciclo.
  intentado_el  timestamptz,

  UNIQUE (tenant_id, id),
  -- La misma URL para la misma propiedad no se encola dos veces: reimportar la
  -- planilla es algo que la gente hace, y sin esto duplicaría cada foto.
  UNIQUE (propiedad_id, url),
  FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE
);

-- El índice que usa el worker para elegir la próxima tanda.
CREATE INDEX ix_foto_pendiente_cola
  ON foto_pendiente (estado, intentado_el NULLS FIRST)
  WHERE estado = 'pendiente';

-- El que usa la ficha de la propiedad para decir cuántas faltan.
CREATE INDEX ix_foto_pendiente_propiedad ON foto_pendiente (propiedad_id);

ALTER TABLE foto_pendiente ENABLE ROW LEVEL SECURITY;
CREATE POLICY foto_pendiente_del_tenant ON foto_pendiente
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON foto_pendiente TO app_role;

COMMIT;
