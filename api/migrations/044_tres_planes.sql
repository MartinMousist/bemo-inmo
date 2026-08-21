-- 044 · Los tres planes, definidos y con dientes
--
-- ═══ POR QUÉ ESTA MIGRACIÓN ═══
--
-- La 011 dejó cuatro planes con trece nombres de módulo. De esos trece, el
-- código exigía DOS (`multisucursal` y `api`) y el front escondía CINCO. Los
-- otros seis eran texto: un plan «Inicial» declaraba no incluir liquidaciones
-- y las liquidaciones funcionaban igual.
--
-- Eso no es un plan, es una lista de intenciones. Y era peor que no tenerla:
-- una página de precios que promete un límite que no existe es una promesa rota
-- en las dos direcciones —al que paga de más y al que se entera de que no hacía
-- falta—.
--
-- Además el catálogo se escribió antes de las etapas 12 a 19. Bandeja
-- omnicanal, portal, conciliación bancaria, actas, emprendimientos en pozo y la
-- Red no figuran en ningún plan, así que hoy los tiene cualquiera.
--
-- ═══ LOS TRES ═══
--
-- **Base** — para quien trabaja solo y hoy tiene la cartera en un Excel y las
-- consultas en el WhatsApp personal. Tiene el sistema entero de su trabajo
-- diario, con techos claros. No se le saca una función a mitad de camino: se
-- llega a un tope y se avisa. Un plan de entrada al que le falta una pieza del
-- flujo se abandona antes de terminar de cargar la cartera.
--
-- **Inmobiliaria** — para la oficina con equipo que además administra alquileres
-- de terceros. Acá aparece lo que más tiempo ahorra —la liquidación al
-- propietario, el portal, la bandeja— y lo que reparte plata entre agentes.
--
-- **Total** — todo, sin techos. Conciliación bancaria, emprendimientos en pozo
-- con sus calculadoras, actas, multisucursal, API y marca blanca.
--
-- ═══ EL PRECIO ═══
--
-- La columna se crea VACÍA. El catálogo público sigue diciendo «A convenir»
-- hasta que el dueño del producto escriba un número, que es la regla que este
-- repo tiene desde la etapa 0 y que un test cuida: no se publica un precio que
-- nadie decidió.
--
-- La propuesta —USD 25 / 79 / 199 por mes— está en `docs/planes.md` con su
-- razonamiento. Se carga con un UPDATE cuando esté decidida; por eso la columna
-- vive en la base y no en el código.
--
-- En dólares y no en pesos porque un número en pesos queda viejo solo; lo que
-- se cobra es su equivalente del día.
--
-- ═══ LO QUE ESTA MIGRACIÓN NO HACE ═══
--
-- No bloquea nada por falta de pago. Los topes son del PLAN, no del estado de
-- la suscripción: una cuenta con la cuota vencida sigue viendo sus contratos y
-- sus liquidaciones. Cortarle el acceso a sus propios datos a quien debe dos
-- meses no es cobrar, es tomar de rehén el trabajo de otro.

BEGIN;

ALTER TABLE plan
  ADD COLUMN precio_usd            numeric(10,2),
  ADD COLUMN resumen               text,
  ADD COLUMN para_quien            text,
  -- Los topes que faltaban. NULL = sin límite, igual que los tres que ya había.
  ADD COLUMN max_contratos         integer,
  ADD COLUMN max_sucursales        integer,
  ADD COLUMN max_canales           integer,
  ADD COLUMN max_envios_mes        integer,
  ADD COLUMN max_red_compartidas   integer;

-- Los códigos pasan a decir qué son. `medio` y `pro` no significan nada para
-- quien mira una página de precios, y el nombre y el código separados terminan
-- en un `CASE` en algún lado traduciendo uno al otro.
ALTER TABLE plan DROP CONSTRAINT plan_codigo_check;

INSERT INTO plan (
  codigo, nombre, orden, precio_usd, resumen, para_quien,
  max_usuarios, max_propiedades, max_contratos, max_sucursales,
  max_canales, max_envios_mes, max_red_compartidas, modulos
) VALUES
  ('base', 'Base', 1, NULL,
   'Tu cartera, tus consultas y tus operaciones, ordenadas.',
   'Trabajás solo o son dos, y hoy esto está en un Excel y en el WhatsApp personal.',
   2, 150, 25, 1, 0, 10, 0,
   ARRAY['leads', 'ventas', 'reservas']),

  ('inmobiliaria', 'Inmobiliaria', 2, NULL,
   'Todo lo anterior sin techos chicos, más lo que administra los alquileres de otros.',
   'Tenés equipo y le rendís cuentas a propietarios todos los meses.',
   10, 1000, NULL, 1, 2, NULL, 20,
   ARRAY['leads', 'ventas', 'reservas', 'comisiones', 'publicaciones',
         'liquidaciones', 'portal', 'bandeja', 'red', 'documentos']),

  ('total', 'Total', 3, NULL,
   'El sistema entero, sin límites.',
   'Administrás a escala, desarrollás emprendimientos o tenés más de una sucursal.',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   ARRAY['leads', 'ventas', 'reservas', 'comisiones', 'publicaciones',
         'liquidaciones', 'portal', 'bandeja', 'red', 'documentos',
         'emprendimientos', 'conciliacion', 'actas', 'multisucursal',
         'api', 'marca_blanca', 'arca']);

-- Las cuentas que ya existen se mueven al equivalente. Nadie pierde nada:
-- `medio` era el del medio y `Inmobiliaria` es el del medio.
UPDATE suscripcion SET plan_codigo = CASE plan_codigo
  WHEN 'inicial' THEN 'base'
  WHEN 'medio'   THEN 'inmobiliaria'
  WHEN 'pro'     THEN 'total'
  WHEN 'medida'  THEN 'total'
  ELSE 'inmobiliaria'
END;

DELETE FROM plan WHERE codigo IN ('inicial', 'medio', 'pro', 'medida');

ALTER TABLE plan ADD CONSTRAINT plan_codigo_check
  CHECK (codigo IN ('base', 'inmobiliaria', 'total'));

/**
 * Cuánto se usó de un recurso, y cuánto permite el plan.
 *
 * Reemplaza la versión de la 011, que sólo sabía de usuarios y propiedades y
 * devolvía «permitido» para cualquier otra cosa que le preguntaran. Ese `ELSE`
 * era lo que hacía que los topes nuevos no existieran: se podía escribir
 * `app_limite_plan('canales')` y siempre decía que sí.
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
    -- Sin suscripción no se bloquea nada: es un problema de datos nuestro, no
    -- del usuario, y no puede impedirle trabajar.
    RETURN QUERY SELECT true, 0, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF p_recurso = 'usuarios' THEN
    SELECT count(*)::int INTO v_usado FROM membresia
      WHERE tenant_id = v_tenant AND estado = 'activa';
    v_max := v_plan.max_usuarios;

  ELSIF p_recurso = 'propiedades' THEN
    SELECT count(*)::int INTO v_usado FROM propiedad WHERE tenant_id = v_tenant;
    v_max := v_plan.max_propiedades;

  ELSIF p_recurso = 'contratos' THEN
    -- Los VIGENTES, no los históricos. Un contrato que terminó en 2023 no
    -- consume nada, y contarlo obligaría a borrar historia para seguir
    -- trabajando —justo lo contrario de lo que este sistema es—.
    SELECT count(*)::int INTO v_usado FROM contrato
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
    -- Del mes corriente: es un caudal, no un acumulado. Si se contaran todos
    -- los envíos de la historia, el tope se alcanzaría una vez y para siempre.
    SELECT count(*)::int INTO v_usado FROM envio_propiedades
      WHERE tenant_id = v_tenant
        AND created_at >= date_trunc('month', now());
    v_max := v_plan.max_envios_mes;

  ELSIF p_recurso = 'red_compartidas' THEN
    SELECT count(*)::int INTO v_usado FROM propiedad
      WHERE tenant_id = v_tenant AND red_compartida;
    v_max := v_plan.max_red_compartidas;

  ELSE
    -- Un recurso que no está acá es un error de programación, no un permiso.
    -- Antes esto devolvía «permitido» y así fue como los topes nuevos no
    -- existían en silencio.
    RAISE EXCEPTION 'Recurso de plan desconocido: %', p_recurso
      USING ERRCODE = 'BE004';
  END IF;

  RETURN QUERY SELECT (v_max IS NULL OR v_usado < v_max), v_usado, v_max, v_plan.codigo;
END;
$$;

GRANT EXECUTE ON FUNCTION app_limite_plan(text) TO app_role;

COMMIT;
