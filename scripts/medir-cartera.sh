#!/usr/bin/env bash
#
# Mide las consultas pesadas contra una cartera del tamaño que se vende.
#
# Existe porque "esto va a andar lento con 500 propiedades" es una hipótesis, y
# optimizar sobre una hipótesis es el error #4 del playbook con otra cara. Esto
# carga los datos, mide, y borra lo que cargó.
#
#   ./scripts/medir-cartera.sh [cantidad_de_contratos]
#
# El tenant de medición se borra al final; el CASCADE se lleva todo.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

N="${1:-500}"
TENANT='c0a0c0a0-0000-4000-8000-00000000beef'

psql() { docker compose exec -T db psql -U "$DB_OWNER_USER" -d "$DB_NAME" "$@"; }
psql_app() { docker compose exec -T db psql -U "$DB_APP_USER" -d "$DB_NAME" "$@"; }

limpiar() {
  psql -tAq -c "DELETE FROM tenant WHERE id = '$TENANT'" >/dev/null 2>&1 || true
}
trap limpiar EXIT

echo "→ Cargando $N contratos con 24 cuotas cada uno…"
limpiar

psql -q <<SQL
BEGIN;
-- El trigger de límite de plan usa app_current_tenant(): sin contexto da tope 0.
SELECT set_config('app.current_tenant_id', '$TENANT', true);

INSERT INTO tenant (id, nombre, provincia) VALUES ('$TENANT', 'MEDICION', 'Mendoza');
INSERT INTO suscripcion (tenant_id, plan_codigo, estado) VALUES ('$TENANT', 'pro', 'activa');

INSERT INTO propiedad (tenant_id, codigo, calle, numero, localidad, provincia, tipo)
SELECT '$TENANT', 90000 + i, 'Calle ' || i, (i * 7)::text,
       (ARRAY['Ciudad','Godoy Cruz','Guaymallén','Maipú','Luján'])[1 + i % 5],
       'Mendoza', (ARRAY['departamento','casa','local','ph'])[1 + i % 4]
  FROM generate_series(1, $N) AS i;

INSERT INTO persona (tenant_id, nombre, apellido)
SELECT '$TENANT', 'Nombre' || i, 'Apellido' || i FROM generate_series(1, $((N * 2))) AS i;

INSERT INTO contrato_alquiler (
  tenant_id, propiedad_id, fecha_inicio, fecha_fin, dia_vencimiento,
  monto_inicial, moneda, indice, periodicidad_meses, mes_base,
  honorarios_pct, punitorio_diario_pct, estado)
SELECT '$TENANT', p.id, current_date - interval '2 years', current_date + interval '1 year',
       10, 300000 + (p.codigo % 40) * 10000,
       CASE WHEN p.codigo % 7 = 0 THEN 'USD' ELSE 'ARS' END,
       (ARRAY['ipc','icl','uva','ninguno'])[1 + p.codigo % 4],
       3, date_trunc('month', current_date - interval '2 years')::date,
       8, 0.1, 'vigente'
  FROM propiedad p WHERE p.tenant_id = '$TENANT';

INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol, porcentaje)
SELECT '$TENANT', c.id, pe.id, 'locador', 100
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM contrato_alquiler
         WHERE tenant_id = '$TENANT') c
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM persona
         WHERE tenant_id = '$TENANT' LIMIT $N) pe ON pe.n = c.n;

INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol, porcentaje)
SELECT '$TENANT', c.id, pe.id, 'locatario', NULL
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM contrato_alquiler
         WHERE tenant_id = '$TENANT') c
  JOIN (SELECT id, row_number() OVER (ORDER BY id) - $N AS n FROM persona
         WHERE tenant_id = '$TENANT' OFFSET $N) pe ON pe.n = c.n;

-- 24 meses de historia: es lo que hace pesados los agregados de la cartera.
INSERT INTO periodo_alquiler (tenant_id, contrato_id, periodo, vence_el,
                              monto_alquiler, expensas, otros, total, moneda, estado)
SELECT c.tenant_id, c.id,
       (date_trunc('month', current_date) - (m || ' months')::interval)::date,
       (date_trunc('month', current_date) - (m || ' months')::interval)::date + 9,
       c.monto_inicial, 0, 0, c.monto_inicial, c.moneda,
       CASE WHEN m % 4 = 0 THEN 'pendiente' ELSE 'pagado' END
  FROM contrato_alquiler c, generate_series(0, 23) AS m
 WHERE c.tenant_id = '$TENANT';

INSERT INTO cobro (tenant_id, periodo_id, monto, moneda, fecha, medio, imputacion)
SELECT p.tenant_id, p.id, p.total, p.moneda, p.vence_el, 'transferencia', 'alquiler'
  FROM periodo_alquiler p WHERE p.tenant_id = '$TENANT' AND p.estado = 'pagado';
COMMIT;

ANALYZE propiedad; ANALYZE contrato_alquiler; ANALYZE contrato_parte;
ANALYZE periodo_alquiler; ANALYZE cobro;
SQL

psql -tAc "SELECT 'contratos: ' || (SELECT count(*) FROM contrato_alquiler WHERE tenant_id='$TENANT')
        || ' · cuotas: ' || (SELECT count(*) FROM periodo_alquiler WHERE tenant_id='$TENANT')
        || ' · cobros: ' || (SELECT count(*) FROM cobro WHERE tenant_id='$TENANT')"

echo
echo "→ Midiendo (tres corridas, la primera calienta cachés)…"

medir() {
  local nombre="$1" sql="$2"
  local mejor=""
  for _ in 1 2 3; do
    local t
    t=$(psql_app -tAq \
          -c "SET app.current_tenant_id = '$TENANT';" \
          -c "EXPLAIN (ANALYZE, TIMING) $sql" 2>&1 |
        grep -oE 'Execution Time: [0-9.]+' | grep -oE '[0-9.]+')
    mejor="$t"
  done
  printf "   %-34s %8s ms\n" "$nombre" "$mejor"
}

medir "cartera (página de 50)" "$(cat <<'Q'
WITH cuotas AS (
  SELECT p.id, p.contrato_id, p.periodo, p.vence_el, p.total, p.moneda, p.estado,
         coalesce(co.pagado, 0) AS pagado, p.total - coalesce(co.pagado, 0) AS saldo
    FROM periodo_alquiler p
    LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) co
      ON co.periodo_id = p.id),
resumen AS (
  SELECT contrato_id, count(*) AS cuotas,
         coalesce(sum(saldo) FILTER (WHERE saldo > 0), 0) AS adeudado,
         count(*) FILTER (WHERE vence_el < current_date AND saldo > 0) AS en_mora
    FROM cuotas GROUP BY contrato_id),
ultima AS (
  SELECT DISTINCT ON (contrato_id) contrato_id, id, saldo FROM cuotas
   ORDER BY contrato_id, periodo DESC)
SELECT c.id, coalesce(r.adeudado,0), u.id
  FROM contrato_alquiler c
  JOIN propiedad pr ON pr.id = c.propiedad_id
  LEFT JOIN resumen r ON r.contrato_id = c.id
  LEFT JOIN ultima u ON u.contrato_id = c.id
 ORDER BY (r.en_mora > 0) DESC, c.fecha_fin LIMIT 50
Q
)"

medir "inicio · por cobrar del mes" "$(cat <<'Q'
SELECT p.moneda, sum(p.total - coalesce(c.pagado,0))
  FROM periodo_alquiler p
  LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) c
    ON c.periodo_id = p.id
 WHERE p.periodo = date_trunc('month', current_date)
   AND p.estado IN ('pendiente','parcial','vencido')
 GROUP BY p.moneda
Q
)"

medir "inicio · cuotas impagas" "$(cat <<'Q'
SELECT count(*), p.moneda, sum(p.total - coalesce(c.pagado,0))
  FROM periodo_alquiler p
  JOIN contrato_alquiler ca ON ca.id = p.contrato_id
  JOIN propiedad pr ON pr.id = ca.propiedad_id
  LEFT JOIN (SELECT periodo_id, sum(monto) AS pagado FROM cobro GROUP BY periodo_id) c
    ON c.periodo_id = p.id
 WHERE p.estado IN ('pendiente','parcial','vencido')
   AND p.vence_el < current_date
   AND p.total - coalesce(c.pagado,0) > 0
 GROUP BY p.moneda
Q
)"

medir "vencimientos (90 días)" "$(cat <<'Q'
SELECT count(*) FROM (
  SELECT c.id FROM contrato_alquiler c JOIN propiedad pr ON pr.id = c.propiedad_id
   WHERE c.estado = 'vigente' AND c.fecha_fin BETWEEN current_date AND current_date + 90
  UNION ALL
  SELECT p.id FROM periodo_alquiler p
   JOIN contrato_alquiler c ON c.id = p.contrato_id
   WHERE p.estado IN ('pendiente','parcial','vencido') AND p.vence_el <= current_date + 90
) v
Q
)"

echo
echo "→ Listo. El tenant de medición se borra solo."
