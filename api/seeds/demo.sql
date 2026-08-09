-- ============================================================================
-- Datos demo para desarrollo. Corre como OWNER, NUNCA en producción
-- (`seed-cli.ts` lo rechaza si `NODE_ENV=production`, y la imagen de
-- producción ni siquiera lleva este archivo).
--
-- Son DOS inmobiliarias a propósito: con una sola no se puede probar que el
-- aislamiento funcione. El gate de la etapa 2 es "cero fuga entre dos cuentas",
-- y para eso hacen falta dos cuentas desde el día uno.
--
-- ── Tres reglas que este archivo se impone ──────────────────────────────────
--
-- 1. **Idempotente.** Todo lleva UUID fijo y `ON CONFLICT DO NOTHING`. Las
--    filas generadas (períodos, cobros) derivan su id de un `md5()` de su
--    padre, así que volver a correrlo no duplica nada. `SEED_ON_BOOT` lo
--    ejecuta en cada arranque de dev.
--
-- 2. **Fechas relativas a `current_date`.** Un seed con fechas fijas envejece:
--    a los tres meses todos los contratos están vencidos y la demo no muestra
--    nada. Acá el mes 0 es el mes en curso y todo cuelga de ahí.
--
-- 3. **Variedad con intención, no relleno.** Cada contrato existe para poner
--    un caso distinto en pantalla: los cuatro tramos de mora, las dos monedas,
--    los seis índices, la cadena de renovación, el contrato sólo intermediado.
--    El tablero y el embudo no se pueden probar con diez filas iguales.
--
-- Entrar: `owner@andes.test` / `unaclavelarga1`. Todos los usuarios demo usan
-- la misma contraseña.
--
-- ⚠️ **Los emails van en un dominio que el seed se reserva** —`@andes.test` y
-- `@plata.test`— y no en `@prueba.test`, que es el que usa cualquiera que se
-- registre a mano probando el signup. `usuario.email` es único GLOBAL: si el
-- seed pide un email que ya existe, revienta `usuario_email_key`.
--
-- Y eso no era una molestia menor: con `SEED_ON_BOOT` prendido, el seed corre
-- ANTES de que levante Nest, así que un choque de email dejaba a la API en
-- ciclo de reinicio y al front con `ERR_CONNECTION_RESET`. Pasó de verdad al
-- escribir este archivo. Se arregló por los dos lados: acá, con un dominio
-- propio; y en `main.ts`, donde un seed que falla ahora avisa y deja arrancar.
-- ============================================================================


-- ── Inmobiliarias ───────────────────────────────────────────────────────────

INSERT INTO tenant (id, nombre, cuit, provincia, moneda_default)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Inmobiliaria Andes',    '30-71234567-9', 'Mendoza',      'ARS'),
  ('22222222-2222-4222-8222-222222222222', 'Inmobiliaria del Plata','30-79876543-2', 'Buenos Aires', 'ARS')
ON CONFLICT (id) DO NOTHING;

-- El trigger `propiedad_limite_plan` consulta el plan del tenant ACTUAL, y sin
-- contexto `app_limite_plan()` devuelve "no permitido". Fijarlo acá no es un
-- detalle del seed: es la misma llave que usa la aplicación en cada request.
SELECT set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', false);

INSERT INTO suscripcion (tenant_id, plan_codigo, estado, prueba_hasta)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'medio', 'prueba', current_date + 30),
  ('22222222-2222-4222-8222-222222222222', 'inicial', 'prueba', current_date + 30)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO sucursal (id, tenant_id, nombre, direccion, telefono) VALUES
  ('5c000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Centro',     'Av. San Martín 1043, Ciudad',  '261 420-1100'),
  ('5c000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Godoy Cruz', 'Perito Moreno 220, Godoy Cruz','261 424-8890'),
  ('5c000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Casa central','Av. Rivadavia 5600, CABA',    '11 4903-2200')
ON CONFLICT (id) DO NOTHING;


-- ── Usuarios y roles ────────────────────────────────────────────────────────
-- Los cuatro roles existen para que la matriz de permisos se pueda probar a
-- mano: entrar como `agente` y ver que los bloques de plata vienen en `null`
-- —no en cero— es media pantalla de inicio verificada sin escribir un test.
--
-- Están TODOS acá, incluidos los cinco que sólo hacen falta más abajo (Belén,
-- Martín, Paula, Iván y el asesor de La Plata). Antes se cargaban recién en
-- «Completar el volumen», y eso rompía el seed entero en una base limpia:
-- `comision.beneficiario_id` referencia `usuario(id)`, y el árbol de comisiones
-- de la venta 6 nombra a Martín Aguirre 500 líneas antes de que Martín
-- existiera. El archivo corre en UNA transacción, así que ese error no dejaba
-- un seed a medias: dejaba la base vacía y la API sin arrancar.
-- Las membresías de esos cinco siguen abajo, con sus sucursales, que recién se
-- crean ahí.

INSERT INTO usuario (id, email, password_hash, nombre, estado) VALUES
  ('11000000-0000-4000-8000-000000000001','owner@andes.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Ana Torres',  'activo'),
  ('11000000-0000-4000-8000-000000000002','admin@andes.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Diego Paz',   'activo'),
  ('11000000-0000-4000-8000-000000000003','asesor@andes.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Sofía Luna',  'activo'),
  ('11000000-0000-4000-8000-000000000004','contable@andes.test','$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Raúl Vega',   'activo'),
  ('11000000-0000-4000-8000-000000000005','asesor2@andes.test', '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Nicolás Paz', 'activo'),
  ('11000000-0000-4000-8000-000000000006','asesor3@andes.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Belén Ortiz',   'activo'),
  ('11000000-0000-4000-8000-000000000007','asesor4@andes.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Martín Aguirre','activo'),
  ('11000000-0000-4000-8000-000000000008','admin2@andes.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Paula Bravo',   'activo'),
  ('11000000-0000-4000-8000-000000000009','suspendido@andes.test','$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Iván Sosa',    'suspendido'),
  ('22000000-0000-4000-8000-000000000001','owner@plata.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Laura Giménez','activo'),
  ('22000000-0000-4000-8000-000000000002','asesor@plata.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Damián Ruiz',   'activo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO membresia (id, tenant_id, usuario_id, rol, estado, sucursal_id) VALUES
  ('11500000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000001','owner',   'activa','5c000000-0000-4000-8000-000000000001'),
  ('11500000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000002','admin',   'activa','5c000000-0000-4000-8000-000000000001'),
  ('11500000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000003','agente',  'activa','5c000000-0000-4000-8000-000000000001'),
  ('11500000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000004','contable','activa',NULL),
  ('11500000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000005','agente',  'activa','5c000000-0000-4000-8000-000000000002'),
  ('22500000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','22000000-0000-4000-8000-000000000001','owner',   'activa','5c000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;


-- ── Personas ────────────────────────────────────────────────────────────────
-- Una persona, muchos papeles: Elena Bustos es propietaria en condominio Y
-- compradora en otra operación. Es la regla estructural #1 del spec —roles
-- contextuales, no tablas por tipo— y sin un caso así en los datos, nadie la
-- ve funcionar.

INSERT INTO persona (id, tenant_id, tipo, nombre, apellido, doc_tipo, doc_numero, email, telefono, domicilio) VALUES
  -- Propietarios
  ('a0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','fisica','Jorge','Ferreyra','dni','14876234','jferreyra@correo.test','261 615-2233','Belgrano 1240, Ciudad'),
  ('a0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','fisica','Marta','Silva','dni','16234998','msilva@correo.test','261 604-1188','Olascoaga 560, Ciudad'),
  ('a0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','fisica','Elena','Bustos','dni','20114567','ebustos@correo.test','261 632-7745','Sarmiento 88, Ciudad'),
  ('a0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','fisica','Raúl','Ovejero','dni','18990321','rovejero@correo.test','261 641-9002','Mitre 1420, Ciudad'),
  ('a0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','juridica','Cooperativa San Martín',NULL,'cuit','30-70998877-4','admin@coopsm.test','261 429-3311','Av. San Martín 2300, Ciudad'),
  ('a0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','fisica','Luis','Cabrera','dni','22456789','lcabrera@correo.test','261 655-4412','Rioja 780, Ciudad'),
  ('a0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','fisica','Nora','Peralta','dni','13567890','nperalta@correo.test','261 622-3390','Chile 1150, Ciudad'),
  ('a0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','fisica','Héctor','Molina','dni','11234876','hmolina@correo.test','261 618-7723','Salta 445, Ciudad'),
  -- Inquilinos
  ('a0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','fisica','Camila','Rossi','dni','35678901','crossi@correo.test','261 671-2200','Arístides Villanueva 345, Ciudad'),
  ('a0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','fisica','Federico','Arce','dni','33445566','farce@correo.test','261 688-1145','Belgrano 560, Ciudad'),
  ('a0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','fisica','Valentina','Ruiz','dni','37890123','vruiz@correo.test','261 690-3312','Rivadavia 2340, Guaymallén'),
  ('a0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','fisica','Matías','Correa','dni','31122334','mcorrea@correo.test','261 645-8890','Emilio Civit 890, Ciudad'),
  ('a0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','fisica','Julieta','Ferrari','dni','38112233','jferrari@correo.test','261 677-9911','Paso de los Andes 1780, Godoy Cruz'),
  ('a0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','fisica','Gonzalo','Vidal','dni','36778899','gvidal@correo.test','261 662-4478','Sarmiento 240, Ciudad'),
  ('a0000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','juridica','Bar Don Genaro SRL',NULL,'cuit','30-71556677-1','contacto@dongenaro.test','261 425-6677','San Martín 1120, Godoy Cruz'),
  -- Garantes
  ('a0000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','fisica','Adriana','Rossi','dni','17889900','arossi@correo.test','261 633-1220','Godoy Cruz 340, Ciudad'),
  ('a0000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','fisica','Pablo','Arce','dni','15667788','parce@correo.test','261 611-5540','9 de Julio 990, Ciudad'),
  ('a0000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','fisica','Silvina','Correa','dni','19334455','scorrea@correo.test','261 628-6612','Perú 1230, Ciudad'),
  -- Compradores e interesados
  ('a0000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','fisica','Ignacio','Duarte','dni','29556677','iduarte@correo.test','261 650-1177','Av. Colón 220, Ciudad'),
  ('a0000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','fisica','Rocío','Miranda','dni','34667788','rmiranda@correo.test','261 682-3345','Las Heras 1100, Ciudad'),
  ('a0000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','fisica','Tomás','Belgrano','dni','30998877','tbelgrano@correo.test','261 640-9988','Buenos Aires 660, Ciudad'),
  ('a0000000-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','fisica','Carla','Zapata','dni','32445599','czapata@correo.test','261 673-2214','Espejo 480, Ciudad'),
  ('a0000000-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','fisica','Emilio','Núñez','dni','28112244','enunez@correo.test','261 636-7701','Necochea 320, Ciudad'),
  ('a0000000-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111','fisica','Fabiana','Ledesma','dni','33221100','fledesma@correo.test','261 659-4433','Montevideo 150, Ciudad'),
  -- Las partes de los cuatro contratos que proyectan (c15..c18). Propietarios,
  -- inquilinos y garantes: cuatro de cada uno, con teléfono y mail cargados,
  -- que es lo que el envío del pre-contrato necesita para tener a quién
  -- mandárselo. Los teléfonos van escritos como los escribe una persona —«261
  -- 615-2233»— porque es lo que `telefono.motor.ts` tiene que saber leer.
  ('a0000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111','fisica','Gabriela','Sosa','dni','21445566','gsosa@correo.test','261 613-8890','Boulogne Sur Mer 1240, Ciudad'),
  ('a0000000-0000-4000-8000-000000000026','11111111-1111-4111-8111-111111111111','fisica','Osvaldo','Funes','dni','16778899','ofunes@correo.test','261 627-4471','Tiburcio Benegas 780, Godoy Cruz'),
  ('a0000000-0000-4000-8000-000000000027','11111111-1111-4111-8111-111111111111','fisica','Mercedes','Ávila','dni','19556677','mavila@correo.test','261 634-2218','San Lorenzo 455, Ciudad'),
  ('a0000000-0000-4000-8000-000000000028','11111111-1111-4111-8111-111111111111','fisica','Ramiro','Quiroz','dni','23887766','rquiroz@correo.test','261 648-9930','Carlos Pellegrini 2130, Guaymallén'),
  ('a0000000-0000-4000-8000-000000000029','11111111-1111-4111-8111-111111111111','fisica','Lucía','Bianchi','dni','39112244','lbianchi@correo.test','261 695-7712','Boulogne Sur Mer 1240, Ciudad'),
  ('a0000000-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111','fisica','Damián','Ojeda','dni','34556688','dojeda@correo.test','261 684-3320','Tiburcio Benegas 780, Godoy Cruz'),
  ('a0000000-0000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111','fisica','Paula','Ibáñez','dni','37665544','pibanez@correo.test','261 691-4408','San Lorenzo 455, Ciudad'),
  ('a0000000-0000-4000-8000-000000000032','11111111-1111-4111-8111-111111111111','fisica','Sebastián','Roldán','dni','32998811','sroldan@correo.test','261 679-2245','Carlos Pellegrini 2130, Guaymallén'),
  ('a0000000-0000-4000-8000-000000000033','11111111-1111-4111-8111-111111111111','fisica','Norma','Bianchi','dni','18334422','nbianchi@correo.test','261 620-1194','Chacabuco 610, Ciudad'),
  ('a0000000-0000-4000-8000-000000000034','11111111-1111-4111-8111-111111111111','fisica','Aníbal','Ojeda','dni','17223344','aojeda@correo.test','261 616-5583','Perú 980, Ciudad'),
  ('a0000000-0000-4000-8000-000000000035','11111111-1111-4111-8111-111111111111','fisica','Cristina','Ibáñez','dni','20667788','cibanez@correo.test','261 625-7739','Godoy Cruz 1180, Ciudad'),
  ('a0000000-0000-4000-8000-000000000036','11111111-1111-4111-8111-111111111111','fisica','Hugo','Roldán','dni','15889977','hroldan@correo.test','261 611-3326','Alem 450, Ciudad'),
  -- La otra inmobiliaria
  ('a2000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','fisica','Alberto','Krause','dni','12334455','akrause@correo.test','11 5544-2200','Av. Cabildo 2200, CABA'),
  ('a2000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','fisica','Mariana','Ostrovsky','dni','27889900','mostrovsky@correo.test','11 5566-8877','Juramento 1450, CABA'),
  ('a2000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','fisica','Sergio','Quiroga','dni','30112233','squiroga@correo.test','11 5533-1199','Av. Santa Fe 3300, CABA')
ON CONFLICT (id) DO NOTHING;


-- ── Propiedades ─────────────────────────────────────────────────────────────
-- Nueve de los nueve tipos que el schema admite, y direcciones reales del Gran
-- Mendoza. Tres quedan SIN lat/lng a propósito: el aviso de "sin ubicar" y el
-- backfill de geocoding necesitan algo que arreglar para poder verse.

INSERT INTO propiedad (id, tenant_id, codigo, calle, numero, piso, depto, localidad, provincia, cp, lat, lng, geocode_fuente, geocode_el, tipo, sup_total, sup_cubierta, ambientes, dormitorios, banos, cocheras, antiguedad, orientacion, estado_conservacion, amenities, descripcion, agente_captador_id, sucursal_id) VALUES
  ('b0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111', 1,'Arístides Villanueva','345','3','B','Ciudad','Mendoza','5500',-32.8908000,-68.8558000,'google',now()-interval '40 days','departamento', 78, 72,3,2,1,1,12,'norte','muy_bueno','{balcon,seguridad}','Luminoso, sobre la calle de bares. Balcón al frente.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111', 2,'San Martín','1120',NULL,NULL,'Godoy Cruz','Mendoza','5501',NULL,NULL,NULL,NULL,'local',120,110,NULL,NULL,2,0,25,'este','bueno','{vidriera}','Local a la calle con dos vidrieras y depósito atrás.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111', 3,'Perito Moreno','78',NULL,NULL,'Chacras de Coria','Mendoza','5505',-32.9833000,-68.8833000,'google',now()-interval '55 days','casa',420,260,5,3,3,2,18,'noreste','muy_bueno','{pileta,parque,quincho}','Casa en Chacras con parque añoso y pileta.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111', 4,'Belgrano','560','5','A','Ciudad','Mendoza','5500',-32.8895000,-68.8471000,'google',now()-interval '30 days','departamento', 55, 52,2,1,1,0,22,'sur','bueno','{ascensor}','Dos ambientes en el centro, a dos cuadras de la peatonal.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111', 5,'Rivadavia','2340',NULL,NULL,'Guaymallén','Mendoza','5519',-32.8892000,-68.8106000,'google',now()-interval '28 days','ph', 90, 84,3,2,1,1,35,'oeste','bueno','{patio}','PH al fondo, con patio propio y entrada independiente.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111', 6,'Emilio Civit','890',NULL,NULL,'Ciudad','Mendoza','5500',-32.8921000,-68.8622000,'google',now()-interval '60 days','casa',310,240,6,4,3,2,45,'norte','muy_bueno','{parque,quincho,seguridad}','Casona sobre Civit, refaccionada. En condominio entre dos hermanos.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111', 7,'Av. España','1450','8','3','Ciudad','Mendoza','5500',-32.8880000,-68.8420000,'google',now()-interval '15 days','oficina', 65, 65,3,NULL,1,1,10,'este','muy_bueno','{ascensor,seguridad}','Oficina en torre sobre España, apta profesional.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111', 8,'Paso de los Andes','1780','2','C','Godoy Cruz','Mendoza','5501',-32.9101000,-68.8712000,'google',now()-interval '22 days','departamento', 62, 58,2,1,1,1,8,'norte','muy_bueno','{balcon,ascensor,sum}','Dos ambientes con balcón y SUM en el edificio.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111', 9,'Ruta 40 km 12',NULL,NULL,NULL,'Luján de Cuyo','Mendoza','5507',NULL,NULL,NULL,NULL,'galpon',800,800,NULL,NULL,2,10,20,NULL,'bueno','{}','Galpón sobre Ruta 40 con playa de maniobras.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111',10,'Sarmiento','240','4','D','Ciudad','Mendoza','5500',-32.8899000,-68.8449000,'google',now()-interval '18 days','departamento', 45, 42,1,1,1,0,30,'sur','regular','{}','Monoambiente sobre la peatonal, ideal renta.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111',11,'Roca','55',NULL,NULL,'Maipú','Mendoza','5515',-32.9800000,-68.7900000,'google',now()-interval '70 days','casa',180,140,4,3,2,1,28,'noreste','bueno','{patio,parrilla}','Casa en Maipú con patio y parrilla.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111',12,'Las Heras','670',NULL,'C-14','Ciudad','Mendoza','5500',NULL,NULL,NULL,NULL,'cochera', 14, 14,NULL,NULL,NULL,1,15,NULL,'bueno','{seguridad}','Cochera cubierta en playa con acceso 24 h.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111',13,'Viamonte','3200',NULL,NULL,'Chacras de Coria','Mendoza','5505',-32.9855000,-68.8801000,'google',now()-interval '12 days','terreno',600,NULL,NULL,NULL,NULL,NULL,NULL,'norte','bueno','{}','Lote en Chacras, todos los servicios, apto duplex.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111',14,'Colón','445','2','A','Ciudad','Mendoza','5500',-32.8912000,-68.8480000,'google',now()-interval '90 days','departamento', 70, 66,3,2,1,1,16,'este','bueno','{ascensor,balcon}','Tres ambientes sobre Colón, con balcón corrido.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  -- Las cuatro de los contratos que PROYECTAN sus aumentos (ver la tabla de
  -- casos en la sección de Contratos). Propiedades nuevas y no alguna de las
  -- catorce de arriba: el constraint EXCLUDE de contratos solapados no se toca,
  -- y cada contrato queda con su propia historia limpia.
  --
  -- Los códigos arrancan en 31 y no en 15 porque `seeds/demo-cartera.sql` —la
  -- cartera ofrecida— se reserva del 15 al 30. `UNIQUE (tenant_id, codigo)` no
  -- perdona, y el error que tira no menciona al otro archivo.
  ('b3000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',31,'Boulogne Sur Mer','1240',NULL,NULL,'Ciudad','Mendoza','5500',-32.8935000,-68.8531000,'google',now()-interval '65 days','departamento', 82, 76,3,2,2,1,9,'norte','muy_bueno','{balcon,ascensor,seguridad}','Tres ambientes con balcón, a una cuadra del Parque Central.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',32,'Tiburcio Benegas','780',NULL,NULL,'Godoy Cruz','Mendoza','5501',-32.9155000,-68.8541000,'google',now()-interval '58 days','ph', 95, 88,4,2,1,1,26,'este','bueno','{patio,parrilla}','PH al frente con patio y parrilla, entrada independiente.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b3000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',33,'San Lorenzo','455','6','A','Ciudad','Mendoza','5500',-32.8886000,-68.8503000,'google',now()-interval '44 days','departamento', 68, 64,3,2,1,1,13,'noreste','muy_bueno','{ascensor,balcon,sum}','Tres ambientes en torre sobre San Lorenzo, con SUM.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',34,'Carlos Pellegrini','2130',NULL,NULL,'Guaymallén','Mendoza','5519',-32.8871000,-68.8014000,'google',now()-interval '36 days','casa',240,165,5,3,2,2,31,'oeste','bueno','{patio,quincho}','Casa con quincho y patio grande, sobre calle asfaltada.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  -- La otra inmobiliaria: dos propiedades alcanzan para probar el aislamiento.
  ('b2000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222', 1,'Av. Cabildo','2200','7','B','CABA','Buenos Aires','1428',-34.5620000,-58.4560000,'google',now()-interval '20 days','departamento', 68, 64,3,2,1,1,14,'norte','muy_bueno','{ascensor,seguridad}','Tres ambientes en Belgrano.',NULL,'5c000000-0000-4000-8000-000000000003'),
  ('b2000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222', 2,'Juramento','1450',NULL,NULL,'CABA','Buenos Aires','1428',NULL,NULL,NULL,NULL,'local', 95, 90,NULL,NULL,1,0,30,'sur','bueno','{vidriera}','Local sobre Juramento.',NULL,'5c000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;

-- El correlativo NO es una secuencia: es `tenant.prox_codigo_propiedad`, que
-- `app_proximo_codigo_propiedad()` incrementa con un UPDATE ... RETURNING. Si
-- el seed inserta códigos a mano y no lo mueve, la primera propiedad que cargue
-- el usuario choca contra `UNIQUE (tenant_id, codigo)` y el error no dice nada
-- sobre el seed.
UPDATE tenant t
   SET prox_codigo_propiedad = GREATEST(
         t.prox_codigo_propiedad,
         COALESCE((SELECT max(p.codigo) FROM propiedad p WHERE p.tenant_id = t.id), 0) + 1)
 WHERE t.id IN ('11111111-1111-4111-8111-111111111111',
                '22222222-2222-4222-8222-222222222222');


-- ── Titularidad ─────────────────────────────────────────────────────────────
-- PROP-0006 va en condominio 50/50: es el caso que obliga a la liquidación a
-- partirse en dos, y sin él esa rama del código no se ve nunca.

INSERT INTO titularidad (id, tenant_id, propiedad_id, persona_id, porcentaje) VALUES
  ('7a000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',100),
  ('7a000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002',100),
  ('7a000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000006',100),
  ('7a000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',100),
  ('7a000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000007',100),
  ('7a000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000003', 50),
  ('7a000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000004', 50),
  ('7a000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000005',100),
  ('7a000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000002',100),
  ('7a000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000005',100),
  ('7a000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000008',100),
  ('7a000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000007',100),
  ('7a000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000008',100),
  ('7a000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000006',100),
  ('7a000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000001',100),
  ('7a000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000025',100),
  ('7a000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000026',100),
  ('7a000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000027',100),
  ('7a000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000028',100),
  ('7a200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',100),
  ('7a200000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002',100)
ON CONFLICT (id) DO NOTHING;


-- ── Operaciones ─────────────────────────────────────────────────────────────
-- PROP-0006, PROP-0011 y PROP-0014 están en venta Y en alquiler a la vez. Es
-- la regla estructural #2 del spec y la razón por la que `tipo_operacion` no
-- vive en `propiedad`.

INSERT INTO operacion (id, tenant_id, propiedad_id, tipo, precio, moneda, expensas, expensas_moneda, estado, fecha_publicacion, exclusividad_hasta) VALUES
  ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','alquiler',   546207,'ARS', 68000,'ARS','cerrada',    current_date-620,NULL),
  ('c0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','venta',       94000,'USD',     0,'ARS','disponible', current_date-120,current_date+45),
  ('c0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002','alquiler',   720000,'ARS',     0,'ARS','cerrada',    current_date-400,NULL),
  ('c0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000003','venta',      215000,'USD',     0,'ARS','reservada',  current_date-95, current_date+20),
  ('c0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','alquiler',   352000,'ARS', 42000,'ARS','cerrada',    current_date-500,NULL),
  ('c0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','alquiler',   410000,'ARS',     0,'ARS','cerrada',    current_date-330,NULL),
  ('c0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','alquiler',   950000,'ARS',     0,'ARS','cerrada',    current_date-280,NULL),
  ('c0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','venta',      340000,'USD',     0,'ARS','suspendida', current_date-200,NULL),
  ('c0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000007','alquiler',   480000,'ARS', 95000,'ARS','reservada',  current_date-40, current_date+60),
  ('c0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000008','alquiler',   365000,'ARS', 51000,'ARS','cerrada',    current_date-260,NULL),
  ('c0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','alquiler',      2400,'USD',     0,'ARS','cerrada',    current_date-210,NULL),
  ('c0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','venta',      480000,'USD',     0,'ARS','disponible', current_date-150,NULL),
  ('c0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','alquiler',   240000,'ARS', 33000,'ARS','cerrada',    current_date-180,NULL),
  ('c0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011','venta',      168000,'USD',     0,'ARS','disponible', current_date-75, NULL),
  ('c0000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011','alquiler',   430000,'ARS',     0,'ARS','disponible', current_date-60, NULL),
  ('c0000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000012','alquiler',    85000,'ARS',     0,'ARS','cerrada',    current_date-140,NULL),
  ('c0000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000013','venta',       72000,'USD',     0,'ARS','disponible', current_date-30, current_date+90),
  ('c0000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','alquiler',   398000,'ARS', 47000,'ARS','cerrada',    current_date-750,NULL),
  ('c0000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','venta',      112000,'USD',     0,'ARS','cerrada',    current_date-300,NULL),
  ('c0000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000013','alquiler',   150000,'ARS',     0,'ARS','borrador',   NULL,NULL),
  -- Las de los cuatro contratos que proyectan. Estado 'cerrada' porque es el
  -- estado de una unidad alquilada: la cartera de alquiler filtra por eso, y
  -- dejarlas 'disponible' las mostraría como si estuvieran libres teniendo un
  -- inquilino adentro (la trampa que apareció en la etapa 11.4).
  ('c3000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000001','alquiler',   640000,'ARS', 72000,'ARS','cerrada',    current_date-400,NULL),
  ('c3000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000002','alquiler',   415000,'ARS',     0,'ARS','cerrada',    current_date-300,NULL),
  ('c3000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000003','alquiler',   520000,'ARS', 58000,'ARS','cerrada',    current_date-300,NULL),
  ('c3000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000004','alquiler',   380000,'ARS',     0,'ARS','cerrada',    current_date-400,NULL),
  ('c2000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000001','alquiler',   620000,'ARS', 88000,'ARS','cerrada',    current_date-190,NULL),
  ('c2000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000002','venta',      145000,'USD',     0,'ARS','disponible', current_date-45, NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Contratos ───────────────────────────────────────────────────────────────
-- Catorce contratos, y cada uno está para poner un caso distinto en pantalla:
--
--   c01  IPC           EN MORA +90d (seis cuotas)      el peor caso de cobranza
--   c02  ICL           al día                          el caso normal
--   c03  UVA           PARCIAL                         pago a medias del mes
--   c04  % fijo        mora 31-60d                     el tramo del medio
--   c05  ICP           al día, CONDOMINIO              parte la liquidación en dos
--   c06  IPC           mora 1-30d                      el tramo que todavía se llama
--   c07  ninguno       al día, NO administrado         sólo intermediado: sin ciclo
--   c08  IPC           vencido hace dos meses          alimenta la vacancia
--   c09  IPC           renovado                        cabeza de la cadena
--   c10  IPC           vigente, renueva a c09          la cadena que nadie escribía
--   c11  % fijo        al día                          cochera, importe chico
--   c12  ninguno USD   al día                          la otra moneda
--   c13  ICL           rescindido hace ocho meses      el otro final posible
--   c14  UVA           por_iniciar el mes que viene    todavía no arrancó
--
-- Y los cuatro que existen para que el AJUSTE se vea proyectar de verdad, con
-- las dos periodicidades más usadas y los dos índices que hoy se usan:
--
--   c15  ICL  cada 4 meses, plazo de 2 años    inicio M0-12 · fin M0+12
--   c16  ICL  cada 3 meses                     inicio M0-9  · fin M0+27
--   c17  IPC  cada 3 meses                     inicio M0-9  · fin M0+27
--   c18  IPC  cada 4 meses                     inicio M0-12 · fin M0+24
--
-- Las fechas no son al azar: con estas, cada uno saca TRES aumentos reales y se
-- frena en el cuarto porque el índice de ese mes todavía no se publicó — y lo
-- informa por `sinIndice` en vez de estimarlo. En una demo eso es lo mejor de
-- los dos mundos: se ven los cuatro tipos de ajuste funcionando y se ve el
-- mensaje honesto de «falta el índice de tal mes».
--
-- Los ajustes de estos cuatro NO se escriben acá: los calcula `seed.ts` con
-- `calcularAjuste()` y `periodosDeAjuste()`, o sea con el motor de verdad. Los
-- doce de más abajo están tipeados a mano con su coeficiente, que es dibujar el
-- resultado en vez de dejar que el sistema lo produzca.
--
-- `mes_base` va SIEMPRE un mes antes del arranque: el índice de un mes se
-- publica a mediados del siguiente, y un ajuste que mira el mes en curso no
-- proyecta nada. Es una de las trampas anotadas en docs/CONTINUAR.md.

INSERT INTO contrato_alquiler (
  id, tenant_id, propiedad_id, operacion_id, fecha_inicio, fecha_fin, dia_vencimiento,
  monto_inicial, moneda, indice, indice_porcentaje, periodicidad_meses, mes_base,
  administrado, deposito, deposito_moneda, honorarios_pct, punitorio_diario_pct,
  punitorio_para, estado, contrato_anterior_id, notas
) VALUES
  ('d0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
    (date_trunc('month',current_date)-interval '18 months')::date, (date_trunc('month',current_date)+interval '18 months')::date, 10,
    485000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '19 months')::date,
    true, 485000,'ARS', 8, 0.100,'propietario','vigente',NULL,'Inquilina con atraso sostenido. Ver notas de gestión.'),

  ('d0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005',
    (date_trunc('month',current_date)-interval '14 months')::date, (date_trunc('month',current_date)+interval '22 months')::date, 5,
    320000,'ARS','icl',NULL,4,(date_trunc('month',current_date)-interval '15 months')::date,
    true, 320000,'ARS', 8, 0.080,'propietario','vigente',NULL,NULL),

  ('d0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000006',
    (date_trunc('month',current_date)-interval '10 months')::date, (date_trunc('month',current_date)+interval '26 months')::date, 8,
    410000,'ARS','uva',NULL,6,(date_trunc('month',current_date)-interval '11 months')::date,
    true, 410000,'ARS', 7, 0.050,'propietario','vigente',NULL,NULL),

  ('d0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003',
    (date_trunc('month',current_date)-interval '12 months')::date, (date_trunc('month',current_date)+interval '24 months')::date, 10,
    720000,'ARS','porcentaje_fijo',12.000,6,(date_trunc('month',current_date)-interval '13 months')::date,
    true, 1440000,'ARS',10, 0.150,'inmobiliaria','vigente',NULL,'Comercial. Punitorio a la inmobiliaria por convenio.'),

  ('d0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000007',
    (date_trunc('month',current_date)-interval '9 months')::date, (date_trunc('month',current_date)+interval '27 months')::date, 10,
    950000,'ARS','icp',NULL,12,(date_trunc('month',current_date)-interval '10 months')::date,
    true, 950000,'ARS', 8, 0.100,'propietario','vigente',NULL,'Condominio 50/50: se liquida por separado a cada hermano.'),

  ('d0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000010',
    (date_trunc('month',current_date)-interval '8 months')::date, (date_trunc('month',current_date)+interval '28 months')::date, 10,
    365000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '9 months')::date,
    true, 365000,'ARS', 8, 0.100,'propietario','vigente',NULL,NULL),

  ('d0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000013',
    (date_trunc('month',current_date)-interval '6 months')::date, (date_trunc('month',current_date)+interval '30 months')::date, 10,
    240000,'ARS','ninguno',NULL,12,(date_trunc('month',current_date)-interval '7 months')::date,
    false, 240000,'ARS', 5, 0.000,'propietario','vigente',NULL,'Sólo intermediado: la inmobiliaria no cobra ni liquida.'),

  ('d0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011',NULL,
    (date_trunc('month',current_date)-interval '26 months')::date, (date_trunc('month',current_date)-interval '2 months')::date, 10,
    280000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '27 months')::date,
    true, 280000,'ARS', 8, 0.100,'propietario','vencido',NULL,'Terminó y no renovó. La propiedad quedó vacía.'),

  ('d0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000018',
    (date_trunc('month',current_date)-interval '24 months')::date, (date_trunc('month',current_date)-interval '1 month')::date, 10,
    260000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '25 months')::date,
    true, 260000,'ARS', 8, 0.100,'propietario','renovado',NULL,'Renovado. Ver el contrato siguiente.'),

  ('d0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000018',
    (date_trunc('month',current_date))::date, (date_trunc('month',current_date)+interval '36 months')::date, 10,
    398000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '1 month')::date,
    true, 398000,'ARS', 8, 0.100,'propietario','vigente','d0000000-0000-4000-8000-000000000009','Renovación del anterior con el mismo inquilino.'),

  ('d0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000016',
    (date_trunc('month',current_date)-interval '4 months')::date, (date_trunc('month',current_date)+interval '20 months')::date, 10,
    85000,'ARS','porcentaje_fijo',10.000,12,(date_trunc('month',current_date)-interval '5 months')::date,
    true, 85000,'ARS', 6, 0.000,'propietario','vigente',NULL,NULL),

  ('d0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000011',
    (date_trunc('month',current_date)-interval '7 months')::date, (date_trunc('month',current_date)+interval '29 months')::date, 10,
    2400,'USD','ninguno',NULL,12,(date_trunc('month',current_date)-interval '8 months')::date,
    true, 4800,'USD',10, 0.000,'propietario','vigente',NULL,'En dólares: no se suma con el resto de la cartera.'),

  ('d0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011',NULL,
    (date_trunc('month',current_date)-interval '38 months')::date, (date_trunc('month',current_date)-interval '8 months')::date, 10,
    195000,'ARS','icl',NULL,4,(date_trunc('month',current_date)-interval '39 months')::date,
    true, 195000,'ARS', 8, 0.100,'propietario','rescindido',NULL,'Rescindido antes de tiempo por traslado del inquilino.'),

  ('d0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000009',
    (date_trunc('month',current_date)+interval '1 month')::date, (date_trunc('month',current_date)+interval '37 months')::date, 10,
    480000,'ARS','uva',NULL,6,(date_trunc('month',current_date))::date,
    true, 960000,'ARS', 8, 0.100,'propietario','por_iniciar',NULL,'Firmado, arranca el mes que viene.'),

  -- ICL cada 4 meses, plazo de 2 años. Con expensas.
  ('d0000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
    (date_trunc('month',current_date)-interval '12 months')::date, (date_trunc('month',current_date)+interval '12 months')::date, 10,
    640000,'ARS','icl',NULL,4,(date_trunc('month',current_date)-interval '13 months')::date,
    true, 640000,'ARS', 8, 0.100,'propietario','vigente',NULL,'ICL cuatrimestral, dos años de plazo. Proyecta tres aumentos.'),

  -- ICL cada 3 meses. Sin expensas.
  ('d0000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002',
    (date_trunc('month',current_date)-interval '9 months')::date, (date_trunc('month',current_date)+interval '27 months')::date, 5,
    415000,'ARS','icl',NULL,3,(date_trunc('month',current_date)-interval '10 months')::date,
    true, 415000,'ARS', 8, 0.100,'propietario','vigente',NULL,'ICL trimestral, que es la combinación más usada hoy.'),

  -- IPC cada 3 meses. Con expensas.
  ('d0000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000003',
    (date_trunc('month',current_date)-interval '9 months')::date, (date_trunc('month',current_date)+interval '27 months')::date, 10,
    520000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '10 months')::date,
    true, 520000,'ARS', 8, 0.100,'propietario','vigente',NULL,'IPC trimestral. Mismas fechas que el ICL de al lado, a propósito: se pueden comparar los dos índices sobre el mismo plazo.'),

  -- IPC cada 4 meses. Sin expensas.
  ('d0000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','b3000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000004',
    (date_trunc('month',current_date)-interval '12 months')::date, (date_trunc('month',current_date)+interval '24 months')::date, 10,
    380000,'ARS','ipc',NULL,4,(date_trunc('month',current_date)-interval '13 months')::date,
    true, 760000,'ARS', 7, 0.080,'propietario','vigente',NULL,'IPC cuatrimestral. Depósito de dos meses.'),

  ('d2000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
    (date_trunc('month',current_date)-interval '6 months')::date, (date_trunc('month',current_date)+interval '30 months')::date, 10,
    620000,'ARS','ipc',NULL,3,(date_trunc('month',current_date)-interval '7 months')::date,
    true, 620000,'ARS', 8, 0.100,'propietario','vigente',NULL,NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Partes del contrato ─────────────────────────────────────────────────────
-- Locador, locatario y —donde corresponde— garante. En el condominio hay DOS
-- locadores al 50%, que es de donde sale la liquidación partida.

INSERT INTO contrato_parte (id, tenant_id, contrato_id, persona_id, rol, porcentaje) VALUES
  ('9a000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','locador',100),
  ('9a000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000009','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000016','garante',NULL),
  ('9a000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','locador',100),
  ('9a000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000010','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000017','garante',NULL),
  ('9a000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000007','locador',100),
  ('9a000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000011','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000002','locador',100),
  ('9a000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000015','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000003','locador', 50),
  ('9a000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000004','locador', 50),
  ('9a000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000012','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000018','garante',NULL),
  ('9a000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000002','locador',100),
  ('9a000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000013','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008','locador',100),
  ('9a000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000014','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000007','locador',100),
  ('9a000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000024','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000001','locador',100),
  ('9a000000-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000023','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000001','locador',100),
  ('9a000000-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000023','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000008','locador',100),
  ('9a000000-0000-4000-8000-000000000026','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000022','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000027','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000005','locador',100),
  ('9a000000-0000-4000-8000-000000000028','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000021','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000029','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000007','locador',100),
  ('9a000000-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000020','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000005','locador',100),
  ('9a000000-0000-4000-8000-000000000032','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000019','locatario',NULL),
  ('9a200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','d2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','locador',100),
  ('9a200000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','d2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003','locatario',NULL),
  -- El segundo garante del contrato 1: sin él, ningún contrato de la demo llega
  -- al mínimo de dos y el legajo completo no se ve nunca.
  ('9a000000-0000-4000-8000-000000000033','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000008','garante',NULL),
  -- Las partes de los cuatro que proyectan. Los tres roles en cada uno: el
  -- pre-contrato imprime el bloque de GARANTÍA sólo si hay garante, y sin él la
  -- demo del documento mostraría siempre la versión corta.
  ('9a000000-0000-4000-8000-000000000034','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000015','a0000000-0000-4000-8000-000000000025','locador',100),
  ('9a000000-0000-4000-8000-000000000035','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000015','a0000000-0000-4000-8000-000000000029','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000036','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000015','a0000000-0000-4000-8000-000000000033','garante',NULL),
  ('9a000000-0000-4000-8000-000000000037','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000016','a0000000-0000-4000-8000-000000000026','locador',100),
  ('9a000000-0000-4000-8000-000000000038','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000016','a0000000-0000-4000-8000-000000000030','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000039','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000016','a0000000-0000-4000-8000-000000000034','garante',NULL),
  ('9a000000-0000-4000-8000-000000000040','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000017','a0000000-0000-4000-8000-000000000027','locador',100),
  ('9a000000-0000-4000-8000-000000000041','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000017','a0000000-0000-4000-8000-000000000031','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000042','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000017','a0000000-0000-4000-8000-000000000035','garante',NULL),
  ('9a000000-0000-4000-8000-000000000043','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000018','a0000000-0000-4000-8000-000000000028','locador',100),
  ('9a000000-0000-4000-8000-000000000044','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000018','a0000000-0000-4000-8000-000000000032','locatario',NULL),
  ('9a000000-0000-4000-8000-000000000045','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000018','a0000000-0000-4000-8000-000000000036','garante',NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Garantías ───────────────────────────────────────────────────────────────
-- `contrato_parte` ya decía quién garantiza cada contrato, pero el legajo vive
-- en `garantia` y el .sql sembraba CERO filas: el panel de garantes de la demo
-- arrancaba vacío, que es la peor forma de mostrar una feature terminada.
--
-- Cinco casos para que se vea el ciclo entero, no cinco filas iguales:
--
--   1. Adriana Rossi (contrato 1) — legajo completo y firmado. El caso bueno.
--   2. Héctor Molina (contrato 1) — igual, para que el contrato llegue a DOS.
--      Es propietario en otro contrato y garante en éste: la regla de roles
--      derivados otra vez, ahora del lado de las garantías.
--   3. Pablo Arce (contrato 2) — firmó, pero el legajo está a medias.
--   4. Silvina Correa (contrato 5) — ni firmó ni trajo los recibos.
--   5. Un seguro de caución (contrato 4, el comercial) que vence en 30 días,
--      SIN persona: es el único caso que le da algo que emitir a
--      `garantia_por_vencer`, y el único donde el legajo no son un DNI y tres
--      recibos sino la póliza.
--
-- ⚠️⚠️ **TODAS con `bcra_*` en NULL, y no es un olvido.** Los DNI de este
-- archivo le pertenecen a personas reales —ya pasó: una consulta con un garante
-- demo trajo el nombre y la deuda bancaria de alguien que no dio su
-- consentimiento, y quedó guardada en la base de desarrollo—. Sembrar un
-- veredicto significaría o inventarlo (dato falso en la pantalla) o haberlo
-- consultado (un tercero sin consentimiento). No se hace ninguna de las dos.
--
-- Corolario para quien mire la demo: los cinco garantes van a decir «falta
-- consultar el BCRA» y ningún contrato va a quedar «en regla». **Está bien**:
-- sin consulta no hay veredicto, que es la regla que sostiene toda la feature.
-- Para ver el control funcionando se consulta con un CUIT de sociedad o con el
-- documento propio, nunca con uno de acá.

INSERT INTO garantia (id, tenant_id, contrato_id, persona_id, tipo, detalle, vence_el, firmo_el) VALUES
  ('9c000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000016',
    'garante_solidario','Tía de la inquilina. Empleada municipal, antigüedad 14 años.',NULL,
    (date_trunc('month',current_date)-interval '18 months')::date),

  ('9c000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000008',
    'garante_solidario','Segundo garante. Propietario de la cochera de Las Heras.',NULL,
    (date_trunc('month',current_date)-interval '18 months')::date),

  ('9c000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000017',
    'garante_solidario','Firmó en la oficina. Quedó en traer los dos recibos que faltan.',NULL,
    (date_trunc('month',current_date)-interval '14 months')::date),

  ('9c000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000018',
    'garante_solidario','Presentó el DNI. Falta que firme y que traiga los recibos.',NULL,NULL),

  -- El único con `vence_el`: una póliza se renueva, un garante solidario no.
  -- A 30 días exactos porque el aviso `garantia_por_vencer` está configurado en
  -- 30 (`tenant.avisos`): así el evento cae HOY y se ve en la bandeja apenas se
  -- recalcula, en vez de quedar escondido en «futuros».
  ('9c000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000004',NULL,
    'seguro_caucion','Póliza de caución N° 4471-0093 a nombre de Bar Don Genaro SRL.',
    (current_date + 30),NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Períodos de alquiler ────────────────────────────────────────────────────
-- Generados, no escritos a mano: catorce contratos × hasta 26 meses son
-- cientos de filas, y a mano envejecen mal. El id sale de un `md5()` del
-- contrato + el período, así que volver a correr el seed no duplica nada y los
-- meses nuevos entran solos.
--
-- El contrato 7 no genera nada: es `administrado = false`. Un contrato sólo
-- intermediado no tiene ciclo de cobranza, y que la tabla lo respete es la
-- diferencia entre el supuesto A1 del spec y una suposición.
--
-- ⚠️ **Todo lo generado va filtrado por `tenant_id`, y no es decorativo.**
-- El seed corre como OWNER, que es dueño del schema y por lo tanto **saltea
-- RLS**: una sentencia sin `WHERE tenant_id IN (...)` toca las filas de TODAS
-- las inmobiliarias de la base, incluidas las que cargó una persona a mano.
--
-- Pasó de verdad escribiendo este archivo: el `UPDATE` de estados no filtraba
-- y marcó como pagadas siete cuotas de una inmobiliaria de prueba ajena al
-- seed, inventándoles el cobro. En la app el efecto fue que una cartera con
-- seis cuotas en mora amaneció "al día".
--
-- La lección no es "acordate de filtrar": es que **la protección que sostiene
-- todo el producto —RLS— no aplica acá**, y este archivo es de los pocos
-- lugares del repositorio donde eso es cierto.

INSERT INTO periodo_alquiler (id, tenant_id, contrato_id, periodo, vence_el, monto_alquiler, expensas, otros, total, moneda, estado)
SELECT
  md5(c.id::text || m::text)::uuid,
  c.tenant_id,
  c.id,
  m::date,
  (m + (c.dia_vencimiento - 1) * interval '1 day')::date,
  c.monto_inicial,
  COALESCE(o.expensas, 0),
  0,
  c.monto_inicial + COALESCE(o.expensas, 0),
  c.moneda,
  'pendiente'
FROM contrato_alquiler c
LEFT JOIN operacion o ON o.id = c.operacion_id
CROSS JOIN LATERAL generate_series(
  c.fecha_inicio,
  LEAST(c.fecha_fin, date_trunc('month', current_date)::date),
  interval '1 month'
) AS m
WHERE c.administrado
  AND c.estado IN ('vigente','vencido','renovado','rescindido')
  AND c.tenant_id IN ('11111111-1111-4111-8111-111111111111',
                      '22222222-2222-4222-8222-222222222222')
ON CONFLICT (contrato_id, periodo) DO NOTHING;


-- ── Quién pagó y quién no ───────────────────────────────────────────────────
-- Acá se decide la historia de cobranza de la demo. La regla es una sola por
-- contrato: "las últimas N cuotas quedan impagas". Todo lo anterior se cobra.
--
-- Los cuatro tramos del aging tienen que existir en los datos o el gráfico de
-- morosidad se prueba contra una sola barra:
--
--   c01 → 6 impagas   (llega a +90 días)
--   c04 → 2 impagas   (31-60 días)
--   c06 → 1 impaga    (1-30 días)
--   c03 → 1 parcial   (pagó la mitad del mes en curso)
--   el resto → al día

WITH regla(contrato_id, impagas) AS (
  VALUES
    ('d0000000-0000-4000-8000-000000000001'::uuid, 6),
    ('d0000000-0000-4000-8000-000000000004'::uuid, 2),
    ('d0000000-0000-4000-8000-000000000006'::uuid, 1)
),
ordenados AS (
  SELECT p.id,
         row_number() OVER (PARTITION BY p.contrato_id ORDER BY p.periodo DESC) AS desde_atras,
         COALESCE(r.impagas, 0) AS impagas,
         p.vence_el
    FROM periodo_alquiler p
    LEFT JOIN regla r ON r.contrato_id = p.contrato_id
   WHERE p.tenant_id IN ('11111111-1111-4111-8111-111111111111',
                         '22222222-2222-4222-8222-222222222222')
)
UPDATE periodo_alquiler p
   SET estado = CASE
         WHEN o.desde_atras <= o.impagas AND o.vence_el < current_date THEN 'vencido'
         WHEN o.desde_atras <= o.impagas                               THEN 'pendiente'
         WHEN o.vence_el >= current_date                               THEN 'pendiente'
         ELSE 'pagado'
       END
  FROM ordenados o
 WHERE o.id = p.id;

-- El parcial: el mes en curso de c03 entra a medias.
UPDATE periodo_alquiler
   SET estado = 'parcial'
 WHERE contrato_id = 'd0000000-0000-4000-8000-000000000003'
   AND periodo = date_trunc('month', current_date)::date;


-- ── Cobros ──────────────────────────────────────────────────────────────────
-- Uno por cuota pagada, con el medio rotando para que la caja del día tenga
-- algo que separar: sin variedad de medio, el arqueo por medio es una fila.

INSERT INTO cobro (id, tenant_id, periodo_id, monto, moneda, fecha, medio, comprobante, registrado_por, imputacion)
SELECT
  md5(p.id::text || 'cobro')::uuid,
  p.tenant_id,
  p.id,
  p.total,
  p.moneda,
  LEAST(p.vence_el + ((abs(hashtext(p.id::text)) % 6) - 1), current_date),
  (ARRAY['transferencia','transferencia','efectivo','debito','cheque'])[1 + abs(hashtext(p.id::text)) % 5],
  'REC-' || to_char(p.periodo, 'YYYYMM') || '-' || lpad((abs(hashtext(p.id::text)) % 9999)::text, 4, '0'),
  '11000000-0000-4000-8000-000000000001',
  'alquiler'
FROM periodo_alquiler p
WHERE p.estado = 'pagado'
  AND p.tenant_id IN ('11111111-1111-4111-8111-111111111111',
                      '22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- El pago parcial: la mitad justa, para que el saldo se vea distinto del total.
INSERT INTO cobro (id, tenant_id, periodo_id, monto, moneda, fecha, medio, comprobante, registrado_por, imputacion)
SELECT
  md5(p.id::text || 'parcial')::uuid,
  p.tenant_id, p.id,
  round(p.total / 2, 2),
  p.moneda,
  p.vence_el,
  'efectivo',
  'REC-PARCIAL-' || to_char(p.periodo, 'YYYYMM'),
  '11000000-0000-4000-8000-000000000001',
  'alquiler'
FROM periodo_alquiler p
WHERE p.estado = 'parcial'
  AND p.tenant_id IN ('11111111-1111-4111-8111-111111111111',
                      '22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;


-- ── Ajustes por índice ──────────────────────────────────────────────────────
-- Tres estados en pantalla al mismo tiempo:
--
--   proyectado VENCIDO   c01, rige desde hace cinco semanas y nadie lo confirmó.
--                        Es plata que no se está facturando, y el inicio tiene
--                        que gritarlo.
--   proyectado futuro    c03, rige el mes que viene.
--   aplicado             c02 y c04, ya pasaron por todo el circuito.
--
-- `memoria` va completa: es la regla del dominio que no se negocia —todo
-- cálculo lleva su memoria— y un ajuste sin ella no se le puede explicar al
-- inquilino.

INSERT INTO contrato_ajuste (id, tenant_id, contrato_id, vigente_desde, periodo_base, periodo_actual, indice_tipo, valor_base, valor_actual, coeficiente, monto_anterior, monto_nuevo, moneda, memoria, estado, confirmado_por, confirmado_el) VALUES
  ('e5000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001',
    (date_trunc('month',current_date)-interval '1 month' + interval '4 days')::date,
    (date_trunc('month',current_date)-interval '5 months')::date,
    (date_trunc('month',current_date)-interval '2 months')::date,
    'ipc', 8412.500000, 9124.800000, 1.084670, 514682.00, 546206.79,'ARS',
    '{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,
    'proyectado', NULL, NULL),

  ('e5000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001',
    (date_trunc('month',current_date)-interval '4 months')::date,
    (date_trunc('month',current_date)-interval '8 months')::date,
    (date_trunc('month',current_date)-interval '5 months')::date,
    'ipc', 7742.100000, 8412.500000, 1.086600, 473600.00, 514682.00,'ARS',
    '{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,
    'aplicado', '11000000-0000-4000-8000-000000000001', now()-interval '4 months'),

  ('e5000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003',
    (date_trunc('month',current_date)+interval '1 month')::date,
    (date_trunc('month',current_date)-interval '7 months')::date,
    (date_trunc('month',current_date)-interval '1 month')::date,
    'uva', 1284.320000, 1476.910000, 1.149960, 410000.00, 471483.60,'ARS',
    '{"formula":"monto_vigente × (uva_actual / uva_base)","fuente":"BCRA v4.0 variable 31"}'::jsonb,
    'proyectado', NULL, NULL),

  ('e5000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002',
    (date_trunc('month',current_date)-interval '2 months')::date,
    (date_trunc('month',current_date)-interval '6 months')::date,
    (date_trunc('month',current_date)-interval '3 months')::date,
    'icl', 412.880000, 468.220000, 1.134030, 282000.00, 319796.46,'ARS',
    '{"formula":"monto_vigente × (icl_actual / icl_base)","fuente":"BCRA v4.0 variable 40"}'::jsonb,
    'aplicado', '11000000-0000-4000-8000-000000000002', now()-interval '2 months'),

  ('e5000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000004',
    (date_trunc('month',current_date)-interval '6 months')::date,
    (date_trunc('month',current_date)-interval '12 months')::date,
    (date_trunc('month',current_date)-interval '7 months')::date,
    'porcentaje_fijo', NULL, NULL, 1.120000, 642857.00, 720000.00,'ARS',
    '{"formula":"monto_vigente × (1 + 12%)","fuente":"cláusula del contrato"}'::jsonb,
    'aplicado', '11000000-0000-4000-8000-000000000001', now()-interval '6 months'),

  ('e5000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000006',
    (date_trunc('month',current_date)-interval '3 months')::date,
    (date_trunc('month',current_date)-interval '7 months')::date,
    (date_trunc('month',current_date)-interval '4 months')::date,
    'ipc', 7742.100000, 8412.500000, 1.086600, 335900.00, 364985.94,'ARS',
    '{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,
    'aplicado', '11000000-0000-4000-8000-000000000002', now()-interval '3 months'),

  ('e5000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005',
    (date_trunc('month',current_date)+interval '3 months')::date,
    (date_trunc('month',current_date)-interval '10 months')::date,
    (date_trunc('month',current_date)-interval '1 month')::date,
    'icp', 218.440000, 259.910000, 1.189840, 950000.00, 1130348.00,'ARS',
    '{"formula":"monto_vigente × (icp_actual / icp_base)","fuente":"Casa Propia"}'::jsonb,
    'proyectado', NULL, NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Liquidaciones ───────────────────────────────────────────────────────────
-- Doce, sobre tres períodos y los tres estados. El del mes -2 está `pagada`, el
-- del -1 `cerrada` y el del mes en curso `borrador`: es el ciclo real de una
-- inmobiliaria y lo que hace que el bloque "sin cerrar" del inicio tenga algo
-- que contar.
--
-- El condominio de PROP-0006 sale en DOS liquidaciones, una por hermano, al
-- 50%. Es la regla R3 del spec y la única forma de verla funcionar.

INSERT INTO liquidacion (id, tenant_id, propietario_id, periodo, total_bruto, total_honorarios, total_gastos, total_neto, moneda, estado, cerrada_el, cerrada_por, pagada_el, pagada_por, notas) VALUES
  -- Mes -2: pagadas
  ('11a00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',(date_trunc('month',current_date)-interval '2 months')::date, 866682.00, 69334.56,      0, 797347.44,'ARS','pagada',  now()-interval '50 days','11000000-0000-4000-8000-000000000001',now()-interval '46 days','11000000-0000-4000-8000-000000000001',NULL),
  ('11a00000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002',(date_trunc('month',current_date)-interval '2 months')::date,1085000.00,101300.00,  48000, 935700.00,'ARS','pagada',  now()-interval '50 days','11000000-0000-4000-8000-000000000001',now()-interval '46 days','11000000-0000-4000-8000-000000000001','Se descontó el service del aire del local.'),
  ('11a00000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003',(date_trunc('month',current_date)-interval '2 months')::date, 475000.00, 38000.00,      0, 437000.00,'ARS','pagada',  now()-interval '50 days','11000000-0000-4000-8000-000000000001',now()-interval '46 days','11000000-0000-4000-8000-000000000001','Condominio: 50% de PROP-0006.'),
  ('11a00000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000004',(date_trunc('month',current_date)-interval '2 months')::date, 475000.00, 38000.00,      0, 437000.00,'ARS','pagada',  now()-interval '50 days','11000000-0000-4000-8000-000000000001',now()-interval '46 days','11000000-0000-4000-8000-000000000001','Condominio: 50% de PROP-0006.'),
  ('11a00000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000007',(date_trunc('month',current_date)-interval '2 months')::date, 410000.00, 28700.00,      0, 381300.00,'ARS','pagada',  now()-interval '50 days','11000000-0000-4000-8000-000000000001',now()-interval '46 days','11000000-0000-4000-8000-000000000001',NULL),
  -- Mes -1: cerradas, sin transferir todavía
  ('11a00000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',(date_trunc('month',current_date)-interval '1 month')::date, 866682.00, 69334.56,  95000, 702347.44,'ARS','cerrada', now()-interval '18 days','11000000-0000-4000-8000-000000000002',NULL,NULL,'Reparación de termotanque en PROP-0004.'),
  ('11a00000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002',(date_trunc('month',current_date)-interval '1 month')::date,1085000.00,101300.00,      0, 983700.00,'ARS','cerrada', now()-interval '18 days','11000000-0000-4000-8000-000000000002',NULL,NULL,NULL),
  ('11a00000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003',(date_trunc('month',current_date)-interval '1 month')::date, 475000.00, 38000.00,      0, 437000.00,'ARS','cerrada', now()-interval '18 days','11000000-0000-4000-8000-000000000002',NULL,NULL,'Condominio: 50% de PROP-0006.'),
  ('11a00000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000004',(date_trunc('month',current_date)-interval '1 month')::date, 475000.00, 38000.00,      0, 437000.00,'ARS','cerrada', now()-interval '18 days','11000000-0000-4000-8000-000000000002',NULL,NULL,'Condominio: 50% de PROP-0006.'),
  -- Mes 0: borradores, lo que hay para revisar hoy
  ('11a00000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',(date_trunc('month',current_date))::date,           866682.00, 69334.56,      0, 797347.44,'ARS','borrador',NULL,NULL,NULL,NULL,NULL),
  ('11a00000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002',(date_trunc('month',current_date))::date,          1085000.00,101300.00,  32500, 951200.00,'ARS','borrador',NULL,NULL,NULL,NULL,'Falta confirmar la factura del pintor.'),
  ('11a00000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000005',(date_trunc('month',current_date))::date,             2400.00,   240.00,      0,   2160.00,'USD','borrador',NULL,NULL,NULL,NULL,'El galpón se liquida en dólares.'),
  ('11a20000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','a2000000-0000-4000-8000-000000000001',(date_trunc('month',current_date)-interval '1 month')::date, 620000.00, 49600.00,      0, 570400.00,'ARS','cerrada', now()-interval '15 days','22000000-0000-4000-8000-000000000001',NULL,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO liquidacion_linea (id, tenant_id, liquidacion_id, contrato_id, concepto, tipo, signo, monto) VALUES
  ('11b00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','Alquiler cobrado · PROP-0001','alquiler',    1,546682.00),
  ('11b00000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000002','Alquiler cobrado · PROP-0004','alquiler',    1,320000.00),
  ('11b00000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000006',NULL,                                 'Honorarios 8%',               'honorarios', -1, 69334.56),
  ('11b00000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000006',NULL,                                 'Termotanque PROP-0004',       'reparacion', -1, 95000.00),
  ('11b00000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000004','Alquiler cobrado · PROP-0002','alquiler',    1,720000.00),
  ('11b00000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000006','Alquiler cobrado · PROP-0008','alquiler',    1,365000.00),
  ('11b00000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000011',NULL,                                 'Honorarios',                  'honorarios', -1,101300.00),
  ('11b00000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000011',NULL,                                 'Pintura del local',           'reparacion', -1, 32500.00),
  ('11b00000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-000000000012','Alquiler cobrado · PROP-0009','alquiler',    1,  2400.00),
  ('11b00000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000012',NULL,                                 'Honorarios 10%',              'honorarios', -1,   240.00)
ON CONFLICT (id) DO NOTHING;


-- ── Oportunidades ───────────────────────────────────────────────────────────
-- Dieciocho, cubriendo los SIETE estados y los OCHO orígenes. Sin eso, el
-- embudo del tablero es una barra y "leads por origen" una fila.
--
-- Las perdidas llevan su `motivo_perdida`: la columna existe desde la etapa 3,
-- se llena, y nadie la lee. Es el error #3 del playbook esperando que alguien
-- la agregue.
--
-- Y varias quedan a propósito con `updated_at` viejo: son las "consultas sin
-- mover" del inicio, que sin datos fríos no aparecen nunca.

INSERT INTO oportunidad (id, tenant_id, persona_id, operacion_id, agente_id, origen, portal_origen, estado, motivo_perdida, interes, presupuesto_min, presupuesto_max, moneda, notas, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000019','c0000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000003','portal','zonaprop','negociacion',NULL,'venta',180000,230000,'USD','Ofertó 205k, esperando respuesta del dueño.',now()-interval '38 days',now()-interval '2 days'),
  ('e0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000020','c0000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003','web',NULL,'visita',NULL,'venta',80000,100000,'USD','Vio el depto de Villanueva, le gustó.',now()-interval '21 days',now()-interval '4 days'),
  ('e0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000005','referido',NULL,'calificada',NULL,'venta',400000,520000,'USD','Lo mandó el contador. Busca galpón sobre ruta.',now()-interval '15 days',now()-interval '6 days'),
  ('e0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000022','c0000000-0000-4000-8000-000000000015','11000000-0000-4000-8000-000000000003','whatsapp',NULL,'contactada',NULL,'alquiler',380000,470000,'ARS','Pidió fotos del patio.',now()-interval '9 days',now()-interval '9 days'),
  ('e0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000023',NULL,                                 '11000000-0000-4000-8000-000000000005','telefono',NULL,'nueva',NULL,'alquiler',250000,350000,'ARS','Llamó por un dos ambientes en el centro.',now()-interval '3 days',now()-interval '3 days'),
  ('e0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000024','c0000000-0000-4000-8000-000000000017','11000000-0000-4000-8000-000000000003','cartel',NULL,'ganada',NULL,'venta',60000,80000,'USD','Compró el lote de Viamonte.',now()-interval '70 days',now()-interval '12 days'),
  ('e0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000005','redes',NULL,'perdida','precio','venta',280000,320000,'USD','Se cayó por precio: no bajaba de 340k.',now()-interval '95 days',now()-interval '60 days'),
  ('e0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000011',NULL,                                 '11000000-0000-4000-8000-000000000003','portal','argenprop','perdida','se_fue_con_otra','alquiler',300000,400000,'ARS','Alquiló por otra inmobiliaria.',now()-interval '80 days',now()-interval '55 days'),
  ('e0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000005','otro',NULL,'perdida','no_calificaba','alquiler',420000,520000,'ARS','No llegaba con la garantía.',now()-interval '65 days',now()-interval '40 days'),
  ('e0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000014','11000000-0000-4000-8000-000000000003','portal','mercadolibre','visita',NULL,'venta',150000,180000,'USD','Visitó la casa de Maipú, quedó en llamar.',now()-interval '28 days',now()-interval '19 days'),
  ('e0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000012',NULL,                                 '11000000-0000-4000-8000-000000000005','web',NULL,'nueva',NULL,'alquiler',700000,950000,'ARS','Consulta desde el formulario del sitio.',now()-interval '11 days',now()-interval '11 days'),
  ('e0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000015','11000000-0000-4000-8000-000000000003','whatsapp',NULL,'calificada',NULL,'alquiler',400000,450000,'ARS','Tiene recibo de sueldo y garante propietario.',now()-interval '17 days',now()-interval '16 days'),
  ('e0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000016',NULL,                                 '11000000-0000-4000-8000-000000000005','referido',NULL,'contactada',NULL,'venta',90000,120000,'USD','La mandó Camila Rossi.',now()-interval '13 days',now()-interval '13 days'),
  ('e0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000017','c0000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003','cartel',NULL,'negociacion',NULL,'venta',85000,95000,'USD','Ofertó 89k por el depto de Villanueva.',now()-interval '24 days',now()-interval '1 day'),
  ('e0000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000018',NULL,                                 '11000000-0000-4000-8000-000000000005','telefono',NULL,'perdida','sin_respuesta','alquiler',200000,280000,'ARS','No contestó más.',now()-interval '58 days',now()-interval '35 days'),
  ('e0000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000017','11000000-0000-4000-8000-000000000003','redes',NULL,'ganada',NULL,'venta',65000,75000,'USD','Elena compra el segundo lote. Ya es propietaria de PROP-0006.',now()-interval '48 days',now()-interval '20 days'),
  ('e0000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000009',NULL,                                 '11000000-0000-4000-8000-000000000003','otro',NULL,'nueva',NULL,'alquiler',450000,600000,'ARS','Quiere mudarse a algo más grande.',now()-interval '20 days',now()-interval '20 days'),
  ('e0000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000005','portal','properati','contactada',NULL,'venta',450000,500000,'USD','Consultó por el galpón.',now()-interval '31 days',now()-interval '31 days'),
  ('e2000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','a2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','portal','zonaprop','calificada',NULL,'venta',130000,160000,'USD','Consulta por el local de Juramento.',now()-interval '10 days',now()-interval '5 days')
ON CONFLICT (id) DO NOTHING;


-- ── Visitas ─────────────────────────────────────────────────────────────────
-- Los cuatro estados, y algunas hacia adelante: una agenda sin nada por venir
-- no se puede mirar.

INSERT INTO visita (id, tenant_id, oportunidad_id, operacion_id, agente_id, fecha_hora, estado, feedback) VALUES
  ('61000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000003',now()-interval '30 days','realizada','Le encantó el parque. Preocupado por el mantenimiento de la pileta.'),
  ('61000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003',now()-interval '12 days','realizada','Muy interesada. Pidió ver la expensa de los últimos meses.'),
  ('61000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000014','11000000-0000-4000-8000-000000000003',now()-interval '19 days','realizada','Le pareció chica la cocina.'),
  ('61000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000005',now()-interval '8 days','realizada','Segunda visita, vino con la arquitecta.'),
  ('61000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000005',now()+interval '2 days','agendada',NULL),
  ('61000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000015','11000000-0000-4000-8000-000000000003',now()+interval '4 days','agendada',NULL),
  ('61000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000015','11000000-0000-4000-8000-000000000003',now()+interval '1 day','agendada',NULL),
  ('61000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000005',now()-interval '45 days','ausente','No se presentó y no avisó.'),
  ('61000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000008',NULL,                                 '11000000-0000-4000-8000-000000000003',now()-interval '60 days','cancelada','Canceló la mañana de la visita.'),
  ('61000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000017','11000000-0000-4000-8000-000000000003',now()-interval '55 days','realizada','Fue con el agrimensor a ver los mojones.'),
  ('61000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000016','c0000000-0000-4000-8000-000000000017','11000000-0000-4000-8000-000000000003',now()-interval '35 days','realizada','Segunda visita al lote.'),
  ('61000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','e0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000005',now()+interval '6 days','agendada',NULL)
ON CONFLICT (id) DO NOTHING;


-- ── Reservas ────────────────────────────────────────────────────────────────

INSERT INTO reserva (id, tenant_id, operacion_id, persona_id, monto, moneda, fecha, vence_el, estado, notas) VALUES
  ('62000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000019', 8000,'USD',current_date-18,current_date+12,'activa','Seña por la casa de Chacras.'),
  ('62000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000019',480000,'ARS',current_date-9, current_date+21,'activa','Reserva de la oficina de España.'),
  ('62000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000017','a0000000-0000-4000-8000-000000000024', 5000,'USD',current_date-40,current_date-10,'convertida','Se escrituró el lote.'),
  ('62000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000006',10000,'USD',current_date-88,current_date-58,'caida','No consiguió el crédito.'),
  ('62000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000010', 6000,'USD',current_date-70,current_date-40,'vencida','Venció sin que firmaran el boleto.'),
  ('62000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000019','a0000000-0000-4000-8000-000000000021', 4000,'USD',current_date-290,current_date-260,'convertida','Terminó en escritura.')
ON CONFLICT (id) DO NOTHING;


-- ── Ventas y comisiones ─────────────────────────────────────────────────────
-- Los cuatro estados de una venta, y el reparto en TRES niveles sobre las
-- escrituradas: cuánto cobra la operación, cómo se parte entre inmobiliarias y
-- cómo se reparte puertas adentro. El nivel 3 es el que nadie tiene
-- sistematizado y el que genera discusiones todos los meses.

INSERT INTO operacion_venta (id, tenant_id, operacion_id, comprador_id, precio_cierre, moneda, fecha_reserva, fecha_boleto, fecha_escritura, escribania, estado, motivo_caida, notas) VALUES
  ('f0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000017','a0000000-0000-4000-8000-000000000024', 70000,'USD',current_date-40,current_date-25,current_date-10,'Escribanía Funes','escriturada',NULL,'Lote de Viamonte.'),
  ('f0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000019','a0000000-0000-4000-8000-000000000021',112000,'USD',current_date-290,current_date-270,current_date-240,'Escribanía Lugones','escriturada',NULL,'Depto de Colón.'),
  ('f0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000019',207000,'USD',current_date-18,NULL,NULL,NULL,'en_curso',NULL,'Ofertó 205k, cerró en 207k. Falta boleto.'),
  ('f0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000010',162000,'USD',current_date-70,current_date-50,NULL,'Escribanía Funes','boleto',NULL,'Firmado el boleto, escritura en 60 días.'),
  ('f0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000006',320000,'USD',current_date-88,NULL,NULL,NULL,'caida','no_consiguio_credito','Se cayó el crédito del comprador.'),
  ('f0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000021',465000,'USD',current_date-5, NULL,NULL,NULL,'en_curso',NULL,'Galpón. Reserva tomada esta semana.')
ON CONFLICT (id) DO NOTHING;

-- El catálogo de inmobiliarias con las que se comparte (migración 021). Sin
-- esto, «Propiedades del Oeste» es texto libre adentro de una comisión y no hay
-- forma de contestar cuánto se le pagó en el año.
INSERT INTO inmobiliaria_externa (id, tenant_id, nombre, cuit, contacto, telefono, email, activa, notas) VALUES
  ('ce000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Propiedades del Oeste','30712345678','Marcelo Duarte','261 423-9080','operaciones@delOeste.test',true,'Trabajamos 50/50 desde 2023. Cobran a los 30 días de la escritura.'),
  ('ce000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Cuyo Negocios Inmobiliarios','30798765432','Vanina Ruiz','261 155-33-2210','vruiz@cuyoneg.test',true,NULL),
  ('ce000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Inmobiliaria San Martín',NULL,NULL,NULL,NULL,false,'Cerró la oficina en 2025. Se deja para el histórico de lo que se le pagó.'),
  ('ce200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','Norte Propiedades',NULL,'Sergio Vidal','11 4790-1122',NULL,true,NULL)
ON CONFLICT (id) DO NOTHING;

-- ── El reparto, con la MISMA forma que produce el motor ─────────────────────
--
-- Este bloque estaba escrito a mano con otro árbol —el nivel 3 colgaba del
-- nivel 2, y había filas de nivel 2 con beneficiario 'casa' que el motor nunca
-- emite— y por eso **diez de las once ventas no cuadraban**: PROP-0011 mostraba
-- «Comisión USD 4.860 / A la casa USD 4.860» con un agente llevándose 1.215.
-- El seed entra por SQL directo y no pasa por `repartir()`, que es donde vive
-- la validación, así que el error era invisible: cada número se veía razonable
-- por separado.
--
-- La forma correcta, la que emite `comisiones.motor.ts`:
--
--   nivel 1 · una por punta, beneficiario 'operacion', sin padre
--   nivel 2 · la otra inmobiliaria, si la hay. Padre: la de nivel 1 de SU punta
--   nivel 3 · captador, cerrador y el RESTO de la casa. Padre: también la de
--             nivel 1 de su punta, NO la de nivel 2
--
-- El nivel 3 se aplica sobre lo que queda de cada punta **después** del nivel
-- 2, así que compartir al 50% le baja la comisión al agente a la mitad. Se ve
-- en la venta 1: Sofía cobra 525 por la punta propia y 262,50 por la compartida.
--
-- Hay un test que afirma que todas las ventas del seed cuadran, para que esto
-- no se vuelva a desviar.
INSERT INTO comision (id, tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto, moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id, beneficiario_nombre, externa_id, concepto, estado, cobrada_el) VALUES
  -- ── Venta 1 · USD 70.000, escriturada y cobrada. Dos puntas, y la compradora
  --    compartida 50/50 con Propiedades del Oeste. Es la que muestra el efecto
  --    de compartir sobre lo que se lleva el agente.
  ('c9000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,NULL,1,'vendedora',70000,'USD',3.0000,2100.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000001',3,'vendedora',2100,'USD',25.0000,525.00,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','cobrada',current_date-8),
  ('c9000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000001',3,'vendedora',2100,'USD',75.0000,1575.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,NULL,1,'compradora',70000,'USD',3.0000,2100.00,'operacion',NULL,NULL,NULL,'Honorarios punta compradora · 3%','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000004',2,'compradora',2100,'USD',50.0000,1050.00,'inmobiliaria_externa',NULL,'Propiedades del Oeste','ce000000-0000-4000-8000-000000000001','Propiedades del Oeste · 50% de la punta compradora','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000004',3,'compradora',1050,'USD',25.0000,262.50,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','cobrada',current_date-8),
  ('c9000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000004',3,'compradora',1050,'USD',75.0000,787.50,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta compradora','cobrada',current_date-10),

  -- ── Venta 2 · USD 112.000, escriturada hace ocho meses. Cerró Nicolás.
  ('c9000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,NULL,1,'vendedora',112000,'USD',3.0000,3360.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','cobrada',current_date-240),
  ('c9000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,'c9000000-0000-4000-8000-000000000008',3,'vendedora',3360,'USD',30.0000,1008.00,'agente','11000000-0000-4000-8000-000000000005',NULL,NULL,'Nicolás Paz · cerrador 30%','cobrada',current_date-235),
  ('c9000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,'c9000000-0000-4000-8000-000000000008',3,'vendedora',3360,'USD',70.0000,2352.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-240),

  -- ── Venta 4 · USD 162.000, con boleto: devengada y NO cobrada. Es el bloque
  --    «comisiones por cobrar». Nicolás captó Y cerró: son DOS líneas, no una.
  ('c9000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,NULL,1,'vendedora',162000,'USD',3.0000,4860.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','devengada',NULL),
  ('c9000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,'c9000000-0000-4000-8000-000000000011',3,'vendedora',4860,'USD',25.0000,1215.00,'agente','11000000-0000-4000-8000-000000000005',NULL,NULL,'Nicolás Paz · captador 25%','devengada',NULL),
  ('c9000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,'c9000000-0000-4000-8000-000000000011',3,'vendedora',4860,'USD',25.0000,1215.00,'agente','11000000-0000-4000-8000-000000000005',NULL,NULL,'Nicolás Paz · cerrador 25%','devengada',NULL),
  ('c9000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,'c9000000-0000-4000-8000-000000000011',3,'vendedora',4860,'USD',50.0000,2430.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','devengada',NULL),

  -- ── Ventas en curso: proyectadas. Todavía no son plata de nadie, pero el
  --    reparto ya está acordado y por eso está escrito.
  ('c9000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000003',NULL,NULL,1,'vendedora',207000,'USD',3.0000,6210.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000003',NULL,'c9000000-0000-4000-8000-000000000015',3,'vendedora',6210,'USD',25.0000,1552.50,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000003',NULL,'c9000000-0000-4000-8000-000000000015',3,'vendedora',6210,'USD',75.0000,4657.50,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','proyectada',NULL),

  ('c9000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000006',NULL,NULL,1,'vendedora',465000,'USD',3.0000,13950.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000006',NULL,'c9000000-0000-4000-8000-000000000018',3,'vendedora',13950,'USD',25.0000,3487.50,'agente','11000000-0000-4000-8000-000000000007',NULL,NULL,'Martín Aguirre · captador 25%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000006',NULL,'c9000000-0000-4000-8000-000000000018',3,'vendedora',13950,'USD',75.0000,10462.50,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','proyectada',NULL),

  -- ── Venta caída: el árbol entero anulado, no borrado. Lo que se acordó y
  --    después no fue sigue siendo parte de la historia de la operación.
  ('c9000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000005',NULL,NULL,1,'vendedora',320000,'USD',3.0000,9600.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','anulada',NULL),
  ('c9000000-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000005',NULL,'c9000000-0000-4000-8000-000000000021',3,'vendedora',9600,'USD',25.0000,2400.00,'agente','11000000-0000-4000-8000-000000000005',NULL,NULL,'Nicolás Paz · captador 25%','anulada',NULL),
  ('c9000000-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000005',NULL,'c9000000-0000-4000-8000-000000000021',3,'vendedora',9600,'USD',75.0000,7200.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','anulada',NULL),

  -- ── La comisión de un ALQUILER, con su reparto completo.
  --    Base: UN MES (`monto_inicial`, congelado al firmar, no la cuota vigente:
  --    si se calculara contra el monto de hoy, cada ajuste por índice
  --    recalcularía una comisión ya cobrada). Punta locadora al 100%: un mes
  --    entero, que es como se cobra acá. Y se reparte igual que una venta.
  ('c9000000-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111',NULL,'d0000000-0000-4000-8000-000000000010',NULL,1,'locadora',398000,'ARS',100.0000,398000.00,'operacion',NULL,NULL,NULL,'Honorarios punta locadora · 100% (un mes)','cobrada',current_date-20),
  ('c9000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111',NULL,'d0000000-0000-4000-8000-000000000010','c9000000-0000-4000-8000-000000000024',3,'locadora',398000,'ARS',25.0000,99500.00,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','cobrada',current_date-18),
  ('c9000000-0000-4000-8000-000000000026','11111111-1111-4111-8111-111111111111',NULL,'d0000000-0000-4000-8000-000000000010','c9000000-0000-4000-8000-000000000024',3,'locadora',398000,'ARS',25.0000,99500.00,'agente','11000000-0000-4000-8000-000000000005',NULL,NULL,'Nicolás Paz · cerrador 25%','cobrada',current_date-18),
  ('c9000000-0000-4000-8000-000000000027','11111111-1111-4111-8111-111111111111',NULL,'d0000000-0000-4000-8000-000000000010','c9000000-0000-4000-8000-000000000024',3,'locadora',398000,'ARS',50.0000,199000.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta locadora','cobrada',current_date-20)
ON CONFLICT (id) DO NOTHING;


-- ── Notas de seguimiento ────────────────────────────────────────────────────
-- Sobre las cuatro entidades que la tabla admite, y con los seis tipos. Varias
-- con `recordar_el` en los próximos días: el panel de notas sin nada pendiente
-- no muestra para qué sirve.

INSERT INTO nota (id, tenant_id, entidad_tipo, entidad_id, texto, tipo, recordar_el, resuelta_el, autor_id, created_at) VALUES
  ('a9000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000001','Llamada a Camila: dice que paga la semana que viene. Es la tercera vez que lo dice.','llamado',current_date+3,NULL,'11000000-0000-4000-8000-000000000002',now()-interval '4 days'),
  ('a9000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000001','Se le mandó el detalle de deuda por WhatsApp con las seis cuotas.','whatsapp',NULL,now()-interval '9 days','11000000-0000-4000-8000-000000000002',now()-interval '10 days'),
  ('a9000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000001','Hablar con el garante si no paga antes de fin de mes.','nota',current_date+8,NULL,'11000000-0000-4000-8000-000000000001',now()-interval '2 days'),
  ('a9000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000004','El bar pidió permiso para poner toldo. Consultar al propietario.','reclamo',current_date+5,NULL,'11000000-0000-4000-8000-000000000003',now()-interval '6 days'),
  ('a9000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000002','Se rompió el termotanque. Ya se cambió, va en la liquidación del mes.','reclamo',NULL,now()-interval '20 days','11000000-0000-4000-8000-000000000002',now()-interval '25 days'),
  ('a9000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','contrato_alquiler','d0000000-0000-4000-8000-000000000010','Renovado con el mismo inquilino. Firmaron los dos ejemplares.','nota',NULL,now()-interval '28 days','11000000-0000-4000-8000-000000000001',now()-interval '30 days'),
  ('a9000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','propiedad','b0000000-0000-4000-8000-000000000002','Falta la boleta de ABL para el aviso. Pedirla a Marta.','nota',current_date+2,NULL,'11000000-0000-4000-8000-000000000005',now()-interval '5 days'),
  ('a9000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','propiedad','b0000000-0000-4000-8000-000000000003','La pileta necesita service antes de la próxima visita.','nota',current_date+1,NULL,'11000000-0000-4000-8000-000000000003',now()-interval '3 days'),
  ('a9000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','propiedad','b0000000-0000-4000-8000-000000000009','Sin lat/lng: cargar la ubicación a mano, la ruta no geocodifica bien.','nota',NULL,NULL,'11000000-0000-4000-8000-000000000005',now()-interval '14 days'),
  ('a9000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','persona','a0000000-0000-4000-8000-000000000009','Trabaja de lunes a sábado. Llamar después de las 19.','nota',NULL,NULL,'11000000-0000-4000-8000-000000000002',now()-interval '40 days'),
  ('a9000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','persona','a0000000-0000-4000-8000-000000000001','Prefiere que le transfieran a la cuenta del Nación, no a la del Galicia.','nota',NULL,NULL,'11000000-0000-4000-8000-000000000001',now()-interval '60 days'),
  ('a9000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','oportunidad','e0000000-0000-4000-8000-000000000001','Contraoferta del dueño: 212k. Avisarle a Ignacio.','llamado',current_date+1,NULL,'11000000-0000-4000-8000-000000000003',now()-interval '2 days'),
  ('a9000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','oportunidad','e0000000-0000-4000-8000-000000000005','Mandarle las tres opciones del centro por mail.','email',current_date+2,NULL,'11000000-0000-4000-8000-000000000005',now()-interval '3 days'),
  ('a9000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','oportunidad','e0000000-0000-4000-8000-000000000011','Entró por el formulario del sitio y todavía no la llamó nadie.','nota',current_date,NULL,'11000000-0000-4000-8000-000000000001',now()-interval '11 days'),
  ('a9200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','contrato_alquiler','d2000000-0000-4000-8000-000000000001','Todo al día. Buen inquilino.','nota',NULL,NULL,'22000000-0000-4000-8000-000000000001',now()-interval '20 days')
ON CONFLICT (id) DO NOTHING;


-- ── Completar el volumen ────────────────────────────────────────────────────
-- Lo de arriba arma la historia; esto le da cuerpo. Una demo con seis ventas y
-- seis reservas no deja ver un ranking por asesor ni una serie mensual, y son
-- justo las dos cosas que el tablero tiene que contestar.
--
-- `tenant` se queda en DOS y no se infla: son dos para poder probar el
-- aislamiento, y una tercera no prueba nada nuevo. `sucursal` llega a seis, que
-- es lo que tiene una inmobiliaria mediana del Gran Mendoza; ponerle diez sería
-- inventar oficinas para llenar una tabla.

INSERT INTO sucursal (id, tenant_id, nombre, direccion, telefono) VALUES
  ('5c000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Chacras',       'Viamonte 2900, Chacras de Coria','261 496-2200'),
  ('5c000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Maipú',         'Pescara 480, Maipú',            '261 481-7710'),
  ('5c000000-0000-4000-8000-000000000006','22222222-2222-4222-8222-222222222222','Sucursal Norte','Av. Maipú 2400, Vicente López',  '11 4791-3300')
ON CONFLICT (id) DO NOTHING;

-- Los cinco usuarios de este tramo ya se cargaron arriba, junto a los otros
-- seis: las comisiones de las ventas 6 y 8 los referencian antes de esta línea
-- y la FK no perdona. Acá quedan sólo sus membresías, que sí dependen de las
-- sucursales de Chacras y Maipú creadas dos statements más arriba.
INSERT INTO membresia (id, tenant_id, usuario_id, rol, estado, sucursal_id) VALUES
  ('11500000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000006','agente','activa',   '5c000000-0000-4000-8000-000000000004'),
  ('11500000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000007','agente','activa',   '5c000000-0000-4000-8000-000000000005'),
  ('11500000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000008','admin', 'activa',   '5c000000-0000-4000-8000-000000000001'),
  -- Suspendida a propósito: un usuario dado de baja no puede entrar, y sin uno
  -- así esa rama del login no se prueba a mano nunca.
  ('11500000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','11000000-0000-4000-8000-000000000009','agente','suspendida','5c000000-0000-4000-8000-000000000001'),
  ('22500000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','22000000-0000-4000-8000-000000000002','agente','activa',   '5c000000-0000-4000-8000-000000000006')
ON CONFLICT (id) DO NOTHING;

-- Más operaciones de venta: una propiedad puede estar alquilada Y a la venta.
INSERT INTO operacion (id, tenant_id, propiedad_id, tipo, precio, moneda, estado, fecha_publicacion) VALUES
  ('c0000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','venta', 78000,'USD','cerrada',   current_date-420),
  ('c0000000-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','venta', 96000,'USD','cerrada',   current_date-380),
  ('c0000000-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000008','venta', 88000,'USD','cerrada',   current_date-200),
  ('c0000000-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','venta', 54000,'USD','disponible',current_date-25),
  ('c0000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000012','venta', 19000,'USD','cerrada',   current_date-160)
ON CONFLICT (id) DO NOTHING;

INSERT INTO operacion_venta (id, tenant_id, operacion_id, comprador_id, precio_cierre, moneda, fecha_reserva, fecha_boleto, fecha_escritura, escribania, estado, notas) VALUES
  ('f0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000022', 76500,'USD',current_date-420,current_date-395,current_date-360,'Escribanía Lugones','escriturada','Depto de Belgrano.'),
  ('f0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000022','a0000000-0000-4000-8000-000000000023', 93000,'USD',current_date-380,current_date-350,current_date-320,'Escribanía Funes','escriturada','PH de Guaymallén.'),
  ('f0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000023','a0000000-0000-4000-8000-000000000020', 86000,'USD',current_date-200,current_date-170,current_date-140,'Escribanía Paz','escriturada','Depto de Paso de los Andes.'),
  ('f0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000025','a0000000-0000-4000-8000-000000000024', 18500,'USD',current_date-160,current_date-140,current_date-110,'Escribanía Paz','escriturada','Cochera de Las Heras.'),
  ('f0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000024','a0000000-0000-4000-8000-000000000019', 52000,'USD',current_date-6, NULL,NULL,NULL,'en_curso','Monoambiente de Sarmiento. Recién reservado.')
ON CONFLICT (id) DO NOTHING;

-- Las ventas de volumen, también con el árbol completo del motor: sin el nivel
-- 3, «honorarios devengados» del tablero se queda con dos operaciones y no
-- dibuja una serie, y el perfil de un agente no tiene nada que mostrar.
INSERT INTO comision (id, tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto, moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id, beneficiario_nombre, externa_id, concepto, estado, cobrada_el) VALUES
  ('c9000000-0000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000007',NULL,NULL,1,'vendedora', 76500,'USD',3.0000,2295.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','cobrada',current_date-360),
  ('c9000000-0000-4000-8000-000000000032','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000007',NULL,'c9000000-0000-4000-8000-000000000031',3,'vendedora',2295,'USD',25.0000, 573.75,'agente','11000000-0000-4000-8000-000000000006',NULL,NULL,'Belén Ortiz · captador 25%','cobrada',current_date-358),
  ('c9000000-0000-4000-8000-000000000033','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000007',NULL,'c9000000-0000-4000-8000-000000000031',3,'vendedora',2295,'USD',75.0000,1721.25,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-360),

  -- Compartida con Cuyo Negocios: 40% para ellos. El agente cobra sobre lo que
  -- QUEDA, no sobre el bruto — es la mitad de las discusiones de fin de mes.
  ('c9000000-0000-4000-8000-000000000034','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,NULL,1,'vendedora', 93000,'USD',3.0000,2790.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','cobrada',current_date-320),
  ('c9000000-0000-4000-8000-000000000035','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,'c9000000-0000-4000-8000-000000000034',2,'vendedora',2790,'USD',40.0000,1116.00,'inmobiliaria_externa',NULL,'Cuyo Negocios Inmobiliarios','ce000000-0000-4000-8000-000000000002','Cuyo Negocios Inmobiliarios · 40% de la punta vendedora','cobrada',current_date-320),
  ('c9000000-0000-4000-8000-000000000036','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,'c9000000-0000-4000-8000-000000000034',3,'vendedora',1674,'USD',30.0000, 502.20,'agente','11000000-0000-4000-8000-000000000007',NULL,NULL,'Martín Aguirre · cerrador 30%','cobrada',current_date-318),
  ('c9000000-0000-4000-8000-000000000037','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,'c9000000-0000-4000-8000-000000000034',3,'vendedora',1674,'USD',70.0000,1171.80,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-320),

  ('c9000000-0000-4000-8000-000000000038','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000009',NULL,NULL,1,'vendedora', 86000,'USD',3.0000,2580.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','cobrada',current_date-140),
  ('c9000000-0000-4000-8000-000000000039','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000009',NULL,'c9000000-0000-4000-8000-000000000038',3,'vendedora',2580,'USD',25.0000, 645.00,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','cobrada',current_date-138),
  ('c9000000-0000-4000-8000-000000000040','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000009',NULL,'c9000000-0000-4000-8000-000000000038',3,'vendedora',2580,'USD',75.0000,1935.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-140),

  -- Una cochera al 4% y sin agente: la casa se lleva todo. El motor emite igual
  -- la línea del resto, y por eso la operación cuadra sin nivel 3 de agentes.
  ('c9000000-0000-4000-8000-000000000041','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000010',NULL,NULL,1,'vendedora', 18500,'USD',4.0000, 740.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 4%','cobrada',current_date-110),
  ('c9000000-0000-4000-8000-000000000042','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000010',NULL,'c9000000-0000-4000-8000-000000000041',3,'vendedora',740,'USD',100.0000, 740.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','cobrada',current_date-110),

  ('c9000000-0000-4000-8000-000000000043','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000011',NULL,NULL,1,'vendedora', 52000,'USD',3.0000,1560.00,'operacion',NULL,NULL,NULL,'Honorarios punta vendedora · 3%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000044','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000011',NULL,'c9000000-0000-4000-8000-000000000043',3,'vendedora',1560,'USD',25.0000, 390.00,'agente','11000000-0000-4000-8000-000000000003',NULL,NULL,'Sofía Luna · captador 25%','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000045','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000011',NULL,'c9000000-0000-4000-8000-000000000043',3,'vendedora',1560,'USD',75.0000,1170.00,'casa',NULL,NULL,NULL,'Inmobiliaria · resto de la punta vendedora','proyectada',NULL)
ON CONFLICT (id) DO NOTHING;

-- El % propio de dos personas del equipo.
--
-- NULL en las demás **no es cero**: es «hereda el 25/25 de la inmobiliaria».
-- Sofía cobra más por captar porque trae la cartera, y Belén arrancó hace poco
-- con un esquema más bajo. Sin al menos dos filas distintas, la pantalla de
-- Equipo mostraría seis veces el mismo número y no se vería para qué sirve.
UPDATE membresia SET comision_captador_pct = 30, comision_cerrador_pct = 20
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
   AND usuario_id = '11000000-0000-4000-8000-000000000003';
UPDATE membresia SET comision_captador_pct = 15, comision_cerrador_pct = 15
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
   AND usuario_id = '11000000-0000-4000-8000-000000000006';

-- Y una propiedad con honorarios propios: el lote de Viamonte se acordó al 4%
-- + 2% en vez del 3% + 3% de la casa. `operacion.comision_config` existía desde
-- la 006 y estaba vacía en todas las filas — la columna que nadie leía.
--
-- El seed corre como OWNER y **saltea RLS**: el filtro por tenant_id va a mano.
-- Sin él, este UPDATE le cambiaría los honorarios a una operación de la otra
-- inmobiliaria. Ya pasó una vez, con siete cuotas marcadas como pagadas.
UPDATE operacion SET comision_config = '{"venta":{"compradora":2,"vendedora":4}}'::jsonb
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
   AND id = 'c0000000-0000-4000-8000-000000000017';

INSERT INTO reserva (id, tenant_id, operacion_id, persona_id, monto, moneda, fecha, vence_el, estado, notas) VALUES
  ('62000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000022',4000,'USD',current_date-420,current_date-390,'convertida','Terminó en escritura.'),
  ('62000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000022','a0000000-0000-4000-8000-000000000023',5000,'USD',current_date-380,current_date-350,'convertida','Terminó en escritura.'),
  ('62000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000023','a0000000-0000-4000-8000-000000000020',4500,'USD',current_date-200,current_date-170,'convertida','Terminó en escritura.'),
  ('62000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000025','a0000000-0000-4000-8000-000000000024',1500,'USD',current_date-160,current_date-130,'convertida','Terminó en escritura.'),
  ('62000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000024','a0000000-0000-4000-8000-000000000019',3000,'USD',current_date-6, current_date+24,'activa','Seña del monoambiente.')
ON CONFLICT (id) DO NOTHING;

-- Ajustes de los contratos que faltaban: el histórico es lo que hace que la
-- ficha de un contrato tenga una tabla y no un renglón.
INSERT INTO contrato_ajuste (id, tenant_id, contrato_id, vigente_desde, periodo_base, periodo_actual, indice_tipo, valor_base, valor_actual, coeficiente, monto_anterior, monto_nuevo, moneda, memoria, estado, confirmado_por, confirmado_el) VALUES
  ('e5000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001',(date_trunc('month',current_date)-interval '7 months')::date,(date_trunc('month',current_date)-interval '11 months')::date,(date_trunc('month',current_date)-interval '8 months')::date,'ipc',7104.300000,7742.100000,1.089780,434600.00,473600.00,'ARS','{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,'aplicado','11000000-0000-4000-8000-000000000001',now()-interval '7 months'),
  ('e5000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001',(date_trunc('month',current_date)-interval '10 months')::date,(date_trunc('month',current_date)-interval '14 months')::date,(date_trunc('month',current_date)-interval '11 months')::date,'ipc',6512.900000,7104.300000,1.090800,398500.00,434600.00,'ARS','{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,'aplicado','11000000-0000-4000-8000-000000000001',now()-interval '10 months'),
  ('e5000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002',(date_trunc('month',current_date)-interval '6 months')::date,(date_trunc('month',current_date)-interval '10 months')::date,(date_trunc('month',current_date)-interval '7 months')::date,'icl',364.110000,412.880000,1.133950,248700.00,282000.00,'ARS','{"formula":"monto_vigente × (icl_actual / icl_base)","fuente":"BCRA v4.0 variable 40"}'::jsonb,'aplicado','11000000-0000-4000-8000-000000000002',now()-interval '6 months'),
  ('e5000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000006',(date_trunc('month',current_date)+interval '1 month' + interval '2 days')::date,(date_trunc('month',current_date)-interval '4 months')::date,(date_trunc('month',current_date)-interval '1 month')::date,'ipc',8412.500000,9124.800000,1.084670,364985.94,395884.00,'ARS','{"formula":"monto_vigente × (indice_actual / indice_base)","fuente":"INDEC"}'::jsonb,'proyectado',NULL,NULL),
  ('e5000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000011',(date_trunc('month',current_date)+interval '8 months')::date,(date_trunc('month',current_date)-interval '5 months')::date,(date_trunc('month',current_date)-interval '1 month')::date,'porcentaje_fijo',NULL,NULL,1.100000,85000.00,93500.00,'ARS','{"formula":"monto_vigente × (1 + 10%)","fuente":"cláusula del contrato"}'::jsonb,'proyectado',NULL,NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO liquidacion_linea (id, tenant_id, liquidacion_id, contrato_id, concepto, tipo, signo, monto) VALUES
  ('11b00000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Alquiler cobrado · PROP-0001','alquiler',  1,546682.00),
  ('11b00000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','Alquiler cobrado · PROP-0004','alquiler',  1,320000.00),
  ('11b00000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000001',NULL,                                 'Honorarios 8%',               'honorarios',-1, 69334.56),
  ('11b00000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000005','Alquiler cobrado · PROP-0006 (50%)','alquiler',1,475000.00),
  ('11b00000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000003',NULL,                                 'Honorarios 8%',               'honorarios',-1, 38000.00),
  ('11b00000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000005','Alquiler cobrado · PROP-0006 (50%)','alquiler',1,475000.00),
  ('11b00000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000004',NULL,                                 'Honorarios 8%',               'honorarios',-1, 38000.00),
  ('11b00000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000001','Alquiler cobrado · PROP-0001','alquiler',  1,546682.00),
  ('11b00000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000002','Alquiler cobrado · PROP-0004','alquiler',  1,320000.00),
  ('11b00000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','11a00000-0000-4000-8000-000000000010',NULL,                                 'Honorarios 8%',               'honorarios',-1, 69334.56)
ON CONFLICT (id) DO NOTHING;


-- ── Proveedores, reclamos y gastos ──────────────────────────────────────────
-- El día a día de administrar. Los reclamos cubren los cuatro estados y las
-- cuatro prioridades; los gastos, los tres "a cargo de" — que es lo que decide
-- si entran o no en la liquidación del propietario.

INSERT INTO proveedor (id, tenant_id, nombre, rubro, cuit, telefono, email, activo) VALUES
  ('bb000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Gasista Pérez',      'gas',          '20-14876234-3','261 615-8800','perez@correo.test',true),
  ('bb000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Plomería Del Valle', 'plomería',     '30-71223344-5','261 429-1177','delvalle@correo.test',true),
  ('bb000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Electricidad Suárez','electricidad', '20-22456789-1','261 640-3322','suarez@correo.test',true),
  ('bb000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Pinturas Andina',    'pintura',      '30-70889977-6','261 431-5566','andina@correo.test',true),
  ('bb000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Clima Sur',          'climatización','30-71667788-2','261 428-9911','climasur@correo.test',true),
  ('bb000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','Cerrajería 24hs',    'cerrajería',   '20-30112233-4','261 155-6677','cerrajeria@correo.test',true),
  ('bb000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','Techos Mendoza',     'techista',     '30-70334455-8','261 422-7788','techos@correo.test',true),
  -- Inactivo: la lista por defecto no lo muestra, y sigue existiendo para la
  -- historia de los gastos que ya se le pagaron.
  ('bb000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','Albañil que se mudó','albañilería',  NULL,          '261 400-0000',NULL,false),
  ('bb000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','Fumigadora Cuyo',    'fumigación',   '30-71889900-3','261 433-2211','cuyo@correo.test',true),
  ('bb000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','Vidriería Central',  'vidriería',    '20-28112244-7','261 425-4433','vidrios@correo.test',true),
  ('bb200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','Plomero de Belgrano','plomería',     NULL,          '11 5566-1122',NULL,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO reclamo (id, tenant_id, propiedad_id, contrato_id, categoria, descripcion, prioridad, estado, a_cargo_de, proveedor_id, reportado_por, abierto_por, resuelto_el, resuelto_por, resolucion, created_at) VALUES
  ('cc000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','plomeria','Pierde agua debajo de la bacha de la cocina.','alta','abierto','propietario','bb000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000003',NULL,NULL,NULL,now()-interval '9 days'),
  ('cc000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000003','gas','Olor a gas en el lavadero.','urgente','en_curso','propietario','bb000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000005',NULL,NULL,NULL,now()-interval '2 days'),
  ('cc000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000006','humedad','Mancha de humedad en el techo del dormitorio.','normal','abierto',NULL,NULL,'a0000000-0000-4000-8000-000000000013','11000000-0000-4000-8000-000000000003',NULL,NULL,NULL,now()-interval '23 days'),
  ('cc000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000002','artefactos','Se rompió el termotanque.','urgente','resuelto','propietario','bb000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000002',now()-interval '20 days','11000000-0000-4000-8000-000000000002','Se cambió por uno nuevo de 80 litros. Garantía dos años.',now()-interval '26 days'),
  ('cc000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000004','electricidad','Salta la térmica al prender el horno.','alta','resuelto','propietario','bb000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000015','11000000-0000-4000-8000-000000000002',now()-interval '35 days','11000000-0000-4000-8000-000000000001','Se repuso el cableado de la línea del horno.',now()-interval '40 days'),
  ('cc000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000005','climatizacion','No enfría el split del living.','normal','resuelto','inquilino','bb000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000003',now()-interval '12 days','11000000-0000-4000-8000-000000000002','Faltaba carga de gas. Mantenimiento, va por cuenta del inquilino.',now()-interval '15 days'),
  ('cc000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000007','cerrajeria','Se quedó afuera, cambio de cilindro.','baja','resuelto','inquilino','bb000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000014','11000000-0000-4000-8000-000000000005',now()-interval '50 days','11000000-0000-4000-8000-000000000001','Se cambió el cilindro y se entregaron tres copias.',now()-interval '52 days'),
  ('cc000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011',NULL,'estructura','Filtra el techo del garaje. La unidad está vacía.','alta','en_curso','propietario','bb000000-0000-4000-8000-000000000007',NULL,'11000000-0000-4000-8000-000000000005',NULL,NULL,NULL,now()-interval '6 days'),
  ('cc000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000003',NULL,'limpieza','Hay que limpiar la pileta antes de la próxima visita.','baja','cancelado',NULL,NULL,NULL,'11000000-0000-4000-8000-000000000003',NULL,NULL,NULL,now()-interval '30 days'),
  ('cc000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','d0000000-0000-4000-8000-000000000010','artefactos','La persiana del balcón no baja.','normal','abierto','propietario',NULL,'a0000000-0000-4000-8000-000000000023','11000000-0000-4000-8000-000000000003',NULL,NULL,NULL,now()-interval '4 days'),
  ('cc000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000012','otro','Hay que fumigar el depósito.','baja','abierto','inmobiliaria','bb000000-0000-4000-8000-000000000009',NULL,'11000000-0000-4000-8000-000000000005',NULL,NULL,NULL,now()-interval '17 days'),
  ('cc200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','plomeria','Gotea el termotanque.','normal','abierto','propietario','bb200000-0000-4000-8000-000000000001',NULL,'22000000-0000-4000-8000-000000000001',NULL,NULL,NULL,now()-interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- Los gastos van con `estado = 'registrado'` y sin liquidación: el que los toma
-- es `POST /liquidaciones/generar`, que es justamente lo que hay que poder ver
-- funcionar. Sembrarlos ya rendidos apuntando a una liquidación del seed sería
-- dibujar el resultado en vez de dejar que el sistema lo produzca.
INSERT INTO gasto (id, tenant_id, propiedad_id, contrato_id, proveedor_id, reclamo_id, concepto, tipo, monto, moneda, fecha, a_cargo_de, estado, comprobante, registrado_por) VALUES
  ('dd000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000004','Artefactos · Termotanque 80 litros','reparacion', 95000,'ARS',current_date-20,'propietario','registrado','FC-A-0012','11000000-0000-4000-8000-000000000002'),
  ('dd000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000004','bb000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000005','Electricidad · Cableado de la línea del horno','reparacion', 48000,'ARS',current_date-35,'propietario','registrado','FC-A-0009','11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000005','bb000000-0000-4000-8000-000000000005','cc000000-0000-4000-8000-000000000006','Climatización · Carga de gas del split','reparacion', 38000,'ARS',current_date-12,'inquilino','registrado','FC-B-0033','11000000-0000-4000-8000-000000000002'),
  ('dd000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000007','bb000000-0000-4000-8000-000000000006','cc000000-0000-4000-8000-000000000007','Cerrajería · Cambio de cilindro','reparacion', 22000,'ARS',current_date-50,'inquilino','registrado','FC-B-0021','11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002',NULL,                                 'bb000000-0000-4000-8000-000000000004',NULL,'Pintura del local','reparacion', 32500,'ARS',current_date-5,'propietario','registrado','FC-A-0044','11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',NULL,NULL,'ABL del bimestre','impuesto', 28400,'ARS',current_date-8,'propietario','registrado','ABL-2026-04','11000000-0000-4000-8000-000000000002'),
  ('dd000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000003',NULL,NULL,'Expensas extraordinarias del consorcio','expensas', 74000,'ARS',current_date-3,'propietario','registrado',NULL,'11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011',NULL,                                 'bb000000-0000-4000-8000-000000000007',NULL,'Reparación del techo del garaje (anticipo)','reparacion',150000,'ARS',current_date-4,'propietario','registrado','FC-A-0050','11000000-0000-4000-8000-000000000005'),
  ('dd000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000012',NULL,NULL,'Seguro del galpón','seguro',   180,'USD',current_date-10,'propietario','registrado','POL-88213','11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000012','bb000000-0000-4000-8000-000000000009','cc000000-0000-4000-8000-000000000011','Fumigación del depósito','servicio', 46000,'ARS',current_date-2,'inmobiliaria','registrado',NULL,'11000000-0000-4000-8000-000000000005'),
  ('dd000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000003',NULL,                                 'bb000000-0000-4000-8000-000000000008',NULL,'Cargado por error','otro', 1000,'ARS',current_date-60,'propietario','anulado',NULL,'11000000-0000-4000-8000-000000000001'),
  ('dd000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','d0000000-0000-4000-8000-000000000010','bb000000-0000-4000-8000-000000000010',NULL,'Cambio de vidrio del balcón','reparacion', 36000,'ARS',current_date-6,'propietario','registrado','FC-A-0051','11000000-0000-4000-8000-000000000002'),
  ('dd200000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001',NULL,'Service del termotanque','reparacion', 52000,'ARS',current_date-7,'propietario','registrado',NULL,'22000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
