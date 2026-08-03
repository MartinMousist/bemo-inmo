-- 004 — Las funciones que corren SIN contexto de tenant.
--
-- Todas son SECURITY DEFINER: corren con los privilegios del owner y saltean RLS.
-- Por eso cada una hace UNA cosa acotada y no acepta un tenant_id como parámetro
-- de entrada libre. Una SECURITY DEFINER genérica sería un agujero del tamaño de
-- la base entera.
--
-- Todas fijan `search_path` explícito: sin eso, un rol que pueda crear objetos en
-- un schema anterior del search_path puede secuestrar una llamada a una función
-- interna y ejecutarla con privilegios de owner.

-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoría. Funciona con o sin contexto de tenant.
-- Si el logging dependiera del contexto, los eventos más importantes —los que
-- ocurren ANTES de tenerlo— serían justamente los que no se registran.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_auditar(
  p_tenant_id    uuid,
  p_usuario_id   uuid,
  p_accion       text,
  p_resultado    text,
  p_entidad_tipo text DEFAULT NULL,
  p_entidad_id   text DEFAULT NULL,
  p_ip           inet DEFAULT NULL,
  p_user_agent   text DEFAULT NULL,
  p_detalle      jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO auditoria (tenant_id, usuario_id, accion, resultado,
                         entidad_tipo, entidad_id, ip, user_agent, detalle)
  VALUES (p_tenant_id, p_usuario_id, p_accion, p_resultado,
          p_entidad_tipo, p_entidad_id, p_ip, p_user_agent, p_detalle);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Login: buscar al usuario por mail.
-- Devuelve el hash para que la app compare. No compara acá adentro para no
-- meter la contraseña en claro en los logs de Postgres.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_usuario_por_email(p_email citext)
RETURNS TABLE (id uuid, password_hash text, nombre text, estado text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.password_hash, u.nombre, u.estado
  FROM usuario u
  WHERE u.email = p_email;
$$;

-- Las inmobiliarias a las que pertenece un usuario, con su rol en cada una.
CREATE OR REPLACE FUNCTION app_membresias_de_usuario(p_usuario_id uuid)
RETURNS TABLE (tenant_id uuid, tenant_nombre text, rol text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.nombre, m.rol
  FROM membresia m
  JOIN tenant t ON t.id = m.tenant_id
  WHERE m.usuario_id = p_usuario_id
    AND m.estado = 'activa'
    AND t.estado = 'activo'
  ORDER BY t.nombre;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Signup: crea inmobiliaria + usuario + membresía owner, todo o nada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_signup(
  p_inmobiliaria  text,
  p_provincia     text,
  p_email         citext,
  p_password_hash text,
  p_nombre        text
) RETURNS TABLE (usuario_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario_id uuid;
  v_tenant_id  uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM usuario WHERE email = p_email) THEN
    RAISE EXCEPTION 'email ya registrado' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO tenant (nombre, provincia)
  VALUES (p_inmobiliaria, p_provincia)
  RETURNING id INTO v_tenant_id;

  INSERT INTO usuario (email, password_hash, nombre)
  VALUES (p_email, p_password_hash, p_nombre)
  RETURNING id INTO v_usuario_id;

  INSERT INTO membresia (tenant_id, usuario_id, rol)
  VALUES (v_tenant_id, v_usuario_id, 'owner');

  RETURN QUERY SELECT v_usuario_id, v_tenant_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sesiones
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_sesion_crear(
  p_usuario_id uuid,
  p_tenant_id  uuid,
  p_token_hash text,
  p_expira_el  timestamptz,
  p_ip         inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_familia uuid := gen_random_uuid();
  v_id      uuid;
BEGIN
  -- Nadie inicia sesión en una inmobiliaria donde no tiene membresía activa.
  IF NOT EXISTS (
    SELECT 1 FROM membresia
    WHERE usuario_id = p_usuario_id AND tenant_id = p_tenant_id AND estado = 'activa'
  ) THEN
    RAISE EXCEPTION 'sin membresía activa' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO sesion (usuario_id, tenant_id, familia, token_hash, expira_el, ip, user_agent)
  VALUES (p_usuario_id, p_tenant_id, v_familia, p_token_hash, p_expira_el, p_ip, p_user_agent)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Rotación con detección de reuso. Es atómica a propósito: el `FOR UPDATE`
-- serializa dos refrescos simultáneos del mismo token, que es exactamente el
-- escenario en el que un atacante y el usuario legítimo compiten.
--
-- Devuelve `resultado`:
--   ok        → rotado, hay token nuevo
--   invalido  → ese token no existe
--   reuso     → el token YA se había usado. Alguien tiene una copia:
--               se revocan TODAS las sesiones del usuario, no sólo esta familia.
--   revocado  → la sesión ya estaba revocada
--   expirado  → venció
CREATE OR REPLACE FUNCTION app_sesion_rotar(
  p_token_hash  text,
  p_nuevo_hash  text,
  p_expira_el   timestamptz,
  p_ip          inet DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS TABLE (resultado text, usuario_id uuid, tenant_id uuid, rol text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  s   sesion%ROWTYPE;
  v_rol text;
BEGIN
  SELECT * INTO s FROM sesion WHERE token_hash = p_token_hash FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF s.usado_el IS NOT NULL THEN
    UPDATE sesion
       SET revocado_el = now(), revocado_motivo = 'reuso_detectado'
     WHERE sesion.usuario_id = s.usuario_id AND revocado_el IS NULL;

    PERFORM app_auditar(s.tenant_id, s.usuario_id, 'sesion.reuso_detectado', 'denegado',
                        'sesion', s.id::text, p_ip, p_user_agent,
                        jsonb_build_object('familia', s.familia));

    RETURN QUERY SELECT 'reuso'::text, s.usuario_id, s.tenant_id, NULL::text;
    RETURN;
  END IF;

  IF s.revocado_el IS NOT NULL THEN
    RETURN QUERY SELECT 'revocado'::text, s.usuario_id, s.tenant_id, NULL::text;
    RETURN;
  END IF;

  IF s.expira_el <= now() THEN
    RETURN QUERY SELECT 'expirado'::text, s.usuario_id, s.tenant_id, NULL::text;
    RETURN;
  END IF;

  SELECT m.rol INTO v_rol
  FROM membresia m
  JOIN usuario u ON u.id = m.usuario_id
  WHERE m.usuario_id = s.usuario_id
    AND m.tenant_id = s.tenant_id
    AND m.estado = 'activa'
    AND u.estado = 'activo';

  IF v_rol IS NULL THEN
    -- Le sacaron el acceso mientras tenía sesión abierta.
    UPDATE sesion SET revocado_el = now(), revocado_motivo = 'sin_membresia'
     WHERE id = s.id;
    RETURN QUERY SELECT 'revocado'::text, s.usuario_id, s.tenant_id, NULL::text;
    RETURN;
  END IF;

  UPDATE sesion SET usado_el = now() WHERE id = s.id;

  INSERT INTO sesion (usuario_id, tenant_id, familia, token_hash, expira_el, ip, user_agent)
  VALUES (s.usuario_id, s.tenant_id, s.familia, p_nuevo_hash, p_expira_el, p_ip, p_user_agent);

  RETURN QUERY SELECT 'ok'::text, s.usuario_id, s.tenant_id, v_rol;
END;
$$;

-- Logout: revoca la familia entera, no sólo el token actual. Cerrar sesión en un
-- dispositivo tiene que invalidar toda su cadena de refrescos.
CREATE OR REPLACE FUNCTION app_sesion_revocar(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_familia uuid;
BEGIN
  SELECT familia INTO v_familia FROM sesion WHERE token_hash = p_token_hash;
  IF v_familia IS NULL THEN
    RETURN false;
  END IF;

  UPDATE sesion
     SET revocado_el = now(), revocado_motivo = 'logout'
   WHERE familia = v_familia AND revocado_el IS NULL;

  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Invitaciones: aceptarlas ocurre sin contexto de tenant, igual que el login.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_invitacion_aceptar(
  p_token_hash    text,
  p_password_hash text,
  p_nombre        text
) RETURNS TABLE (resultado text, usuario_id uuid, tenant_id uuid, rol text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  i            invitacion%ROWTYPE;
  v_usuario_id uuid;
BEGIN
  SELECT * INTO i FROM invitacion WHERE token_hash = p_token_hash FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalida'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF i.aceptada_el IS NOT NULL THEN
    RETURN QUERY SELECT 'ya_aceptada'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF i.cancelada_el IS NOT NULL THEN
    RETURN QUERY SELECT 'cancelada'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF i.expira_el <= now() THEN
    RETURN QUERY SELECT 'expirada'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT id INTO v_usuario_id FROM usuario WHERE email = i.email;

  IF v_usuario_id IS NULL THEN
    INSERT INTO usuario (email, password_hash, nombre)
    VALUES (i.email, p_password_hash, p_nombre)
    RETURNING id INTO v_usuario_id;
  END IF;

  INSERT INTO membresia (tenant_id, usuario_id, rol)
  VALUES (i.tenant_id, v_usuario_id, i.rol)
  ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol, estado = 'activa';

  UPDATE invitacion SET aceptada_el = now() WHERE id = i.id;

  RETURN QUERY SELECT 'ok'::text, v_usuario_id, i.tenant_id, i.rol;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos: nadie más que app_role ejecuta esto.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION
  app_auditar(uuid, uuid, text, text, text, text, inet, text, jsonb),
  app_usuario_por_email(citext),
  app_membresias_de_usuario(uuid),
  app_signup(text, text, citext, text, text),
  app_sesion_crear(uuid, uuid, text, timestamptz, inet, text),
  app_sesion_rotar(text, text, timestamptz, inet, text),
  app_sesion_revocar(text),
  app_invitacion_aceptar(text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app_auditar(uuid, uuid, text, text, text, text, inet, text, jsonb),
  app_usuario_por_email(citext),
  app_membresias_de_usuario(uuid),
  app_signup(text, text, citext, text, text),
  app_sesion_crear(uuid, uuid, text, timestamptz, inet, text),
  app_sesion_rotar(text, text, timestamptz, inet, text),
  app_sesion_revocar(text),
  app_invitacion_aceptar(text, text, text)
TO app_role;
