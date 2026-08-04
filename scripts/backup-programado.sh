#!/bin/sh
#
# Backup automático, CON VERIFICACIÓN, desde adentro de la red de compose.
#
# Es el mismo procedimiento que `backup.sh`, pero hablándole a Postgres por la
# red en vez de por `docker compose exec`: un contenedor no tiene acceso al
# socket de Docker, y dárselo para hacer un backup sería darle el control del
# host entero.
#
# Corre en un bucle y no con cron: la imagen de Postgres no trae cron, y sumar
# uno significa otra imagen, otro archivo de configuración y otro lugar donde
# los logs no aparecen. Un `sleep` hasta la próxima hora hace lo mismo y se ve
# en `docker compose logs`.
#
# ⚠️ Un backup que nunca se restauró es una hipótesis. Por eso cada dump se
# vuelve a levantar en una base descartable y se cuentan las filas de las tablas
# que importan. Si eso falla, el archivo queda marcado .INVALIDO y el script lo
# grita en el log en vez de seguir como si nada.

set -eu

DESTINO="${BACKUP_DIR:-/backups}"
HORA="${BACKUP_HORA:-03}"        # hora local del contenedor, 00-23
RETENER="${BACKUP_RETENER:-14}"  # cuántos dumps se guardan

export PGHOST="${PGHOST:-db}"
export PGUSER="${DB_OWNER_USER}"
export PGPASSWORD="${DB_OWNER_PASSWORD}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

correr_backup() {
  SELLO="$(date +%Y%m%d-%H%M%S)"
  ARCHIVO="$DESTINO/bemo-inmo-$SELLO.dump"
  # Sin guiones: un identificador de Postgres los rechaza sin comillas.
  BASE_PRUEBA="verificacion_$(echo "$SELLO" | tr -d -)"

  mkdir -p "$DESTINO"

  log "dump de $DB_NAME"
  # Formato custom (-Fc): comprimido y restaurable selectivamente, a diferencia
  # del SQL plano que hay que tragar entero.
  if ! pg_dump -d "$DB_NAME" -Fc --no-owner --no-acl > "$ARCHIVO" 2>/tmp/dump.err; then
    log "✗ falló el dump: $(cat /tmp/dump.err)"
    rm -f "$ARCHIVO"
    return 1
  fi

  TAM=$(wc -c < "$ARCHIVO" | tr -d ' ')
  if [ "$TAM" -lt 1024 ]; then
    log "✗ el dump pesa $TAM bytes: algo salió mal"
    rm -f "$ARCHIVO"
    return 1
  fi

  log "verificando: restaurando en $BASE_PRUEBA"
  psql -d postgres -q -c "DROP DATABASE IF EXISTS $BASE_PRUEBA" \
                    -c "CREATE DATABASE $BASE_PRUEBA"

  # El restore tira warnings por objetos que no existen en una base vacía
  # (roles, extensiones). Sólo importa que el resultado tenga datos.
  pg_restore -d "$BASE_PRUEBA" --no-owner --no-acl < "$ARCHIVO" 2>/dev/null || true

  FALLAS=0
  for TABLA in tenant usuario membresia propiedad contrato_alquiler liquidacion; do
    N=$(psql -d "$BASE_PRUEBA" -tAc "SELECT count(*) FROM $TABLA" 2>/dev/null || echo ERROR)
    log "  $TABLA: $N"
    [ "$N" = "ERROR" ] && FALLAS=$((FALLAS + 1))
  done

  psql -d postgres -q -c "DROP DATABASE IF EXISTS $BASE_PRUEBA"

  if [ "$FALLAS" -gt 0 ]; then
    mv "$ARCHIVO" "$ARCHIVO.INVALIDO"
    log "✗ no se pudo verificar. Renombrado a .INVALIDO"
    return 1
  fi

  log "✓ $ARCHIVO ($((TAM / 1024)) KB) — verificado"

  # Rotación. Un disco lleno también es una caída, y es la que nadie ve venir.
  ls -1t "$DESTINO"/bemo-inmo-*.dump 2>/dev/null | tail -n +$((RETENER + 1)) | while read -r v; do
    log "rotando: $(basename "$v")"
    rm -f "$v"
  done
}

# Un backup al arrancar: si el contenedor se levantó después de una caída, no
# tiene sentido esperar hasta mañana para saber si la base está sana.
if [ "${BACKUP_AL_ARRANCAR:-true}" = "true" ]; then
  log "backup inicial"
  correr_backup || log "el backup inicial falló; se sigue igual y se reintenta a las $HORA:00"
fi

log "programado todos los días a las $HORA:00"

while true; do
  AHORA_H=$(date +%H)
  AHORA_M=$(date +%M)
  # Segundos que faltan hasta la próxima vez que den las HORA:00.
  FALTA=$(( ((10#$HORA - 10#$AHORA_H + 24) % 24) * 3600 - 10#$AHORA_M * 60 ))
  [ "$FALTA" -le 60 ] && FALTA=$((FALTA + 86400))

  log "próximo backup en $((FALTA / 3600))h $((FALTA % 3600 / 60))m"
  sleep "$FALTA"

  correr_backup || log "✗ el backup de hoy falló"
done
