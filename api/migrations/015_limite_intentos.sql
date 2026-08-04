-- 015 — El contador del límite de intentos, compartido.
--
-- Hasta acá el contador vivía en la memoria del proceso. Con una sola instancia
-- alcanza; con dos réplicas detrás de un balanceador, cada una lleva el suyo y
-- el límite efectivo se duplica **en silencio** — que es la peor forma de que
-- un límite de seguridad deje de funcionar.
--
-- Va en Postgres y no en Redis a propósito: la base ya está, ya es estado
-- compartido entre réplicas, y ya se respalda. Sumar Redis para esto sería otro
-- servicio que vigilar, otro que respaldar y otro que puede estar caído, a
-- cambio de nada que acá se note: los intentos de login son decenas por minuto,
-- no miles por segundo.
--
-- Los datos son efímeros y no son de nadie: no llevan `tenant_id` ni RLS. El
-- contador de una IP existe ANTES de saber a qué inmobiliaria pertenece — de
-- hecho, existe justamente para los casos en que no pertenece a ninguna.
CREATE TABLE limite_intento (
  clave           text PRIMARY KEY,
  hits            integer NOT NULL DEFAULT 0,
  -- Cuándo se reinicia la cuenta.
  expira_el       timestamptz NOT NULL,
  -- Cuándo deja de estar bloqueado. NULL = no lo está.
  bloqueado_hasta timestamptz
);

-- Para la limpieza periódica: barrer por fecha sin recorrer la tabla entera.
CREATE INDEX ix_limite_expira ON limite_intento (expira_el);

-- La app escribe y lee acá directamente. Sin RLS: no hay tenant que aislar, y
-- la clave ya viene hasheada desde la aplicación.
GRANT SELECT, INSERT, UPDATE, DELETE ON limite_intento TO app_role;
