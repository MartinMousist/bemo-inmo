-- 035 · Sellado de referencias entre inmobiliarias
--
-- ── El agujero ──
--
-- RLS impide LEER lo ajeno, y lo impide bien. Pero no impide APUNTAR a lo
-- ajeno, porque **los chequeos de integridad referencial de Postgres pasan por
-- encima de las políticas de fila**: está en la documentación, es a propósito
-- (si no, una FK podría fallar por filas que el usuario no ve) y significa que
--
--     FOREIGN KEY (agente_id) REFERENCES usuario(id)
--
-- acepta feliz el id de un asesor de otra inmobiliaria.
--
-- Medido, no supuesto: `test/hostil.spec.ts` mandaba el id de un agente de la
-- inmobiliaria vecina en seis endpoints distintos y los seis contestaban 201.
--
-- ── Por qué no se arregla en el servicio ──
--
-- Se podía validar en cada lugar donde entra un id. Eran seis hoy, y el
-- séptimo endpoint que alguien escriba mañana vuelve a estar abierto: es
-- exactamente la clase de defensa que este repo ya decidió no usar cuando
-- eligió que olvidarse de `withTenant` ROMPA la feature en vez de filtrarla.
--
-- La FK compuesta hace la referencia cruzada **estructuralmente imposible**.
-- No hay código que se pueda olvidar porque no hay código: lo sostiene el
-- mismo mecanismo que ya sostiene la integridad.
--
-- ── Qué NO tapa ──
--
-- Esto no era una fuga de datos: leer seguía bloqueado por RLS y el JOIN de
-- vuelta devolvía NULL. Lo que evita es la corrupción silenciosa —un lead
-- colgado de un asesor que de este lado no existe desaparece de todas las
-- pantallas y sigue en la base— y, en comisiones, plata asignada a un
-- beneficiario fantasma.
--
-- ── La trampa de `ON DELETE SET NULL` ──
--
-- Una FK compuesta con SET NULL a secas anularía TAMBIÉN `tenant_id`, que es
-- NOT NULL: toda baja de un padre reventaría. Postgres 15 agregó
-- `ON DELETE SET NULL (columna)` para acotar el anulado, y por eso esto
-- requiere PG 15+. Corremos 16.

BEGIN;

-- ── 1. La clave que hace referenciable el par ──────────────────────────────
-- Una FK necesita UNIQUE del lado apuntado. `id` ya es PK, así que este par es
-- redundante en cuanto a unicidad: existe para que `(tenant_id, id)` sea un
-- destino válido.
ALTER TABLE acta ADD CONSTRAINT acta_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE acta_item ADD CONSTRAINT acta_item_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE cobro ADD CONSTRAINT cobro_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE comision ADD CONSTRAINT comision_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_alquiler_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE documento_generado ADD CONSTRAINT documento_generado_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE extracto ADD CONSTRAINT extracto_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE garantia ADD CONSTRAINT garantia_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE gasto ADD CONSTRAINT gasto_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE inmobiliaria_externa ADD CONSTRAINT inmobiliaria_externa_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE liquidacion ADD CONSTRAINT liquidacion_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE operacion ADD CONSTRAINT operacion_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE operacion_venta ADD CONSTRAINT operacion_venta_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE oportunidad ADD CONSTRAINT oportunidad_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE periodo_alquiler ADD CONSTRAINT periodo_alquiler_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE persona ADD CONSTRAINT persona_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE plantilla_doc ADD CONSTRAINT plantilla_doc_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE propiedad ADD CONSTRAINT propiedad_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE proveedor ADD CONSTRAINT proveedor_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE reclamo ADD CONSTRAINT reclamo_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE sucursal ADD CONSTRAINT sucursal_tenant_id_key UNIQUE (tenant_id, id);

-- ── 2. Las 58 referencias, ahora con el tenant adentro ─────────────────────
-- Generadas desde el catálogo preservando el ON DELETE de cada una: 27 CASCADE,
-- 22 SET NULL y 9 RESTRICT. Cambiar ese comportamiento acá sería un cambio de
-- semántica escondido adentro de un arreglo de seguridad.
ALTER TABLE acceso_portal DROP CONSTRAINT acceso_propietario_persona_id_fkey;
ALTER TABLE acceso_portal ADD CONSTRAINT acceso_propietario_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE acta DROP CONSTRAINT acta_contrato_id_fkey;
ALTER TABLE acta ADD CONSTRAINT acta_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE acta_foto DROP CONSTRAINT acta_foto_acta_item_id_fkey;
ALTER TABLE acta_foto ADD CONSTRAINT acta_foto_acta_item_id_fkey FOREIGN KEY (tenant_id, acta_item_id) REFERENCES acta_item (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE acta_item DROP CONSTRAINT acta_item_acta_id_fkey;
ALTER TABLE acta_item ADD CONSTRAINT acta_item_acta_id_fkey FOREIGN KEY (tenant_id, acta_id) REFERENCES acta (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE cobro DROP CONSTRAINT cobro_liquidacion_fk;
ALTER TABLE cobro ADD CONSTRAINT cobro_liquidacion_fk FOREIGN KEY (tenant_id, liquidacion_id) REFERENCES liquidacion (tenant_id, id) ON DELETE SET NULL (liquidacion_id);
ALTER TABLE cobro DROP CONSTRAINT cobro_periodo_id_fkey;
ALTER TABLE cobro ADD CONSTRAINT cobro_periodo_id_fkey FOREIGN KEY (tenant_id, periodo_id) REFERENCES periodo_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE comision DROP CONSTRAINT comision_contrato_id_fkey;
ALTER TABLE comision ADD CONSTRAINT comision_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE comision DROP CONSTRAINT comision_externa_id_fkey;
ALTER TABLE comision ADD CONSTRAINT comision_externa_id_fkey FOREIGN KEY (tenant_id, externa_id) REFERENCES inmobiliaria_externa (tenant_id, id) ON DELETE SET NULL (externa_id);
ALTER TABLE comision DROP CONSTRAINT comision_padre_id_fkey;
ALTER TABLE comision ADD CONSTRAINT comision_padre_id_fkey FOREIGN KEY (tenant_id, padre_id) REFERENCES comision (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE comision DROP CONSTRAINT comision_venta_id_fkey;
ALTER TABLE comision ADD CONSTRAINT comision_venta_id_fkey FOREIGN KEY (tenant_id, venta_id) REFERENCES operacion_venta (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contraparte_conocida DROP CONSTRAINT contraparte_conocida_persona_id_fkey;
ALTER TABLE contraparte_conocida ADD CONSTRAINT contraparte_conocida_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contrato_ajuste DROP CONSTRAINT contrato_ajuste_contrato_id_fkey;
ALTER TABLE contrato_ajuste ADD CONSTRAINT contrato_ajuste_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contrato_alquiler DROP CONSTRAINT contrato_alquiler_contrato_anterior_id_fkey;
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_alquiler_contrato_anterior_id_fkey FOREIGN KEY (tenant_id, contrato_anterior_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE SET NULL (contrato_anterior_id);
ALTER TABLE contrato_alquiler DROP CONSTRAINT contrato_alquiler_operacion_id_fkey;
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_alquiler_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE SET NULL (operacion_id);
ALTER TABLE contrato_alquiler DROP CONSTRAINT contrato_alquiler_propiedad_id_fkey;
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_alquiler_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE contrato_parte DROP CONSTRAINT contrato_parte_contrato_id_fkey;
ALTER TABLE contrato_parte ADD CONSTRAINT contrato_parte_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contrato_parte DROP CONSTRAINT contrato_parte_persona_id_fkey;
ALTER TABLE contrato_parte ADD CONSTRAINT contrato_parte_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE documento_envio DROP CONSTRAINT documento_envio_documento_id_fkey;
ALTER TABLE documento_envio ADD CONSTRAINT documento_envio_documento_id_fkey FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_generado (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE documento_generado DROP CONSTRAINT documento_generado_contrato_id_fkey;
ALTER TABLE documento_generado ADD CONSTRAINT documento_generado_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE documento_generado DROP CONSTRAINT documento_generado_plantilla_id_fkey;
ALTER TABLE documento_generado ADD CONSTRAINT documento_generado_plantilla_id_fkey FOREIGN KEY (tenant_id, plantilla_id) REFERENCES plantilla_doc (tenant_id, id) ON DELETE SET NULL (plantilla_id);
ALTER TABLE evento_programado DROP CONSTRAINT evento_programado_destinatario_persona_id_fkey;
ALTER TABLE evento_programado ADD CONSTRAINT evento_programado_destinatario_persona_id_fkey FOREIGN KEY (tenant_id, destinatario_persona_id) REFERENCES persona (tenant_id, id) ON DELETE SET NULL (destinatario_persona_id);
ALTER TABLE garantia DROP CONSTRAINT garantia_contrato_id_fkey;
ALTER TABLE garantia ADD CONSTRAINT garantia_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE garantia DROP CONSTRAINT garantia_persona_id_fkey;
ALTER TABLE garantia ADD CONSTRAINT garantia_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE garantia_bcra_consulta DROP CONSTRAINT garantia_bcra_consulta_garantia_id_fkey;
ALTER TABLE garantia_bcra_consulta ADD CONSTRAINT garantia_bcra_consulta_garantia_id_fkey FOREIGN KEY (tenant_id, garantia_id) REFERENCES garantia (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE garantia_documento DROP CONSTRAINT garantia_documento_garantia_id_fkey;
ALTER TABLE garantia_documento ADD CONSTRAINT garantia_documento_garantia_id_fkey FOREIGN KEY (tenant_id, garantia_id) REFERENCES garantia (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE gasto DROP CONSTRAINT gasto_contrato_id_fkey;
ALTER TABLE gasto ADD CONSTRAINT gasto_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE SET NULL (contrato_id);
ALTER TABLE gasto DROP CONSTRAINT gasto_liquidacion_id_fkey;
ALTER TABLE gasto ADD CONSTRAINT gasto_liquidacion_id_fkey FOREIGN KEY (tenant_id, liquidacion_id) REFERENCES liquidacion (tenant_id, id) ON DELETE SET NULL (liquidacion_id);
ALTER TABLE gasto DROP CONSTRAINT gasto_propiedad_id_fkey;
ALTER TABLE gasto ADD CONSTRAINT gasto_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE gasto DROP CONSTRAINT gasto_proveedor_id_fkey;
ALTER TABLE gasto ADD CONSTRAINT gasto_proveedor_id_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedor (tenant_id, id) ON DELETE SET NULL (proveedor_id);
ALTER TABLE gasto DROP CONSTRAINT gasto_reclamo_id_fkey;
ALTER TABLE gasto ADD CONSTRAINT gasto_reclamo_id_fkey FOREIGN KEY (tenant_id, reclamo_id) REFERENCES reclamo (tenant_id, id) ON DELETE SET NULL (reclamo_id);
ALTER TABLE liquidacion DROP CONSTRAINT liquidacion_propietario_id_fkey;
ALTER TABLE liquidacion ADD CONSTRAINT liquidacion_propietario_id_fkey FOREIGN KEY (tenant_id, propietario_id) REFERENCES persona (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE liquidacion_linea DROP CONSTRAINT liquidacion_linea_contrato_id_fkey;
ALTER TABLE liquidacion_linea ADD CONSTRAINT liquidacion_linea_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE SET NULL (contrato_id);
ALTER TABLE liquidacion_linea DROP CONSTRAINT liquidacion_linea_gasto_id_fkey;
ALTER TABLE liquidacion_linea ADD CONSTRAINT liquidacion_linea_gasto_id_fkey FOREIGN KEY (tenant_id, gasto_id) REFERENCES gasto (tenant_id, id) ON DELETE SET NULL (gasto_id);
ALTER TABLE liquidacion_linea DROP CONSTRAINT liquidacion_linea_liquidacion_id_fkey;
ALTER TABLE liquidacion_linea ADD CONSTRAINT liquidacion_linea_liquidacion_id_fkey FOREIGN KEY (tenant_id, liquidacion_id) REFERENCES liquidacion (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE liquidacion_linea DROP CONSTRAINT liquidacion_linea_periodo_id_fkey;
ALTER TABLE liquidacion_linea ADD CONSTRAINT liquidacion_linea_periodo_id_fkey FOREIGN KEY (tenant_id, periodo_id) REFERENCES periodo_alquiler (tenant_id, id) ON DELETE SET NULL (periodo_id);
ALTER TABLE membresia DROP CONSTRAINT membresia_sucursal_id_fkey;
ALTER TABLE membresia ADD CONSTRAINT membresia_sucursal_id_fkey FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursal (tenant_id, id) ON DELETE SET NULL (sucursal_id);
ALTER TABLE movimiento_bancario DROP CONSTRAINT movimiento_bancario_cobro_id_fkey;
ALTER TABLE movimiento_bancario ADD CONSTRAINT movimiento_bancario_cobro_id_fkey FOREIGN KEY (tenant_id, cobro_id) REFERENCES cobro (tenant_id, id) ON DELETE SET NULL (cobro_id);
ALTER TABLE movimiento_bancario DROP CONSTRAINT movimiento_bancario_extracto_id_fkey;
ALTER TABLE movimiento_bancario ADD CONSTRAINT movimiento_bancario_extracto_id_fkey FOREIGN KEY (tenant_id, extracto_id) REFERENCES extracto (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE operacion DROP CONSTRAINT operacion_propiedad_id_fkey;
ALTER TABLE operacion ADD CONSTRAINT operacion_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE operacion_precio DROP CONSTRAINT operacion_precio_operacion_id_fkey;
ALTER TABLE operacion_precio ADD CONSTRAINT operacion_precio_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE operacion_venta DROP CONSTRAINT operacion_venta_comprador_id_fkey;
ALTER TABLE operacion_venta ADD CONSTRAINT operacion_venta_comprador_id_fkey FOREIGN KEY (tenant_id, comprador_id) REFERENCES persona (tenant_id, id) ON DELETE SET NULL (comprador_id);
ALTER TABLE operacion_venta DROP CONSTRAINT operacion_venta_operacion_id_fkey;
ALTER TABLE operacion_venta ADD CONSTRAINT operacion_venta_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE oportunidad DROP CONSTRAINT oportunidad_operacion_id_fkey;
ALTER TABLE oportunidad ADD CONSTRAINT oportunidad_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE SET NULL (operacion_id);
ALTER TABLE oportunidad DROP CONSTRAINT oportunidad_persona_id_fkey;
ALTER TABLE oportunidad ADD CONSTRAINT oportunidad_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE periodo_alquiler DROP CONSTRAINT periodo_alquiler_contrato_id_fkey;
ALTER TABLE periodo_alquiler ADD CONSTRAINT periodo_alquiler_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE propiedad DROP CONSTRAINT propiedad_sucursal_id_fkey;
ALTER TABLE propiedad ADD CONSTRAINT propiedad_sucursal_id_fkey FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursal (tenant_id, id) ON DELETE SET NULL (sucursal_id);
ALTER TABLE propiedad_foto DROP CONSTRAINT propiedad_foto_propiedad_id_fkey;
ALTER TABLE propiedad_foto ADD CONSTRAINT propiedad_foto_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE publicacion DROP CONSTRAINT publicacion_operacion_id_fkey;
ALTER TABLE publicacion ADD CONSTRAINT publicacion_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE reclamo DROP CONSTRAINT reclamo_contrato_id_fkey;
ALTER TABLE reclamo ADD CONSTRAINT reclamo_contrato_id_fkey FOREIGN KEY (tenant_id, contrato_id) REFERENCES contrato_alquiler (tenant_id, id) ON DELETE SET NULL (contrato_id);
ALTER TABLE reclamo DROP CONSTRAINT reclamo_propiedad_id_fkey;
ALTER TABLE reclamo ADD CONSTRAINT reclamo_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE reclamo DROP CONSTRAINT reclamo_proveedor_id_fkey;
ALTER TABLE reclamo ADD CONSTRAINT reclamo_proveedor_id_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedor (tenant_id, id) ON DELETE SET NULL (proveedor_id);
ALTER TABLE reclamo DROP CONSTRAINT reclamo_reportado_por_fkey;
ALTER TABLE reclamo ADD CONSTRAINT reclamo_reportado_por_fkey FOREIGN KEY (tenant_id, reportado_por) REFERENCES persona (tenant_id, id) ON DELETE SET NULL (reportado_por);
ALTER TABLE reserva DROP CONSTRAINT reserva_operacion_id_fkey;
ALTER TABLE reserva ADD CONSTRAINT reserva_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE reserva DROP CONSTRAINT reserva_persona_id_fkey;
ALTER TABLE reserva ADD CONSTRAINT reserva_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE titularidad DROP CONSTRAINT titularidad_persona_id_fkey;
ALTER TABLE titularidad ADD CONSTRAINT titularidad_persona_id_fkey FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE titularidad DROP CONSTRAINT titularidad_propiedad_id_fkey;
ALTER TABLE titularidad ADD CONSTRAINT titularidad_propiedad_id_fkey FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE visita DROP CONSTRAINT visita_operacion_id_fkey;
ALTER TABLE visita ADD CONSTRAINT visita_operacion_id_fkey FOREIGN KEY (tenant_id, operacion_id) REFERENCES operacion (tenant_id, id) ON DELETE SET NULL (operacion_id);
ALTER TABLE visita DROP CONSTRAINT visita_oportunidad_id_fkey;
ALTER TABLE visita ADD CONSTRAINT visita_oportunidad_id_fkey FOREIGN KEY (tenant_id, oportunidad_id) REFERENCES oportunidad (tenant_id, id) ON DELETE CASCADE;

-- ── 3. El caso de `usuario`, que no lleva `tenant_id` ──────────────────────
--
-- Una persona puede trabajar en dos inmobiliarias: la pertenencia vive en
-- `membresia`, no en `usuario`, así que acá no hay par `(tenant_id, id)` que
-- referenciar y la FK compuesta no aplica. Va un disparador.
--
-- SECURITY DEFINER a propósito: tiene que poder ver `membresia` entera para
-- responder «¿pertenece?», y bajo RLS vería sólo la del tenant actual —que es
-- justo lo que está en duda—.
CREATE OR REPLACE FUNCTION app_verificar_agente_del_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  columna text := TG_ARGV[0];
  valor   uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  -- Sin agente asignado no hay nada que verificar: NULL es un estado legítimo
  -- —una propiedad sin captador, un lead sin dueño— y no un intento de nada.
  IF valor IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM membresia m
     WHERE m.usuario_id = valor AND m.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'El usuario % no es de la inmobiliaria % (columna %)', valor, NEW.tenant_id, columna
      USING ERRCODE = 'BE003';
  END IF;

  RETURN NEW;
END $$;

-- Sólo las cuatro columnas donde el id LLEGA DESDE EL CUERPO de un request.
--
-- Las otras veintiséis referencias a `usuario` (`registrado_por`, `creada_por`,
-- `abierto_por`…) salen del token del actor, no de lo que mande el cliente.
-- Ponerles el disparador no agregaría defensa y sí riesgo: `auditoria` y
-- `sesion` se escriben en caminos —login fallido, expulsión de un miembro—
-- donde la membresía puede legítimamente no existir todavía o ya no existir, y
-- ahí el chequeo rompería la auditoría en vez de proteger algo.
CREATE TRIGGER tg_propiedad_captador_del_tenant
  BEFORE INSERT OR UPDATE OF agente_captador_id ON propiedad
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_captador_id');

CREATE TRIGGER tg_oportunidad_agente_del_tenant
  BEFORE INSERT OR UPDATE OF agente_id ON oportunidad
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_id');

CREATE TRIGGER tg_visita_agente_del_tenant
  BEFORE INSERT OR UPDATE OF agente_id ON visita
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('agente_id');

-- La más cara de las cuatro: acá lo que se cuelga de un fantasma es plata.
CREATE TRIGGER tg_comision_beneficiario_del_tenant
  BEFORE INSERT OR UPDATE OF beneficiario_id ON comision
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('beneficiario_id');

COMMIT;
