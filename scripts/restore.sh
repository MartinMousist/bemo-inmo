#!/usr/bin/env bash
#
# Restaura un backup SOBRE LA BASE REAL. Destructivo.
#
#   ./scripts/restore.sh backups/bemo-inmo-20260803-120000.dump --yes
#
# El --yes es obligatorio a propósito: este comando borra la base actual y no
# hay forma de deshacerlo. Que no se pueda ejecutar por accidente vale más que
# la comodidad de escribir menos.
#
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

ARCHIVO="${1:-}"
CONFIRMA="${2:-}"

if [ -z "$ARCHIVO" ] || [ ! -f "$ARCHIVO" ]; then
  echo "Uso: ./scripts/restore.sh <archivo.dump> --yes" >&2
  echo "Backups disponibles:" >&2
  ls -1t ./backups/*.dump 2>/dev/null | head -10 >&2 || echo "  (ninguno)" >&2
  exit 1
fi

if [ "$CONFIRMA" != "--yes" ]; then
  echo "✗ Falta --yes." >&2
  echo "  Esto BORRA la base '$DB_NAME' y la reemplaza por $ARCHIVO." >&2
  echo "  No se puede deshacer." >&2
  exit 1
fi

echo "→ Cerrando conexiones a $DB_NAME"
docker compose stop api web >/dev/null 2>&1 || true
docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()"

echo "→ Recreando $DB_NAME"
docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $DB_NAME" \
  -c "CREATE DATABASE $DB_NAME"

echo "→ Restaurando"
docker compose exec -T db pg_restore \
  -U "$DB_OWNER_USER" -d "$DB_NAME" --no-owner --no-acl < "$ARCHIVO" 2>&1 | tail -5 || true

# El rol de aplicación vive fuera de la base, así que los GRANT se pierden en el
# restore. Sin esto, la app arranca y no puede leer nada.
# Un GRANT ON ALL TABLES es demasiado ancho: le da a la app permiso sobre
# tablas de infraestructura. Se otorga en bloque y después se recorta a mano,
# tabla por tabla, igual que en las migraciones.
echo "→ Reponiendo permisos de app_role"
docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$DB_NAME" -q <<'EOSQL'
  GRANT USAGE ON SCHEMA public TO app_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_role;

  -- El registro de migraciones es de la infraestructura, no de la aplicación.
  -- Si app_role pudiera tocarlo, podría marcar como aplicada una migración que
  -- no corrió, o borrar una fila y provocar que se re-ejecute.
  REVOKE ALL ON schema_migrations FROM app_role;
  REVOKE INSERT, UPDATE, DELETE ON auditoria FROM app_role;
  GRANT SELECT ON auditoria TO app_role;
  REVOKE ALL ON sesion FROM app_role;
  REVOKE INSERT, UPDATE, DELETE ON indice_valor FROM app_role;
  GRANT SELECT ON indice_valor TO app_role;
  REVOKE INSERT, DELETE ON tenant FROM app_role;
EOSQL

docker compose start api web >/dev/null 2>&1 || true
echo "✓ Restaurado desde $ARCHIVO"
echo "  Verificá que la app levante: curl -s localhost:${API_PORT:-3000}/v1/health"
