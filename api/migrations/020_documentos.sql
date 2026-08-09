-- 020 — Los documentos generados: qué salió, quién lo hizo y por dónde se mandó.
--
-- El motor de plantillas está entero desde la etapa 4 y probado: `generar()`
-- arma el pre-contrato con las partes, los montos, el plazo y el índice reales.
-- Lo que hace hasta hoy es **renderizar y devolver un string**. Nada más.
--
-- O sea que el sistema no sabe responder ninguna de estas tres preguntas, que
-- son las que se hacen de verdad en una inmobiliaria:
--
--   · «¿Qué pre-contrato le mandamos a esta gente?» — el texto no se guardó.
--   · «¿Quién lo generó y cuándo?» — no hay fila que lo diga.
--   · «¿Se lo mandamos o quedó en el escritorio de alguien?» — tampoco.
--
-- Y hay una cuarta, que es la que obliga a hacerlo ahora: PlantillasPage ya le
-- promete al usuario, en el diálogo de borrar una plantilla, que «los documentos
-- que ya se generaron con ella no se tocan». Hoy eso es cierto por la peor de
-- las razones —no se guarda ninguno—. Con esta tabla pasa a ser una promesa que
-- el schema tiene que sostener, y por eso el nombre y el tipo de la plantilla
-- viajan CONGELADOS en la fila del documento.
--
-- Dos tablas y no una: un mismo pre-contrato se manda por WhatsApp al inquilino,
-- por mail al garante y después se imprime. Son tres hechos, no uno que se pisa.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · El documento.
--
-- `texto_generado` y `texto_final` van SEPARADOS a propósito. La diferencia
-- entre los dos es la respuesta a «¿qué le cambiaron al modelo antes de
-- mandarlo?», que en un papel con efecto legal es media auditoría: si alguien
-- le sacó la cláusula del depósito al pre-contrato, eso tiene que poder verse
-- seis meses después sin depender de que se acuerde.
--
-- `contrato_id` es NOT NULL y no hay `venta_id`: `generar()` hoy sólo sabe de
-- contratos de alquiler, y una columna que nadie escribe es el error #3 del
-- playbook. Cuando exista el pre-contrato de venta se agrega con su servicio y
-- su pantalla en el mismo movimiento, como manda el método.
--
-- `plantilla_id` con SET NULL y el nombre congelado al lado: borrar la plantilla
-- no puede llevarse puesto el documento que ya salió impreso.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE documento_generado (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contrato_id     uuid NOT NULL REFERENCES contrato_alquiler(id) ON DELETE CASCADE,

  plantilla_id    uuid REFERENCES plantilla_doc(id) ON DELETE SET NULL,
  -- Congelados. Si la plantilla se borra o se le cambia el nombre, el historial
  -- sigue diciendo con qué modelo salió este papel.
  plantilla_nombre text NOT NULL,
  plantilla_tipo   text NOT NULL,

  titulo          text,
  -- Lo que produjo el motor, tal cual. No se toca nunca.
  texto_generado  text NOT NULL,
  -- Lo que la persona dejó después de editarlo. Igual al anterior si no editó.
  texto_final     text NOT NULL,
  -- Las variables que quedaron sin dato al generar. Se guardan porque explican
  -- por qué el texto tiene huecos, y porque un documento con huecos que igual se
  -- mandó es un dato de gestión.
  faltantes       text[] NOT NULL DEFAULT '{}',

  generado_por    uuid REFERENCES usuario(id) ON DELETE SET NULL,
  -- La marca de que ya salió. La pone el trigger del primer envío; a partir de
  -- ahí `texto_final` queda congelado.
  primer_envio_el timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN documento_generado.texto_generado IS
  'Lo que produjo el motor de plantillas. Inmutable: contra esto se compara texto_final para saber qué se editó.';
COMMENT ON COLUMN documento_generado.plantilla_nombre IS
  'Congelado al generar. Borrar la plantilla no borra el documento ni le saca el nombre con el que salió.';
COMMENT ON COLUMN documento_generado.primer_envio_el IS
  'Cuándo se abrió el primer canal. NULL = todavía no salió y el texto se puede editar.';

CREATE INDEX ix_documento_contrato ON documento_generado (contrato_id, created_at DESC);
CREATE INDEX ix_documento_tenant ON documento_generado (tenant_id, created_at DESC);

CREATE TRIGGER documento_touch BEFORE UPDATE ON documento_generado
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Por dónde salió.
--
-- ⚠️ La columna se llama `abierto_el` y **NO** `enviado_el`, y no es una
-- preferencia de estilo. El sistema no manda nada: abre `wa.me` o `mailto:` en
-- el dispositivo del usuario, con el texto cargado. La persona puede cerrar la
-- ventana sin apretar enviar. Escribir «enviado el 06/08» sería afirmar un
-- hecho que nadie verificó, en el historial de un papel con efecto legal — es
-- exactamente la regla que este producto ya tiene escrita para el cobro («no
-- integrado, y la app lo dice en vez de simularlo») y para los portales.
--
-- `destino` guarda el teléfono o el mail que REALMENTE se usó, no el de la
-- ficha: alguien puede corregirlo antes de abrir el canal, y lo que importa
-- después es adónde fue.
--
-- `impresion`, `descarga` y `copia` también son canales. Un pre-contrato que se
-- imprimió y se entregó en mano salió igual que uno mandado por mail, y si el
-- historial sólo anotara los dos canales electrónicos, la mitad de las entregas
-- de una inmobiliaria de barrio no existirían para el sistema.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE documento_envio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  documento_id uuid NOT NULL REFERENCES documento_generado(id) ON DELETE CASCADE,

  canal        text NOT NULL CHECK (canal IN (
                 'whatsapp', 'email', 'impresion', 'descarga', 'copia')),
  -- El teléfono o el mail que se usó. NULL para imprimir, copiar y descargar:
  -- ahí no hay destinatario, y poner "—" sería inventar uno.
  destino      text,
  -- La URL que el sistema abrió, tal cual. Sirve para explicar después por qué
  -- el mensaje salió con carátula en vez de con el texto entero.
  url_abierta  text,
  -- 'completo' = el texto viajó en la URL · 'adjunto' = no entraba y fue archivo.
  modo         text CHECK (modo IN ('completo', 'adjunto')),
  caracteres   integer,

  abierto_el   timestamptz NOT NULL DEFAULT now(),
  abierto_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  nota         text
);

COMMENT ON TABLE documento_envio IS
  'Cada vez que se abrió un canal para este documento. «Abierto», no «enviado»: el sistema abre wa.me o mailto:, no manda el mensaje.';
COMMENT ON COLUMN documento_envio.modo IS
  'completo = el texto entró en la URL. adjunto = no entraba en el límite del canal y fue como archivo con una carátula.';

CREATE INDEX ix_documento_envio ON documento_envio (documento_id, abierto_el DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · El congelado.
--
-- Un documento que ya salió es el que salió. Editarle el texto después haría
-- que el historial muestre una versión que el destinatario nunca recibió — y
-- ese historial es justo lo que se mira cuando hay una discusión sobre qué
-- decía el pre-contrato.
--
-- Es la misma regla que un ajuste confirmado (`app_ajuste_inmutable` en la 007)
-- y que una liquidación cerrada. Y va en la BASE y no sólo en el servicio: una
-- regla de inmutabilidad que vive únicamente en TypeScript se esquiva con un
-- script de mantenimiento a la una de la mañana.
--
-- Lo que SÍ se puede seguir cambiando es el título: es una etiqueta para
-- encontrarlo en la lista, no el papel.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_documento_congelado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.primer_envio_el IS NOT NULL THEN
    IF NEW.texto_final <> OLD.texto_final
       OR NEW.texto_generado <> OLD.texto_generado THEN
      RAISE EXCEPTION
        'Este documento ya se mandó. El texto que salió es el que queda; generá uno nuevo.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documento_congelado BEFORE UPDATE ON documento_generado
  FOR EACH ROW EXECUTE FUNCTION app_documento_congelado();

-- El primer envío marca el padre. Va por trigger y no desde el servicio porque
-- es la condición que dispara el congelado de arriba: si la escribiera la
-- aplicación, un INSERT en `documento_envio` hecho por cualquier otro camino
-- dejaría un documento mandado que todavía se puede editar.
CREATE OR REPLACE FUNCTION app_documento_marcar_envio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documento_generado
     SET primer_envio_el = NEW.abierto_el
   WHERE id = NEW.documento_id
     AND primer_envio_el IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER documento_envio_marca AFTER INSERT ON documento_envio
  FOR EACH ROW EXECUTE FUNCTION app_documento_marcar_envio();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · RLS y permisos.
--
-- Sin el GRANT, el rol de la aplicación no ve la tabla y el test de seguridad
-- —que recorre `pg_class` pidiendo policy en todo lo que tenga `tenant_id`—
-- falla. Está bien que falle: un pre-contrato tiene los DNI y los domicilios de
-- las partes, y es exactamente el tipo de fila que no puede cruzar de una
-- inmobiliaria a otra.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE documento_generado ENABLE ROW LEVEL SECURITY;
CREATE POLICY documento_aislamiento ON documento_generado
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON documento_generado TO app_role;

ALTER TABLE documento_envio ENABLE ROW LEVEL SECURITY;
CREATE POLICY documento_envio_aislamiento ON documento_envio
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON documento_envio TO app_role;
