-- 038 · Inbox omnicanal: cuentas de canal, conversaciones y mensajes
--
-- ── El agujero que tapa ──
--
-- El lead entra por WhatsApp, por Instagram o por mail, y hoy la conversación
-- vive en la app de cada canal. El sistema sabe que el lead existe
-- —`oportunidad.origen` desde la etapa 3— y **no tiene una sola línea de lo que
-- se habló**. Cuando el asesor que atendió se va, se va la conversación con él.
--
-- ── Tres tablas y por qué son tres ──
--
-- `canal_cuenta` es UNA cuenta conectada: un número de WhatsApp por Twilio, un
-- bot de Telegram, una casilla. Son varias por inmobiliaria a propósito —ventas
-- y administración no comparten número— y de ahí sale el permiso por canal.
--
-- `conversacion` es el HILO con una persona en una cuenta. No por canal: si el
-- mismo cliente escribe por WhatsApp y por Telegram son dos hilos, porque son
-- dos identidades que todavía no sabemos que son la misma. Unificarlas es un
-- problema aparte y adivinarlo mal mezcla las conversaciones de dos personas.
--
-- `mensaje` es cada línea, con su id del proveedor para que un webhook
-- reintentado no duplique. **Un mensaje repetido en un hilo es peor que uno que
-- falta**: el que falta se nota y se pregunta; el repetido se lee como que el
-- cliente insistió.
--
-- ── Las credenciales ──
--
-- El token de Twilio y el del bot de Telegram son la llave para escribirle a
-- los clientes de esa inmobiliaria haciéndose pasar por ella. Van cifrados con
-- `pgcrypto`: un dump de la base no alcanza para robarlos. La clave vive en el
-- entorno (`CANALES_SECRETO`), o sea fuera de la base, que es lo único que hace
-- que cifrar signifique algo.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- canal_cuenta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE canal_cuenta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,

  -- El canal es lo que ve el cliente; el proveedor es por dónde sale.
  -- Se separan porque WhatsApp se puede mandar por Twilio HOY y por la API
  -- oficial de Meta cuando la verificación esté: mismo canal, otro proveedor,
  -- y las conversaciones no se enteran.
  canal         text NOT NULL CHECK (canal IN
                  ('whatsapp','telegram','email','instagram','facebook','sms')),
  proveedor     text NOT NULL CHECK (proveedor IN ('twilio','telegram','smtp','meta')),

  -- Lo que el agente ve en el selector: «Ventas», «Administración».
  nombre        text NOT NULL,
  -- El número, el @usuario del bot, la casilla o el id de página.
  identificador text NOT NULL,

  -- Cifrado con pgcrypto. NUNCA sale por la API: ver `app_canal_secreto`.
  secreto       bytea,
  -- Lo que no es secreto: account sid, page id, host de SMTP, reglas del bot.
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,

  activa        boolean NOT NULL DEFAULT true,

  -- La ruta pública por donde entra el webhook del proveedor.
  --
  -- Impredecible y ÚNICA GLOBALMENTE: el webhook llega sin sesión —el proveedor
  -- no tiene cómo autenticarse contra nosotros— así que este token es lo que
  -- dice de qué inmobiliaria es el mensaje. Sin él habría que confiar en un
  -- campo del cuerpo, que lo escribe quien quiera.
  webhook_token text NOT NULL UNIQUE,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, canal, identificador)
);

CREATE INDEX ix_canal_cuenta_tenant ON canal_cuenta (tenant_id, canal);

-- ─────────────────────────────────────────────────────────────────────────────
-- conversacion
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE conversacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  canal_cuenta_id  uuid NOT NULL,

  -- Quién es del otro lado, en las coordenadas del canal: el chat_id de
  -- Telegram, el `whatsapp:+549…` de Twilio, la dirección de correo.
  contacto_externo text NOT NULL,
  -- Como se llama según el canal. Es lo único que hay antes de identificarlo.
  contacto_nombre  text,

  -- Se llenan cuando se identifica a la persona. Nulos NO son un error: el
  -- primer mensaje de un desconocido es el caso normal, y forzar a crear una
  -- persona para poder contestar es lo que hace que nadie use la bandeja.
  persona_id       uuid,
  oportunidad_id   uuid,

  estado           text NOT NULL DEFAULT 'abierta'
                     CHECK (estado IN ('abierta','resuelta','archivada','bloqueada')),

  asignado_a       uuid REFERENCES usuario(id) ON DELETE SET NULL,

  no_leido         boolean NOT NULL DEFAULT true,

  -- ── El bot ──
  --
  -- `bot_activo` lo apaga una persona para esta conversación y no vuelve solo.
  -- `bot_pausado_hasta` es el otro caso: el agente contestó, así que el bot se
  -- calla un rato y se reactiva SOLO. Son dos cosas distintas y por eso son dos
  -- columnas: apagarlo a mano tiene que sobrevivir al reloj.
  bot_activo       boolean NOT NULL DEFAULT true,
  bot_pausado_hasta timestamptz,

  -- ── La ventana de 24 horas ──
  --
  -- Regla de WhatsApp, no nuestra: pasadas 24 h del último mensaje del cliente
  -- sólo se le puede mandar una plantilla aprobada. Se guarda para que la
  -- pantalla lo DIGA antes de que alguien escriba un mensaje que va a rebotar.
  ventana_vence_el timestamptz,

  ultimo_mensaje_el   timestamptz,
  -- El último ENTRANTE, aparte: es el que contesta «¿a quién le estoy quedando
  -- mal?», que es la única pregunta que se le hace a una bandeja a la mañana.
  ultimo_entrante_el  timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, canal_cuenta_id, contacto_externo),

  -- Compuestas con tenant_id, como manda la 035: los chequeos de integridad de
  -- Postgres pasan por encima de RLS, y una FK simple acepta el id de otra
  -- inmobiliaria.
  FOREIGN KEY (tenant_id, canal_cuenta_id) REFERENCES canal_cuenta (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, persona_id)      REFERENCES persona (tenant_id, id) ON DELETE SET NULL (persona_id),
  FOREIGN KEY (tenant_id, oportunidad_id)  REFERENCES oportunidad (tenant_id, id) ON DELETE SET NULL (oportunidad_id)
);

CREATE INDEX ix_conversacion_bandeja
  ON conversacion (tenant_id, estado, ultimo_entrante_el DESC NULLS LAST);
CREATE INDEX ix_conversacion_asignado ON conversacion (tenant_id, asignado_a)
  WHERE asignado_a IS NOT NULL;

-- `asignado_a` llega DESDE EL CUERPO de un request, así que va con el
-- disparador de la 035/037: sin esto se le puede asignar una conversación a un
-- usuario de otra inmobiliaria y el hilo desaparece de todas las pantallas.
CREATE CONSTRAINT TRIGGER tg_conversacion_asignado_del_tenant
  AFTER INSERT OR UPDATE OF asignado_a ON conversacion
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('asignado_a');

-- ─────────────────────────────────────────────────────────────────────────────
-- mensaje
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE mensaje (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  conversacion_id  uuid NOT NULL,

  direccion        text NOT NULL CHECK (direccion IN ('entrante','saliente')),

  -- Quién lo escribió. `bot` y `sistema` se distinguen a propósito: uno es una
  -- respuesta automática que el cliente ve, el otro es una anotación del
  -- sistema («se derivó a Ana») que explica el hilo al que lo lee después.
  autor_tipo       text NOT NULL CHECK (autor_tipo IN ('cliente','agente','bot','sistema')),
  autor_usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL,

  cuerpo           text,
  adjuntos         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- El id del proveedor. Es la clave de idempotencia del webhook.
  id_externo       text,

  estado           text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','enviado','entregado','leido','fallido','recibido')),
  error            text,

  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversacion_id) REFERENCES conversacion (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_mensaje_hilo ON mensaje (tenant_id, conversacion_id, created_at);

-- Idempotencia. Parcial porque un mensaje NUESTRO todavía sin despachar no
-- tiene id del proveedor, y en Postgres `NULL != NULL`: sin el `WHERE`, un
-- UNIQUE no restringe nada sobre las filas donde la columna es nula —y eso ya
-- pasó en este repo con las cotizaciones—.
CREATE UNIQUE INDEX ux_mensaje_id_externo
  ON mensaje (tenant_id, id_externo) WHERE id_externo IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE canal_cuenta  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversacion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensaje       ENABLE ROW LEVEL SECURITY;

CREATE POLICY canal_cuenta_del_tenant ON canal_cuenta
  USING (tenant_id = app_current_tenant());
CREATE POLICY conversacion_del_tenant ON conversacion
  USING (tenant_id = app_current_tenant());
CREATE POLICY mensaje_del_tenant ON mensaje
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON canal_cuenta, conversacion, mensaje TO app_role;

CREATE TRIGGER tg_canal_cuenta_updated BEFORE UPDATE ON canal_cuenta
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
CREATE TRIGGER tg_conversacion_updated BEFORE UPDATE ON conversacion
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- El secreto del canal, cifrado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER y sin `SELECT secreto` para nadie más: el token sale de la
-- base SÓLO por acá, y sólo para el despachador. Un endpoint que devuelva el
-- token —aunque sea a un owner— es un token que termina en un log del navegador.
CREATE OR REPLACE FUNCTION app_canal_secreto(p_cuenta uuid, p_clave text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN c.secreto IS NULL THEN NULL
              ELSE pgp_sym_decrypt(c.secreto, p_clave) END
    FROM canal_cuenta c WHERE c.id = p_cuenta;
$$;

CREATE OR REPLACE FUNCTION app_canal_guardar_secreto(p_cuenta uuid, p_secreto text, p_clave text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE canal_cuenta
     SET secreto = CASE WHEN p_secreto IS NULL OR p_secreto = ''
                        THEN NULL ELSE pgp_sym_encrypt(p_secreto, p_clave) END
   WHERE id = p_cuenta;
$$;

-- Resuelve el webhook entrante: de qué inmobiliaria y qué cuenta es este token.
-- SECURITY DEFINER porque el webhook llega SIN contexto de inmobiliaria —es
-- justamente lo que viene a averiguar—.
CREATE OR REPLACE FUNCTION app_canal_por_webhook(p_token text)
RETURNS TABLE (id uuid, tenant_id uuid, canal text, proveedor text, config jsonb, activa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.tenant_id, c.canal, c.proveedor, c.config, c.activa
    FROM canal_cuenta c WHERE c.webhook_token = p_token;
$$;

REVOKE ALL ON FUNCTION app_canal_secreto(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_canal_guardar_secreto(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_canal_secreto(uuid, text) TO app_role;
GRANT EXECUTE ON FUNCTION app_canal_guardar_secreto(uuid, text, text) TO app_role;
GRANT EXECUTE ON FUNCTION app_canal_por_webhook(text) TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que ya existía y hay que ampliar
-- ─────────────────────────────────────────────────────────────────────────────

-- Los orígenes nuevos de un lead.
ALTER TABLE oportunidad DROP CONSTRAINT IF EXISTS oportunidad_origen_check;
ALTER TABLE oportunidad ADD CONSTRAINT oportunidad_origen_check CHECK (origen IN
  ('portal','web','whatsapp','telefono','referido','cartel','redes','otro',
   'telegram','email','instagram','facebook','meta'));

-- Dos avisos nuevos, y son el corazón del pedido: que el sistema avise CUÁNDO
-- HACE FALTA UNA PERSONA.
--
--   `conversacion_escalada`   — el bot se rindió, o el cliente pidió un humano.
--   `conversacion_sin_responder` — nadie contestó en el plazo configurado.
ALTER TABLE evento_programado DROP CONSTRAINT IF EXISTS evento_programado_tipo_check;
ALTER TABLE evento_programado ADD CONSTRAINT evento_programado_tipo_check CHECK (tipo IN
  ('contrato_por_vencer','ajuste_por_aplicar','cuota_impaga','reserva_por_vencer',
   'visita_agendada','garantia_por_vencer','garantia_revision_bcra',
   'conversacion_escalada','conversacion_sin_responder'));

COMMIT;
