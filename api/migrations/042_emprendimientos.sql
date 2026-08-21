-- 042 · Emprendimientos: la venta en pozo
--
-- ── La decisión que ordena todo el módulo ──
--
-- **Una unidad ES una `propiedad`**, no una tabla nueva. Se le agrega
-- `emprendimiento_id` y dos campos, y listo.
--
-- La tentación era una tabla `unidad` aparte, porque durante el pozo la unidad
-- no tiene escritura ni dirección propia. Pero *se publica* en los portales,
-- *se fotografía*, *se reserva*, *se vende* y *se le paga comisión a alguien* —
-- exactamente lo que `propiedad` ya sabe hacer, con doce migraciones encima.
-- Duplicarlo sería mantener dos veces el mismo listado, las mismas fotos y el
-- mismo embudo, y descubrir en seis meses que sólo uno de los dos recibió el
-- último arreglo.
--
-- Además `propiedad` YA tiene `piso`, `depto`, superficies, ambientes y
-- amenities: lo que falta de verdad son tres campos.
--
-- ── Por qué el plan de pago es del emprendimiento y no de la venta ──
--
-- Porque la desarrolladora publica «anticipo 30% + 36 cuotas ajustadas por CAC»
-- y se lo ofrece a todos. Es una lista de precios, no un acuerdo particular. La
-- venta puntual puede apartarse, y para eso guarda su propia copia cuando se
-- cierra — pero el default vive acá y se edita en un solo lugar.
--
-- ── CAC ──
--
-- Los contratos en pozo se ajustan por el índice de la Cámara Argentina de la
-- Construcción, no por IPC ni ICL. Se suma al mismo `indice_valor` que ya
-- mueve los ajustes de alquiler: así hereda la memoria de cálculo, la
-- inmutabilidad del valor usado y la pantalla de cobertura, sin escribir nada.
--
-- ⚠️ **A diferencia de ICL y UVA, el CAC NO lo publica el BCRA** y no hay API
-- gratuita: se carga a mano, con el mismo camino que ya existe para la
-- cotización propia. Está anotado acá para que no se descubra a mitad del
-- primer emprendimiento.

BEGIN;

ALTER TABLE indice_valor DROP CONSTRAINT IF EXISTS indice_valor_tipo_check;
ALTER TABLE indice_valor ADD CONSTRAINT indice_valor_tipo_check
  CHECK (tipo IN ('ipc', 'icl', 'uva', 'icp', 'cac'));

-- ─────────────────────────────────────────────────────────────────────────────
-- emprendimiento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE emprendimiento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  nombre        text NOT NULL,
  calle         text NOT NULL,
  numero        text,
  localidad     text,
  provincia     text,
  lat           numeric(10,7),
  lng           numeric(10,7),

  -- Dónde está la obra. Es lo primero que pregunta quien compra en pozo, y lo
  -- que decide si la unidad se puede mostrar o hay que imaginarla.
  etapa         text NOT NULL DEFAULT 'pozo'
                  CHECK (etapa IN ('pozo','en_construccion','terminado','entregado')),

  -- Porcentaje de avance. Se muestra al comprador: es la ansiedad número uno de
  -- quien puso plata en algo que todavía no existe.
  avance_pct    numeric(5,2) NOT NULL DEFAULT 0
                  CHECK (avance_pct >= 0 AND avance_pct <= 100),
  avance_el     date,

  entrega_estimada date,
  -- La fecha que se prometió al principio, congelada. Se guarda aparte de
  -- `entrega_estimada` a propósito: cuando la obra se atrasa, la diferencia
  -- entre las dos ES el dato —y si se pisara, nadie podría decir cuánto se
  -- corrió—.
  entrega_original date,

  descripcion   text,
  amenities     text[] NOT NULL DEFAULT '{}',
  notas_internas text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, nombre)
);

CREATE INDEX ix_emprendimiento_tenant ON emprendimiento (tenant_id, etapa);

-- ─────────────────────────────────────────────────────────────────────────────
-- La unidad: propiedad + tres campos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE propiedad
  ADD COLUMN emprendimiento_id uuid,
  -- «2 ambientes al frente», «Tipo B». Agrupa unidades iguales para poder
  -- duplicarlas y para poner precio por tipología en vez de una por una.
  ADD COLUMN tipologia text,
  -- El coeficiente de copropiedad: qué porción del total es esta unidad. Sale
  -- del reglamento y define expensas y voto en el consorcio.
  ADD COLUMN coeficiente numeric(8,5),
  ADD CONSTRAINT propiedad_emprendimiento_fkey
    FOREIGN KEY (tenant_id, emprendimiento_id) REFERENCES emprendimiento (tenant_id, id)
    ON DELETE SET NULL (emprendimiento_id);

CREATE INDEX ix_propiedad_emprendimiento
  ON propiedad (tenant_id, emprendimiento_id) WHERE emprendimiento_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- plan_pago — la lista de precios de la desarrolladora
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE plan_pago (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  emprendimiento_id uuid,

  nombre           text NOT NULL,

  -- El anticipo va en PORCENTAJE y no en monto: el mismo plan se le ofrece a
  -- una unidad de USD 80.000 y a otra de 140.000, y con monto fijo habría que
  -- crear un plan por unidad.
  anticipo_pct     numeric(5,2) NOT NULL DEFAULT 0
                     CHECK (anticipo_pct >= 0 AND anticipo_pct <= 100),
  cuotas           integer NOT NULL CHECK (cuotas >= 0),

  /**
   * Los refuerzos: las cuotas grandes de mitad y fin de año.
   *
   * `[{"cuota": 6, "pct": 5}, {"cuota": 12, "pct": 5}]` — en qué número de
   * cuota cae y qué porcentaje del total es. Van como jsonb y no como tabla
   * porque nunca se consultan solos: se leen enteros al armar el plan de pago,
   * igual que las `avisos` del tenant.
   */
  refuerzos        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Con qué se ajustan las cuotas. `ninguno` es un plan en dólares o en pesos
  -- fijos, que también existe.
  indice           text NOT NULL DEFAULT 'ninguno'
                     CHECK (indice IN ('ninguno','cac','ipc','uva','icl')),
  moneda           text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('ARS','USD')),

  -- La entrega contra llave: lo que se paga al recibir la unidad.
  contra_entrega_pct numeric(5,2) NOT NULL DEFAULT 0
                     CHECK (contra_entrega_pct >= 0 AND contra_entrega_pct <= 100),

  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, emprendimiento_id) REFERENCES emprendimiento (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX ix_plan_pago_emprendimiento ON plan_pago (tenant_id, emprendimiento_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS y triggers
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE emprendimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_pago      ENABLE ROW LEVEL SECURITY;

CREATE POLICY emprendimiento_del_tenant ON emprendimiento
  USING (tenant_id = app_current_tenant());
CREATE POLICY plan_pago_del_tenant ON plan_pago
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON emprendimiento, plan_pago TO app_role;

CREATE TRIGGER tg_emprendimiento_updated BEFORE UPDATE ON emprendimiento
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER tg_plan_pago_updated BEFORE UPDATE ON plan_pago
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

COMMIT;
