-- 037 · Los disparadores de agente pasan a ser DIFERIDOS
--
-- ── Qué se rompió ──
--
-- La migración 035 puso cuatro disparadores `BEFORE INSERT` que exigen que el
-- usuario referenciado tenga membresía en la inmobiliaria **en ese instante**.
-- Contra una base ya poblada eso no se nota. Contra una base VACÍA, el seed de
-- demostración se cae:
--
--     El usuario 11000000-…-007 no es de la inmobiliaria 11111111-…
--
-- El usuario sí es de esa inmobiliaria. Lo que pasa es que el seed carga los
-- usuarios temprano —las comisiones los referencian— y sus membresías recién
-- después, porque dependen de sucursales que se crean más abajo. El propio
-- archivo lo tiene comentado desde antes de que estos disparadores existieran.
--
-- Lo encontró el CI, que es el único lugar donde la base arranca vacía. En
-- desarrollo la 035 se aplicó sobre datos que ya estaban y el problema no
-- existía: **una migración que sólo se probó como delta no está probada**.
--
-- ── Por qué diferido y no reordenar el seed ──
--
-- Porque la invariante real no es «cuando insertás la comisión, la membresía ya
-- tiene que estar»: es **«al cerrar la transacción, el beneficiario pertenece a
-- la inmobiliaria»**. Eso es exactamente un `CONSTRAINT TRIGGER … DEFERRABLE
-- INITIALLY DEFERRED`, que es como Postgres resuelve el mismo problema para las
-- claves foráneas.
--
-- Reordenar el seed arreglaría el seed de hoy y dejaría la trampa armada para
-- la próxima carga masiva —una importación, una migración de datos de otro
-- sistema— que tenga cualquier otro orden legítimo.
--
-- ── Qué NO cambia ──
--
-- La protección. Verificado con las dos mitades antes de escribir esto: una
-- comisión insertada ANTES que la membresía del mismo tenant pasa, y una
-- comisión con el beneficiario de OTRA inmobiliaria sigue abortando la
-- transacción —ahora en el COMMIT, con el mismo SQLSTATE `BE003`, así que la
-- respuesta HTTP sigue siendo el mismo 422 con `REFERENCIA_INVALIDA`—.
--
-- Los disparadores pasan de BEFORE a AFTER porque un constraint trigger tiene
-- que ser AFTER. La función devuelve NEW igual; en un AFTER ese valor se
-- ignora, y no hacía falta para nada más: nunca modificó la fila.

BEGIN;

DROP TRIGGER tg_propiedad_captador_del_tenant ON propiedad;
DROP TRIGGER tg_oportunidad_agente_del_tenant ON oportunidad;
DROP TRIGGER tg_visita_agente_del_tenant ON visita;
DROP TRIGGER tg_comision_beneficiario_del_tenant ON comision;

CREATE CONSTRAINT TRIGGER tg_propiedad_captador_del_tenant
  AFTER INSERT OR UPDATE OF agente_captador_id ON propiedad
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_captador_id');

CREATE CONSTRAINT TRIGGER tg_oportunidad_agente_del_tenant
  AFTER INSERT OR UPDATE OF agente_id ON oportunidad
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_id');

CREATE CONSTRAINT TRIGGER tg_visita_agente_del_tenant
  AFTER INSERT OR UPDATE OF agente_id ON visita
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_id');

CREATE CONSTRAINT TRIGGER tg_comision_beneficiario_del_tenant
  AFTER INSERT OR UPDATE OF beneficiario_id ON comision
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('beneficiario_id');

COMMIT;
