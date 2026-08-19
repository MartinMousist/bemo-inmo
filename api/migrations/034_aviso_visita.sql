-- 034 — El aviso de visita agendada, que estaba declarado y nadie emitía.
--
-- `visita_agendada` figura en el CHECK de `evento_programado` desde la
-- migración 010 y **ningún bloque del generador lo emite**. La tabla `visita`
-- existe desde la 006 con su fecha, su agente y su estado; agendar y editar ya
-- funcionan desde la ficha del lead.
--
-- O sea: la mitad de esta feature estaba construida y no se notaba, que es el
-- error #3 del playbook otra vez. Lo que falta es el aviso y la agenda.
--
-- ── Por qué un solo día y no tres ──
--
-- Los otros avisos son de cosas que se preparan con semanas: un contrato que
-- vence, un aumento que hay que notificar. Una visita se confirma el día
-- anterior y punto. Avisar con treinta días de anticipación de una visita que
-- se agendó para mañana sería ruido, y la bandeja que grita se aprende a
-- ignorar.

ALTER TABLE tenant ALTER COLUMN avisos SET DEFAULT
  '{"contrato_por_vencer": [90, 60, 30],
    "ajuste_por_aplicar": [30, 15],
    "reserva_por_vencer": [7, 3],
    "garantia_por_vencer": [30],
    "garantia_revision_bcra": [0],
    "visita_agendada": [1],
    "cuota_impaga": [0, 5, 15]}'::jsonb;

-- Las inmobiliarias que ya existen lo reciben también: sin esto, el aviso
-- nuevo sólo lo tendría quien se dé de alta a partir de hoy, y el default sería
-- una promesa que la mitad de las cuentas no ve.
UPDATE tenant
   SET avisos = jsonb_set(avisos, '{visita_agendada}', '[1]'::jsonb)
 WHERE NOT (avisos ? 'visita_agendada');

-- La agenda pregunta «qué tengo esta semana» filtrando por agente y fecha, y el
-- índice de la 006 es `(tenant_id, fecha_hora)`. Alcanza: el filtro por agente
-- cae sobre las pocas filas que quedan del rango, no al revés.
