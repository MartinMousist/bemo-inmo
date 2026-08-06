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
-- Todos los usuarios demo tienen la misma contraseña: `unaclavelarga1`.
--
-- ⚠️ **El seed se cree dueño de `@prueba.test`.** `usuario.email` es único
-- GLOBAL, así que si alguien ya se registró a mano con `owner@prueba.test`, el
-- INSERT choca contra `usuario_email_key` y el seed no corre. No se resuelve
-- borrando por las suyas —esto es una base de desarrollo de alguien— sino
-- liberando el email a mano. Pasa una sola vez, en bases que ya venían usadas.
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

INSERT INTO usuario (id, email, password_hash, nombre, estado) VALUES
  ('11000000-0000-4000-8000-000000000001','owner@prueba.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Ana Torres',  'activo'),
  ('11000000-0000-4000-8000-000000000002','admin@prueba.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Diego Paz',   'activo'),
  ('11000000-0000-4000-8000-000000000003','asesor@prueba.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Sofía Luna',  'activo'),
  ('11000000-0000-4000-8000-000000000004','contable@prueba.test','$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Raúl Vega',   'activo'),
  ('11000000-0000-4000-8000-000000000005','asesor2@prueba.test', '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Nicolás Paz', 'activo'),
  ('22000000-0000-4000-8000-000000000001','plata@prueba.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Laura Giménez','activo')
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
  ('9a200000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','d2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003','locatario',NULL)
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

INSERT INTO comision (id, tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto, moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id, beneficiario_nombre, concepto, estado, cobrada_el) VALUES
  -- Venta 1 · escriturada y cobrada. Punta compradora y vendedora.
  ('c9000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,NULL,1,'vendedora',70000,'USD',3.0000,2100.00,'operacion',NULL,NULL,'Honorarios punta vendedora','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,NULL,1,'compradora',70000,'USD',3.0000,2100.00,'operacion',NULL,NULL,'Honorarios punta compradora','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000001',2,'vendedora',2100,'USD',100.0000,2100.00,'casa',NULL,NULL,'Queda en la casa: captación propia','cobrada',current_date-10),
  ('c9000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000003',3,'vendedora',2100,'USD',25.0000, 525.00,'agente','11000000-0000-4000-8000-000000000003',NULL,'Sofía Luna · captación','cobrada',current_date-8),
  ('c9000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000001',NULL,'c9000000-0000-4000-8000-000000000002',2,'compradora',2100,'USD',50.0000,1050.00,'inmobiliaria_externa',NULL,'Propiedades del Oeste','50/50 con la otra inmobiliaria','cobrada',current_date-10),
  -- Venta 2 · escriturada hace ocho meses
  ('c9000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,NULL,1,'vendedora',112000,'USD',3.0000,3360.00,'operacion',NULL,NULL,'Honorarios punta vendedora','cobrada',current_date-240),
  ('c9000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,'c9000000-0000-4000-8000-000000000006',2,'vendedora',3360,'USD',100.0000,3360.00,'casa',NULL,NULL,'Queda en la casa','cobrada',current_date-240),
  ('c9000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000002',NULL,'c9000000-0000-4000-8000-000000000007',3,'vendedora',3360,'USD',30.0000,1008.00,'agente','11000000-0000-4000-8000-000000000005',NULL,'Nicolás Paz · cierre','cobrada',current_date-235),
  -- Venta 4 · con boleto: devengada pero NO cobrada. Es "comisiones por cobrar".
  ('c9000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,NULL,1,'vendedora',162000,'USD',3.0000,4860.00,'operacion',NULL,NULL,'Honorarios punta vendedora','devengada',NULL),
  ('c9000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,'c9000000-0000-4000-8000-000000000009',2,'vendedora',4860,'USD',100.0000,4860.00,'casa',NULL,NULL,'Queda en la casa','devengada',NULL),
  ('c9000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000004',NULL,'c9000000-0000-4000-8000-000000000010',3,'vendedora',4860,'USD',25.0000,1215.00,'agente','11000000-0000-4000-8000-000000000005',NULL,'Nicolás Paz · captación y cierre','devengada',NULL),
  -- Ventas en curso: proyectadas, todavía no son plata de nadie
  ('c9000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000003',NULL,NULL,1,'vendedora',207000,'USD',3.0000,6210.00,'operacion',NULL,NULL,'Honorarios punta vendedora','proyectada',NULL),
  ('c9000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000006',NULL,NULL,1,'vendedora',465000,'USD',3.0000,13950.00,'operacion',NULL,NULL,'Honorarios punta vendedora','proyectada',NULL),
  -- Venta caída: anulada
  ('c9000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000005',NULL,NULL,1,'vendedora',320000,'USD',3.0000,9600.00,'operacion',NULL,NULL,'Honorarios punta vendedora','anulada',NULL),
  -- Comisión de ALQUILER: la punta locadora del contrato nuevo
  ('c9000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111',NULL,'d0000000-0000-4000-8000-000000000010',NULL,1,'locadora',398000,'ARS',100.0000,398000.00,'operacion',NULL,NULL,'Honorarios de contrato · un mes','cobrada',current_date-20)
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

INSERT INTO usuario (id, email, password_hash, nombre, estado) VALUES
  ('11000000-0000-4000-8000-000000000006','asesor3@prueba.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Belén Ortiz',   'activo'),
  ('11000000-0000-4000-8000-000000000007','asesor4@prueba.test',  '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Martín Aguirre','activo'),
  ('11000000-0000-4000-8000-000000000008','admin2@prueba.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Paula Bravo',   'activo'),
  ('11000000-0000-4000-8000-000000000009','suspendido@prueba.test','$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Iván Sosa',    'suspendido'),
  ('22000000-0000-4000-8000-000000000002','plata2@prueba.test',   '$2b$12$am.JJqhntjm/jCPCFz0fo.N62ELRAH5JaGOyusALJU7ZtJOzPhDIW','Damián Ruiz',   'activo')
ON CONFLICT (id) DO NOTHING;

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

-- Nivel 1 de las ventas nuevas: sin esto el "honorarios devengados" del tablero
-- se queda con dos operaciones y no dibuja una serie.
INSERT INTO comision (id, tenant_id, venta_id, contrato_id, padre_id, nivel, punta, base_monto, moneda, porcentaje, monto, beneficiario_tipo, beneficiario_id, concepto, estado, cobrada_el) VALUES
  ('c9000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000007',NULL,NULL,1,'vendedora', 76500,'USD',3.0000,2295.00,'operacion',NULL,'Honorarios punta vendedora','cobrada',current_date-360),
  ('c9000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000007',NULL,'c9000000-0000-4000-8000-000000000016',3,'vendedora',2295,'USD',25.0000, 573.75,'agente','11000000-0000-4000-8000-000000000006','Belén Ortiz · captación','cobrada',current_date-358),
  ('c9000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,NULL,1,'vendedora', 93000,'USD',3.0000,2790.00,'operacion',NULL,'Honorarios punta vendedora','cobrada',current_date-320),
  ('c9000000-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000008',NULL,'c9000000-0000-4000-8000-000000000018',3,'vendedora',2790,'USD',30.0000, 837.00,'agente','11000000-0000-4000-8000-000000000007','Martín Aguirre · cierre','cobrada',current_date-318),
  ('c9000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000009',NULL,NULL,1,'vendedora', 86000,'USD',3.0000,2580.00,'operacion',NULL,'Honorarios punta vendedora','cobrada',current_date-140),
  ('c9000000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000009',NULL,'c9000000-0000-4000-8000-000000000020',3,'vendedora',2580,'USD',25.0000, 645.00,'agente','11000000-0000-4000-8000-000000000003','Sofía Luna · captación','cobrada',current_date-138),
  ('c9000000-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000010',NULL,NULL,1,'vendedora', 18500,'USD',4.0000, 740.00,'operacion',NULL,'Honorarios punta vendedora','cobrada',current_date-110),
  ('c9000000-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','f0000000-0000-4000-8000-000000000011',NULL,NULL,1,'vendedora', 52000,'USD',3.0000,1560.00,'operacion',NULL,'Honorarios punta vendedora','proyectada',NULL)
ON CONFLICT (id) DO NOTHING;

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
