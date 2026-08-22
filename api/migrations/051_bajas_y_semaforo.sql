-- 051 · Archivar propiedades, vencer contratos y el semáforo de personas
--
-- ═══ TRES COSAS QUE FALTABAN, Y UNA QUE ESTABA MAL ═══
--
-- ── 1 · Archivar una propiedad ──
--
-- Hoy sólo hay `DELETE`. Postgres lo frena cuando hay contratos, gastos o
-- reclamos —son RESTRICT y está bien— pero eso deja a la inmobiliaria sin
-- ninguna forma de sacar de la cartera una propiedad que ya vendió. Se quedan
-- para siempre, y la cartera deja de ser la cartera.
--
-- Archivar no borra nada: la saca de circulación y conserva su historia.
--
-- **No cuenta para el tope del plan.** Si contara, archivar no liberaría nada y
-- la gente volvería a intentar borrar — que es justo lo que no se puede hacer.
--
-- ── 2 · Los contratos no se vencían solos ──
--
-- Nada movía `contrato_alquiler.estado` a 'vencido': el único UPDATE que lo
-- tocaba lo ponía en 'renovado', y sólo al renovarlo a mano. Y `vigente` se
-- calcula del estado GUARDADO, no de las fechas. O sea que un contrato que
-- terminó hace seis meses seguía figurando como vigente.
--
-- ── 3 · Los roles no caducaban ──
--
-- «Inquilino» salía de `contrato_parte` sin mirar el estado del contrato, así
-- que alguien que alquiló en 2019 y se fue seguía siendo inquilino para
-- siempre. Eso no se arregla acá —es una consulta, no un dato— pero el
-- vencimiento automático es lo que lo hace posible.
--
-- ── 4 · El semáforo ──
--
-- Lo que hoy vive en la cabeza de alguien o en un grupo de WhatsApp: si a esta
-- persona le volveríamos a alquilar.
--
-- **Avisa, nunca bloquea.** Que el software se niegue a dejarte alquilarle a
-- alguien es una decisión que no le corresponde, y una marca puesta con bronca
-- dejaría a una persona afuera en silencio.
--
-- **Nunca sale de la inmobiliaria.** Ni al portal, ni a la Red, ni a un envío,
-- ni al feed. Es la opinión de ESTA oficina sobre una persona con nombre y
-- apellido — no un puntaje, y no un dato que se comparta.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A · Archivar propiedades
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE propiedad
  ADD COLUMN archivada_el   timestamptz,
  ADD COLUMN archivada_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN archivada_motivo text;

-- Parcial: el 99% de las consultas pide las NO archivadas, y un índice sobre
-- las archivadas —que son pocas— no ayuda a ninguna.
CREATE INDEX ix_propiedad_activa ON propiedad (tenant_id) WHERE archivada_el IS NULL;

CREATE CONSTRAINT TRIGGER tg_propiedad_archivada_por_del_tenant
  AFTER INSERT OR UPDATE OF archivada_por ON propiedad
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('archivada_por');

/**
 * El tope de propiedades del plan deja de contar las archivadas.
 *
 * Si las contara, archivar no liberaría un solo lugar y la única salida sería
 * borrar — que es exactamente lo que las claves foráneas impiden, y con razón.
 * La cuenta quedaría trabada sin ninguna acción posible.
 */
CREATE OR REPLACE FUNCTION app_limite_plan(p_recurso text)
RETURNS TABLE (permitido boolean, usado integer, maximo integer, plan text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_plan   plan%ROWTYPE;
  v_usado  integer;
  v_max    integer;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, NULL::text;
    RETURN;
  END IF;

  SELECT p.* INTO v_plan
    FROM suscripcion s JOIN plan p ON p.codigo = s.plan_codigo
   WHERE s.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, 0, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF p_recurso = 'usuarios' THEN
    SELECT count(*)::int INTO v_usado FROM membresia
      WHERE tenant_id = v_tenant AND estado = 'activa';
    v_max := v_plan.max_usuarios;

  ELSIF p_recurso = 'propiedades' THEN
    -- Sin las archivadas. Ver el comentario de arriba.
    SELECT count(*)::int INTO v_usado FROM propiedad
      WHERE tenant_id = v_tenant AND archivada_el IS NULL;
    v_max := v_plan.max_propiedades;

  ELSIF p_recurso = 'contratos' THEN
    SELECT count(*)::int INTO v_usado FROM contrato_alquiler
      WHERE tenant_id = v_tenant AND estado = 'vigente';
    v_max := v_plan.max_contratos;

  ELSIF p_recurso = 'sucursales' THEN
    SELECT count(*)::int INTO v_usado FROM sucursal WHERE tenant_id = v_tenant;
    v_max := v_plan.max_sucursales;

  ELSIF p_recurso = 'canales' THEN
    SELECT count(*)::int INTO v_usado FROM canal_cuenta
      WHERE tenant_id = v_tenant AND activo;
    v_max := v_plan.max_canales;

  ELSIF p_recurso = 'envios_mes' THEN
    SELECT count(*)::int INTO v_usado FROM envio_propiedades
      WHERE tenant_id = v_tenant AND created_at >= date_trunc('month', now());
    v_max := v_plan.max_envios_mes;

  ELSIF p_recurso = 'red_compartidas' THEN
    SELECT count(*)::int INTO v_usado FROM propiedad
      WHERE tenant_id = v_tenant AND red_compartida;
    v_max := v_plan.max_red_compartidas;

  ELSE
    RAISE EXCEPTION 'Recurso de plan desconocido: %', p_recurso
      USING ERRCODE = 'BE004';
  END IF;

  RETURN QUERY SELECT (v_max IS NULL OR v_usado < v_max), v_usado, v_max, v_plan.codigo;
END;
$$;
GRANT EXECUTE ON FUNCTION app_limite_plan(text) TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B · Vencer los contratos cuya fecha pasó
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Pasa a 'vencido' lo que ya terminó. Devuelve cuántos movió.
 *
 * ── Lo que NO hace, y es lo importante ──
 *
 * **No toca una sola cuota.** La deuda sobrevive al contrato: alguien que se
 * fue debiendo tres meses los sigue debiendo, y si el vencimiento las cerrara,
 * la inmobiliaria perdería el reclamo. Sólo mira la FECHA.
 *
 * Tampoco toca 'renovado', 'rescindido' ni 'borrador': los tres son decisiones
 * que alguien ya tomó, y pisarlas sería borrar esa decisión.
 *
 * Incluye 'por_iniciar' porque es un caso real: un contrato cargado tarde, que
 * empezó y terminó antes de que nadie lo tocara.
 *
 * SECURITY DEFINER porque lo llama un proceso de fondo, sin inmobiliaria. No
 * devuelve datos: sólo un número.
 */
CREATE OR REPLACE FUNCTION app_vencer_contratos()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE contrato_alquiler
     SET estado = 'vencido'
   WHERE estado IN ('vigente', 'por_iniciar')
     AND fecha_fin < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION app_vencer_contratos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_vencer_contratos() TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D · El semáforo
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE persona
  ADD COLUMN semaforo text NOT NULL DEFAULT 'sin_marcar'
    CHECK (semaforo IN ('sin_marcar', 'recomendado', 'con_reparos', 'no_alquilar')),
  -- El motivo es OBLIGATORIO para marcar, y eso lo exige el servicio y no un
  -- CHECK: una marca sin motivo es un rumor con forma de dato, y dentro de seis
  -- meses nadie sabe por qué está puesta.
  ADD COLUMN semaforo_motivo text,
  ADD COLUMN semaforo_por  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN semaforo_el   timestamptz;

CREATE INDEX ix_persona_semaforo ON persona (tenant_id, semaforo)
  WHERE semaforo <> 'sin_marcar';

CREATE CONSTRAINT TRIGGER tg_persona_semaforo_por_del_tenant
  AFTER INSERT OR UPDATE OF semaforo_por ON persona
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('semaforo_por');

COMMIT;
