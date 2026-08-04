-- 013 — Los huecos del dominio: punitorios, depósito, renovación y auditoría.
--
-- Todo lo de acá cierra columnas que YA existían y que nadie leía. Es el error
-- #3 del playbook —una tabla que ningún código usa es una feature que no
-- existe— y en tres de los cuatro casos había además una promesa hecha:
--
--   · `punitorio_diario_pct` se cargaba, se guardaba y **se imprimía en el
--     contrato** ("devengará un interés punitorio del X% diario"), y ningún
--     código lo calculaba. El sistema imprimía una cláusula que no aplicaba.
--   · `contrato_anterior_id` existía y no lo escribía nadie: renovar era cargar
--     un contrato nuevo a mano y perder la cadena.
--   · `deposito_devuelto_el` existía y nada lo movía. Es plata de un tercero
--     retenida por la inmobiliaria y la última discusión de todo alquiler.
--
-- Y una que faltaba entera: quién cerró una liquidación.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Punitorios
-- ─────────────────────────────────────────────────────────────────────────────

-- A quién le corresponde el interés por mora.
--
-- Va **por contrato** y no como regla global porque no hay una sola respuesta:
-- en la mayoría de los contratos el punitorio compensa al propietario por la
-- plata que no cobró a tiempo, pero es negociable y hay inmobiliarias que lo
-- retienen como compensación por la gestión de cobranza. Es la misma decisión
-- que ya se toma por contrato con el índice y con los honorarios.
--
-- El default es 'propietario': es lo más frecuente y es el que NO le da plata
-- extra a quien administra sin que el dueño lo haya acordado.
ALTER TABLE contrato_alquiler
  ADD COLUMN punitorio_para text NOT NULL DEFAULT 'propietario'
    CHECK (punitorio_para IN ('propietario', 'inmobiliaria'));

-- Condonar el punitorio de una cuota es una decisión comercial de todos los
-- días —el inquilino bueno que se atrasó una semana— y tiene que dejar rastro:
-- es plata que alguien resigna en nombre del propietario.
ALTER TABLE periodo_alquiler
  ADD COLUMN punitorio_condonado_el timestamptz,
  ADD COLUMN punitorio_condonado_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN punitorio_condonado_motivo text;

-- El punitorio cobrado se guarda en la cuota y NO se recalcula después.
--
-- Misma regla que un ajuste confirmado: el interés se congela el día que se
-- cobra. Recalcularlo en cada lectura haría que una cuota ya saldada mostrara
-- un número distinto mañana, porque los días de mora siguen corriendo.
ALTER TABLE periodo_alquiler
  ADD COLUMN punitorio_cobrado numeric(14, 2) NOT NULL DEFAULT 0
    CHECK (punitorio_cobrado >= 0);

-- Un cobro puede imputarse al alquiler o al punitorio. Sin esto, cobrar el
-- interés obligaría a inflar el monto de la cuota y el saldo dejaría de cuadrar.
ALTER TABLE cobro
  ADD COLUMN imputacion text NOT NULL DEFAULT 'alquiler'
    CHECK (imputacion IN ('alquiler', 'punitorio'));

CREATE INDEX ix_cobro_imputacion ON cobro (periodo_id, imputacion);

-- El punitorio como línea de liquidación. Con signo +1 va al propietario;
-- cuando el contrato dice 'inmobiliaria' simplemente no se genera la línea.
ALTER TABLE liquidacion_linea DROP CONSTRAINT liquidacion_linea_tipo_check;
ALTER TABLE liquidacion_linea ADD CONSTRAINT liquidacion_linea_tipo_check
  CHECK (tipo IN (
    'alquiler', 'honorarios', 'expensas', 'reparacion',
    'impuesto', 'ajuste', 'punitorio', 'otro'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Devolución del depósito en garantía
-- ─────────────────────────────────────────────────────────────────────────────

-- `deposito` y `deposito_devuelto_el` ya existían. Faltaba con cuánto se
-- devolvió y por qué se descontó lo que se descontó: sin eso, "te devolví
-- menos" es la palabra de uno contra la del otro.
ALTER TABLE contrato_alquiler
  ADD COLUMN deposito_devuelto_monto numeric(14, 2)
    CHECK (deposito_devuelto_monto >= 0),
  ADD COLUMN deposito_devuelto_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  -- [{concepto, monto}]. Se guarda el detalle, no sólo el neto.
  ADD COLUMN deposito_descuentos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- No se puede devolver más de lo que se recibió.
ALTER TABLE contrato_alquiler ADD CONSTRAINT deposito_devuelto_coherente
  CHECK (
    deposito_devuelto_monto IS NULL
    OR (deposito IS NOT NULL AND deposito_devuelto_monto <= deposito)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Renovación
-- ─────────────────────────────────────────────────────────────────────────────

-- `contrato_anterior_id` ya existe. Lo único que faltaba es que la cadena no
-- pueda bifurcarse: dos contratos no pueden decir que renuevan al mismo, porque
-- entonces "el siguiente" deja de tener respuesta.
CREATE UNIQUE INDEX ux_contrato_renovacion
  ON contrato_alquiler (contrato_anterior_id)
  WHERE contrato_anterior_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auditoría de los movimientos de plata
-- ─────────────────────────────────────────────────────────────────────────────

-- `cobro.registrado_por` y `contrato_ajuste.confirmado_por` ya guardaban el
-- autor. `liquidacion` sólo tenía `cerrada_el` y `pagada_el`: NO quién. Cerrar
-- una liquidación es el acto que congela lo que se le transfiere a un
-- propietario, y era justo el que no tenía firma.
ALTER TABLE liquidacion
  ADD COLUMN cerrada_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN pagada_por  uuid REFERENCES usuario(id) ON DELETE SET NULL;

-- El registro de quién tocó la plata va en la tabla `auditoria` QUE YA EXISTE
-- (migración 003), no en una nueva.
--
-- La primera versión de esta migración creaba una `auditoria` propia para los
-- movimientos de plata y falló al aplicarse, que es exactamente lo que tenía que
-- pasar. Dos registros de auditoría son peores que ninguno: la pregunta real no
-- es "¿quién cerró esta liquidación?" sino "¿qué pasó el martes?", y con la
-- historia partida en dos tablas esa pregunta se contesta a mano.
--
-- Lo único que le faltaba a la tabla de 003 para servir acá es el monto. Un
-- asiento de auditoría de plata sin el importe obliga a ir a buscarlo a la
-- entidad, que es justo lo que puede haber cambiado después.
ALTER TABLE auditoria
  ADD COLUMN monto  numeric(14, 2),
  ADD COLUMN moneda text;

-- `resultado` es NOT NULL y sólo admite permitido/denegado, porque nació para
-- eventos de permisos. Un movimiento de plata que se registró es 'permitido'.
-- No se relaja el CHECK: el valor sigue significando lo mismo.

-- Índice para "¿qué le pasó a ESTA liquidación?". El de 003 cubre la consulta
-- por tenant y fecha; ésta es la otra que se hace todo el tiempo.
CREATE INDEX ix_auditoria_entidad ON auditoria (entidad_tipo, entidad_id);

-- La política de 003 es `FOR SELECT` solamente y el GRANT es `SELECT`: la app
-- NO puede escribir en auditoría directamente, escribe por `app_auditar()`, que
-- es SECURITY DEFINER. Eso se mantiene tal cual — un registro de auditoría que
-- la aplicación puede editar o borrar no sirve para lo que existe.
--
-- Se agrega una segunda firma con monto y moneda en vez de cambiar la que ya
-- está: la de 003 la llaman las funciones de sesión de 004, y cambiarle los
-- parámetros a una función que ya tiene llamadores es cómo se rompe un deploy.
CREATE OR REPLACE FUNCTION app_auditar_plata(
  p_tenant_id    uuid,
  p_usuario_id   uuid,
  p_accion       text,
  p_entidad_tipo text,
  p_entidad_id   text,
  p_monto        numeric DEFAULT NULL,
  p_moneda       text DEFAULT NULL,
  p_ip           inet DEFAULT NULL,
  p_detalle      jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO auditoria (tenant_id, usuario_id, accion, resultado,
                         entidad_tipo, entidad_id, monto, moneda, ip, detalle)
  VALUES (p_tenant_id, p_usuario_id, p_accion, 'permitido',
          p_entidad_tipo, p_entidad_id, p_monto, p_moneda, p_ip, p_detalle);
$$;

-- SECURITY DEFINER con search_path fijo: sin eso, un search_path manipulado
-- puede hacer que la función escriba en otra tabla con los privilegios del
-- dueño. Es el mismo recaudo que toma `app_auditar` en 004.
REVOKE ALL ON FUNCTION
  app_auditar_plata(uuid, uuid, text, text, text, numeric, text, inet, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_auditar_plata(uuid, uuid, text, text, text, numeric, text, inet, jsonb)
  TO app_role;
