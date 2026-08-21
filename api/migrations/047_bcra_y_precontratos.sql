-- 047 · La consulta al BCRA se vende, y los pre-contratos bajan a Gestión
--
-- ═══ DOS DECISIONES DE ALCANCE, NO DE PRESENTACIÓN ═══
--
-- ── 1 · El BCRA ──
--
-- `garantes/deudores.service.ts` consulta la Central de Deudores del BCRA y los
-- cheques rechazados, contra la API real y con el contrato verificado. Es de lo
-- más fuerte que tiene el producto y hasta hoy no figuraba en NINGÚN plan: lo
-- tenía cualquiera y no se explicaba en ningún lado.
--
-- Se gatea la CONSULTA, no los garantes. Cargar un garante con su DNI y sus
-- recibos es núcleo: sin garantes no se alquila, y un plan de entrada que no
-- deja cargarlos no sirve para alquilar. Lo que se paga es que el sistema vaya
-- al BCRA, traiga la situación y los cheques, y lo deje asentado en el legajo
-- con quién lo consultó y cuándo.
--
-- Queda afuera SÓLO de «Esencial». La diferencia con «Al día» pasa a ser
-- concreta: Esencial te deja cargar el garante, Al día te dice si debe.
--
-- ── 2 · Los pre-contratos ──
--
-- `documentos` estaba de «Medio» para arriba, o sea que ninguna cuenta de la
-- familia Gestión podía generar un contrato desde una plantilla.
--
-- Eso está mal: escribir cada contrato a mano en Word es exactamente el dolor
-- de quien administra alquileres, y es la razón por la que muchos no dejan la
-- planilla. Baja a «Al día» y a «Básico».
--
-- ═══ LO QUE NO SE TOCA ═══
--
-- Nada se le quita a nadie. Las dos capacidades se AGREGAN a planes que no las
-- tenían; ningún plan pierde un módulo.

BEGIN;

-- El BCRA, en todos menos el de entrada.
UPDATE plan SET modulos = modulos || ARRAY['bcra']
 WHERE codigo IN ('gestion_dia', 'inmo_basico', 'inmo_medio', 'inmo_total')
   AND NOT ('bcra' = ANY(modulos));

-- Los pre-contratos bajan a la familia Gestión y al Básico.
UPDATE plan SET modulos = modulos || ARRAY['documentos']
 WHERE codigo IN ('gestion_dia', 'inmo_basico')
   AND NOT ('documentos' = ANY(modulos));

COMMIT;
