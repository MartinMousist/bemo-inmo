-- 021 — Compartir una comisión con otra inmobiliaria deja de ser texto libre.
--
-- Esta migración sale CHICA a propósito. Casi todo lo que hace falta para el
-- pedido ya está en la base desde hace varias etapas y no lo lee nadie — el
-- error #3 del playbook, cuatro veces seguidas en el mismo módulo:
--
--   · `membresia.comision_captador_pct` / `comision_cerrador_pct` (017)
--     existen, tienen su COMMENT explicando que NULL hereda, y ninguna consulta
--     las devuelve. El % por agente NO necesita columnas nuevas.
--   · `propiedad.agente_captador_id` (006) se escribe desde la ficha y
--     `selectPropiedad()` nunca lo devolvió: el captador está cargado y el
--     reparto lo sigue pidiendo a mano.
--   · `operacion.comision_config jsonb` (006) no se lee NI se escribe. Es
--     exactamente el % por propiedad que se está pidiendo. Agregarle una
--     columna nueva al lado dejaría dos columnas muertas en vez de una.
--   · `comision.contrato_id` (008) no tiene un solo escritor: el alquiler no
--     genera comisiones. La única fila que existe la puso el seed a mano.
--
-- Así que lo único que la base todavía no sabe es QUIÉN es la otra inmobiliaria.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · El catálogo de inmobiliarias con las que se comparte.
--
-- Hasta hoy el nombre de la otra agencia viajaba como texto libre en
-- `comision.beneficiario_nombre`. Con eso no se puede contestar la única
-- pregunta que se hace de verdad sobre una operación compartida —«¿cuánto le
-- pagamos este año a Propiedades del Oeste?»— porque «Propiedades del Oeste»,
-- «Prop. del Oeste» y «propiedades del oeste» son tres agencias distintas.
--
-- El UNIQUE va sobre `lower(nombre)` por esa misma razón: quien carga la
-- segunda operación con la misma agencia escribe el nombre como le sale.
--
-- `activa` y no un DELETE: dar de baja una agencia no puede borrar el historial
-- de lo que se le pagó. Se saca del autocompletar y listo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inmobiliaria_externa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  nombre     text NOT NULL CHECK (length(trim(nombre)) > 0),
  cuit       text,
  contacto   text,
  telefono   text,
  email      text,
  notas      text,
  activa     boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ix_externa_nombre ON inmobiliaria_externa (tenant_id, lower(nombre));
CREATE INDEX ix_externa_tenant ON inmobiliaria_externa (tenant_id) WHERE activa;

CREATE TRIGGER externa_touch BEFORE UPDATE ON inmobiliaria_externa
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

COMMENT ON TABLE inmobiliaria_externa IS
  'Las otras inmobiliarias con las que se comparten operaciones. Sirve para sumar lo que se le pagó a cada una, que con el nombre escrito a mano en cada comisión era imposible.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · La comisión, encadenada al catálogo.
--
-- `beneficiario_nombre` SE SIGUE GUARDANDO aunque ahora haya FK, y no es
-- redundancia: una comisión ya cobrada no puede cambiar de nombre porque
-- alguien corrigió la ficha de la agencia seis meses después. Es la misma regla
-- que el ajuste confirmado y que `documento_generado.plantilla_nombre`: lo que
-- salió es lo que salió.
--
-- Por eso también el ON DELETE SET NULL: si la ficha se borra, la comisión
-- pierde el enlace pero conserva a quién se le pagó.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE comision
  ADD COLUMN externa_id uuid REFERENCES inmobiliaria_externa(id) ON DELETE SET NULL;

CREATE INDEX ix_comision_externa ON comision (tenant_id, externa_id)
  WHERE externa_id IS NOT NULL;

COMMENT ON COLUMN comision.externa_id IS
  'La ficha de la otra inmobiliaria, cuando salió del catálogo. NULL = se escribió el nombre a mano. El nombre que cobró está siempre en beneficiario_nombre y no se pisa.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · RLS y permisos.
--
-- Sin el GRANT el rol de la aplicación no ve la tabla, y el test de seguridad
-- —que recorre `pg_class` pidiendo policy en todo lo que tenga `tenant_id`—
-- falla. Está bien que falle: con quién comparte operaciones una inmobiliaria
-- es información comercial y es justo lo que no puede cruzar de un tenant a
-- otro.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE inmobiliaria_externa ENABLE ROW LEVEL SECURITY;
CREATE POLICY externa_aislamiento ON inmobiliaria_externa
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON inmobiliaria_externa TO app_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · La forma de `operacion.comision_config`, escrita donde vive la columna.
--
-- La columna existe desde la 006 sin una línea que diga qué se guarda adentro,
-- y ése es medio motivo por el que nadie la usó. Guarda un override PARCIAL de
-- `tenant.comisiones`, con la misma forma:
--
--     {"venta": {"compradora": 4, "vendedora": 2}}
--     {"alquiler": {"locataria": 50, "locadora": 100}}
--
-- `{}` —el default— significa «heredá todo de la inmobiliaria», y es distinto
-- de `{"venta": {"compradora": 0, "vendedora": 0}}`, que significa «esta
-- propiedad no cobra honorarios». Un NULL no alcanzaría para decir eso.
--
-- El merge es campo por campo y NO un spread de primer nivel: guardar sólo
-- `{"venta": {"compradora": 4}}` y mezclarlo de a un nivel dejaría `vendedora`
-- en undefined y el motor calcularía una punta menos sin avisar. Está resuelto
-- en `configEfectiva()` y hay tests de papel que lo fijan.
--
-- El reparto interno NO se puede pisar por propiedad, a propósito: quién se
-- lleva qué puertas adentro es una política de la casa y del contrato de cada
-- agente, no un atributo de un inmueble.
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN operacion.comision_config IS
  'Override PARCIAL de tenant.comisiones para esta operación: {"venta":{"compradora":4,"vendedora":2}} o {"alquiler":{...}}. {} = hereda todo de la inmobiliaria. El merge se hace campo por campo (ver configEfectiva); un spread de primer nivel dejaría la otra punta sin valor.';

COMMENT ON COLUMN propiedad.agente_captador_id IS
  'Quién captó la propiedad. Pre-llena el captador del reparto de comisiones, como valor por defecto EDITABLE: el que captó no siempre es el que cargó la ficha.';
