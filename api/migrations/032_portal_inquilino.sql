-- 032 — El portal del inquilino, sobre la misma pieza que el del propietario.
--
-- ── Por qué se GENERALIZA la tabla en vez de duplicarla ──
--
-- `acceso_propietario` (migración 014) ya resuelve todo lo difícil: guarda el
-- HASH y no el token, vence, se revoca, cuenta usos, y se resuelve sin contexto
-- de tenant con una función SECURITY DEFINER —porque quien abre el enlace no
-- tiene sesión y no hay tenant que fijar todavía—.
--
-- Un `acceso_inquilino` sería esa tabla otra vez, con su función otra vez y su
-- lógica de revocación otra vez. Dos copias de un mecanismo de seguridad son
-- dos lugares donde arreglar el mismo agujero, y el día que se arregle uno solo
-- nadie se va a enterar.
--
-- Lo único que cambia entre los dos es QUÉ SE MUESTRA, y eso vive en el
-- servicio. Así que la tabla pasa a llamarse por lo que es —`acceso_portal`— y
-- suma la columna que faltaba.

ALTER TABLE acceso_propietario RENAME TO acceso_portal;

-- `propietario` por defecto: las filas que ya existen son todas de ese rol, y
-- así el backfill es la definición de la columna.
ALTER TABLE acceso_portal ADD COLUMN rol text NOT NULL DEFAULT 'propietario'
  CHECK (rol IN ('propietario', 'inquilino'));

ALTER INDEX ix_acceso_persona RENAME TO ix_acceso_portal_persona;
ALTER POLICY acceso_aislamiento ON acceso_portal RENAME TO acceso_portal_aislamiento;

-- La función resuelve igual, y ahora devuelve TAMBIÉN el rol: es lo que decide
-- qué pantalla se arma del otro lado. Sigue sin devolver un solo dato de la
-- persona ni de la inmobiliaria — un token inválido y uno vencido dan lo mismo:
-- nada.
DROP FUNCTION IF EXISTS app_resolver_acceso_propietario(text);

CREATE OR REPLACE FUNCTION app_resolver_acceso_portal(p_hash text)
RETURNS TABLE (tenant_id uuid, persona_id uuid, acceso_id uuid, rol text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.tenant_id, a.persona_id, a.id, a.rol
    FROM acceso_portal a
   WHERE a.token_hash = p_hash
     AND a.revocado_el IS NULL
     AND a.expira_el > now();
$$;

REVOKE ALL ON FUNCTION app_resolver_acceso_portal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolver_acceso_portal(text) TO app_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reportar un desperfecto desde el portal.
--
-- El inquilino no tiene sesión ni usuario, así que no puede escribir en
-- `reclamo` por el camino normal: la policy pide un tenant fijado y la tabla
-- espera un autor. Va por función, igual que la resolución del token.
--
-- **Entra como `reportado_por_inquilino` y NO se le asigna prioridad ni
-- proveedor**: eso lo decide la inmobiliaria. Un reclamo que llega con
-- prioridad «urgente» puesta por quien lo reporta convierte el campo en ruido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_reclamo_desde_portal(
  p_acceso_id   uuid,
  p_categoria   text,
  p_descripcion text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant   uuid;
  v_persona  uuid;
  v_rol      text;
  v_contrato uuid;
  v_propiedad uuid;
  v_id       uuid;
BEGIN
  SELECT a.tenant_id, a.persona_id, a.rol INTO v_tenant, v_persona, v_rol
    FROM acceso_portal a
   WHERE a.id = p_acceso_id AND a.revocado_el IS NULL AND a.expira_el > now();

  IF v_tenant IS NULL OR v_rol <> 'inquilino' THEN
    RAISE EXCEPTION 'Acceso inválido' USING ERRCODE = 'BE003';
  END IF;

  -- La propiedad NO la elige quien reporta: sale de su contrato vigente. Es lo
  -- que hace que el reclamo llegue ya identificado, y también lo que impide
  -- que alguien reporte un desperfecto en una propiedad que no habita.
  SELECT c.id, c.propiedad_id INTO v_contrato, v_propiedad
    FROM contrato_alquiler c
    JOIN contrato_parte cp ON cp.contrato_id = c.id
   WHERE cp.persona_id = v_persona AND cp.rol = 'locatario'
     AND c.tenant_id = v_tenant AND c.estado = 'vigente'
   ORDER BY c.fecha_inicio DESC
   LIMIT 1;

  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Sin contrato vigente' USING ERRCODE = 'BE003';
  END IF;

  -- `reportado_por` es la PERSONA que avisó, y acá se sabe con certeza: es la
  -- dueña del enlace. Es lo primero que se pregunta cuando hay que volver a
  -- llamar, y por el portal no hace falta tipearlo.
  --
  -- La prioridad se deja en su default y `a_cargo_de` en NULL: quién paga es
  -- media gestión del reclamo y no la decide quien lo reporta.
  INSERT INTO reclamo (
    tenant_id, propiedad_id, contrato_id,
    categoria, descripcion, estado, reportado_por
  ) VALUES (
    v_tenant, v_propiedad, v_contrato,
    p_categoria, p_descripcion, 'abierto', v_persona
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app_reclamo_desde_portal(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_reclamo_desde_portal(uuid, text, text) TO app_role;
