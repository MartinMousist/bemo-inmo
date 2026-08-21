-- 046 · Dos familias de planes: Gestión e Inmobiliaria
--
-- ═══ POR QUÉ CAMBIA OTRA VEZ ═══
--
-- Las 044 y 045 armaron UNA escalera de cuatro peldaños. Está mal: no son
-- cuatro tamaños del mismo producto, son DOS PRODUCTOS.
--
-- Quien administra veinte departamentos no es una inmobiliaria chica. No capta,
-- no vende, no reparte comisiones y no publica en portales — y no va a hacerlo
-- nunca. Ponerlo como el escalón de abajo de una escalera de inmobiliarias le
-- dice, cada vez que abre la página de precios, que está en el peldaño más bajo
-- de algo que no quiere subir.
--
--   Gestión de alquileres     Esencial · Al día
--   Inmobiliaria              Básico · Medio · Todo
--
-- ═══ CONTRA QUIÉN COMPITE CADA FAMILIA ═══
--
-- **Gestión compite con el Excel**, no con Tokko. Y el Excel es gratis y ya lo
-- saben usar, así que el precio tiene que ser tan bajo que la pregunta no sea
-- «¿me conviene?» sino «¿por qué no?».
--
-- Lo que el Excel no puede hacer, y es todo lo que Esencial necesita traer:
-- calcular bien el ajuste por IPC, ICL, UVA o Casa Propia el mes que toca, y
-- armar la liquidación al propietario con sus honorarios, gastos y retenciones.
-- Eso es lo caro de construir y va en el plan más barato, porque sin eso no le
-- gana a una planilla.
--
-- **Inmobiliaria compite con Tokko**, y ahí la comparación es al revés: hace
-- todo lo que hace Tokko y además administra lo que ya se vendió.
--
-- ═══ DÓNDE CAE EL CORTE ENTRE ESENCIAL Y AL DÍA ═══
--
-- Esencial es **mirar**: entrás y ves qué vence, quién debe y cuánto hay que
-- ajustar. La pantalla de Vencimientos es núcleo y no se toca — es la razón por
-- la que alguien deja el Excel.
--
-- Al día es **que te avise y que puedas contestar**: la bandeja de avisos que
-- se genera sola, y el WhatsApp centralizado con las plantillas a mano.
--
-- ⚠️ **Los avisos NO salen del sistema.** Hoy llegan a una bandeja adentro de la
-- aplicación: `recordatorios.service.ts` declara `email` y `whatsapp` como no
-- disponibles porque falta el proveedor de correo y la verificación de negocio
-- de Meta. Así que este plan NO se vende como «te avisamos por WhatsApp». Se
-- vende por lo que hace: avisos que se generan solos y una bandeja donde
-- centralizás los mensajes y respondés con tus plantillas. El día que el envío
-- exista, se agrega; hasta entonces, prometerlo sería vender algo que no está.

BEGIN;

ALTER TABLE plan
  ADD COLUMN familia text NOT NULL DEFAULT 'inmobiliaria'
    CHECK (familia IN ('gestion', 'inmobiliaria'));

ALTER TABLE plan DROP CONSTRAINT plan_codigo_check;

INSERT INTO plan (
  codigo, familia, nombre, orden, precio_usd, resumen, para_quien,
  max_usuarios, max_propiedades, max_contratos, max_sucursales,
  max_canales, max_envios_mes, max_red_compartidas, modulos
) VALUES
  -- ── Familia Gestión ────────────────────────────────────────────────────────
  ('gestion_esencial', 'gestion', 'Esencial', 1, NULL,
   'Los contratos, el ajuste que corresponde y la rendición al propietario.',
   'Hoy lo llevás en una planilla y se te pasan los aumentos.',
   1, 40, 25, 1, 0, 0, 0,
   -- Sólo liquidaciones. Vencimientos, cuotas, cobros y ajustes son núcleo y no
   -- se apagan: son la razón por la que alguien deja el Excel.
   ARRAY['liquidaciones']),

  ('gestion_dia', 'gestion', 'Al día', 2, NULL,
   'Todo lo de Esencial, más que el sistema te avise y puedas contestar.',
   'Administrás varias y no querés estar mirando el calendario.',
   3, 120, 80, 1, 1, 10, 0,
   ARRAY['liquidaciones', 'avisos', 'bandeja', 'portal']),

  -- ── Familia Inmobiliaria ───────────────────────────────────────────────────
  ('inmo_basico', 'inmobiliaria', 'Básico', 1, NULL,
   'Administrar alquileres y además captar y vender.',
   'Sos una inmobiliaria chica y hacés las dos cosas.',
   3, 250, NULL, 1, 1, 30, 0,
   ARRAY['liquidaciones', 'avisos', 'bandeja', 'portal',
         'leads', 'ventas', 'reservas', 'publicaciones']),

  ('inmo_medio', 'inmobiliaria', 'Medio', 2, NULL,
   'Todo lo del Básico, más el equipo, la Red y las respuestas automáticas.',
   'Tenés asesores, repartís comisiones y querés más volumen.',
   10, 1500, NULL, 2, 3, NULL, 30,
   ARRAY['liquidaciones', 'avisos', 'bandeja', 'portal',
         'leads', 'ventas', 'reservas', 'publicaciones',
         'comisiones', 'documentos', 'red', 'bot']),

  ('inmo_total', 'inmobiliaria', 'Todo', 3, NULL,
   'El sistema entero, sin límites.',
   'Administrás a escala, desarrollás emprendimientos o tenés varias sucursales.',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   ARRAY['liquidaciones', 'avisos', 'bandeja', 'portal',
         'leads', 'ventas', 'reservas', 'publicaciones',
         'comisiones', 'documentos', 'red', 'bot',
         'emprendimientos', 'conciliacion', 'actas',
         'multisucursal', 'api', 'marca_blanca', 'arca']);

-- Las cuentas existentes van al equivalente más cercano. Nadie pierde un módulo
-- que ya tenía: `gestion` traía bandeja y portal, así que va a «Al día» y no a
-- «Esencial».
UPDATE suscripcion SET plan_codigo = CASE plan_codigo
  WHEN 'gestion'      THEN 'gestion_dia'
  WHEN 'base'         THEN 'inmo_basico'
  WHEN 'inmobiliaria' THEN 'inmo_medio'
  WHEN 'total'        THEN 'inmo_total'
  ELSE 'inmo_basico'
END;

DELETE FROM plan WHERE codigo IN ('gestion', 'base', 'inmobiliaria', 'total');

ALTER TABLE plan ADD CONSTRAINT plan_codigo_check
  CHECK (codigo IN ('gestion_esencial', 'gestion_dia',
                    'inmo_basico', 'inmo_medio', 'inmo_total'));

-- El orden ya no es único global: hay un «1» por familia. La página de precios
-- muestra dos grupos, y dentro de cada uno ordena por este número.
CREATE UNIQUE INDEX ix_plan_familia_orden ON plan (familia, orden);

COMMIT;
