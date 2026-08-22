-- 052 · Alertas de mora, y mensajes entre la gente de la oficina
--
-- ═══ DOS ALERTAS QUE NO SON «CUOTA IMPAGA» ═══
--
-- Ya existe `cuota_impaga`, que avisa por CADA cuota a los N días de vencida.
-- Sirve para cobrar, y es lo que se mira todos los días.
--
-- Las dos que se agregan contestan otra pregunta, y por eso no son la misma:
--
-- **`mora_prolongada`** — no es «hay una cuota impaga», es «este inquilino
-- lleva más de tres días sin pagar». La diferencia importa: la primera es
-- rutina de cobranza, la segunda es el momento de levantar el teléfono.
--
-- **`mora_reincidente`** — es sobre la PERSONA y no sobre la cuota: ya se
-- atrasó más de una vez. Eso no lo dice ninguna cuota mirada de a una, y es
-- justo lo que hay que saber antes de renovarle el contrato — y lo que alimenta
-- el semáforo de la migración 051.
--
-- Las dos van sobre el CONTRATO y no sobre el período: si fueran por cuota,
-- alguien con cuatro meses de atraso recibiría cuatro avisos idénticos el mismo
-- día, que es exactamente el ruido que la bandeja de Inicio ya tuvo que
-- arreglar agrupando por deudor.
--
-- ═══ MENSAJES ENTRE USUARIOS ═══
--
-- No es la bandeja omnicanal: aquella habla con gente de AFUERA —inquilinos,
-- interesados— por WhatsApp, mail o Instagram. Esto es entre la gente de la
-- oficina, y por eso no tiene canal, ni bot, ni plantillas.
--
-- Lo que sí tiene y la otra no: **una referencia a algo del sistema**. «Mirá
-- esta propiedad», «este contrato vence», «este inquilino debe». Un chat
-- interno sin eso es un WhatsApp peor; con eso, es el lugar donde se pasa el
-- trabajo.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A · Los dos tipos de alerta nuevos
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE evento_programado DROP CONSTRAINT evento_programado_tipo_check;
ALTER TABLE evento_programado ADD CONSTRAINT evento_programado_tipo_check
  CHECK (tipo IN (
    'contrato_por_vencer', 'ajuste_por_aplicar', 'cuota_impaga',
    'reserva_por_vencer', 'visita_agendada', 'garantia_por_vencer',
    'garantia_revision_bcra', 'conversacion_escalada', 'conversacion_sin_responder',
    'mora_prolongada', 'mora_reincidente'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- B · Mensajes entre usuarios
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Un hilo entre dos o más personas de la oficina.
 *
 * Sin nombre ni asunto: un hilo interno se identifica por con QUIÉN es, igual
 * que en cualquier mensajería. Pedir un asunto para escribirle «¿viste la de
 * Belgrano?» a la persona de al lado es una fricción que hace que se use el
 * WhatsApp personal, que es justo lo que esto viene a evitar.
 */
CREATE TABLE hilo_interno (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  creado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  -- El último mensaje, para ordenar la lista sin tocar `mensaje_interno`.
  ultimo_el  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE hilo_participante (
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  hilo_id    uuid NOT NULL,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- Hasta dónde leyó ESTA persona. El no-leído es por participante, no por
  -- hilo: que alguien lo abra no lo marca leído para el resto.
  leido_el   timestamptz,
  PRIMARY KEY (hilo_id, usuario_id),
  FOREIGN KEY (tenant_id, hilo_id) REFERENCES hilo_interno (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE mensaje_interno (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  hilo_id    uuid NOT NULL,
  autor_id   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  texto      text NOT NULL CHECK (length(trim(texto)) > 0),

  /*
   * La referencia a algo del sistema.
   *
   * Es lo que separa esto de un WhatsApp: «mirá esta propiedad» con el enlace
   * adentro, y el que lo recibe llega de un toque. Se guarda el TIPO y el ID y
   * no una URL, porque una URL guardada se rompe el día que cambie una ruta —
   * y estos mensajes duran.
   */
  ref_tipo   text CHECK (ref_tipo IS NULL OR ref_tipo IN (
               'propiedad', 'contrato', 'persona', 'liquidacion', 'reclamo', 'aviso')),
  ref_id     uuid,
  CONSTRAINT ref_completa CHECK ((ref_tipo IS NULL) = (ref_id IS NULL)),

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, hilo_id) REFERENCES hilo_interno (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_mensaje_interno_hilo ON mensaje_interno (hilo_id, created_at);
CREATE INDEX ix_hilo_participante_usuario ON hilo_participante (usuario_id);
CREATE INDEX ix_hilo_reciente ON hilo_interno (tenant_id, ultimo_el DESC);

ALTER TABLE hilo_interno      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hilo_participante ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensaje_interno   ENABLE ROW LEVEL SECURITY;

-- RLS acota por INMOBILIARIA. Que además sólo veas TUS hilos lo pone la
-- consulta: mezclarlo en la policy haría que una consulta sin `usuario_id`
-- devuelva vacío en vez de fallar, y ese error no se ve.
CREATE POLICY hilo_del_tenant ON hilo_interno USING (tenant_id = app_current_tenant());
CREATE POLICY hilo_part_del_tenant ON hilo_participante USING (tenant_id = app_current_tenant());
CREATE POLICY mensaje_int_del_tenant ON mensaje_interno USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON hilo_interno, hilo_participante, mensaje_interno TO app_role;

CREATE CONSTRAINT TRIGGER tg_hilo_creador_del_tenant
  AFTER INSERT OR UPDATE OF creado_por ON hilo_interno
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('creado_por');

CREATE CONSTRAINT TRIGGER tg_hilo_part_del_tenant
  AFTER INSERT OR UPDATE OF usuario_id ON hilo_participante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('usuario_id');

CREATE CONSTRAINT TRIGGER tg_mensaje_int_autor_del_tenant
  AFTER INSERT OR UPDATE OF autor_id ON mensaje_interno
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('autor_id');

COMMIT;
