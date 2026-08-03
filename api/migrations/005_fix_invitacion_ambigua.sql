-- 005 — Corrige "column reference tenant_id is ambiguous" en app_invitacion_aceptar.
--
-- La función devuelve TABLE (resultado, usuario_id, tenant_id, rol). Esos nombres
-- son parámetros de SALIDA y, dentro del cuerpo, plpgsql los sustituye en
-- cualquier contexto de EXPRESIÓN. La lista de columnas de un INSERT no lo es,
-- pero la cláusula de inferencia de ON CONFLICT sí:
--
--     ON CONFLICT (tenant_id, usuario_id)   ← acá `tenant_id` es ambiguo
--
-- Se reemplaza por un UPDATE/INSERT explícito con todas las referencias
-- calificadas por alias. No hay carrera: la fila de `invitacion` ya está tomada
-- con FOR UPDATE, así que dos aceptaciones de la misma invitación se serializan.

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

  SELECT u.id INTO v_usuario_id FROM usuario u WHERE u.email = i.email;

  IF v_usuario_id IS NULL THEN
    INSERT INTO usuario (email, password_hash, nombre)
    VALUES (i.email, p_password_hash, p_nombre)
    RETURNING id INTO v_usuario_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM membresia m
     WHERE m.tenant_id = i.tenant_id AND m.usuario_id = v_usuario_id
  ) THEN
    UPDATE membresia m
       SET rol = i.rol, estado = 'activa'
     WHERE m.tenant_id = i.tenant_id AND m.usuario_id = v_usuario_id;
  ELSE
    INSERT INTO membresia (tenant_id, usuario_id, rol)
    VALUES (i.tenant_id, v_usuario_id, i.rol);
  END IF;

  UPDATE invitacion SET aceptada_el = now() WHERE id = i.id;

  RETURN QUERY SELECT 'ok'::text, v_usuario_id, i.tenant_id, i.rol;
END;
$$;

REVOKE EXECUTE ON FUNCTION app_invitacion_aceptar(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invitacion_aceptar(text, text, text) TO app_role;
