#!/usr/bin/env bash
#
# Mide el listado de personas con los SEIS roles derivados, con el volumen de
# una inmobiliaria grande.
#
# Existe por una razón concreta: el plan malo de esta pantalla **se ve perfecto
# en la página 1** y se degrada con el número de página. Con las 74 personas de
# la base de desarrollo es imposible de detectar mirando, así que «esto anda
# bien» sería una hipótesis — el error #4 del playbook con otra cara.
#
#   ./scripts/medir-personas-rol.sh [cantidad_de_personas]
#
# Hermano de `medir-cartera.sh`: carga, mide y borra lo que cargó.
#
# ── LO QUE ESTE SCRIPT YA CONTESTÓ (corrida del 2026-08-09, 5.000 personas) ──
#
#   listado SIN CTE · página 1 …………………………………  6,4 ms
#   listado SIN CTE · última página ……………………  7,0 ms
#   listado CON CTE · página 1 …………………………………  4,6 ms
#   listado CON CTE · última página ……………………  5,1 ms
#   listado CON CTE · última + rol=inquilino …  2,4 ms
#   listado CON CTE · última + rol=garante ……  2,9 ms
#   conteos · LEFT JOIN de DISTINCT ……………………  7,5 ms
#   conteos · EXISTS correlacionado ……………………  140 ms  ← sin índices
#                                                32 ms  ← con índices
#
# Dos conclusiones, y las dos van contra lo que se esperaba:
#
# 1. **La CTE de paginación gana poco: 7,0 → 5,1 ms, no 175 → 5.** El plan
#    suponía que los seis roles se evaluaban por fila. No es así: se derivan con
#    `p.id IN (subconsulta)`, que Postgres planifica como un hash semi-join
#    construido UNA sola vez. La CTE se deja porque igual es más rápida y no
#    cuesta nada, no porque evite un desastre.
#
# 2. **NO se agregó ninguna migración de índices, y eso es el resultado de
#    medir.** Se probaron los cuatro candidatos —oportunidad(persona_id),
#    reserva(persona_id) parcial, operacion_venta(comprador_id) parcial y
#    contrato_parte(rol, persona_id)— y contra las consultas que el servicio
#    escribe de verdad no mueven la aguja: el listado queda en 6,4 vs 6,3 ms y
#    la ficha de una persona en 1,17 vs 1,10 ms, que es ruido. Sólo ayudan a la
#    forma con EXISTS correlacionado, que es justamente la que NO se usa.
#    Agregarlos habría sido pagar escritura en cuatro tablas calientes a cambio
#    de nada: el error #4 del playbook, y el mismo criterio con el que ya se
#    decidió no indexar `propiedad.agente_captador_id`.
#
#    Si algún día alguien cambia los `IN (subconsulta)` por EXISTS, esto hay que
#    volver a correrlo: ahí los índices pasan a valer 140 → 32 ms.
#
# ⚠️ Los ÍNDICES de prueba se crean y se dropean dentro del ciclo de vida de la
# medición, y el trap los borra: un índice es un objeto de la TABLA, no del
# tenant, así que el `DELETE FROM tenant` no se lo lleva.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

N="${1:-5000}"

psql() { docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$DB_NAME" "$@"; }
psql_app() { docker compose exec -T db psql -U "$DB_APP_USER" -d "$DB_NAME" "$@"; }

limpiar() {
  psql -tAq -c "DELETE FROM tenant WHERE nombre = 'MEDICION_ROLES'" >/dev/null 2>&1 || true
  # Los índices de MEDICIÓN, no los de la 025: esos son de producción y quedan.
  psql -tAq -c "DROP INDEX IF EXISTS ix_medicion_oportunidad_persona;
                DROP INDEX IF EXISTS ix_medicion_reserva_persona;
                DROP INDEX IF EXISTS ix_medicion_venta_comprador;
                DROP INDEX IF EXISTS ix_medicion_parte_rol_persona;" >/dev/null 2>&1 || true
}
trap limpiar EXIT

echo "→ Cargando $N personas con las seis fuentes de rol…"
limpiar

TID=$(psql -tAq -c "INSERT INTO tenant (nombre, provincia)
                    VALUES ('MEDICION_ROLES', 'Mendoza') RETURNING id" | tr -d '[:space:]')

psql -q <<SQL
BEGIN;
SELECT set_config('app.current_tenant_id', '$TID', true);
INSERT INTO suscripcion (tenant_id, plan_codigo, estado) VALUES ('$TID', 'pro', 'activa');

INSERT INTO persona (tenant_id, nombre, apellido, doc_numero)
SELECT '$TID', 'Nombre' || i, 'Apellido' || lpad(i::text, 6, '0'), (70000000 + i)::text
  FROM generate_series(1, $N) AS i;

-- Las propiedades y los contratos que sostienen las relaciones.
INSERT INTO propiedad (tenant_id, codigo, calle, numero, localidad, provincia, tipo)
SELECT '$TID', 80000 + i, 'Medición ' || i, i::text, 'Ciudad', 'Mendoza', 'departamento'
  FROM generate_series(1, $((N / 2))) AS i;

INSERT INTO contrato_alquiler (
  tenant_id, propiedad_id, fecha_inicio, fecha_fin, dia_vencimiento,
  monto_inicial, moneda, indice, periodicidad_meses, mes_base,
  honorarios_pct, punitorio_diario_pct, estado)
SELECT '$TID', p.id, current_date - interval '1 year', current_date + interval '2 years',
       10, 300000, 'ARS', 'ipc', 3,
       date_trunc('month', current_date - interval '1 year')::date, 8, 0.1, 'vigente'
  FROM propiedad p WHERE p.tenant_id = '$TID';

-- Proporciones tomadas del plan: 1.800 propietarios, 2.700 partes, 900
-- garantías, 1.200 leads, 300 reservas y 700 ventas sobre 5.000 personas.
INSERT INTO titularidad (tenant_id, propiedad_id, persona_id, porcentaje)
SELECT '$TID', pr.id, pe.id, 100
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM propiedad
         WHERE tenant_id = '$TID') pr
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = pr.n
 WHERE pr.n <= $((N * 36 / 100));

INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol)
SELECT '$TID', c.id, pe.id, 'locatario'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM contrato_alquiler
         WHERE tenant_id = '$TID') c
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = c.n + $((N * 36 / 100))
 WHERE c.n <= $((N * 30 / 100));

-- Los garantes, por las DOS fuentes: una parte en contrato_parte y una garantía
-- con persona. Se solapan a propósito, como en la base real.
INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol)
SELECT '$TID', c.id, pe.id, 'garante'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM contrato_alquiler
         WHERE tenant_id = '$TID') c
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = c.n + $((N * 66 / 100))
 WHERE c.n <= $((N * 24 / 100));

INSERT INTO garantia (tenant_id, contrato_id, persona_id, tipo)
SELECT '$TID', c.id, pe.id, 'garante_solidario'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM contrato_alquiler
         WHERE tenant_id = '$TID') c
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = c.n + $((N * 70 / 100))
 WHERE c.n <= $((N * 18 / 100));

INSERT INTO oportunidad (tenant_id, persona_id, origen, estado)
SELECT '$TID', pe.id, 'web', 'nueva'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe
 WHERE pe.n <= $((N * 24 / 100));

INSERT INTO operacion (tenant_id, propiedad_id, tipo, estado, precio, moneda)
SELECT '$TID', p.id, 'venta', 'disponible', 120000, 'USD'
  FROM propiedad p WHERE p.tenant_id = '$TID';

INSERT INTO operacion_venta (tenant_id, operacion_id, comprador_id,
                             precio_cierre, moneda, estado)
SELECT '$TID', o.id, pe.id, 110000, 'USD',
       -- Una de cada diez cae: el rol `comprador` las tiene que excluir.
       CASE WHEN o.n % 10 = 0 THEN 'caida' ELSE 'boleto' END
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM operacion
         WHERE tenant_id = '$TID') o
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = o.n + $((N * 20 / 100))
 WHERE o.n <= $((N * 14 / 100));

INSERT INTO reserva (tenant_id, operacion_id, persona_id, monto, moneda, estado)
SELECT '$TID', o.id, pe.id, 5000, 'USD',
       CASE WHEN o.n % 3 = 0 THEN 'convertida' ELSE 'activa' END
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM operacion
         WHERE tenant_id = '$TID' ORDER BY id DESC) o
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TID') pe ON pe.n = o.n + $((N * 50 / 100))
 WHERE o.n <= $((N * 9 / 100));
COMMIT;

ANALYZE persona; ANALYZE titularidad; ANALYZE contrato_parte; ANALYZE garantia;
ANALYZE oportunidad; ANALYZE reserva; ANALYZE operacion_venta;
SQL

psql -tAc "SELECT 'personas: '   || (SELECT count(*) FROM persona        WHERE tenant_id='$TID')
        || ' · titularidades: '  || (SELECT count(*) FROM titularidad    WHERE tenant_id='$TID')
        || ' · partes: '         || (SELECT count(*) FROM contrato_parte WHERE tenant_id='$TID')
        || ' · garantías: '      || (SELECT count(*) FROM garantia       WHERE tenant_id='$TID')
        || ' · leads: '          || (SELECT count(*) FROM oportunidad    WHERE tenant_id='$TID')
        || ' · reservas: '       || (SELECT count(*) FROM reserva        WHERE tenant_id='$TID')
        || ' · ventas: '         || (SELECT count(*) FROM operacion_venta WHERE tenant_id='$TID')"

# ── Las consultas, tal como las escribe el servicio ──────────────────────────

ROLES_SQL="array_remove(ARRAY[
  CASE WHEN p.id IN (SELECT persona_id FROM titularidad) THEN 'propietario' END,
  CASE WHEN p.id IN (SELECT persona_id FROM contrato_parte WHERE rol = 'locatario') THEN 'inquilino' END,
  CASE WHEN p.id IN (SELECT persona_id FROM contrato_parte WHERE rol IN ('garante','fiador')
                     UNION SELECT persona_id FROM garantia WHERE persona_id IS NOT NULL) THEN 'garante' END,
  CASE WHEN p.id IN (SELECT comprador_id FROM operacion_venta
                      WHERE comprador_id IS NOT NULL AND estado <> 'caida') THEN 'comprador' END,
  CASE WHEN p.id IN (SELECT persona_id FROM oportunidad) THEN 'interesado' END,
  CASE WHEN p.id IN (SELECT persona_id FROM reserva WHERE estado = 'activa') THEN 'reservante' END
], NULL)"

sin_cte() { # $1 = offset
  echo "SELECT p.id, $ROLES_SQL AS roles FROM persona p
         ORDER BY p.apellido NULLS LAST, p.nombre LIMIT 25 OFFSET $1"
}

con_cte() { # $1 = offset, $2 = predicado extra
  echo "WITH pagina AS (
          SELECT p.id, p.apellido, p.nombre FROM persona p
           WHERE true ${2:-}
           ORDER BY p.apellido NULLS LAST, p.nombre LIMIT 25 OFFSET $1)
        SELECT p.id, $ROLES_SQL AS roles FROM pagina p
         ORDER BY p.apellido NULLS LAST, p.nombre"
}

CONTEOS="SELECT count(*) AS todas,
   count(c1.persona_id), count(c2.persona_id), count(c3.persona_id),
   count(c4.persona_id), count(c5.persona_id), count(c6.persona_id)
  FROM persona p
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT persona_id FROM titularidad) s) c1 ON c1.persona_id = p.id
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT persona_id FROM contrato_parte WHERE rol='locatario') s) c2 ON c2.persona_id = p.id
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT persona_id FROM contrato_parte WHERE rol IN ('garante','fiador') UNION SELECT persona_id FROM garantia WHERE persona_id IS NOT NULL) s) c3 ON c3.persona_id = p.id
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT comprador_id AS persona_id FROM operacion_venta WHERE comprador_id IS NOT NULL AND estado <> 'caida') s) c4 ON c4.persona_id = p.id
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT persona_id FROM oportunidad) s) c5 ON c5.persona_id = p.id
  LEFT JOIN (SELECT DISTINCT persona_id FROM (SELECT persona_id FROM reserva WHERE estado='activa') s) c6 ON c6.persona_id = p.id"

CONTEOS_EXISTS="SELECT count(*),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM titularidad t WHERE t.persona_id = p.id)),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM contrato_parte cp WHERE cp.persona_id = p.id AND cp.rol='locatario')),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM garantia g WHERE g.persona_id = p.id)),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM operacion_venta v WHERE v.comprador_id = p.id AND v.estado <> 'caida')),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM oportunidad o WHERE o.persona_id = p.id)),
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reserva r WHERE r.persona_id = p.id AND r.estado='activa'))
  FROM persona p"

ULTIMA=$((N - 25))

medir() {
  local nombre="$1" sql="$2" mejor=999999 t
  for _ in 1 2 3; do
    t=$(psql_app -tAq \
          -c "SET app.current_tenant_id = '$TID';" \
          -c "EXPLAIN (ANALYZE, TIMING) $sql" 2>&1 |
        grep -oE 'Execution Time: [0-9.]+' | grep -oE '[0-9.]+' || echo 999999)
    # El MEJOR de tres, no el último: la primera corrida calienta cachés.
    awk -v a="$t" -v b="$mejor" 'BEGIN{exit !(a<b)}' && mejor="$t"
  done
  printf "   %-46s %9s ms\n" "$nombre" "$mejor"
}

corrida() {
  echo
  echo "── $1 ──"
  medir "listado SIN CTE · página 1"          "$(sin_cte 0)"
  medir "listado SIN CTE · última página"     "$(sin_cte $ULTIMA)"
  medir "listado CON CTE · página 1"          "$(con_cte 0)"
  medir "listado CON CTE · última página"     "$(con_cte $ULTIMA)"
  medir "listado CON CTE · última + rol=inquilino" \
    "$(con_cte $ULTIMA "AND p.id IN (SELECT persona_id FROM contrato_parte WHERE rol = 'locatario')")"
  medir "listado CON CTE · última + rol=garante" \
    "$(con_cte $ULTIMA "AND p.id IN (SELECT persona_id FROM contrato_parte WHERE rol IN ('garante','fiador') UNION SELECT persona_id FROM garantia WHERE persona_id IS NOT NULL)")"
  medir "conteos · LEFT JOIN de DISTINCT"     "$CONTEOS"
  medir "conteos · EXISTS correlacionado"     "$CONTEOS_EXISTS"
}

echo
echo "→ Midiendo (mejor de tres corridas)…"
corrida "SIN los índices de la 025"

# Se recrean con OTRO nombre para poder medir las dos situaciones aunque la 025
# ya esté aplicada: lo que se mide es el efecto de tener el índice, y un índice
# duplicado no cambia el plan. Ver el aviso del encabezado sobre el trap.
psql -q -c "DROP INDEX IF EXISTS ix_oportunidad_persona;
            DROP INDEX IF EXISTS ix_reserva_persona;
            DROP INDEX IF EXISTS ix_venta_comprador;
            DROP INDEX IF EXISTS ix_parte_rol_persona;" 2>/dev/null || true

corrida "SIN índices (los de la 025 dropeados de verdad)"

psql -q <<'SQL'
CREATE INDEX IF NOT EXISTS ix_oportunidad_persona ON oportunidad (persona_id);
CREATE INDEX IF NOT EXISTS ix_reserva_persona ON reserva (persona_id) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS ix_venta_comprador ON operacion_venta (comprador_id) WHERE comprador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_parte_rol_persona ON contrato_parte (rol, persona_id);
ANALYZE oportunidad; ANALYZE reserva; ANALYZE operacion_venta; ANALYZE contrato_parte;
SQL

corrida "CON los índices de la 025"

echo
echo "→ Listo. El tenant de medición se borra solo; los índices de la 025 quedan."
