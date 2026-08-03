# Bemo INMO — spec técnico

> Estado: **v0.1, borrador de arranque.** Escrito antes de la primera línea de código.
> Los supuestos marcados con ⚠️ están sin confirmar y hay que cerrarlos antes de la etapa 3.

---

## 1. Qué es y para quién

Sistema de gestión para inmobiliarias argentinas que operan **venta y alquiler a la vez**.
Multi-tenant: cada inmobiliaria ve exclusivamente sus datos.

Es la vertical inmobiliaria del grupo **BEMO**. Comparte fundaciones de código con Bemo MED
(`@bemo/ui`, `@bemo/auth`, `@bemo/api-core`, `@bemo/testing`) y **no comparte nada en
runtime**: base propia, deploy propio, dominio propio. Ver `suite.md`.

**Usuario primario**: el administrador de la inmobiliaria — la persona que hoy tiene el
Excel de vencimientos y arma las liquidaciones a fin de mes.
**Usuario secundario**: el asesor/agente que carga propiedades y atiende consultas.
**Usuario terciario**: el titular, que quiere ver números y no operar.

### Qué NO es (v1)
- No es un portal público de búsqueda de propiedades.
- No es un sistema contable ni emite facturas electrónicas por sí mismo. ⚠️ Integración
  con ARCA queda fuera de v1; se exporta para el contador.
- No procesa pagos. Registra cobros hechos por otros medios.
- No es un firmador digital de contratos. Genera el documento; la firma es afuera.

---

## 2. La tesis del producto

El corte que hace posible construir venta y alquiler en paralelo sin terminar con dos
mitades: **la venta termina, el alquiler empieza.**

Todo lo previo al cierre es el mismo producto para las dos operaciones — misma ficha,
mismo contacto, mismo circuito de lead → visita → reserva. Recién en el cierre divergen:
la venta se liquida y se archiva; el alquiler enciende un motor que corre por años.

```
                    ESPINA COMPARTIDA (~70% del sistema)
  persona ──┐
            ├── propiedad ── operación ── oportunidad ── visita ── reserva ──┐
  ubicación─┘       │                                                       │
                 titularidad                                                │
                                        ┌───────────────────────────────────┴──┐
                                        │                                      │
                         VENTA (termina)                        ALQUILER (empieza)
                         boleto → escritura                     contrato → ciclo mensual
                         → comisión por punta → FIN             → índice → ajuste
                                                                → cuota → cobro
                                                                → liquidación → repetir
```

**Tres reglas estructurales**, fijadas ahora porque después son migraciones dolorosas:

1. **`persona` con roles contextuales, no tablas por tipo.** El propietario que alquila un
   departamento es la misma persona que compra otro y que es garante de un tercero. Tablas
   `inquilinos` y `compradores` separadas duplican el dato y pierden la historia.
2. **Una propiedad puede estar en venta y en alquiler simultáneamente**, con precios y
   estados independientes. `propiedad.tipo_operacion` como campo único es el error clásico
   y obliga a cargar la propiedad dos veces.
3. **Un contrato de alquiler no es un registro, es un motor.** Es la única entidad del
   sistema que genera eventos hacia adelante en el tiempo sin que nadie la toque.

---

## 3. Stack y decisiones técnicas

| Capa | Elección |
|---|---|
| Frontend | Vue 3 + Vite + Pinia + Vue Router + TypeScript |
| Backend | NestJS (TypeScript) |
| Base | PostgreSQL 16 con Row Level Security |
| Migraciones | SQL plano versionado, auto-run en dev, **las mismas en dev, test y producción** |
| Tests | Jest + Supertest contra Postgres real |
| Dev | Docker Compose: `db` + `api` + `web`, con healthchecks. **Node 20 en los contenedores** |
| Archivos | S3-compatible (fotos de propiedades, PDFs de contratos) |

Producto independiente: no comparte código, base ni runtime con Bemo MED. Ver `suite.md`.

**Node 20, no la última.** Node 26 inyecta un `localStorage` experimental que pisa el de
jsdom y rompe la suite de tests del frontend con errores que no son bugs reales. Los
contenedores fijan Node 20 y el problema no existe.

**Nombres del producto dentro de BEMO** (ver `suite.md`): repo `bemo-inmo`, base
`bemo_inmo`, rol de aplicación `inmo_app`, dominio `inmo.bemo.<tld>`. El refresh token se
setea en el subdominio exacto, **nunca** en el dominio padre.

### Multi-tenant: RLS desde la primera migración

La app se conecta con un rol **restringido** (no owner). Cada transacción fija el tenant
antes de tocar una tabla. Las policies filtran por ahí. Los guards de aplicación son
defensa en profundidad, no la única línea.

**La parte que no es obvia**: `SET LOCAL` no acepta bind parameters, así que interpolar el
tenant ahí es una inyección esperando pasar. Se usa `set_config` con el tercer argumento en
`true`, que es el equivalente transaccional y sí acepta parámetro:

```ts
await client.query('BEGIN');
await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
// ... todo el trabajo del request, sobre este mismo client
await client.query('COMMIT');
```

Dos invariantes que se testean, no se asumen:
- **Toda request que toca datos de tenant corre dentro de una transacción.** Sin
  transacción, `set_config(..., true)` no tiene alcance y la policy ve un tenant vacío.
- **El pool devuelve conexiones limpias.** `set_config` transaccional se revierte solo al
  cerrar la tx; si alguien lo hace con `false`, el valor sobrevive en la conexión y el
  próximo request hereda el tenant del anterior. Es la peor fuga posible y es silenciosa.

```sql
ALTER TABLE contrato_alquiler ENABLE ROW LEVEL SECURITY;
CREATE POLICY contrato_tenant ON contrato_alquiler
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON contrato_alquiler TO app_role;
```

Signup, login y webhooks ocurren **sin** contexto de tenant: van por funciones
`SECURITY DEFINER` acotadas.

**Excepción**: `indice_valor` es dato público (IPC de INDEC, ICL/UVA del BCRA). No lleva
`tenant_id` y es de sólo lectura para `app_role`.

### Contrato de error único (RFC 9457)

Toda excepción sale con la misma forma y un **código estable** que el front puede leer. El
`code` es lo único que el front usa para decidir; el `detail` es para mostrar:

```json
{ "type": "about:blank", "title": "Conflict", "status": 409,
  "detail": "La propiedad ya tiene un contrato vigente en ese período",
  "code": "PROPERTY_LEASE_OVERLAP", "instance": "/v1/contratos" }
```

### Reglas de negocio en la base, no en el código

Ningún chequeo de aplicación sobrevive a dos requests simultáneos.

```sql
-- Una propiedad no puede tener dos contratos vigentes solapados
ALTER TABLE contrato_alquiler ADD CONSTRAINT contrato_sin_solape
  EXCLUDE USING gist (
    propiedad_id WITH =,
    daterange(fecha_inicio, fecha_fin, '[]') WITH &&
  ) WHERE (estado IN ('vigente', 'por_iniciar'));

-- Una operación no puede tener dos reservas activas
CREATE UNIQUE INDEX reserva_activa_unica ON reserva (operacion_id)
  WHERE estado = 'activa';
```

Con constraints de exclusión: **serializar con `pg_advisory_xact_lock`** antes de tocarlos,
y reintentar `40001` / `40P01` en la capa de transacción. Con varias transacciones
esperándose el grafo puede ciclar y Postgres mata una con deadlock — que el cliente ve como
un 500.

### Seguridad

- **Validación de entorno al arrancar**: falta un secreto, la app no levanta. Nunca un
  default inseguro.
- Refresh token en cookie httpOnly (`SameSite=Lax`), jamás en localStorage, y seteada en el
  subdominio exacto — nunca en `.bemo.<tld>`.
- Rotación de refresh tokens con detección de reuso → se revocan todas las sesiones del usuario.
- `forbidNonWhitelisted`: un cliente que manda `rol: "owner"` se entera, y nosotros también.
- helmet, límite explícito de body, docs cerrados en producción.
- Los 500 se registran. Un error que sólo se serializa al cliente es un error invisible.
- **Auditoría append-only** de todo acceso y modificación sobre plata y contratos, incluidas
  las denegaciones. `app_role` tiene INSERT y SELECT, no UPDATE ni DELETE.

---

## 4. Modelo de datos

Todas las tablas llevan `id uuid`, `tenant_id uuid`, `created_at`, `updated_at`,
salvo donde se indique.

### 4.1 Tenancy e identidad

```
tenant              nombre, cuit, provincia, moneda_default, config jsonb
sucursal            tenant_id, nombre, direccion
usuario             email (único global), password_hash, nombre, estado
membresia           usuario_id, tenant_id, rol, sucursal_id?, estado
sesion              usuario_id, refresh_token_hash, familia, usado_en, revocado_en
```

**Roles**: `owner` · `admin` · `agente` · `contable`
(matriz completa en §5)

### 4.2 Espina compartida

```
persona             tipo (fisica|juridica), nombre, apellido, razon_social,
                    doc_tipo, doc_numero, cuit, email, telefono, notas
                    UNIQUE (tenant_id, doc_tipo, doc_numero)

persona_rol         persona_id, rol, entidad_tipo, entidad_id
                    rol ∈ propietario | inquilino | comprador | vendedor
                          | garante | interesado | referente

propiedad           codigo (correlativo por tenant), direccion_calle, numero, piso, depto,
                    localidad, provincia, cp, lat, lng, geocode_source, geocode_at,
                    tipo (departamento|casa|ph|local|oficina|galpon|terreno|cochera|campo),
                    sup_total, sup_cubierta, ambientes, dormitorios, banos, cocheras,
                    antiguedad, orientacion, estado_conservacion, amenities text[],
                    descripcion, notas_internas, sucursal_id?, agente_captador_id

titularidad         propiedad_id, persona_id, porcentaje numeric(5,2)
                    -- condominio: dos hermanos al 50% es lo normal
                    CHECK: suma por propiedad = 100

operacion           propiedad_id, tipo (venta|alquiler|alquiler_temporario),
                    precio, moneda (ARS|USD), expensas, expensas_moneda,
                    estado (borrador|disponible|reservada|cerrada|suspendida),
                    fecha_publicacion, exclusividad_hasta, comision_config jsonb
                    -- una propiedad puede tener venta Y alquiler activas a la vez

propiedad_foto      propiedad_id, url, orden, es_portada
propiedad_doc       propiedad_id, tipo (escritura|plano|reglamento|tasacion|otro), url

oportunidad         persona_id, operacion_id?, origen (portal|web|whatsapp|telefono|
                    referido|cartel|redes), portal_origen?, agente_id,
                    estado (nueva|contactada|calificada|visita|negociacion|ganada|perdida),
                    motivo_perdida?, presupuesto_min, presupuesto_max, moneda, notas
                    -- operacion_id nullable: alguien puede buscar sin una propiedad puntual

visita              oportunidad_id, operacion_id, fecha_hora, agente_id,
                    estado (agendada|realizada|cancelada|ausente), feedback

reserva             operacion_id, persona_id, monto, moneda, fecha,
                    vence_el, estado (activa|convertida|caida|vencida), notas
```

### 4.3 Alquileres — el motor

```
contrato_alquiler   propiedad_id, operacion_id?,
                    fecha_inicio, fecha_fin, dia_vencimiento smallint,
                    monto_inicial, moneda,
                    indice (ipc|icl|icp|uva|usd_oficial|porcentaje_fijo|ninguno),
                    indice_porcentaje?,          -- si indice = porcentaje_fijo
                    periodicidad_meses smallint, -- 3, 4, 6, 12...
                    mes_base date,               -- desde qué período se mide el índice
                    administrado boolean,        -- ⚠️ decide si corre el ciclo mensual
                    deposito, deposito_moneda, deposito_devuelto_el,
                    honorarios_config jsonb,     -- % al propietario, % al inquilino
                    punitorio_diario numeric,
                    estado (borrador|por_iniciar|vigente|por_vencer|vencido|rescindido|renovado),
                    contrato_anterior_id?,       -- cadena de renovaciones
                    doc_url

contrato_parte      contrato_id, persona_id, rol (locador|locatario|garante|fiador),
                    porcentaje?  -- para locadores en condominio

garantia            contrato_id, tipo (propietaria|recibo_sueldo|seguro_caucion|
                    garante_solidario|deposito_ampliado), detalle jsonb, doc_url

indice_valor        -- GLOBAL, sin tenant_id, sólo lectura para app_role
                    tipo (ipc|icl|icp|uva), periodo date, valor numeric(18,6),
                    fuente, publicado_el, fetched_at
                    UNIQUE (tipo, periodo)

contrato_ajuste     contrato_id, periodo_desde, periodo_hasta,
                    indice_tipo, valor_base, valor_actual, coeficiente numeric(12,6),
                    monto_anterior, monto_nuevo, moneda,
                    memoria jsonb,   -- la explicación completa, congelada
                    estado (proyectado|confirmado|notificado|aplicado),
                    confirmado_por, confirmado_el, notificado_el
                    -- INMUTABLE una vez confirmado. Si INDEC revisa el IPC, este
                    -- registro NO se recalcula.

periodo_alquiler    contrato_id, periodo date, vence_el,
                    monto_alquiler, expensas, otros jsonb, total, moneda,
                    estado (pendiente|parcial|pagado|vencido|condonado),
                    punitorios_calculados
                    UNIQUE (contrato_id, periodo)

cobro               periodo_id, monto, moneda, fecha, medio (efectivo|transferencia|
                    cheque|debito), comprobante, registrado_por

liquidacion         propietario_id, periodo date, sucursal_id?,
                    total_bruto, total_honorarios, total_gastos, total_neto, moneda,
                    estado (borrador|cerrada|pagada), cerrada_el, pagada_el, doc_url

liquidacion_linea   liquidacion_id, contrato_id?, concepto,
                    tipo (alquiler|honorarios|expensas|reparacion|impuesto|ajuste|otro),
                    monto, signo, detalle jsonb
```

### 4.4 Ventas — el cierre

```
operacion_venta     operacion_id, comprador_persona_id, precio_cierre, moneda,
                    fecha_reserva, fecha_boleto, fecha_escritura,
                    escribania, estado (en_curso|boleto|escriturada|caida),
                    doc_boleto_url

comision            operacion_id, operacion_venta_id?, contrato_id?,
                    punta (compradora|vendedora|locataria|locadora),
                    base_monto, base_moneda, porcentaje, monto,
                    beneficiario_tipo (casa|agente|inmobiliaria_externa),
                    beneficiario_id?, inmobiliaria_externa_nombre?,
                    estado (proyectada|devengada|cobrada), cobrada_el
```

**La calculadora de comisiones tiene tres niveles encadenados**, y confundirlos es lo que
hace que estas cuentas den mal:

1. **Cuánto cobra la operación** — honorarios a cada punta. Varía por provincia, por tipo
   de operación y por si el contrato es residencial o comercial. ⚠️ Los porcentajes por
   defecto se cargan como configuración por tenant, no hardcodeados.
2. **Cómo se reparte entre inmobiliarias** — cuando hay una de cada lado. Típico 50/50, se
   negocia caso por caso.
3. **Cómo se reparte puertas adentro** — % del captador, % del que cerró, y lo que queda
   para la casa. Este es el que nadie tiene sistematizado y el que genera discusiones todos
   los meses.

### 4.5 Transversales

```
plantilla_doc       tipo (pre_contrato_alquiler|pre_contrato_venta|reserva|
                    aviso_aumento|aviso_vencimiento|recibo|liquidacion),
                    nombre, contenido, variables jsonb, activa

documento_generado  plantilla_id, entidad_tipo, entidad_id, url, generado_por

evento_programado   tipo, entidad_tipo, entidad_id, dispara_el, canal (app|email|whatsapp),
                    destinatario_persona_id?, estado (pendiente|enviado|fallido|cancelado),
                    intentos, ultimo_error, payload jsonb

publicacion         operacion_id, portal, estado (borrador|publicada|pausada|error),
                    external_id, url_publica, ultimo_sync, ultimo_error

auditoria           -- append-only, sin UPDATE ni DELETE para app_role
                    usuario_id, accion, entidad_tipo, entidad_id,
                    resultado (permitido|denegado), ip, user_agent, diff jsonb
```

---

## 5. Matriz de permisos

Table-driven en los tests: cada rol × cada endpoint, incluido "sin token". Agregar una fila
cuando se agrega un endpoint es más barato que enterarse en producción.

| Recurso | owner | admin | agente | contable | sin token |
|---|---|---|---|---|---|
| Propiedades — leer | ✓ | ✓ | ✓ | ✓ | ✗ |
| Propiedades — crear/editar | ✓ | ✓ | ✓ (propias) | ✗ | ✗ |
| Propiedades — borrar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Personas — leer | ✓ | ✓ | ✓ | ✓ | ✗ |
| Personas — crear/editar | ✓ | ✓ | ✓ | ✗ | ✗ |
| Oportunidades — leer | ✓ | ✓ | ✓ (asignadas) | ✗ | ✗ |
| Oportunidades — reasignar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Contratos — leer | ✓ | ✓ | ✓ (sin montos) | ✓ | ✗ |
| Contratos — crear/editar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Ajustes — confirmar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cobros — registrar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Liquidaciones — ver | ✓ | ✓ | ✗ | ✓ | ✗ |
| Liquidaciones — cerrar | ✓ | ✓ | ✗ | ✗ | ✗ |
| Comisiones — ver todas | ✓ | ✓ | ✗ | ✓ | ✗ |
| Comisiones — ver propias | ✓ | ✓ | ✓ | ✓ | ✗ |
| Publicaciones — publicar | ✓ | ✓ | ✓ | ✗ | ✗ |
| Usuarios y roles | ✓ | ✗ | ✗ | ✗ | ✗ |
| Configuración del tenant | ✓ | ✗ | ✗ | ✗ | ✗ |
| Auditoría | ✓ | ✗ | ✗ | ✗ | ✗ |

⚠️ "agente ve contratos sin montos" hay que confirmarlo: en inmobiliarias chicas el mismo
agente hace todo y esta restricción molesta más de lo que protege.

---

## 6. Reglas de negocio críticas

### R1 — Cálculo de ajuste por índice

```
coeficiente = valor_indice(periodo_actual) / valor_indice(periodo_base)
monto_nuevo = monto_vigente × coeficiente
```

- El `periodo_base` es el mes del último ajuste (o `mes_base` si es el primero).
- El `periodo_actual` es el mes con el último índice **publicado** al momento de calcular,
  respetando el desfase de publicación (el IPC de un mes sale a mediados del siguiente).
- Si el índice del período todavía no se publicó, el ajuste queda `proyectado` con el
  último disponible y la UI lo marca como estimado. **Nunca se notifica un proyectado.**
- Al confirmar, se congela `memoria` con todos los valores usados. Ese registro no se
  vuelve a tocar.
- ⚠️ Redondeo: a definir con el usuario. Propuesta: redondear el monto final a la centena
  de pesos más cercana, configurable por tenant, y que la memoria lo diga explícitamente.

### R2 — Generación de períodos

Un contrato `administrado` y `vigente` genera un `periodo_alquiler` por mes, con el monto
que corresponda según el último ajuste `aplicado`. Es idempotente por `(contrato, periodo)`.

### R3 — Liquidación al propietario

```
neto = Σ cobros del período por sus contratos
     − honorarios de la inmobiliaria
     − gastos adelantados (reparaciones, impuestos)
     ± ajustes manuales
```

En condominio, el neto se reparte por `titularidad.porcentaje` y sale **una liquidación por
propietario**. Una liquidación `cerrada` no se modifica: se emite una nota de ajuste en el
período siguiente.

### R4 — Un contrato vigente por propiedad y período

Constraint `EXCLUDE` (§3). No un `SELECT` previo.

### R5 — Bordes de zona horaria

Un vencimiento del día 5 es el día 5 **en `America/Argentina/Buenos_Aires`**, no en UTC.
Los cálculos de "faltan N días" se hacen contra la fecha local del tenant.

### R6 — Geocodificación

Se geocodifica **una vez** al guardar la dirección y se persisten `lat`, `lng`,
`geocode_source` y `geocode_at`. Listados y tarjetas usan Static Maps; el mapa interactivo
se carga sólo cuando el usuario lo pide. Google Maps se cobra por carga.

---

## 7. Integraciones externas y su riesgo

| Integración | Riesgo | Mitigación |
|---|---|---|
| **Índices** (INDEC IPC, BCRA ICL/UVA) | Bajo. Fuentes públicas, formatos que cambian poco. | Job diario + carga manual de respaldo. Si falla el scrape, el sistema avisa; no inventa un valor. |
| **Google Maps** | Bajo técnico, **medio de costo**. | Geocodificar una vez, Static Maps en listados, interactivo bajo demanda. Alertas de consumo. |
| **Portales** (Zonaprop, Argenprop, MercadoLibre, Properati) | **Alto y no técnico.** Requiere convenio comercial como CRM tercero. Puede tardar meses y no depende del código. | Plan A: feed XML propio + API donde exista. **Plan B obligatorio**: el sistema arma el aviso completo (texto, fotos ordenadas, atributos) y el usuario lo pega. Nunca bloquear el roadmap esperando un convenio. |
| **WhatsApp Business Cloud API** | Medio. Requiere verificación de negocio y plantillas aprobadas. | Empezar por email + notificación in-app. WhatsApp entra en etapa 7. |
| **Meta Marketing API** | **Alto.** App Review + Business Verification + `ads_management`. Semanas de trámite. | Va a Pro y a la etapa 9. No condiciona nada anterior. |
| **ARCA / facturación** | Medio. | Fuera de v1. Se exporta para el contador. |

---

## 8. Catálogo de capacidades y planes

Cada capacidad lleva `status: 'available' | 'soon'` en el catálogo. La UI muestra "En
desarrollo" en vez de un ✓ hasta que efectivamente exista. Cuando se termina, se cambia el
estado y la pantalla de precios se actualiza sola.

Los planes se separan de forma **híbrida**: cada uno suma módulos *y* sube el tope de
usuarios y propiedades.

| Capacidad | Inicial | Medio | Pro | A medida |
|---|---|---|---|---|
| Usuarios incluidos | 3 | 10 | ilimitados | ilimitados |
| Propiedades en cartera | 100 | 500 | ilimitadas | ilimitadas |
| Fichas + fotos + ubicación en mapa | ✓ | ✓ | ✓ | ✓ |
| Personas y roles | ✓ | ✓ | ✓ | ✓ |
| Oportunidades y visitas | ✓ | ✓ | ✓ | ✓ |
| Contratos y vencimientos | ✓ | ✓ | ✓ | ✓ |
| Ajustes automáticos por índice | ✓ | ✓ | ✓ | ✓ |
| Cobranzas y períodos | — | ✓ | ✓ | ✓ |
| Liquidación a propietarios | — | ✓ | ✓ | ✓ |
| Pre-contratos y plantillas | — | ✓ | ✓ | ✓ |
| Comisiones por punta (3 niveles) | básico | ✓ | ✓ | ✓ |
| Publicación a portales | 1 | 3 | todos | todos |
| Recordatorios por WhatsApp | — | ✓ | ✓ | ✓ |
| Campañas Meta | — | — | ✓ | ✓ |
| Multi-sucursal | — | — | ✓ | ✓ |
| Reportes y export | básico | ✓ | ✓ | ✓ |
| API pública | — | — | ✓ | ✓ |
| Onboarding, migración, marca blanca | — | — | — | ✓ |

**Precios: sin definir a propósito.** El gate de la etapa 0 es que alguien diga un número
concreto. Ponerlos ahora sería inventarlos.

---

## 9. Criterios de aceptación por etapa

Ver `roadmap.md` para el detalle. Los cuatro tests que encuentran bugs de verdad:

1. **Matriz de permisos table-driven** — cada rol × cada endpoint, incluido sin token.
2. **Aislamiento entre inmobiliarias** — dos tenants sembrados, cero fuga en todos los
   list/get, y un update cruzado da 404, no un 200 vacío.
3. **Concurrencia** — N requests en paralelo creando contratos solapados: exactamente un
   éxito, ningún 5xx.
4. **Bordes de zona horaria** — un vencimiento del día 5 cae el día 5 para el usuario, no
   para el servidor.

Más uno específico de este dominio:

5. **Cuadre contra la realidad** — tres liquidaciones reales del mes pasado, calculadas por
   el sistema, coinciden **al peso** con las que la inmobiliaria hizo a mano.

---

## 10. Supuestos abiertos ⚠️

Cerrar antes de la etapa indicada.

| # | Supuesto | Impacto si está mal | Cerrar antes de |
|---|---|---|---|
| A1 | Alquileres mixtos: unos administrados, otros sólo intermediados | Si todos son intermediados, sobra medio módulo de cobranzas | Etapa 4 |
| A2 | Sistema actual es una mezcla (CRM + Excel + WhatsApp) | Si es Tokko, la vara de comparación y la migración suben mucho | Etapa 3 |
| A3 | Escala 100-500 propiedades | Si es 500+, cambia el diseño de listados y liquidación masiva | Etapa 3 |
| A4 | Primer corte vertical: vencimientos y aumentos | Cambia el orden de las etapas 4 y 5, no la arquitectura | Etapa 3 |
| A5 | Porcentajes de honorarios configurables por tenant, no fijos por ley | Si hay topes legales por provincia, hay que validarlos server-side | Etapa 5 |
| A6 | Redondeo del ajuste a la centena, configurable | Diferencias de pesos en cada aviso de aumento | Etapa 4 |
| A7 | El agente no ve montos de contratos | En inmobiliarias chicas puede molestar más de lo que protege | Etapa 4 |
| A8 | No se emite factura electrónica en v1 | Si el usuario la necesita, entra ARCA y es un módulo entero | Etapa 6 |
