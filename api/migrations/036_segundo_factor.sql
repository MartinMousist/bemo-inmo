-- 036 · Segundo factor (TOTP) para entrar al sistema
--
-- ── Por qué el titular ──
--
-- El `owner` puede cambiar el tipo de cuenta, los planes, las comisiones de
-- todos y los accesos del equipo. Con su contraseña sola, un correo de phishing
-- bien hecho alcanza para vaciar la configuración de una inmobiliaria y para
-- redirigir a quién se le liquida la plata.
--
-- Queda habilitado para CUALQUIER rol, no sólo para el titular: el asesor que
-- entra desde el teléfono en un locutorio tiene el mismo problema y no hay
-- razón para negárselo. Lo que la etapa pedía era que el titular pudiera; que
-- sea OBLIGATORIO es una política que se prende cuando el titular ya se enroló,
-- porque al revés se queda afuera de su propia cuenta.
--
-- ── Dónde vive ──
--
-- En `usuario`, que es GLOBAL: no lleva `tenant_id` porque una persona puede
-- trabajar en dos inmobiliarias y su teléfono es uno solo. Enrolarse dos veces
-- para la misma cara sería absurdo.
--
-- ── Los códigos de recuperación ──
--
-- Sin ellos, perder el teléfono es perder la cuenta, y lo que pasa de verdad en
-- ese caso es que la inmobiliaria nos llama para que le desactivemos el segundo
-- factor — que es exactamente el agujero que el segundo factor vino a tapar.
--
-- Se guardan hasheados con SHA-256 sin sal, igual que los refresh y por el
-- mismo motivo: son aleatorios, no hay diccionario que atacar y hay que poder
-- buscarlos por hash. Lo que los sostiene son sus 80 bits.

BEGIN;

ALTER TABLE usuario
  -- El secreto en base32. NULL = sin segundo factor.
  ADD COLUMN totp_secreto text,
  -- NULL con secreto cargado = empezó a enrolarse y no confirmó todavía. La
  -- distinción importa: un secreto sin confirmar NO puede pedir código al
  -- entrar, o alguien que abandona el alta a la mitad se queda afuera.
  ADD COLUMN totp_confirmado_el timestamptz;

CREATE TABLE usuario_codigo_recuperacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  hash        text NOT NULL,
  usado_el    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, hash)
);

CREATE INDEX ix_codigo_recuperacion_usuario ON usuario_codigo_recuperacion (usuario_id);

ALTER TABLE usuario_codigo_recuperacion ENABLE ROW LEVEL SECURITY;
-- Sin policies y sin grants, igual que `sesion`: nadie llega por SQL directo y
-- la tabla se toca EXCLUSIVAMENTE por las funciones de abajo.
--
-- RLS habilitada aunque no haya política y aunque `app_role` no tenga permiso.
-- Parece redundante y no lo es: sin política, RLS significa «cero filas», que
-- es la defensa correcta si alguien agrega un GRANT más adelante sin acordarse
-- de esto. Es la misma decisión que ya tomó `sesion`, y hay un test que exige
-- que TODA tabla la tenga —lo encontró él—.

-- ── Lectura para el login ──────────────────────────────────────────────────
-- Devuelve el secreto sólo si está CONFIRMADO. Uno a medio enrolar no bloquea
-- la entrada.
CREATE OR REPLACE FUNCTION app_totp_activo(p_usuario uuid)
RETURNS TABLE (secreto text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.totp_secreto FROM usuario u
   WHERE u.id = p_usuario AND u.totp_confirmado_el IS NOT NULL
     AND u.totp_secreto IS NOT NULL;
$$;

-- ── Enrolamiento ───────────────────────────────────────────────────────────
-- Arrancar de nuevo pisa el secreto anterior y BORRA los códigos viejos: si no,
-- quedarían sirviendo para un secreto que ya no existe.
CREATE OR REPLACE FUNCTION app_totp_iniciar(p_usuario uuid, p_secreto text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE usuario
     SET totp_secreto = p_secreto, totp_confirmado_el = NULL
   WHERE id = p_usuario;
  DELETE FROM usuario_codigo_recuperacion WHERE usuario_id = p_usuario;
END $$;

CREATE OR REPLACE FUNCTION app_totp_confirmar(p_usuario uuid, p_hashes text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE usuario SET totp_confirmado_el = now()
   WHERE id = p_usuario AND totp_secreto IS NOT NULL;

  INSERT INTO usuario_codigo_recuperacion (usuario_id, hash)
  SELECT p_usuario, h FROM unnest(p_hashes) AS h;
END $$;

CREATE OR REPLACE FUNCTION app_totp_desactivar(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE usuario SET totp_secreto = NULL, totp_confirmado_el = NULL
   WHERE id = p_usuario;
  DELETE FROM usuario_codigo_recuperacion WHERE usuario_id = p_usuario;
END $$;

-- ── Estado, para la pantalla de seguridad ──────────────────────────────────
CREATE OR REPLACE FUNCTION app_totp_estado(p_usuario uuid)
RETURNS TABLE (activo boolean, confirmado_el timestamptz, codigos_sin_usar int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT
    u.totp_confirmado_el IS NOT NULL,
    u.totp_confirmado_el,
    (SELECT count(*)::int FROM usuario_codigo_recuperacion c
      WHERE c.usuario_id = u.id AND c.usado_el IS NULL)
  FROM usuario u WHERE u.id = p_usuario;
$$;

-- ── Usar un código de recuperación ─────────────────────────────────────────
--
-- Marcar y devolver en UNA sentencia. Leer y después marcar dejaría que dos
-- intentos simultáneos con el mismo código pasen los dos, que es justo lo que
-- un código de un solo uso no puede hacer.
CREATE OR REPLACE FUNCTION app_totp_usar_recuperacion(p_usuario uuid, p_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE usuario_codigo_recuperacion
     SET usado_el = now()
   WHERE usuario_id = p_usuario AND hash = p_hash AND usado_el IS NULL
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END $$;

GRANT EXECUTE ON FUNCTION app_totp_activo(uuid) TO app_role;
GRANT EXECUTE ON FUNCTION app_totp_iniciar(uuid, text) TO app_role;
GRANT EXECUTE ON FUNCTION app_totp_confirmar(uuid, text[]) TO app_role;
GRANT EXECUTE ON FUNCTION app_totp_desactivar(uuid) TO app_role;
GRANT EXECUTE ON FUNCTION app_totp_estado(uuid) TO app_role;
GRANT EXECUTE ON FUNCTION app_totp_usar_recuperacion(uuid, text) TO app_role;

COMMIT;
