-- 019 — Garantes: la revisión periódica del BCRA, su historial y los cheques.
--
-- La 018 dejó el control de la Central de Deudores funcionando y CONGELADO: se
-- guarda lo que el BCRA respondió el día que se consultó. Eso está bien y no se
-- toca. El problema es el otro: **la consulta se hace una vez y nunca más**, y
-- un contrato de alquiler dura tres años. Un garante aprobado en enero puede
-- estar en situación 3 en junio, y hoy nadie se entera.
--
-- Volver a consultar parece un `UPDATE` y no lo es. Si la segunda consulta pisa
-- `garantia.bcra_*`, destruye exactamente el dato que la 018 se propuso guardar:
-- «por qué lo aceptamos» deja de tener respuesta en el momento en que se
-- averigua que hoy está peor. Por eso acá hay una tabla de historial y no una
-- columna más.
--
-- Cuatro bloques:
--   1. la fecha de la próxima revisión y el cache de los cheques rechazados,
--   2. `garantia_bcra_consulta` — todas las consultas, con RLS y su backfill,
--   3. el tipo de evento nuevo en el CHECK de `evento_programado`,
--   4. la clave nueva en `tenant.avisos`, con UPDATE a los que ya existen.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Cuándo hay que volver a mirar, y qué dijeron los cheques.
--
-- `bcra_revisar_el` la calcula el servicio al consultar, no un trigger: la regla
-- mira el largo del contrato y la fecha de vencimiento de la garantía, y esa
-- cuenta vive en un motor puro que se puede probar sin base.
--
-- ⚠️ NULL en `bcra_revisar_el` significa **no hay que revisar**, y eso pasa en
-- dos casos muy distintos: el contrato es corto, o el garante nunca se consultó.
-- No es un "revisar ya": un garante sin consultar ya aparece como pendiente por
-- otro lado y duplicarlo acá sólo haría ruido.
--
-- `bcra_cheques` es CACHE de la última consulta —el historial es la fuente— y
-- puede quedar en NULL con `bcra_consultado_el` cargado: significa que las
-- deudas se pudieron consultar y los cheques no. Ese caso se muestra tal cual en
-- la pantalla en vez de tirar a la basura la consulta buena.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE garantia
  ADD COLUMN bcra_revisar_el date,
  ADD COLUMN bcra_cheques    jsonb;

COMMENT ON COLUMN garantia.bcra_revisar_el IS
  'Fecha en la que corresponde volver a consultar la Central de Deudores. NULL = no corresponde (contrato corto, o todavía sin consultar).';
COMMENT ON COLUMN garantia.bcra_cheques IS
  'Cache del veredicto de cheques rechazados de la ÚLTIMA consulta. NULL con bcra_consultado_el cargado = no se pudieron consultar.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · El historial. Una fila por consulta, y ninguna se pisa.
--
-- La PRIMERA fila de cada garantía es la que respaldó la firma; la última es la
-- foto de hoy. No hay columna «respaldó la firma» a propósito: es la de
-- `consultado_el` más viejo y un dato derivado no se desincroniza — la misma
-- decisión que los roles de una persona en la etapa 3.
--
-- `situacion` acepta NULL: una consulta que no encontró a nadie informándolo es
-- una consulta válida y su veredicto es «sin deuda bancaria». El CHECK
-- 1..6 es el mismo de la 018.
--
-- ⚠️ Ojo con `Deudas/Historicas`, que devuelve `situacion: 0` y reventaría este
-- CHECK. Acá no se guarda el histórico del BCRA, se guarda el histórico de
-- NUESTRAS consultas, que es otra cosa; queda anotado porque la confusión es
-- fácil y el error saldría recién en producción.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE garantia_bcra_consulta (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  garantia_id    uuid NOT NULL REFERENCES garantia(id) ON DELETE CASCADE,

  consultado_el  timestamptz NOT NULL DEFAULT now(),
  -- Quién apretó el botón. La re-consulta la dispara una persona y no un cron
  -- —ver el comentario del bloque 4— así que siempre hay alguien detrás.
  consultado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,

  cuit           text,
  denominacion   text,
  situacion      smallint CHECK (situacion BETWEEN 1 AND 6),
  periodo        text,
  apto           boolean,
  motivo         text,
  -- La respuesta entera de Deudas: entidades, advertencias y los CUIL probados.
  detalle        jsonb,
  -- El veredicto de cheques rechazados. NULL = no se pudieron consultar.
  cheques        jsonb,
  -- Por qué no se pudieron. Se guarda el motivo y no un booleano: «el BCRA
  -- devolvió 429» y «se cortó la red» se arreglan de manera distinta.
  cheques_error  text,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_garantia_bcra_consulta ON garantia_bcra_consulta (garantia_id, consultado_el DESC);

ALTER TABLE garantia_bcra_consulta ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantia_bcra_consulta_aislamiento ON garantia_bcra_consulta
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON garantia_bcra_consulta TO app_role;

-- Backfill: lo que hoy está congelado en `garantia.bcra_*` es la primera
-- consulta de cada legajo. Sin esto, la primera revisión que alguien haga
-- después de esta migración se vería como si fuera la única que hubo, y el dato
-- que respaldó la firma quedaría fuera del historial justo cuando empieza a
-- importar.
INSERT INTO garantia_bcra_consulta
  (tenant_id, garantia_id, consultado_el, cuit, denominacion, situacion,
   periodo, apto, motivo, detalle)
SELECT g.tenant_id, g.id, g.bcra_consultado_el, g.bcra_cuit, g.bcra_denominacion,
       g.bcra_situacion, g.bcra_periodo,
       (g.bcra_detalle->>'apto')::boolean, g.bcra_detalle->>'motivo', g.bcra_detalle
  FROM garantia g
 WHERE g.bcra_consultado_el IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · El tipo de evento nuevo.
--
-- `evento_programado_tipo_check` enumera los seis tipos de la 010 y
-- `garantia_revision_bcra` no está. Sin tocar la constraint el INSERT falla con
-- 23514 y se cae el generador ENTERO —incluidos los cuatro avisos que hoy
-- funcionan—, porque `generar()` corre todo en la misma transacción.
--
-- El nombre de la constraint está verificado contra la base (`\d
-- evento_programado`); es el que Postgres genera solo, no uno inventado.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE evento_programado DROP CONSTRAINT evento_programado_tipo_check;
ALTER TABLE evento_programado ADD CONSTRAINT evento_programado_tipo_check
  CHECK (tipo IN (
    'contrato_por_vencer', 'ajuste_por_aplicar', 'cuota_impaga',
    'reserva_por_vencer', 'visita_agendada', 'garantia_por_vencer',
    'garantia_revision_bcra'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · La configuración del aviso nuevo.
--
-- `generar()` lee `avisos.<tipo> ?? []` y itera: sin la clave, el bucle no da
-- ni una vuelta y el emisor nuevo no corre PARA NADIE. Cambiar sólo el DEFAULT
-- alcanza para las inmobiliarias que se creen de acá en adelante y deja afuera
-- a todas las que ya existen. La 017 sentó el precedente de actualizar también
-- las filas cargadas.
--
-- `[0]` = el día que toca revisar, sin anticipo. Los otros avisos avisan antes
-- porque hay algo que preparar; acá la acción es apretar un botón y adelantarla
-- sólo haría que la revisión se hiciera antes de lo que se decidió.
--
-- El UPDATE es idempotente por el WHERE: correr la migración sobre una base que
-- ya la tiene no pisa lo que el usuario haya configurado.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenant ALTER COLUMN avisos SET DEFAULT
  '{"contrato_por_vencer": [90, 60, 30],
    "ajuste_por_aplicar": [30, 15],
    "reserva_por_vencer": [7, 3],
    "garantia_por_vencer": [30],
    "garantia_revision_bcra": [0],
    "cuota_impaga": [0, 5, 15]}'::jsonb;

UPDATE tenant
   SET avisos = jsonb_set(avisos, '{garantia_revision_bcra}', '[0]'::jsonb)
 WHERE NOT (avisos ? 'garantia_revision_bcra');
