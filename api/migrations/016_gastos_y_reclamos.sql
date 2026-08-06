-- 016 — Gastos y reclamos con entidad propia.
--
-- El hueco más grande del dominio, y el que **ya costó plata**.
--
-- Hasta acá un gasto sólo existía como `liquidacion_linea`: nacía adentro de la
-- rendición del mes y no existía antes. Eso tiene tres consecuencias, y la
-- tercera ya pasó:
--
--   1. No se puede cargar una reparación en marzo y liquidarla en abril.
--   2. No tiene proveedor, ni factura, ni estado, ni quién la pagó.
--   3. **Rearmar la liquidación podía destruirlo.** El `DELETE` de líneas no
--      filtraba por tipo y borraba los gastos cargados a mano; después sumaba
--      desde la tabla recién vaciada y `total_gastos` daba 0. Un termotanque de
--      ARS 85.000 adelantado por la inmobiliaria se le transfería de más al
--      propietario.
--
-- Ese bug se parcheó filtrando el `DELETE`, y el parche es correcto. Pero la
-- causa de raíz es el modelo: **mientras el gasto viva DENTRO de la
-- liquidación, rearmar la liquidación puede destruirlo.** Acá el gasto pasa a
-- vivir por su cuenta y la liquidación lo *toma*.
--
-- Y del otro lado está el reclamo, que es la carga operativa número uno de un
-- alquiler administrado: se rompió el termotanque, quién avisó, qué proveedor
-- fue, cuánto salió y quién lo paga. Hoy eso vive en WhatsApp — que es de donde
-- este producto vino a sacar las cosas. `nota` se le parece y no alcanza: una
-- nota no tiene estado, ni proveedor, ni monto, ni fecha de resolución.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Proveedores
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE proveedor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  nombre     text NOT NULL CHECK (length(btrim(nombre)) > 0),
  -- Rubro y no `tipo`: es como lo dice el mostrador. Libre y no un CHECK,
  -- porque la lista real de oficios no la conocemos y una enumeración corta
  -- obliga a poner "otro" en la mitad de los casos.
  rubro      text,
  cuit       text,
  telefono   text,
  email      citext,
  notas      text,

  -- Se desactiva, no se borra: un proveedor con gastos históricos no se puede
  -- eliminar sin romper la historia de una liquidación ya cerrada.
  activo     boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_proveedor_tenant ON proveedor (tenant_id, activo, nombre);

CREATE TRIGGER proveedor_touch BEFORE UPDATE ON proveedor
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY proveedor_aislamiento ON proveedor
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON proveedor TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reclamos
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE reclamo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  -- La propiedad es obligatoria y el contrato no: se puede romper algo en una
  -- unidad vacía, y ésa es justamente la que hay que arreglar antes de
  -- alquilarla.
  propiedad_id  uuid NOT NULL REFERENCES propiedad(id) ON DELETE RESTRICT,
  contrato_id   uuid REFERENCES contrato_alquiler(id) ON DELETE SET NULL,

  categoria     text NOT NULL CHECK (categoria IN (
                  'plomeria','electricidad','gas','humedad','cerrajeria',
                  'climatizacion','estructura','artefactos','limpieza','otro')),
  descripcion   text NOT NULL CHECK (length(btrim(descripcion)) > 0),

  prioridad     text NOT NULL DEFAULT 'normal'
                  CHECK (prioridad IN ('baja','normal','alta','urgente')),
  estado        text NOT NULL DEFAULT 'abierto'
                  CHECK (estado IN ('abierto','en_curso','resuelto','cancelado')),

  -- Quién lo paga puede no saberse al abrirlo —esa discusión es media gestión
  -- del reclamo— así que es nullable a propósito. Cuando se define, el gasto lo
  -- hereda.
  a_cargo_de    text CHECK (a_cargo_de IN ('propietario','inquilino','inmobiliaria')),

  proveedor_id  uuid REFERENCES proveedor(id) ON DELETE SET NULL,

  -- Quién avisó, del lado de afuera: el inquilino, el propietario, el vecino.
  -- Es lo primero que se pregunta cuando hay que volver a llamar.
  reportado_por uuid REFERENCES persona(id) ON DELETE SET NULL,

  abierto_por   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  resuelto_el   timestamptz,
  resuelto_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  resolucion    text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Un reclamo resuelto sin fecha de resolución es un estado que miente. Se
  -- hace cumplir en la base y no en el servicio: ningún chequeo de aplicación
  -- sobrevive a dos requests simultáneos.
  CONSTRAINT reclamo_resuelto_coherente CHECK (
    (estado = 'resuelto') = (resuelto_el IS NOT NULL)
  )
);

-- La consulta de la pantalla: los abiertos primero, los urgentes arriba.
CREATE INDEX ix_reclamo_abiertos ON reclamo (tenant_id, prioridad, created_at DESC)
  WHERE estado IN ('abierto','en_curso');
CREATE INDEX ix_reclamo_propiedad ON reclamo (tenant_id, propiedad_id, created_at DESC);

CREATE TRIGGER reclamo_touch BEFORE UPDATE ON reclamo
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE reclamo ENABLE ROW LEVEL SECURITY;
CREATE POLICY reclamo_aislamiento ON reclamo
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON reclamo TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Gastos
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE gasto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  propiedad_id  uuid NOT NULL REFERENCES propiedad(id) ON DELETE RESTRICT,
  contrato_id   uuid REFERENCES contrato_alquiler(id) ON DELETE SET NULL,
  proveedor_id  uuid REFERENCES proveedor(id) ON DELETE SET NULL,
  reclamo_id    uuid REFERENCES reclamo(id) ON DELETE SET NULL,

  concepto      text NOT NULL CHECK (length(btrim(concepto)) > 0),
  tipo          text NOT NULL CHECK (tipo IN (
                  'reparacion','impuesto','expensas','servicio','seguro','otro')),

  monto         numeric(14,2) NOT NULL CHECK (monto > 0),
  -- Ningún monto sin su moneda. Es la regla del dominio que no se negocia.
  moneda        text NOT NULL CHECK (moneda IN ('ARS','USD')),
  fecha         date NOT NULL DEFAULT CURRENT_DATE,

  -- Quién lo paga en definitiva. Sólo los del propietario entran en su
  -- liquidación: un arreglo a cargo del inquilino se le cobra a él y no tiene
  -- nada que hacer en la rendición del dueño.
  a_cargo_de    text NOT NULL DEFAULT 'propietario'
                  CHECK (a_cargo_de IN ('propietario','inquilino','inmobiliaria')),

  --   registrado → existe y todavía no se rindió
  --   rendido    → ya entró en una liquidación
  --   anulado    → se cargó mal. NO se borra: si ya se rindió, borrarlo dejaría
  --                una liquidación cerrada apuntando a la nada.
  estado        text NOT NULL DEFAULT 'registrado'
                  CHECK (estado IN ('registrado','rendido','anulado')),

  comprobante   text,
  doc_url       text,
  notas         text,

  -- La liquidación TOMA el gasto. Esta columna es la que hace que rearmarla no
  -- pueda destruirlo: el gasto es dueño de sí mismo y sólo se deja apuntar.
  liquidacion_id uuid REFERENCES liquidacion(id) ON DELETE SET NULL,

  registrado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Rendido y liquidación van juntos en las dos direcciones. Sin esto se puede
  -- llegar a "rendido" sin decir dónde, que es exactamente la pregunta que hace
  -- un propietario cuando ve un descuento que no reconoce.
  CONSTRAINT gasto_rendido_coherente CHECK (
    (estado = 'rendido') = (liquidacion_id IS NOT NULL)
  )
);

-- Los que están esperando entrar en una liquidación. Es la consulta que corre
-- cada vez que se genera un período, así que va parcial y por propiedad.
CREATE INDEX ix_gasto_por_rendir ON gasto (tenant_id, propiedad_id, fecha)
  WHERE estado = 'registrado' AND a_cargo_de = 'propietario';
CREATE INDEX ix_gasto_propiedad ON gasto (tenant_id, propiedad_id, fecha DESC);
CREATE INDEX ix_gasto_liquidacion ON gasto (liquidacion_id) WHERE liquidacion_id IS NOT NULL;

CREATE TRIGGER gasto_touch BEFORE UPDATE ON gasto
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

ALTER TABLE gasto ENABLE ROW LEVEL SECURITY;
CREATE POLICY gasto_aislamiento ON gasto
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON gasto TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Un gasto rendido es inmutable
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mismo criterio que un ajuste confirmado y una liquidación cerrada: una vez
-- que el número se le informó a un tercero, no se cambia. Si estaba mal, se
-- corrige con un gasto nuevo en el período siguiente.
--
-- Va por trigger y no por permiso de aplicación porque es una regla del dominio
-- y no de la pantalla: el día que alguien escriba un script de corrección
-- masiva, el trigger sigue estando.

CREATE OR REPLACE FUNCTION app_gasto_rendido_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'rendido' THEN
    -- Lo único que se puede tocar es desvincularlo cuando la liquidación se
    -- rearma o se borra: ahí vuelve a estar disponible, que es lo correcto.
    IF NEW.estado = 'registrado' AND NEW.liquidacion_id IS NULL
       AND NEW.monto = OLD.monto AND NEW.moneda = OLD.moneda
       AND NEW.concepto = OLD.concepto AND NEW.fecha = OLD.fecha THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'El gasto ya se rindió en una liquidación y no se puede modificar. Cargá uno nuevo para corregirlo.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gasto_inmutable BEFORE UPDATE ON gasto
  FOR EACH ROW EXECUTE FUNCTION app_gasto_rendido_inmutable();

CREATE OR REPLACE FUNCTION app_gasto_rendido_no_se_borra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Si la inmobiliaria ya no existe, esto es el CASCADE de borrarla y no un
  -- borrado de la aplicación: el `ON DELETE CASCADE` elimina el padre primero,
  -- así que a esta altura `tenant` ya no tiene la fila.
  --
  -- Sin esta salida, una inmobiliaria con un solo gasto rendido pasa a ser
  -- imposible de borrar, y la regla "un gasto rendido no se toca" termina
  -- decidiendo algo que no le corresponde. Se descubrió porque el arnés de
  -- tests no podía limpiar sus propios fixtures.
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.estado = 'rendido' THEN
    RAISE EXCEPTION
      'El gasto ya se rindió en una liquidación y no se puede borrar. Anulalo con un gasto de signo contrario.'
      USING ERRCODE = 'BE002';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER gasto_no_se_borra BEFORE DELETE ON gasto
  FOR EACH ROW EXECUTE FUNCTION app_gasto_rendido_no_se_borra();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La línea de liquidación aprende de dónde vino
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Con esto la relación queda en los dos sentidos y se puede contestar "¿de
-- dónde salió este descuento?" desde la liquidación, que es como lo pregunta un
-- propietario.

ALTER TABLE liquidacion_linea
  ADD COLUMN gasto_id uuid REFERENCES gasto(id) ON DELETE SET NULL;

CREATE INDEX ix_linea_gasto ON liquidacion_linea (gasto_id) WHERE gasto_id IS NOT NULL;
