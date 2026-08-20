-- 039 · Respuestas rápidas (plantillas de chat)
--
-- ── Por qué NO se reusa `plantilla_doc` ──
--
-- `plantilla_doc` es de la etapa 14: HTML de un pre-contrato, editado con un
-- editor tipo Word, pensado para imprimirse. Esto es otra cosa: dos líneas de
-- texto plano que un asesor manda veinte veces por día desde el teléfono.
-- Compartir la tabla obligaría a que cada respuesta rápida cargue el editor
-- entero y a que cada pre-contrato tenga un canal — dos features tirándose del
-- mismo modelo hasta romperlo.
--
-- ── Las variables ──
--
-- `{nombre}`, `{inmobiliaria}`, `{agente}`. Se reemplazan AL ENVIAR y no al
-- guardar: la misma plantilla la usan cinco asesores para cien clientes, y
-- resolverlas al guardar dejaría el nombre del primero pegado para siempre.
--
-- Llaves simples y no `{{dobles}}` como el editor de documentos: acá lo escribe
-- alguien apurado en un formulario chico, no en un editor. La forma más corta
-- es la que se usa bien.

BEGIN;

CREATE TABLE respuesta_rapida (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  nombre     text NOT NULL,
  cuerpo     text NOT NULL,

  -- `NULL` = sirve para todos los canales. Existe porque lo que se manda por
  -- WhatsApp no es lo que se manda por mail: el mismo texto con «Hola!» va bien
  -- en un chat y suena raro en un correo.
  canal      text CHECK (canal IN
               ('whatsapp','telegram','email','instagram','facebook','sms')),

  -- Para buscarla tecleando en vez de scrollear una lista de cuarenta.
  atajo      text,

  activa     boolean NOT NULL DEFAULT true,
  usos       integer NOT NULL DEFAULT 0,

  creada_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, nombre)
);

CREATE INDEX ix_respuesta_rapida_canal ON respuesta_rapida (tenant_id, canal);

ALTER TABLE respuesta_rapida ENABLE ROW LEVEL SECURITY;
CREATE POLICY respuesta_rapida_del_tenant ON respuesta_rapida
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON respuesta_rapida TO app_role;

CREATE TRIGGER tg_respuesta_rapida_updated BEFORE UPDATE ON respuesta_rapida
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

COMMIT;
