-- 049 · Cómo el worker elige la próxima tanda de fotos
--
-- El worker corre SIN inmobiliaria: es un proceso de fondo, no un request de
-- nadie. Con el rol restringido y RLS puesto, `app_current_tenant()` es NULL y
-- no ve una sola fila — que es exactamente lo que RLS tiene que hacer.
--
-- Así que la única consulta que cruza el borde es ésta, `SECURITY DEFINER`, y
-- devuelve lo MÍNIMO para trabajar: ids, la URL y de qué inmobiliaria es. Ni una
-- dirección, ni un precio, ni un nombre. Con el `tenant_id` en la mano, el
-- worker hace todo lo demás con `withTenant`, o sea con RLS aplicando de vuelta.
--
-- Es el mismo patrón que `app_red_buscar` y `app_envio_abrir`: una ventana
-- angosta y declarada, no un agujero.

BEGIN;

/**
 * La próxima tanda de fotos por bajar.
 *
 * `FOR UPDATE SKIP LOCKED` para que dos procesos —dos réplicas de la API—
 * puedan drenar la cola a la vez sin bajar la misma foto dos veces. Sin el
 * `SKIP LOCKED`, el segundo esperaría al primero y el paralelismo no serviría
 * de nada.
 */
CREATE OR REPLACE FUNCTION app_fotos_por_bajar(p_limite int DEFAULT 5)
RETURNS TABLE (id uuid, tenant_id uuid, propiedad_id uuid, url text, intentos smallint)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE foto_pendiente f
     SET intentado_el = now(),
         intentos = f.intentos + 1
   WHERE f.id IN (
     SELECT c.id FROM foto_pendiente c
      WHERE c.estado = 'pendiente'
        -- Se espera antes de reintentar. Sin esto, una foto que falla se
        -- reintentaría en cada vuelta del ciclo y martillaría a un servidor
        -- ajeno que ya dijo que no.
        AND (c.intentado_el IS NULL OR c.intentado_el < now() - interval '10 minutes')
      ORDER BY c.intentado_el NULLS FIRST, c.created_at
      LIMIT least(greatest(coalesce(p_limite, 5), 1), 20)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING f.id, f.tenant_id, f.propiedad_id, f.url, f.intentos;
$$;

REVOKE ALL ON FUNCTION app_fotos_por_bajar(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_fotos_por_bajar(int) TO app_role;

/** Cuántas quedan, para saber si vale la pena seguir dando vueltas. */
CREATE OR REPLACE FUNCTION app_fotos_pendientes_total()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*) FROM foto_pendiente WHERE estado = 'pendiente';
$$;
GRANT EXECUTE ON FUNCTION app_fotos_pendientes_total() TO app_role;

COMMIT;
