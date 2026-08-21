-- 045 · El plan Gestión, y separar el bot de la bandeja
--
-- ═══ QUÉ CAMBIA Y POR QUÉ ═══
--
-- La 044 armó tres planes suponiendo que el de entrada era «una inmobiliaria
-- chica». Era la suposición equivocada.
--
-- El de entrada es **quien administra alquileres** —propios o de terceros—: no
-- capta, no vende, no reparte comisiones entre agentes y no publica en portales.
-- Cobra el 1, le rinde al propietario y cuida que no se le venza una garantía.
--
-- Esa persona ya tenía nombre en este sistema desde la etapa 16: es el tipo de
-- cuenta `gestor`. Lo que faltaba era el plan que le corresponde.
--
-- ── Por qué el hook lleva liquidaciones, que es lo más caro de construir ──
--
-- Porque sin liquidaciones no administra nada. Un plan de entrada al que le
-- falta el trabajo entero de quien lo compra no es barato: es inútil. Lo que se
-- reserva para los planes de arriba es lo COMERCIAL —captar, vender, repartir,
-- publicar—, que es justamente lo que un gestor no hace.
--
-- La escalera queda por lo que cada uno HACE, no por cuánto aguanta:
--
--   Gestión      administra alquileres
--   Base         + vende y capta
--   Inmobiliaria + equipo, comisiones, portales y la Red
--   Total        + desarrollos, banco y todo lo demás
--
-- ═══ SEPARAR EL BOT DE LA BANDEJA ═══
--
-- Hasta acá `bandeja` era una sola cosa: centralizar mensajes y el bot que
-- responde solo. Son dos productos distintos y se compran por separado.
--
-- Centralizar es infraestructura: los mensajes de WhatsApp, Instagram y mail en
-- un lugar, con las plantillas de contratos a mano. Sirve desde el primer día y
-- no tiene nada que configurar.
--
-- El bot es una decisión: palabras de salida, escalado a una persona,
-- confirmaciones automáticas. Configurarlo mal le contesta cualquier cosa a un
-- cliente, y hay quien no lo quiere ni gratis.
--
-- Por eso `bandeja` va desde el plan de entrada y `bot` recién en Inmobiliaria.
-- El corte cae limpio sobre los controladores que ya existían separados:
-- `InboxController` y `CanalesController` de un lado, `BotController` y
-- `RespuestasController` del otro.

BEGIN;

ALTER TABLE plan DROP CONSTRAINT plan_codigo_check;

INSERT INTO plan (
  codigo, nombre, orden, precio_usd, resumen, para_quien,
  max_usuarios, max_propiedades, max_contratos, max_sucursales,
  max_canales, max_envios_mes, max_red_compartidas, modulos
) VALUES
  ('gestion', 'Gestión', 1, NULL,
   'Cobrar, ajustar y rendirle al propietario, sin nada de más.',
   'Administrás alquileres —propios o de terceros— y no trabajás con ventas.',
   2, 60, 40, 1, 1, 5, 0,
   -- Sin `bot`: acá la bandeja centraliza y manda plantillas, y nada responde
   -- solo. Es lo que se pidió y además es lo correcto para quien recién entra:
   -- un bot mal configurado le contesta cualquier cosa a un inquilino.
   ARRAY['liquidaciones', 'portal', 'bandeja']);

-- Base deja de ser el plan de entrada y pasa a ser «el gestor que además vende».
-- Hereda todo lo de Gestión y suma lo comercial.
UPDATE plan SET
  orden = 2,
  resumen = 'Todo lo de Gestión, más captar y vender.',
  para_quien = 'Además de administrar, salís a buscar propiedades y a venderlas.',
  max_propiedades = 150,
  max_contratos = NULL,
  max_canales = 1,
  max_envios_mes = 20,
  modulos = ARRAY['liquidaciones', 'portal', 'bandeja',
                  'leads', 'ventas', 'reservas', 'publicaciones']
WHERE codigo = 'base';

UPDATE plan SET
  orden = 3,
  resumen = 'Todo lo de Base, más el equipo, la Red y el bot.',
  modulos = ARRAY['liquidaciones', 'portal', 'bandeja',
                  'leads', 'ventas', 'reservas', 'publicaciones',
                  'comisiones', 'documentos', 'red', 'bot']
WHERE codigo = 'inmobiliaria';

UPDATE plan SET
  orden = 4,
  modulos = ARRAY['liquidaciones', 'portal', 'bandeja',
                  'leads', 'ventas', 'reservas', 'publicaciones',
                  'comisiones', 'documentos', 'red', 'bot',
                  'emprendimientos', 'conciliacion', 'actas',
                  'multisucursal', 'api', 'marca_blanca', 'arca']
WHERE codigo = 'total';

ALTER TABLE plan ADD CONSTRAINT plan_codigo_check
  CHECK (codigo IN ('gestion', 'base', 'inmobiliaria', 'total'));

COMMIT;
