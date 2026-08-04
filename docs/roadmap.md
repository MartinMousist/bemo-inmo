# Bemo INMO — roadmap

Etapas con **gates**. No se pasa a la siguiente sin cumplir el criterio de salida.
Las de negocio son tan obligatorias como las técnicas.

**Si el gate es un test y no hay test, el gate no está cerrado — sólo se escribió código.**

---

## Etapa 0 — Validación

**Qué**: confirmar que hay demanda con un número, no con entusiasmo.

- [ ] Fecha comprometida en la que la inmobiliaria propia corta con el sistema actual
- [ ] Tres liquidaciones y tres contratos reales exportados, que van a servir de banco de pruebas
- [ ] Dos inmobiliarias externas entrevistadas que dijeron **un precio concreto**
- [ ] Escrito: qué hacen hoy a mano, cuántas horas por mes les cuesta

**Gate**: alguien dice "sí, lo pago" con un precio concreto.
**Desbloquea**: todo. Sin esto se está construyendo a ciegas.
**Riesgo si se saltea**: el error #1 de la lista del playbook. Se construyen cinco etapas
sobre una hipótesis sin verificar.

---

## Etapa 1 — Fundaciones ✅ CERRADA (2026-08-03)

**Qué**: el esqueleto del proyecto.

- [x] Docker Compose: `db` (Postgres 16) + `api` (NestJS) + `web` (Vite), con healthchecks
- [x] Migraciones SQL versionadas con auto-run en dev, las mismas en test y producción
- [x] Rol de base restringido + `app_current_tenant()` + RLS en la primera migración
- [x] Contexto de tenant vía `set_config(..., true)` + test de que el pool no filtra el
      tenant entre requests
- [x] Seed de datos demo (dos inmobiliarias ficticias — hacen falta dos para probar el aislamiento)
- [x] Contrato de error RFC 9457 + prefijo `/v1` + validación de entorno al arrancar
- [x] Jest + Supertest contra Postgres real
- [x] gitleaks en pre-commit
- [x] CI en `.github/workflows/ci.yml`: Postgres real, migraciones de producción,
      typecheck de las dos puntas, build del front y gitleaks. **Sin verificar**: no hay
      repo remoto donde correrlo
- [x] Tokens CSS + modo oscuro + script anti-flash en el `<head>`

**Gate**: `docker compose up` levanta todo en menos de 5 minutos, en una máquina limpia.
**Cerrado con**: arranque limpio en **13,8 s**, 10/10 tests contra Postgres real, y RLS
comprobado a mano (owner ve 2 filas, rol de app sin contexto ve 0, con contexto ve 1).
**Esfuerzo real**: 1 sesión.

**Trampa del playbook (error #7)**: los contenedores tienen su propio `node_modules` en un
volumen anónimo. Instalar dependencias sólo en el host no rompe al instalar — rompe al
reiniciar. Se instala **adentro** (`docker compose exec api npm i <paquete>`) o se
reconstruye la imagen.

---

## Etapa 2 — Auth, tenant y aislamiento ✅ CERRADA (2026-08-03)

**Qué**: la capa que define quién ve qué.

- [x] Signup / login / refresh con rotación y detección de reuso
- [x] Refresh token en cookie httpOnly. Renovación automática single-flight
- [x] Guard de rutas con `?next=`. Logout que limpia estado local **primero**
- [x] Membresías y los cuatro roles (`owner`, `admin`, `agente`, `contable`)
- [x] Invitaciones — se genera el enlace; **el envío por correo queda para la etapa 7**,
      junto con el resto de las notificaciones. La UI lo dice.
- [x] Auditoría append-only funcionando, incluidas las denegaciones

**Gate**: cero fuga entre dos inmobiliarias.
**Cerrado con**: 55 tests contra Postgres real, entre ellos la matriz de permisos
table-driven (5 endpoints × 5 identidades) y `test/fuga.spec.ts`. Verificado además con
**dos mutaciones deliberadas**: sacar un `@Roles` hace fallar 3 tests de la matriz, y
sacar un `withTenant` hace fallar el de aislamiento.
**Esfuerzo real**: 1 sesión.

**Dos decisiones que conviene recordar**:
- El guard es **global y default-deny**: una ruta es pública sólo con `@Publico()`. Si
  fuera opt-in, un endpoint nuevo sin decorador quedaría abierto.
- Olvidarse un `withTenant` **rompe la feature, no filtra datos**: sin contexto, las
  policies devuelven cero filas. Verificado con la mutación.

---

## Etapa 3 — La espina compartida ✅ CERRADA (2026-08-03)

**Qué**: personas, propiedades, ubicación y oportunidades. El 70% del sistema que sirve
igual para venta y para alquiler.

- [x] `persona` con roles **derivados** + búsqueda por documento con alta inline
- [x] `propiedad` + `titularidad` (condominio, suma 100% por trigger deferrable)
- [x] `operacion` múltiple: venta y alquiler simultáneos sobre la misma propiedad
- [x] Geocodificación al guardar, persistida. Sin API key no inventa coordenadas
- [x] `oportunidad` → `visita` → `reserva` (una activa por operación, por índice parcial)
- [x] Paginación server-side y búsqueda
- [x] Importador CSV con previsualización que no escribe nada, alias de columna y
      números escritos a mano
- [ ] Fotos de propiedades — **pendiente** (falta el bucket S3)
- [x] Componentes base + `AppShell` + `CommandPalette` (⌘K)

**Gate**: cargar una propiedad real y seguir un lead, sin ayuda.
**Cerrado con**: 105 tests, y uso real en el navegador con tres propiedades y tres
oportunidades cargadas.
**Esfuerzo real**: 1 sesión.

**Cambio respecto del spec**: no existe `persona_rol`. Era polimórfica (entidad_tipo +
entidad_id) y una FK polimórfica no se puede hacer cumplir. Los roles se derivan de las
relaciones reales; un dato derivado no se desincroniza.

**Dos bugs que sólo aparecieron usando la app**:
- Un `PATCH` parcial borraba todos los campos que no venían en el cuerpo. Cargar los
  titulares dejaba la propiedad sin número, sin ambientes y sin metros.
- El CSS *scoped* del padre alcanza al elemento **raíz** del componente hijo: un
  `.velo { display: none }` en `AppShell` (velo del drawer móvil) le pegaba a la raíz de
  `CommandPalette`, y la paleta nunca se veía.

---

## Etapa 4 — Alquileres vivos ⚠️ CONSTRUIDA, GATE ABIERTO (2026-08-03)

**Qué**: el motor. Es la razón de ser del producto.

- [x] `contrato_alquiler` + partes + garantías
- [x] Índices IPC / ICL / UVA / ICP con carga manual y de a lote. **La ingesta
      automática desde INDEC y BCRA queda para la etapa 7**; la manual se queda como
      respaldo permanente
- [x] Motor de ajustes con memoria congelada. Un ajuste confirmado es inmutable por trigger
- [x] Constraint `EXCLUDE` de contratos solapados + advisory lock + reintento de `40001`/`40P01`
- [x] Tablero de vencimientos con semáforo, agrupado por urgencia
- [x] Generación idempotente de períodos
- [x] Cobros, cobros parciales y estado de cuenta por contrato
- [x] Liquidación al propietario, con reparto por condominio
- [ ] Avisos de aumento y de vencimiento — **etapa 7**, con el resto de las notificaciones

**Gate**: tres liquidaciones reales del mes pasado tienen que dar exactamente los mismos
números.

**⚠️ EL GATE SIGUE ABIERTO.** No depende de código: hacen falta **tus** liquidaciones
reales. Lo que sí está probado, con 41 tests:
- El motor de cálculo, con casos de papel (17 tests sin base).
- El ciclo completo contra Postgres real (24 tests): contrato → ajustes encadenados →
  cuotas → cobros parciales → liquidación → cierre → pago tardío.
- Condominio 60/40: la suma de las partes da el total exacto, sin perder ni inventar un peso.

**Tres bugs que sólo aparecieron al correr**:
- Las columnas `date` de Postgres llegaban como `Date` de JS. Un `date` no tiene hora ni
  zona: convertirlo le inventa medianoche UTC y al mostrarlo en Argentina se corre un día.
  Un contrato que empieza el 1 aparecía empezando el 31 del mes anterior. Se corrigió en
  las dos puntas — parser de `pg` y formateo del front.
- Un test se acopló al estado **global** de los índices, que por diseño no se limpia entre
  corridas. Ahora afirma la invariante, no un valor exacto.
- El tablero escondía los ajustes sin confirmar más viejos de 31 días — justo los que no
  hay que dejar caer.

---

## Etapa 5 — Cierre de ventas ⚠️ CONSTRUIDA, GATE ABIERTO (2026-08-03)

- [x] `operacion_venta`: reserva → boleto → escritura, sin marcha atrás
- [x] Calculadora de comisiones de **tres niveles**, con 11 tests de papel
- [x] Comisiones proyectadas / devengadas / cobradas, con vista por agente
- [ ] Pre-contratos y plantillas — la tabla existe, la UI no. **Se corta la feature
      entera antes que dejarla a medias**

**Gate**: una operación real repartida y verificada por quien cobra.
**⚠️ ABIERTO**: necesita una venta tuya real. Lo que sí está probado (12 tests de
integración + 11 del motor): el reparto **siempre cuadra** — lo que factura la operación
es exactamente lo que se reparte, incluso con montos que no dividen redondo.

**La decisión que evita el error clásico**: el reparto interno se aplica sobre lo que
queda DESPUÉS del reparto con la otra inmobiliaria, no sobre el honorario bruto. Pagarle
al agente el 25% del bruto cuando la mitad ya se fue es la forma más común de regalar
plata.

---

## Etapa 6 — Publicaciones ⚠️ PLAN B LISTO, GATE BLOQUEADO (2026-08-03)

- [x] Generador de aviso: título, precio, atributos y texto listo para pegar
- [x] **Plan B primero**, como estaba planeado. Se construyó ANTES que cualquier
      integración y funciona hoy sin depender de nadie
- [x] Feed XML público por inmobiliaria, con token rotable
- [ ] Integración con un portal — **bloqueada por convenio comercial**, no por código
- [x] Estado por operación, con último sync y último error

**Gate**: un aviso publicado en un portal.
**⚠️ BLOQUEADO Y NO POR NOSOTROS**: requiere convenio con Navent o MercadoLibre. El
roadmap NO se detuvo esperándolo, que era exactamente el riesgo anotado.

`INTEGRACION_ACTIVA` marca hoy `false` para todos los portales y la UI dice "copiar y
pegar" en vez de mostrar un botón *Publicar* que no publica. Cuando se firme un convenio
se cambia una constante.

**Detalle de producto**: el aviso publica la **zona, nunca el número de puerta**. La
dirección exacta es para quien ya llamó.

---

## Etapa 7 — Recordatorios ⚠️ GENERACIÓN LISTA, ENVÍO BLOQUEADO (2026-08-03)

- [x] `evento_programado`, **idempotente por clave única**: el generador va a correr en
      un cron y los crons se reintentan. Un aviso duplicado le llega dos veces al inquilino
- [x] Recordatorios de contrato por vencer, aumento por aplicar, cuota impaga y reserva
      por vencer, con los días configurables por inmobiliaria (90/60/30 y demás)
- [x] Bandeja dentro de la app
- [ ] Envío por **email** — falta configurar un proveedor
- [ ] Envío por **WhatsApp** — Business Cloud API pide verificación de negocio y
      plantillas aprobadas. Es un trámite, no código
- [x] Ingesta automática de **ICL y UVA** desde la API del BCRA (v4.0, variables 40 y
      31). El **IPC sigue manual**: INDEC no publica una API estable y raspar un HTML que
      cambia sin aviso pondría un número equivocado en un aviso de aumento
- [ ] Preferencias de canal por persona

**Gate**: dejaron de mirar el Excel.
**⚠️ ABIERTO**: los avisos se generan y se ven, pero todavía no salen solos. `GET
/v1/avisos/canales` devuelve qué canal puede enviar de verdad y la UI lo muestra tal cual,
en vez de un botón "enviar" que no manda nada.

**Cuando el envío exista, los eventos ya generados salen sin tocar nada más**: falta el
despachador, no el modelo.

---

## Etapa 8 — Piloto sostenido ⚠️ LISTA, GATE ABIERTO (2026-08-04)

- [x] Backup automatizado **que se verifica solo**: hace el dump, lo restaura en una base
      descartable y cuenta filas. Si no se puede leer, lo renombra a `.INVALIDO` y falla
- [x] Restore **probado de verdad**: se borró la base, se restauró desde el dump y la app
      volvió a leer todo por el rol restringido
- [x] Rotación de backups: se guardan los últimos 14
- [x] Dockerfile de producción multi-stage, sin devDeps, usuario sin privilegios
- [x] Estilos de impresión — una liquidación se imprime y se le entrega al propietario
- [x] Export CSV de propiedades, personas, contratos, liquidaciones, comisiones y cobros
- [x] Suite de permisos en verde
- [x] Revisión de seguridad del sistema entero, **convertida en tests**

**Gate**: 30 días de uso diario sin volver al sistema viejo.
**⚠️ ABIERTO**: necesita 30 días.

**Tres hallazgos de la revisión de seguridad**, cada uno ahora con su test:
- `app_role` tenía INSERT/UPDATE/DELETE sobre `schema_migrations`. Lo introdujo mi propio
  script de restore con un `GRANT ON ALL TABLES`. La app podía alterar el registro de
  migraciones.
- **El arnés de tests no tenía `helmet`.** La suite corría contra una app que difería de
  producción justo en la capa de seguridad. La causa era configuración duplicada entre
  `main.ts` y el arnés: se unificó en `configurar-app.ts`.
- El export CSV neutraliza las fórmulas de Excel: un nombre `=1+1` se ejecuta al abrir el
  archivo. Es inyección real, no un detalle de formato.

---

## Etapa 9 — Segundo cliente y monetización ⚠️ LISTA, GATE ABIERTO (2026-08-04)

- [x] Los tres planes **con sus límites aplicados de verdad**, en un trigger de base. Un
      plan que sólo vive en la pantalla de precios es un cartel
- [x] Módulos por plan: pedir uno que no está incluido devuelve 403 con el motivo
- [x] Multi-sucursal (plan Pro)
- [x] API pública con claves: se muestran una sola vez, en la base queda el hash
- [ ] **Cobro** — no hay medio de pago integrado, y `mi-plan` lo dice en vez de simularlo
- [ ] **Campañas Meta** — App Review y Business Verification son un trámite de semanas
- [x] Onboarding: el signup crea la inmobiliaria y el titular en un solo paso

**Gate**: una inmobiliaria ajena, pagando, un mes completo.
**⚠️ ABIERTO**: necesita un cliente y un medio de pago.

**Nada de cobro simulado.** Sin facturas falsas, sin `Visa •••• 4242`, sin "se debitará
automáticamente". `GET /v1/planes/mi-plan` devuelve `cobro.integrado: false` con el
motivo, y el catálogo devuelve `precio: null` porque el gate de la etapa 0 es que alguien
diga un número concreto.

**El límite se aplica en la BASE, no en el servicio.** Un tope que sólo vive en el código
de la aplicación se saltea con un request bien armado; el trigger corta en el mismo lugar
donde se escribe el dato. Levanta el SQLSTATE propio `BE001`, que el filtro global traduce
a un 403 con el mensaje que redacta la base — el límite vive en un solo lugar.

---

## Cómo se construye cada feature, siempre igual

```
migración (tabla + RLS + permisos)
   → servicio con sus reglas de negocio
   → controlador con sus roles
   → tests: camino feliz + cada denegación + aislamiento entre inmobiliarias
   → pantalla
   → verificación en el navegador
   → marcarla como disponible en el catálogo
```

Si falta tiempo, se cortan **features enteras**. Nunca las capas de una feature.

## Errores que ya sabemos que se cometen

1. Construir cinco etapas sin cerrar la etapa 0.
2. Gates que son tests, sin tests. Se cierran tres etapas que nunca se verificaron.
3. Crear una tabla que ningún código lee: la feature no existe en la práctica.
4. Arreglar el síntoma. Un reintento que baja la frecuencia del deadlock no lo elimina.
5. Hacer asíncrono algo que no lo necesita.
6. Confiar en un test flaky. Falla una de cada cuatro veces y es un 500 real bajo contención.
7. Instalar dependencias sólo en el host cuando el contenedor tiene su propio volumen de
   `node_modules`.
