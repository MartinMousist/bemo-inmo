-- 017 — Las comisiones dejan de ser una columna que nadie lee.
--
-- `tenant.comisiones` existe desde la 008 con el modelo que pidió el dueño
-- —3% + 3% a las puntas, 25% + 25% puertas adentro— y ningún código lo lee:
-- cada venta obliga a tipear los cuatro números. Es el error #3 del playbook.
-- Esta migración agrega lo único que faltaba en la base; el resto es servicio,
-- pantalla y tests.

-- ─────────────────────────────────────────────────────────────────────────────
-- El % de cada agente, en su membresía.
--
-- NULL **no es cero**: NULL hereda el reparto de la inmobiliaria, y cero es un
-- agente que efectivamente no cobra por captar. Guardar el default copiado en
-- cada fila haría que cambiar la política de la casa no alcanzara a nadie.
--
-- Van en `membresia` y no en `usuario` porque la misma persona puede trabajar
-- en dos inmobiliarias con condiciones distintas — que es la misma razón por la
-- que el rol también vive acá.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE membresia
  ADD COLUMN comision_captador_pct numeric(5, 2)
    CHECK (comision_captador_pct >= 0 AND comision_captador_pct <= 100),
  ADD COLUMN comision_cerrador_pct numeric(5, 2)
    CHECK (comision_cerrador_pct >= 0 AND comision_cerrador_pct <= 100);

COMMENT ON COLUMN membresia.comision_captador_pct IS
  '% de lo que le queda a la casa cuando este agente capta. NULL hereda tenant.comisiones.';
COMMENT ON COLUMN membresia.comision_cerrador_pct IS
  '% de lo que le queda a la casa cuando este agente cierra. NULL hereda tenant.comisiones.';

-- ─────────────────────────────────────────────────────────────────────────────
-- La comisión de alquiler: un mes.
--
-- El default de la 008 dejaba `alquiler` en 0 y 0, o sea "no se cobra nada al
-- firmar". La única comisión de alquiler que existe en los datos demo dice
-- «Honorarios de contrato · un mes», punta locadora, 100%, y así es como se
-- cobra: la base del cálculo es UN MES de alquiler y el porcentaje es qué parte
-- de ese mes paga cada punta. 100 = un mes entero.
--
-- Se corrige el default y se actualiza a los que quedaron con el viejo. Pisar
-- un dato existente en una migración sería peligroso si alguien lo estuviera
-- leyendo; acá nadie lo lee todavía —ese es justamente el problema que esta
-- etapa viene a resolver— así que no hay configuración de nadie que romper.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenant ALTER COLUMN comisiones SET DEFAULT
  '{"venta": {"compradora": 3, "vendedora": 3},
    "alquiler": {"locataria": 0, "locadora": 100},
    "repartoInterno": {"captador": 25, "cerrador": 25}}'::jsonb;

UPDATE tenant
   SET comisiones = jsonb_set(comisiones, '{alquiler}',
         '{"locataria": 0, "locadora": 100}'::jsonb)
 WHERE comisiones->'alquiler' = '{"locataria": 0, "locadora": 0}'::jsonb;
