#!/usr/bin/env bash
#
# Mueve los objetos que quedaron en las rutas viejas del bucket, UNA sola vez.
#
# Contexto: hasta la migración 029 el bucket tenía `anonymous set download`
# sobre la raíz y las claves eran `{tenant}/{tipo}/…`. Ahí adentro convivían las
# fotos de propiedades —que tienen que ser públicas, van en el feed XML de los
# portales— con las dos caras del DNI de cada garante, sus recibos de sueldo y
# las fotos de las actas.
#
# Ahora la clave lleva la visibilidad adelante (`publico/…` y `privado/…`) y la
# política sólo abre `publico/`. Los objetos viejos quedan en rutas que ya no
# tienen permiso: este script los reubica y actualiza la base.
#
# Es idempotente: correrlo dos veces no rompe nada — la segunda no encuentra
# nada que mover.
#
#   ./scripts/migrar-bucket-029.sh          # dice qué haría
#   ./scripts/migrar-bucket-029.sh --aplicar
set -euo pipefail
cd "$(dirname "$0")/.."

APLICAR=false
[[ "${1:-}" == "--aplicar" ]] && APLICAR=true

set -a; . ./.env; set +a
: "${S3_BUCKET:?falta S3_BUCKET en .env}"
# El compose la arma así para la app; acá se replica en vez de pedirla en .env,
# para que las dos digan siempre lo mismo.
S3_PUBLIC_URL="${S3_PUBLIC_URL:-http://localhost:${S3_PORT:-9000}/${S3_BUCKET}}"

mc() {
  docker compose exec -T s3 mc --config-dir /tmp/.mc "$@"
}

alias_listo() {
  mc alias set local "http://localhost:9000" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
}

psql_owner() {
  docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

alias_listo

echo "Objetos en rutas viejas (los que NO empiezan con publico/ o privado/):"

# `mc ls --recursive` devuelve la clave relativa al bucket en la última columna.
VIEJOS=$(mc ls --recursive "local/$S3_BUCKET" \
  | awk '{print $NF}' \
  | grep -Ev '^(publico|privado)/' || true)

if [[ -z "$VIEJOS" ]]; then
  echo "  ninguno. Nada que hacer."
  exit 0
fi

echo "$VIEJOS" | sed 's/^/  /'
TOTAL=$(echo "$VIEJOS" | wc -l | tr -d ' ')
echo
echo "Total: $TOTAL"

if ! $APLICAR; then
  echo
  echo "Esto fue una vista previa. Para aplicarlo:"
  echo "  ./scripts/migrar-bucket-029.sh --aplicar"
  exit 0
fi

echo
echo "Moviendo…"
while IFS= read -r clave; do
  [[ -z "$clave" ]] && continue

  # La visibilidad sale del TIPO, que es el segundo tramo: {tenant}/{tipo}/…
  # Sólo `propiedades` es publicable; el resto es legajo de una persona.
  tipo=$(echo "$clave" | cut -d/ -f2)
  case "$tipo" in
    propiedades) destino="publico/$clave" ;;
    *)           destino="privado/$clave" ;;
  esac

  # `< /dev/null` NO es decorativo: `docker compose exec` hereda el stdin del
  # `while read`, se come el resto de la lista y el bucle termina después del
  # primer objeto. Movía 1 de 711 y parecía que había andado.
  mc mv "local/$S3_BUCKET/$clave" "local/$S3_BUCKET/$destino" >/dev/null < /dev/null
  echo "  $clave → $destino"
done <<< "$VIEJOS"

echo
echo "Actualizando la base…"

# Las fotos de propiedades siguen sirviéndose por URL directa: se reescribe.
# `position()` y no un LIKE con comodín: la url lleva el bucket adelante y hay
# que insertar el prefijo justo después, no al principio del string.
psql_owner <<SQL
BEGIN;

UPDATE propiedad_foto
   SET url = replace(url, '${S3_PUBLIC_URL}/', '${S3_PUBLIC_URL}/publico/')
 WHERE url LIKE '${S3_PUBLIC_URL}/%'
   AND url NOT LIKE '${S3_PUBLIC_URL}/publico/%'
   AND url NOT LIKE '${S3_PUBLIC_URL}/privado/%';

-- Lo privado ya no se sirve por url: lo que importa es la clave. Se completa
-- para las filas anteriores a la 029, que la tenían en NULL.
UPDATE garantia_documento
   SET clave = 'privado/' || replace(url, '${S3_PUBLIC_URL}/', '')
 WHERE clave IS NULL
   AND url LIKE '${S3_PUBLIC_URL}/%';

UPDATE acta_foto
   SET clave = 'privado/' || replace(url, '${S3_PUBLIC_URL}/', '')
 WHERE clave IS NULL
   AND url LIKE '${S3_PUBLIC_URL}/%';

COMMIT;
SQL

echo
echo "Listo. Verificá que una foto de propiedad abra y que un DNI dé 403."
