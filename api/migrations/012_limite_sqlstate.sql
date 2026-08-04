-- 012 — El tope de plan levanta un SQLSTATE PROPIO.
--
-- Con `check_violation` (23514) la aplicación no puede distinguir "llegaste al
-- tope de tu plan" de cualquier otro CHECK que falle, así que salía como 500.
-- Un límite comercial es un 4xx con motivo, no un error del servidor.
--
-- 'BE001' es un código de la clase 'BE', que Postgres no usa. Así el mapeo a
-- HTTP es inequívoco y el MENSAJE vive en un solo lugar: acá.
CREATE OR REPLACE FUNCTION app_exigir_limite_propiedades() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM app_limite_plan('propiedades');
  IF NOT l.permitido THEN
    RAISE EXCEPTION
      'Llegaste al tope de % propiedades del plan %. Pasá a un plan superior para cargar más.',
      l.maximo, l.plan
      USING ERRCODE = 'BE001';
  END IF;
  RETURN NEW;
END;
$$;
