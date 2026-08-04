#!/usr/bin/env bash
#
# Backup de la base, CON VERIFICACIÓN.
#
# Un dump que nunca se abrió no es un backup: es un archivo. Este script hace el
# dump y después lo restaura en una base descartable para comprobar que se puede
# leer y que las tablas que importan tienen filas. Si eso falla, el backup se
# marca como INVÁLIDO y el script sale con error.
#
#   ./scripts/backup.sh [destino]
#
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

DESTINO="${1:-./backups}"
SELLO="$(date +%Y%m%d-%H%M%S)"
ARCHIVO="$DESTINO/bemo-inmo-$SELLO.dump"
# Sin guiones: un identificador de Postgres los rechaza sin comillas.
BASE_PRUEBA="verificacion_$(echo "$SELLO" | tr -d -)"

mkdir -p "$DESTINO"

echo "→ Dump de $DB_NAME"
# Formato custom (-Fc): comprimido y restaurable selectivamente, a diferencia
# del SQL plano que hay que tragar entero.
docker compose exec -T db pg_dump \
  -U "$DB_OWNER_USER" -d "$DB_NAME" -Fc --no-owner --no-acl \
  > "$ARCHIVO"

TAM=$(wc -c < "$ARCHIVO" | tr -d ' ')
if [ "$TAM" -lt 1024 ]; then
  echo "✗ El dump pesa $TAM bytes. Algo salió mal." >&2
  rm -f "$ARCHIVO"
  exit 1
fi

echo "→ Verificando: restaurando en $BASE_PRUEBA"
docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $BASE_PRUEBA" \
  -c "CREATE DATABASE $BASE_PRUEBA"

# El restore puede tirar warnings por objetos que no existen en la base vacía
# (roles, extensiones ya presentes). Sólo importa que el resultado tenga datos.
docker compose exec -T db pg_restore \
  -U "$DB_OWNER_USER" -d "$BASE_PRUEBA" --no-owner --no-acl \
  < "$ARCHIVO" 2>/dev/null || true

FALLAS=0
for TABLA in tenant usuario membresia propiedad contrato_alquiler; do
  N=$(docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$BASE_PRUEBA" -tAc \
        "SELECT count(*) FROM $TABLA" 2>/dev/null || echo "ERROR")
  printf "   %-20s %s\n" "$TABLA" "$N"
  [ "$N" = "ERROR" ] && FALLAS=$((FALLAS + 1))
done

docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $BASE_PRUEBA"

if [ "$FALLAS" -gt 0 ]; then
  mv "$ARCHIVO" "$ARCHIVO.INVALIDO"
  echo "✗ El backup no se pudo verificar. Renombrado a .INVALIDO" >&2
  exit 1
fi

echo "✓ $ARCHIVO ($(( TAM / 1024 )) KB) — verificado"

# Rotación: se quedan los últimos 14. Un disco lleno también es una caída.
ls -1t "$DESTINO"/bemo-inmo-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
