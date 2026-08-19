-- 033 — Reparación de la 032: la función que quedó apuntando a la tabla vieja.
--
-- ── Qué pasó ──
--
-- La 032 hizo `ALTER TABLE acceso_propietario RENAME TO acceso_portal` y
-- reescribió `app_resolver_acceso_propietario`, pero NO tocó
-- `app_marcar_uso_acceso`, que también nombra la tabla.
--
-- **`ALTER TABLE ... RENAME` no reescribe el cuerpo de las funciones**: Postgres
-- las guarda como texto y las resuelve al ejecutarlas. La migración corrió
-- limpia, el `tsc` pasó y los tests que no abren el portal siguieron en verde.
-- El error aparece recién al abrir un enlace: «relation acceso_propietario does
-- not exist», en un 500, en la única pantalla del sistema que ve alguien de
-- afuera.
--
-- Va en una migración nueva y no editando la 032 porque las migraciones son
-- inmutables: el migrador compara hashes y falla si un archivo aplicado cambia.
-- Dejar el arreglo acá, con su motivo, también deja el registro de que pasó.

CREATE OR REPLACE FUNCTION app_marcar_uso_acceso(p_id uuid) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE acceso_portal
     SET ultimo_uso = now(), usos = usos + 1
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION app_marcar_uso_acceso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_marcar_uso_acceso(uuid) TO app_role;
