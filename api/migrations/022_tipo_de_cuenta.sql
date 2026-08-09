-- 022 — Qué clase de cuenta es esta.
--
-- No toda la gente que administra alquileres es una inmobiliaria. Hay quien
-- gestiona veinte departamentos —propios o de terceros— y no vende, no reparte
-- comisiones y no tiene embudo de captación. Ese usuario abre el sistema hoy y
-- lo primero que ve son cinco secciones que no va a usar nunca: Ventas,
-- Comisiones, Reservas, Leads y Publicaciones. Eso solo ya dice «esto no es
-- para mí», y el que viene de una planilla de Excel necesita exactamente lo
-- contrario.

ALTER TABLE tenant
  ADD COLUMN tipo text NOT NULL DEFAULT 'inmobiliaria'
    CHECK (tipo IN ('inmobiliaria', 'gestor')),

  -- Los módulos que el titular prendió POR ENCIMA de los que trae su tipo.
  --
  -- Se guardan las excepciones y no la lista completa, a propósito: si se
  -- guardara la lista entera, el día que se agregue un módulo nuevo al producto
  -- ninguna cuenta existente lo vería —su lista se escribió antes de que
  -- existiera— y habría que salir a migrar filas. Guardando sólo lo que alguien
  -- decidió a mano, lo que trae cada tipo se sigue calculando en el código y las
  -- cuentas viejas heredan lo nuevo sin tocar la base.
  --
  -- Y el camino inverso: `modulos_off` son los que apagó aunque su tipo los
  -- traiga. Una inmobiliaria chica que no publica en portales puede sacarse
  -- Publicaciones de encima sin dejar de ser una inmobiliaria.
  ADD COLUMN modulos_on  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN modulos_off text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN tenant.tipo IS
  'inmobiliaria = opera venta y alquiler; gestor = sólo administra alquileres.';
COMMENT ON COLUMN tenant.modulos_on IS
  'Módulos prendidos a mano por encima de los que trae el tipo. Sólo las excepciones.';
COMMENT ON COLUMN tenant.modulos_off IS
  'Módulos apagados a mano aunque el tipo los traiga. Sólo las excepciones.';

-- Las cuentas que ya existen son inmobiliarias: es lo único que el producto
-- sabía ser hasta hoy, y el DEFAULT las deja como estaban. No hay UPDATE porque
-- no hay nada que corregir — a diferencia de la 017, donde el default viejo de
-- `comisiones.alquiler` era 0 y sí había que arreglarlo.
