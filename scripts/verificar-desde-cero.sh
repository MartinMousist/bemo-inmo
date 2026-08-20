#!/usr/bin/env bash
#
# Corre TODAS las migraciones y el seed contra una base vacía, y la borra.
#
# ── Por qué existe ──
#
# La migración 035 pasó los tests en desarrollo y rompió el CI. No por un error
# de SQL: porque en desarrollo se aplicó como DELTA sobre una base que ya tenía
# datos, y ahí sus disparadores nunca vieron el orden en que el seed carga las
# cosas. Contra una base vacía —lo único que hace el CI— se caía.
#
# **Una migración probada sólo como delta no está probada.** Esto es lo que
# faltaba para saberlo antes de pushear, en vez de tres minutos después.
#
# No toca la base de desarrollo: crea una aparte, la usa y la borra.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

BASE="bemo_inmo_verificacion"

limpiar() {
  docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $BASE;" >/dev/null 2>&1 || true
}
trap limpiar EXIT

echo "→ Creando $BASE vacía…"
limpiar
docker compose exec -T db psql -U "$DB_OWNER_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $BASE;" >/dev/null

# Los permisos que el init del contenedor da UNA vez, sólo a la base principal.
docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$BASE" -v ON_ERROR_STOP=1 >/dev/null <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE $BASE TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
SQL

echo "→ Migraciones y seed desde cero…"
docker compose exec -T api npx ts-node -e "
import { migrar, correrSql } from './src/database/migrator';
const url = process.env.DATABASE_OWNER_URL!.replace(/\/[^/]+\$/, '/$BASE');
(async () => {
  await migrar(url, './migrations');
  console.log('  migraciones OK');
  await correrSql(url, './seeds/demo.sql');
  console.log('  seed OK');
})().catch(e => { console.error('  FALLÓ →', e.message); process.exit(1); });
"

echo "✓ Desde cero, todo aplica."
