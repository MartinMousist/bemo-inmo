-- 040 · El canal puede ser de UNA persona, no de la inmobiliaria
--
-- ── Por qué ──
--
-- En una inmobiliaria de acá el asesor atiende con SU número. No hay una línea
-- central por la que entra todo: entra por el celular de Ana, por el de Diego y
-- por el número de administración, y cada uno contesta lo suyo.
--
-- Hasta la 038 `canal_cuenta` era de la inmobiliaria y nada más. Eso obligaba a
-- que el titular cargara los números de todos —y a que todos vieran las
-- conversaciones de todos—.
--
-- ── Qué significa NULL ──
--
-- `usuario_id IS NULL` es el canal DE LA INMOBILIARIA: el número de ventas, la
-- casilla de contacto. Lo ve el equipo según los permisos de siempre.
-- Con `usuario_id` cargado es el número personal de esa persona.
--
-- ── ON DELETE SET NULL, y es a propósito ──
--
-- Cuando alguien se va de la inmobiliaria, su canal NO se borra: pasa a ser de
-- la inmobiliaria. Las conversaciones con sus clientes siguen ahí y alguien las
-- puede seguir. Borrarlas en cascada sería perder la relación con el cliente
-- por un cambio de empleado, que es exactamente lo que este sistema existe para
-- que no pase.

BEGIN;

ALTER TABLE canal_cuenta
  ADD COLUMN usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL;

CREATE INDEX ix_canal_cuenta_usuario
  ON canal_cuenta (tenant_id, usuario_id) WHERE usuario_id IS NOT NULL;

-- El id puede llegar desde el cuerpo de un request —el titular asignándole un
-- número a alguien— así que va con el disparador de la 035/037: sin esto se le
-- puede asignar el canal a un usuario de otra inmobiliaria y el número queda
-- colgado de alguien que de este lado no existe.
CREATE CONSTRAINT TRIGGER tg_canal_cuenta_usuario_del_tenant
  AFTER INSERT OR UPDATE OF usuario_id ON canal_cuenta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('usuario_id');

COMMIT;
