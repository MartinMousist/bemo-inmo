#!/bin/sh
# Corre UNA sola vez, cuando el volumen de datos está vacío, como superusuario.
# Crea el rol restringido con el que corre la aplicación.
#
# Dos roles, a propósito:
#   app_role       — rol de GRUPO, sin login. Es a quien las migraciones le dan permisos.
#   $APP_DB_USER   — rol de login que hereda de app_role. Su nombre sale del .env.
# Así las migraciones nunca mencionan un nombre configurable y se pueden correr igual
# en dev, test y producción.
#
# Ninguno de los dos es dueño de nada: por eso RLS les aplica de verdad. Un rol dueño
# saltea las policies salvo FORCE ROW LEVEL SECURITY, y ahí el migrador tampoco podría
# sembrar. Separar owner de app resuelve las dos cosas a la vez.
set -e

if [ -z "$APP_DB_USER" ] || [ -z "$APP_DB_PASSWORD" ]; then
  echo "FATAL: APP_DB_USER y APP_DB_PASSWORD son obligatorias" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v app_user="$APP_DB_USER" -v app_pass="$APP_DB_PASSWORD" <<'EOSQL'
  CREATE ROLE app_role NOLOGIN;

  SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE app_role', :'app_user', :'app_pass')
  \gexec

  -- nadie crea objetos en public salvo el owner
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  SELECT format('GRANT CONNECT ON DATABASE %I TO app_role', current_database())
  \gexec
  GRANT USAGE ON SCHEMA public TO app_role;
EOSQL

echo "rol de aplicación '$APP_DB_USER' creado (miembro de app_role)"
