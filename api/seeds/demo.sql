-- Datos demo para desarrollo. Corre como OWNER, NUNCA en producción.
--
-- Son DOS inmobiliarias a propósito: con una sola no se puede probar que el
-- aislamiento funcione. El gate de la etapa 2 es "cero fuga entre dos cuentas",
-- y para eso hacen falta dos cuentas desde el día uno.

INSERT INTO tenant (id, nombre, cuit, provincia, moneda_default)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Inmobiliaria Andes',    '30-71234567-9', 'Mendoza',      'ARS'),
  ('22222222-2222-4222-8222-222222222222', 'Inmobiliaria del Plata','30-79876543-2', 'Buenos Aires', 'ARS')
ON CONFLICT (id) DO NOTHING;
