-- ============================================================================
-- Cartera ampliada de la demo.
--
-- `demo.sql` arma la HISTORIA: los contratos con sus cuatro tramos de mora, el
-- condominio que parte la liquidación en dos, la cadena de renovación. Por eso
-- casi todas sus unidades están alquiladas o vendidas — es lo que hace que el
-- tablero y las liquidaciones tengan algo que mostrar.
--
-- El costo de eso es que las dos carteras se ven vacías: quedaban **5 unidades
-- en venta y 1 en alquiler** ofrecidas. Una inmobiliaria que abre el sistema y
-- ve una sola propiedad disponible no está viendo su negocio.
--
-- Este archivo agrega lo que falta: la cartera OFRECIDA. Dieciséis propiedades
-- más, sin contrato ni venta cerrada encima, para dejar **12 disponibles de
-- cada lado**. No repite la historia: la completa.
--
-- Mismas tres reglas que `demo.sql` — idempotente con UUID fijo, fechas
-- relativas a `current_date`, y variedad con intención: los nueve tipos, las
-- dos monedas, zonas distintas del Gran Mendoza, propiedades sin geolocalizar
-- y captadores repartidos entre los cuatro asesores para que el filtro por
-- agente tenga qué filtrar.
-- ============================================================================

-- El trigger `propiedad_limite_plan` consulta el plan del tenant ACTUAL: sin
-- contexto, `app_limite_plan()` responde "no permitido" y no entra ni una fila.
SELECT set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', false);


-- ── Propietarios nuevos ─────────────────────────────────────────────────────
-- Seis dueños más, que es lo que hace que Propietarios deje de ser una lista de
-- ocho nombres repetidos entre quince propiedades. Uno es una sociedad: un
-- fideicomiso que pone tres unidades en alquiler es un caso real y obliga a la
-- pantalla a mostrar bien una persona jurídica.

INSERT INTO persona (id, tenant_id, tipo, nombre, apellido, doc_tipo, doc_numero, email, telefono, domicilio) VALUES
  ('a1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','fisica','Roberto','Iglesias','dni','12987456','riglesias@correo.test','261 155-4477','Belgrano 890, Ciudad'),
  ('a1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','fisica','Mercedes','Aguilar','dni','20114558','maguilar@correo.test','261 156-2233','Sarmiento 455, Godoy Cruz'),
  ('a1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','fisica','Alfredo','Pizarro','dni','14336788','apizarro@correo.test','261 154-9911','Las Heras 220, Ciudad'),
  ('a1000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','fisica','Liliana','Quiroga','dni','17882394','lquiroga@correo.test','261 157-3388','Perú 1180, Ciudad'),
  ('a1000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','fisica','Damián','Salinas','dni','29447120','dsalinas@correo.test','261 158-7766','Olascoaga 640, Godoy Cruz'),
  ('a1000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','juridica','Fideicomiso Los Álamos',NULL,'cuit','30-71556677-4','losalamos@correo.test','261 429-0055','Av. Emilio Civit 350, Ciudad')
ON CONFLICT (id) DO NOTHING;


-- ── Interesados nuevos ──────────────────────────────────────────────────────
-- Sin gente buscando, el embudo de Oportunidades no se puede leer: son las
-- personas que entran por un portal o por WhatsApp y todavía no compraron nada.

INSERT INTO persona (id, tenant_id, tipo, nombre, apellido, doc_tipo, doc_numero, email, telefono) VALUES
  ('a1100000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','fisica','Lucía','Mendoza','dni','38221904','lmendoza@correo.test','261 155-8080'),
  ('a1100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','fisica','Nicolás','Paz','dni','36990412','npaz@correo.test','261 156-4141'),
  ('a1100000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','fisica','Ariana','Torres','dni','40112877','atorres@correo.test','261 157-6262'),
  ('a1100000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','fisica','Federico','Sosa','dni','33887201','fsosa@correo.test','261 154-3535'),
  ('a1100000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','fisica','Malena','Ríos','dni','41556098','mrios@correo.test','261 158-9090'),
  ('a1100000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','fisica','Gustavo','Herrera','dni','28776340','gherrera@correo.test','261 155-1717'),
  ('a1100000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','fisica','Carolina','Vega','dni','35102766','cvega@correo.test','261 156-8383'),
  ('a1100000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','fisica','Ezequiel','Domínguez','dni','37449125','edominguez@correo.test','261 157-2424')
ON CONFLICT (id) DO NOTHING;


-- ── Las dieciséis unidades ofrecidas ────────────────────────────────────────
-- Direcciones reales del Gran Mendoza, repartidas entre Ciudad, Godoy Cruz,
-- Guaymallén, Las Heras, Maipú, Luján y Chacras. Cuatro quedan SIN lat/lng a
-- propósito: el aviso de "sin ubicar" y el backfill de geocoding necesitan algo
-- que arreglar para poder verse funcionar.

INSERT INTO propiedad (id, tenant_id, codigo, calle, numero, piso, depto, localidad, provincia, cp, lat, lng, geocode_fuente, geocode_el, tipo, sup_total, sup_cubierta, ambientes, dormitorios, banos, cocheras, antiguedad, orientacion, estado_conservacion, amenities, descripcion, agente_captador_id, sucursal_id) VALUES
  -- En venta
  ('b1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',15,'Montevideo','245','1','A','Ciudad','Mendoza','5500',-32.8886000,-68.8461000,'google',now()-interval '9 days','departamento', 84, 78,3,2,2,1, 6,'norte','muy_bueno','{ascensor,balcon,seguridad}','Tres ambientes a estrenar sobre Montevideo, con balcón aterrazado.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',16,'Italia','1420',NULL,NULL,'Chacras de Coria','Mendoza','5505',-32.9812000,-68.8794000,'google',now()-interval '14 days','casa',520,310,6,4,3,2,10,'noreste','muy_bueno','{pileta,parque,quincho,seguridad}','Casa de categoría en Chacras, parque parquizado y pileta climatizada.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',17,'Balcarce','780',NULL,NULL,'Godoy Cruz','Mendoza','5501',-32.9145000,-68.8552000,'google',now()-interval '21 days','ph',145,118,4,3,2,1,28,'este','bueno','{patio,parrilla}','PH reciclado con patio y parrilla, entrada independiente.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',18,'Bandera de los Andes','3450',NULL,NULL,'Guaymallén','Mendoza','5519',NULL,NULL,NULL,NULL,'local',210,190,NULL,NULL,2,2,18,'sur','bueno','{vidriera,deposito}','Local de esquina sobre Bandera de los Andes, dos vidrieras y depósito.','11000000-0000-4000-8000-000000000006','5c000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111',19,'Roque Sáenz Peña','95',NULL,NULL,'Luján de Cuyo','Mendoza','5507',-33.0378000,-68.8781000,'google',now()-interval '31 days','casa',380,215,5,3,2,2,22,'norte','muy_bueno','{parque,quincho,pileta}','Casa en Luján con parque añoso, a cinco cuadras del centro.','11000000-0000-4000-8000-000000000007','5c000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111',20,'Ozamis','1240',NULL,NULL,'Maipú','Mendoza','5515',NULL,NULL,NULL,NULL,'terreno',1200,NULL,NULL,NULL,NULL,NULL,NULL,'oeste','bueno','{}','Lote de 1.200 m² apto emprendimiento, con todos los servicios en la puerta.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111',21,'Chile','1580','6','B','Ciudad','Mendoza','5500',-32.8931000,-68.8443000,'google',now()-interval '5 days','departamento', 96, 90,4,3,2,1,15,'este','muy_bueno','{ascensor,sum,seguridad}','Cuatro ambientes sobre Chile, edificio con SUM y seguridad.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),

  -- En alquiler
  ('b1000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111',22,'9 de Julio','1230','2','C','Ciudad','Mendoza','5500',-32.8877000,-68.8492000,'google',now()-interval '11 days','departamento', 58, 54,2,1,1,0,19,'norte','bueno','{ascensor}','Dos ambientes en el centro, luminoso y con cocina separada.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111',23,'Tomba','460',NULL,NULL,'Godoy Cruz','Mendoza','5501',-32.9198000,-68.8480000,'google',now()-interval '17 days','casa',195,150,4,3,2,1,32,'sur','bueno','{patio,parrilla}','Casa familiar en Godoy Cruz, cuatro ambientes con patio grande.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111',24,'Necochea','345','4','D','Ciudad','Mendoza','5500',-32.8905000,-68.8465000,'google',now()-interval '3 days','departamento', 42, 40,1,1,1,0,24,'oeste','bueno','{ascensor}','Monoambiente sobre Necochea, ideal estudiante o inversión.','11000000-0000-4000-8000-000000000006','5c000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111',25,'Elpidio González','2870',NULL,NULL,'Guaymallén','Mendoza','5519',-32.8934000,-68.8039000,'google',now()-interval '26 days','ph', 98, 88,3,2,1,1,26,'norte','regular','{patio}','PH al fondo con patio propio, apto crédito.','11000000-0000-4000-8000-000000000007','5c000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111',26,'Dr. Moreno','1150',NULL,NULL,'Las Heras','Mendoza','5539',NULL,NULL,NULL,NULL,'casa',160,125,3,2,1,1,38,'este','regular','{patio}','Casa en Las Heras, tres dormitorios, para refaccionar a gusto.','11000000-0000-4000-8000-000000000006','5c000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111',27,'Espejo','520','3','A','Ciudad','Mendoza','5500',-32.8898000,-68.8477000,'google',now()-interval '7 days','oficina', 72, 72,3,NULL,1,1, 9,'norte','muy_bueno','{ascensor,seguridad}','Oficina sobre Espejo a media cuadra de la Plaza Independencia.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111',28,'Padre Vázquez','680',NULL,NULL,'Maipú','Mendoza','5515',-32.9762000,-68.7854000,'google',now()-interval '35 days','galpon',450,450,NULL,NULL,1,4,16,NULL,'bueno','{}','Galpón con oficina y baño, portón de 4 m y playa de maniobras.','11000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111',29,'Pueyrredón','340',NULL,NULL,'Chacras de Coria','Mendoza','5505',-32.9869000,-68.8823000,'google',now()-interval '13 days','casa',260,180,4,3,2,2,12,'noreste','muy_bueno','{pileta,parque,quincho}','Casa en Chacras con pileta y quincho, en calle de tierra consolidada.','11000000-0000-4000-8000-000000000007','5c000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111',30,'San Lorenzo','875',NULL,'B-12','Ciudad','Mendoza','5500',NULL,NULL,NULL,NULL,'cochera', 16, 16,NULL,NULL,NULL,1,11,NULL,'bueno','{seguridad}','Cochera cubierta con acceso las 24 h, a una cuadra de Belgrano.','11000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- El correlativo NO es una secuencia: es `tenant.prox_codigo_propiedad`. Si el
-- seed inserta códigos a mano y no lo mueve, la primera propiedad que cargue el
-- usuario choca contra UNIQUE (tenant_id, codigo) y el error no menciona al seed.
UPDATE tenant t
   SET prox_codigo_propiedad = GREATEST(
         t.prox_codigo_propiedad,
         COALESCE((SELECT max(p.codigo) FROM propiedad p WHERE p.tenant_id = t.id), 0) + 1)
 WHERE t.id = '11111111-1111-4111-8111-111111111111';


-- ── Quién es dueño de qué ───────────────────────────────────────────────────
-- El fideicomiso concentra tres unidades: es el propietario que en una
-- liquidación real recibe un solo pago por varias propiedades.

INSERT INTO titularidad (id, tenant_id, propiedad_id, persona_id, porcentaje) VALUES
  ('7a100000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',100),
  ('7a100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002',100),
  ('7a100000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003',100),
  ('7a100000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000006',100),
  ('7a100000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000004',100),
  ('7a100000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000005',100),
  ('7a100000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001',100),
  ('7a100000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001',100),
  ('7a100000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000003',100),
  ('7a100000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000006',100),
  ('7a100000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000005',100),
  ('7a100000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000004',100),
  ('7a100000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000013','a1000000-0000-4000-8000-000000000006',100),
  ('7a100000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000014','a1000000-0000-4000-8000-000000000002',100),
  ('7a100000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000015','a0000000-0000-4000-8000-000000000006',100),
  ('7a100000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000016','a1000000-0000-4000-8000-000000000001',100)
ON CONFLICT (id) DO NOTHING;


-- ── Las operaciones: la cartera ofrecida ────────────────────────────────────
-- Siete en venta y once en alquiler, todas `disponible`. Sumadas a las que ya
-- traía `demo.sql` quedan doce y doce.
--
-- PROP-0015 y PROP-0016 van en venta Y en alquiler: es la regla estructural #2
-- del spec —una propiedad puede estar en las dos— y la razón por la que
-- `tipo_operacion` no vive en `propiedad`. Con una sola muestra no se nota; con
-- dos, la cartera obliga a distinguirlas.
--
-- Los precios son de Mendoza a hoy: los alquileres en pesos, las ventas en
-- dólares, que es como se opera. Ninguna cifra sin su moneda.

INSERT INTO operacion (id, tenant_id, propiedad_id, tipo, precio, moneda, expensas, expensas_moneda, estado, fecha_publicacion) VALUES
  ('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000001','venta',   135000,'USD',  NULL,'ARS','disponible',current_date-9),
  ('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000002','venta',   395000,'USD',  NULL,'ARS','disponible',current_date-14),
  ('c1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000003','venta',   118000,'USD',  NULL,'ARS','disponible',current_date-21),
  ('c1000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000004','venta',   240000,'USD',  NULL,'ARS','disponible',current_date-40),
  ('c1000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000005','venta',   285000,'USD',  NULL,'ARS','disponible',current_date-31),
  ('c1000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000006','venta',    92000,'USD',  NULL,'ARS','disponible',current_date-55),
  ('c1000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000007','venta',   168000,'USD',  NULL,'ARS','disponible',current_date-5),

  ('c1000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000008','alquiler',380000,'ARS', 52000,'ARS','disponible',current_date-11),
  ('c1000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000009','alquiler',640000,'ARS',  NULL,'ARS','disponible',current_date-17),
  ('c1000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000010','alquiler',295000,'ARS', 41000,'ARS','disponible',current_date-3),
  ('c1000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000011','alquiler',430000,'ARS',  NULL,'ARS','disponible',current_date-26),
  ('c1000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000012','alquiler',465000,'ARS',  NULL,'ARS','disponible',current_date-44),
  ('c1000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000013','alquiler',520000,'ARS', 78000,'ARS','disponible',current_date-7),
  ('c1000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000014','alquiler',  1900,'USD',  NULL,'ARS','disponible',current_date-35),
  ('c1000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000015','alquiler',890000,'ARS',  NULL,'ARS','disponible',current_date-13),
  ('c1000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000016','alquiler', 95000,'ARS',  NULL,'ARS','disponible',current_date-20),
  -- Las dos que están en las dos puntas a la vez.
  ('c1000000-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000001','alquiler',720000,'ARS', 68000,'ARS','disponible',current_date-9),
  ('c1000000-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','b1000000-0000-4000-8000-000000000002','alquiler',1450000,'ARS', NULL,'ARS','disponible',current_date-14)
ON CONFLICT (id) DO NOTHING;


-- ── Leads sobre la cartera nueva ────────────────────────────────────────────
-- Ocho oportunidades más, repartidas entre los cinco estados vivos del embudo y
-- los cuatro orígenes. Sin esto, «Oportunidades» muestra el embudo de contratos
-- que ya se cerraron y ninguna consulta sobre lo que hoy está a la venta.
--
-- Cada una cuelga de una operación concreta: un lead que no dice qué está
-- mirando no se puede atender, y es lo que separa un CRM de una libreta.

INSERT INTO oportunidad (id, tenant_id, persona_id, operacion_id, agente_id, origen, portal_origen, estado, interes, presupuesto_min, presupuesto_max, moneda, notas, created_at) VALUES
  ('0b100000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000003','portal','zonaprop','nueva',      'alquiler',300000, 450000,'ARS','Consultó por el depto de 9 de Julio. Pide visitarlo el sábado.',now()-interval '2 days'),
  ('0b100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','whatsapp',NULL,   'contactada','venta',   120000, 150000,'USD','Busca tres ambientes a estrenar en Ciudad. Vende su depto para comprar.',now()-interval '6 days'),
  ('0b100000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000006','web',NULL,        'calificada','alquiler',250000, 320000,'ARS','Estudiante de medicina, garantía de los padres en Ciudad.',now()-interval '9 days'),
  ('0b100000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003','portal','argenprop','visita',    'venta',   350000, 420000,'USD','Ya visitó la casa de Chacras. Vuelve con la arquitecta.',now()-interval '12 days'),
  ('0b100000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000013','11000000-0000-4000-8000-000000000007','telefono',NULL,   'negociacion','alquiler',450000, 600000,'ARS','Estudio contable buscando oficina. Ofrece 480.000 y firma a dos años.',now()-interval '18 days'),
  ('0b100000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000005','portal','mercadolibre','contactada','venta',  80000, 100000,'USD','Quiere el lote de Maipú para un dúplex. Pidió los planos aprobados.',now()-interval '22 days'),
  ('0b100000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000007','c1000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000005','whatsapp',NULL,   'visita',    'alquiler',550000, 700000,'ARS','Familia con dos chicos. Le interesa la casa de Godoy Cruz por el patio.',now()-interval '4 days'),
  ('0b100000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','a1100000-0000-4000-8000-000000000008','c1000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000006','web',NULL,        'nueva',     'venta',   200000, 260000,'USD','Consulta por el local de Guaymallén. Quiere poner una farmacia.',now()-interval '1 day')
ON CONFLICT (id) DO NOTHING;


-- ── Dónde están, no sólo qué son ─────────────────────────────────────────────
-- Migración 028. Chacras de Coria es zona real de countries y barrios privados
-- en el Gran Mendoza — de las que ya estaban sembradas ahí, se reparten en dos
-- complejos ficticios para que el filtro por urbanización tenga algo real que
-- mostrar y la búsqueda por nombre de complejo encuentre más de una unidad en
-- el mismo lugar. El resto de la cartera queda `NULL`: es lo honesto para una
-- propiedad de la que nunca se cargó el dato, no «barrio abierto» a la fuerza.
UPDATE propiedad SET tipo_urbanizacion = 'country', nombre_complejo = 'Chacras Park'
 WHERE id IN ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003')
   AND tenant_id = '11111111-1111-4111-8111-111111111111';

UPDATE propiedad SET tipo_urbanizacion = 'barrio_privado', nombre_complejo = 'La Reserva de Chacras'
 WHERE id IN ('b1000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000013')
   AND tenant_id = '11111111-1111-4111-8111-111111111111';
