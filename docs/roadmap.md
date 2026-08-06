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
      typecheck de las dos puntas, build del front y gitleaks. **Verificado el
      2026-08-04**: la primera corrida encontró que faltaba MinIO
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
- [x] Fotos de propiedades sobre S3 (MinIO en dev). Validación por **firma de bytes**,
      portada automática, reordenado y borrado
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
- [x] Pre-contratos y plantillas con motor propio de variables, condicionales y listas.
      Cuatro plantillas base: pre-contrato, aviso de aumento, aviso de vencimiento y recibo

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

## Etapa 10 — Mejoras ✅ CERRADA (2026-08-04)

> Salieron de recorrer el código entero, no de una lista de ideas. Cada una dice
> **por qué** y **cómo se sabe que está hecha**. Están ordenadas por lo que cuesta
> si no se hacen, no por lo que cuesta hacerlas.
>
> Las nueve etapas anteriores siguen siendo el camino: esto es lo que se ve
> desde acá arriba, con las etapas construidas.
>
> **Estado**: hecho **todo** lo que era código. Lo único abierto depende de algo
> que no se escribe: una decisión de negocio (las expensas), un servidor (probar
> el deploy de verdad), un repo remoto (verificar CI) y una API key.

### 10.1 · Huecos del dominio — columnas que nadie lee

Es el **error #3 del playbook** con nombre y apellido: hay columnas en la base que
se escriben, se imprimen en el contrato y después nadie usa. Para el usuario, la
feature no existe; para el que lee el schema, parece que sí.

- [x] **Punitorios por mora.** `contrato_alquiler.punitorio_diario_pct` se carga, se
      guarda y **se imprime en el contrato** (`plantillas.defecto.ts`: «devengará un
      interés punitorio del {{ }}% diario»), pero ningún código lo calcula sobre una
      cuota vencida. El sistema está imprimiendo una cláusula legal que después no
      aplica. Hace falta: el punitorio como línea de la cuota, con su memoria de
      cálculo (días de mora × tasa × saldo), y la decisión de negocio de si se
      condona o no — que hoy es una pregunta abierta en `CONTINUAR.md`.
      **Hecho cuando**: una cuota con 20 días de mora muestra su punitorio calculado
      y explicable, y se puede condonar dejando registro de quién lo hizo.

- [x] **Renovación de contrato.** `contrato_anterior_id` existe en el schema y **no
      lo escribe nadie**. Un contrato que vence es el evento más frecuente de una
      cartera de alquileres, y hoy renovar es cargar uno nuevo a mano y perder la
      cadena. **Hecho cuando**: desde un contrato por vencer se genera el siguiente
      con partes, índice y honorarios precargados, el anterior queda en `renovado`, y
      la ficha muestra la cadena completa hacia atrás.

- [x] **Devolución del depósito.** `deposito` y `deposito_devuelto_el` existen; nada
      los mueve. Es plata de un tercero retenida por la inmobiliaria y es la última
      discusión de todo alquiler. **Hecho cuando**: al cerrar un contrato se registra
      la devolución con sus descuentos (expensas impagas, reparaciones) y queda el
      comprobante.

- [ ] ⏳ **Expensas: quién las cobra.** *(decisión de negocio, no código)* `periodo_alquiler.expensas` entra en el total de
      la cuota, pero no está definido si la inmobiliaria las cobra y las pasa al
      consorcio o si van aparte. Es una de las cinco preguntas abiertas del gate de
      la etapa 0, y cambia el neto de la liquidación.
      **Hecho cuando**: la regla está escrita en `spec.md` y hay un test con números
      reales que la sostiene.

- [x] **Recibo de cobro.** Se registra el cobro y no sale ningún papel. El inquilino
      pide comprobante. El motor de plantillas ya existe: falta la plantilla y el
      botón. **Hecho cuando**: se registra un cobro y se imprime su recibo.

### 10.2 · Auditoría de la plata

Hoy `cobro.registrado_por` y `contrato_ajuste.confirmado_por` guardan el autor, pero
`liquidacion` sólo tiene `cerrada_el` y `pagada_el`: **no quién**. Cerrar una
liquidación es el acto que congela lo que se le transfiere a un propietario, y es
justo el que no tiene firma.

- [x] `cerrada_por` y `pagada_por` en `liquidacion`. Y `estado='pagada'`, que
      existía en el schema y **nadie escribía**: una liquidación cerrada y una ya
      transferida se veían igual, que es justo como se le paga dos veces a alguien.
- [x] Una vista o tabla de auditoría de los movimientos de plata: cobro, ajuste
      confirmado, liquidación cerrada, comisión cobrada, gasto agregado. Con quién,
      cuándo y desde qué IP — ya se guarda para las sesiones.
      **Hecho cuando**: ante «¿quién cerró esto y cuándo?» hay una pantalla, no un
      `SELECT` a mano.

### 10.3 · Lo que se rompe con volumen

- [x] **La segunda tanda de paginación.** La primera cerró cinco endpoints. Quedan
      sin paginar: `GET /contratos/vencimientos` (un `UNION ALL` de tres tablas sin
      `LIMIT`), `/contratos/:id/periodos`, `/contratos/:id/ajustes`,
      `/ventas/comisiones/por-agente`, `/equipo` y `/plantillas`. Los tres primeros
      crecen con el tiempo, no con la cartera: un contrato de tres años son 36
      cuotas, y `vencimientos` con 200 contratos devuelve todo junto.
      **Hecho cuando**: la suite de `paginacion.spec.ts` los incluye en su tabla.

- [x] **Los agregados de la cartera se calculan sobre todo el tenant.** MEDIDO con
      `scripts/medir-cartera.sh`: 500 contratos, 12.000 cuotas, 9.000 cobros →
      cartera **20 ms**, inicio 6–9 ms, vencimientos 1 ms. **No hace falta
      optimizar nada**, que era justamente lo que había que averiguar antes de
      tocar una línea. El script queda para volver a medir. Antes decía: El CTE de
      `cartera.service.ts` agrupa las cuotas de **todos** los contratos para
      devolver una página de 50. Con 500 contratos × 36 cuotas son 18.000 filas
      agregadas en cada request. Hoy no duele; hay que medirlo antes de que duela.
      **Hecho cuando**: hay un `EXPLAIN ANALYZE` con 500 contratos cargados y, si
      hace falta, los totales por contrato viven en una vista materializada.

- [x] **El límite de intentos vive en la memoria del proceso.** Ahora el contador
      va en Postgres —no en Redis: la base ya está y ya es estado compartido—.
      Los tests levantan DOS storages contra la misma base, que es lo único que
      prueba que la cuenta se comparta. Antes decía: Con una sola
      instancia alcanza. Con dos réplicas detrás de un balanceador, cada una lleva su
      contador y el límite efectivo se duplica. Hay un comentario en
      `limite-intentos.ts` que lo dice.
      **Hecho cuando**: hay storage compartido, o está escrito que se despliega una
      sola instancia y por qué.

- [ ] ⏳ **Archivar en vez de acumular.** Contratos rescindidos, oportunidades perdidas
      y avisos vistos siguen entrando en todas las consultas. Falta decidir qué se
      archiva y cómo se lo sigue pudiendo consultar.

### 10.4 · Que se pueda diagnosticar en producción

Ninguna de estas se nota hasta el día que algo falla, y ese día se notan todas juntas.

- [x] **Request-id y logging estructurado.** Hoy diagnosticar sería `grep` sobre logs
      sueltos, sin forma de atar los renglones de un mismo request.
- [x] **El backup no corre solo.** El script existe y lo ejecuta una persona; un
      backup que depende de que alguien se acuerde no es un backup.
      **Hecho cuando**: corre solo, y hay una **restauración probada** — un backup
      que nunca se restauró es una hipótesis.
- [~] **Deploy.** El artefacto está: imagen de producción del front, Caddy con
      TLS automático, `docker-compose.prod.yml` propio (no un override), y
      `docs/deploy.md`. Las dos imágenes compilan, el compose y el Caddyfile
      validan. **Un deploy real sigue sin hacerse**: no hay servidor, así que
      esto NO está cerrado. Antes decía: No hay servidor, dominio ni TLS. El `Dockerfile` de producción está
      listo. Con `docker compose` + Caddy alcanza para empezar.
- [x] **Tests de frontend: hoy hay cero.** Ahora hay 45. Los cuatro bugs de UI de la construcción
      anterior —y los dos de ésta— se encontraron mirando el navegador a mano.
      Cubrir primero lo que ya tuvo un bug: `dominio/formato.ts` (tuvo uno de zona
      horaria), el refresh single-flight, el importador y la galería de fotos.
- [ ] ⏳ **CI sin verificar**: el workflow existe y nunca corrió, porque no hay repo
      remoto.

### 10.5 · Producto — lo que pide quien ya lo usa

- [x] **Portal del propietario.** Un acceso de sólo lectura donde el dueño ve sus
      liquidaciones y el estado de cobranza de su propiedad. Es lo que más llamados
      ahorra, y todo el dato ya existe: es una pantalla y un rol.
- [ ] ⏳ **Cobranza que se explique sola al inquilino.** El recibo ya sale con su
      detalle; falta el enlace con la memoria del aumento. Antes decía: Un enlace con el detalle de la
      cuota, el aumento aplicado y su memoria de cálculo. La regla «todo cálculo se
      puede explicar» hoy termina en la pantalla del administrador.
- [x] **Vista de caja del día.** Qué entró hoy, por qué medio y quién lo registró.
      Los datos están en `cobro`; falta la pantalla.
- [x] **Notas y seguimiento en el contrato.** Hoy el ida y vuelta con el inquilino
      vive en WhatsApp, que es exactamente de donde este producto viene a sacarlo.
- [ ] ⏳ **Comparar contra el año pasado.** Cartera, cobranza y morosidad mes contra
      mes. **Sin gráficos decorativos**: números y variación, según `DESIGN.md`.

### 10.6 · Accesibilidad y detalles que quedaron pendientes

- [x] Revisar la app entera a 375px. Catorce pantallas, sin desborde horizontal;
      apareció uno en Liquidaciones —tres controles en la cabecera empujaban el
      ancho de toda la página— y se arregló en `PageHeader`. Antes decía: Se verificaron el inicio, la cartera y la
      portada; el resto sólo tiene los breakpoints declarados.
- [x] Contraste en modo oscuro y navegación por teclado en las tablas. Medido
      como WCAG, no a ojo: `--muted-2` daba **3,01** sobre `--surface-2` —por
      debajo de AA— en los dos temas, y se usa a 11px. Corregido a 4,56 y 4,66.
      La cartera era la única tabla clicable sin acceso por teclado.
- [x] Estados de carga por fila, no sólo skeletons de pantalla completa.
- [x] La paleta ⌘K: se sumaron contratos, liquidaciones, caja, vencimientos,
      movimientos, índices y «nuevo contrato».

---

## Etapa 11 — Lo que se ve mirando la app corriendo ✅ CERRADA (2026-08-06)

> La etapa 10 salió de recorrer el **código**. Ésta sale de abrir la **aplicación** con
> `owner@prueba.test` y usarla. Ningún test agarró nada de esto, porque los gates que
> los cubrían eran de API.
>
> Es el **error #2 del playbook** con una cara nueva: el gate de B-01 decía «la suite de
> `paginacion.spec.ts` los incluye en su tabla» y se cerró con eso. La suite pasa. La
> pantalla no carga. **Un gate de API no cierra una feature que tiene pantalla** — el
> playbook ya lo dice («una feature hecha en el back no está hecha») y esta etapa es lo
> que costó no aplicarlo hacia atrás.
>
> **Dónde vivía cada defecto**: B-01 y B-05 están en `main` (verificado con
> `git show HEAD:`). B-02, B-03 y B-04 están en el árbol de trabajo, porque la capa
> familia todavía no se commiteó — ver el aviso de abajo.
>
> ⚠️ **`web/src/styles/familia.css` no está en git.** 1301 líneas, la fuente de verdad
> de la forma de los componentes, que `DESIGN.md` documenta como decisión del 04/08 y
> que el repositorio no tiene. No la toca `.gitignore`: nunca se agregó. Lo mismo con
> `web/src/directivas/revelar.ts` y `web/src/dominio/sidebar.ts`. Existen sólo en este
> disco y sin copia. El CI queda en verde igual porque los tests de front no renderizan
> estilos — que es el mismo agujero que dejó pasar B-01, visto desde otro ángulo.

### 11.1 · Los cinco defectos ✅ CERRADO

Van primero porque son lo único que hoy le miente al usuario. Ninguno es una mejora.

- [x] **B-01 · Vencimientos no carga, y muestra «0» en vez de decirlo.** El front pide
      `porPagina=200`; el DTO topea en `@Max(100)`: 400. La pantalla imprime el mensaje
      crudo del validador **en inglés** y debajo, en grande, «Nada por vencer · 0 en los
      próximos 90 días» — con seis cuotas en mora y un contrato que termina el 10/08 en
      la misma base. Es el cero falso que el playbook prohíbe, en la pantalla que sostiene
      la promesa de la portada.
      **Hecho cuando**: la pantalla carga paginada, y un error de carga **nunca** comparte
      pantalla con un total. Con test de front que fije las dos cosas.

- [x] **B-02 · La primera fila de Propiedades es invisible.** Dice «3 en cartera» y se ven
      dos. `.table-sticky th` lleva `top: var(--topbar-h)`, pero la tabla vive dentro de
      `.table-wrap`, y `overflow-x: auto` convierte al wrapper en contenedor de scroll: el
      sticky se ancla a él y se corre 56px sobre la fila 1. Medido: `thead.top` 487,75
      contra `row1.top` 472,75, y `elementFromPoint(400,500)` devuelve el `<th>`.
      **Hecho cuando**: se ven las tres filas, con el encabezado pegado funcionando.

- [x] **B-03 · Blanco sobre `--danger` no pasa AA en oscuro.** `.btn.peligroso-solido` fija
      `color: #fff`. En claro `#b23a32` da 6,5:1; en oscuro `--danger` se aclara a `#d9756c`
      y da **3,13:1**, con texto de 13px. Es el problema que ya se resolvió para el acento
      inventando `--on-accent` y que nunca se extendió a los semánticos.
      **Hecho cuando**: existe `--on-danger`, no queda ningún `#fff` a mano en un botón, y
      el ratio está medido en los dos temas.

- [x] **B-04 · La barra de filtros se rompe con controles sin envolver.** `input, select,
      textarea { width: 100% }` más `.filtros > :first-child { flex: 1 }`: sólo el primer
      hijo tiene ancho propio y los `<select>` toman la fila entera. Medido en la cartera:
      cuatro renglones donde iba uno. Caja se ve bien **por casualidad**, porque envuelve
      todo en `.campo`.
      **Hecho cuando**: la misma clase da el mismo resultado con controles pelados y con
      `.campo`, en las siete pantallas que ya la usan.

- [x] **B-05 · Un contador que lleva a una pantalla que muestra menos.** «Liquidaciones sin
      cerrar: 2» lleva a Liquidaciones, que abre en el mes corriente y responde «Sin
      liquidaciones para ago/26». Los dos borradores son de `2026-01`.
      **Hecho cuando**: la regla queda escrita y aplicada — *ningún contador del inicio
      puede llevar a una pantalla que muestre menos de lo que el contador prometió.*

**Gate**: las cinco pantallas abiertas en el navegador, en claro y oscuro, a 1440 y 375.
Y un test de front por cada uno que sea comprobable sin ojo humano.

### 11.2 · Gastos y reclamos ✅ CERRADO

El hueco más grande del dominio, y el que **ya costó plata**: el `DELETE` sin filtro que
borraba los gastos cargados a mano y se los transfería de más al propietario no fue un
descuido suelto — es una consecuencia del modelo. Mientras el gasto viva **dentro** de la
liquidación, rearmar la liquidación puede destruirlo.

- [x] `gasto` como entidad propia, con `estado` (registrado · rendido · anulado),
      propiedad, contrato, proveedor, comprobante, moneda y **quién lo paga**. La
      liquidación lo **toma**, no lo **contiene**.
- [x] `reclamo` + `proveedor`: categoría, prioridad, estado, quién paga y quién avisó.
      Resolverlo con costo **genera su gasto en la misma transacción** — van juntos o no
      van: si el reclamo se cierra y el gasto no entra, el arreglo queda sin costo.
- [x] Pantallas de las dos, con alta en la misma lista: un reclamo se carga con el
      inquilino al teléfono, y perder la lista para volver a buscarla es lo que hace que
      termine en un papel.
- [ ] ⏳ Que los dos entren al portal del propietario. El patrón está; es una pantalla más.

**Cerrado con** 19 tests contra Postgres real. El que justifica la feature entera es
«rearmar la liquidación NO destruye el gasto ni lo duplica»: verificado en dos corridas
seguidas sobre el mismo período, con el total intacto y **una sola** línea.

**Tres cosas que aparecieron construyéndolo:**

- **El gasto sólo entraba si el propietario también había cobrado ese mes.** `generar` se
  disparaba únicamente con cobros sin liquidar, así que un mes con una unidad vacía a la
  que hubo que arreglarle el techo no generaba nada: el gasto quedaba esperando y nadie
  se enteraba de que el propietario debía. Ahora un propietario con gastos pendientes
  genera su liquidación igual, con bruto 0 y **neto negativo** — un número incómodo y el
  verdadero. Se descubrió probando la pantalla, no el endpoint.
- **El trigger de inmutabilidad hacía imposible borrar una inmobiliaria.** Un gasto
  rendido no se borra, y por CASCADE eso alcanzaba al `DELETE FROM tenant`. Se detectó
  porque el arnés de tests no podía limpiar sus fixtures. La salida es explícita: si la
  inmobiliaria ya no existe, esto es el cascade y no un borrado de la aplicación.
- **`BE002`**, SQLSTATE propio para lo que ya no se puede tocar, mapeado a **409** con
  código `YA_RENDIDO`. Antes habría salido como 500: un conflicto de estado no es un
  error del servidor.

### 11.3 · El tablero ✅ CERRADO

`GET /v1/tablero?periodo=` y la pantalla `/tablero`, con 15 tests contra
Postgres real. Lo que devuelve, y por qué cada uno:

Hoy el producto muestra la plata **de terceros** y no muestra la propia: los honorarios
devengados no están en ninguna pantalla. Y los cuatro números del inicio no tienen contra
qué compararse — un indicador sin base es un número.

- [x] `GET /v1/tablero?periodo=` con el mismo contrato que `/inicio`: agrupado por moneda,
      `null` —no cero— donde el rol no ve. Sin `@Roles`: lo que cambia por rol es el
      contenido, no el acceso, y las consultas de plata **no se ejecutan** para quien no
      las puede ver.
- [x] Cobranza: tasa del mes, aging por tramo (1-30 / 31-60 / 61-90 / +90), deuda vencida,
      días promedio de cobro y la serie de doce meses.
- [x] Cartera: ocupación, vacancia, renovación (el dato ya estaba en `contrato_anterior_id`
      desde la etapa 10 y nadie lo agregaba), y la carga de los próximos 30/60/90/180 días.
- [x] Negocio: **honorarios devengados** —el ingreso propio de la inmobiliaria, que no
      estaba en ninguna pantalla—, comisiones por cobrar y ranking por asesor.
- [x] Embudo: conversión por etapa, leads por origen, tiempo de primera respuesta y
      motivos de pérdida. Las cuatro columnas se llenaban desde la etapa 3 y no las leía
      nadie: error #3 del playbook, cerrado.
- [ ] ⏳ `metrica_mes` persistida al cerrar el período. Hoy la comparación interanual se
      recalcula en vivo, y eso alcanza mientras el histórico no cambie. Cuando haya una
      nota de crédito sobre un período cerrado va a dejar de alcanzar: es la misma lógica
      de inmutabilidad que ya se aplica a los ajustes y a las liquidaciones.

**Sin librería de gráficos.** Todo es polilínea y rectángulo: SVG a mano con los tokens.
Una librería trae peso, un tema propio que pelea con el nuestro, y un montón de formas que
§6 prohíbe. **Lo que sigue prohibido**: torta, dona, área con gradiente, gauge, radar, 3D.
ARS y USD **nunca** en el mismo eje. El que no tiene dato dice «sin datos», no dibuja cero.

**Tres cosas que aparecieron al construirlo**, y las tres son de criterio, no de código:

- **Subir no siempre es bueno.** El delta se pintaba verde para todo lo que creciera, y en
  «días promedio de cobro» crecer es empeorar. Un tablero que felicita a alguien por tardar
  más en cobrar es peor que no tener tablero.
- **«Perdida · 200%»** salía de calcular la conversión de cada etapa contra la anterior sin
  notar que `perdida` no es el paso siguiente a `ganada`, es la otra salida. Un porcentaje
  que no es porcentaje de nada, en una pantalla de indicadores, alguien lo va a leer.
- **`null` y cero se separaron a mano en cada consulta.** «No cobramos nada» y «cobramos el
  mismo día» dan los dos un número chico y significan lo contrario. Hay dos tests que fijan
  justo ese borde.

Absorbe el ⏳ «Comparar contra el año pasado» de 10.5, con el alcance que en realidad tenía.

### 11.4 · Que la tabla no mande a Excel ✅ CERRADO

- [x] **Ordenar por columna**, con `ordenSeguro()` — motor puro, 5 tests de papel. La
      lista blanca no es una validación más: **`ORDER BY` no acepta bind parameters**, así
      que la columna hay que concatenarla sí o sí y ésa es la única defensa. Escribir el
      test hizo aparecer que `columnas[orden]` con `orden = 'constructor'` devuelve una
      función en vez de `undefined`: va con `Object.hasOwn`, la misma trampa de prototipos
      que ya había aparecido en el motor de plantillas.
- [x] El ciclo es asc → desc → **sin orden**. La tercera parada importa: sin ella no hay
      forma de volver al orden que eligió el backend, que en varias pantallas es el útil.
- [x] **Fila de totales por moneda** en Gastos, con el rótulo «de esta página»: mostrar la
      suma de 25 filas como si fuera el total del período sería un número falso.
- [x] **Filtros que se recuerdan**, con tres reglas escritas en `dominio/filtros.ts`: la
      página no se recuerda, un valor guardado que ya no es válido se descarta (si no, el
      backend contesta 400 y la pantalla no carga nunca sin que el usuario entienda por
      qué), y un `localStorage` que falla no rompe la pantalla.
- [x] **Tarjetas por default abajo de 640px**, y una preferencia explícita gana sobre el
      ancho.
- [x] `.btn.enlace` para acciones de fila, y área táctil de 44px bajo `(pointer: coarse)`
      sin tocar el escritorio.
- [ ] ⏳ Columnas que se eligen. No duele todavía: con diez columnas se ve todo.

**Encontrado a 375px**: el checkbox de la tarjeta de contrato medía **195px**, aplastaba
el título a 0 y empujaba el chip fuera de la tarjeta. Es el `input, select, textarea
{ width: 100% }` de `familia.css` mordiendo por **tercera** vez — la primera fueron los
`<select>` de la barra de filtros (B-04). El patrón es siempre el mismo: una regla de
elemento pensada para el caso común, aplicada a controles que no son ese caso. Ahora
`checkbox` y `radio` están acotados en la capa familia.

### 11.5 · Copy y accesibilidad ✅ CERRADO

- [x] **`plural(n, 'contrato', 'contratos')`**, con 6 tests. Pide las dos formas completas
      en vez de derivar la segunda porque las reglas de acentuación no entran en un
      `+ 's'`: el plural de «liquidación» es «liquidaciones», sin tilde, y el paréntesis
      nunca lo iba a resolver.
- [x] **Ningún `detail` de class-validator llega a la pantalla.** Salían en inglés y con
      el nombre interno de la propiedad —«porPagina must not be greater than 100»—, que es
      exactamente lo que se leyó en Vencimientos en B-01. Ahora se redacta en castellano y
      el detalle técnico queda en `errores`, para el log y para quien integre.
      *Trampa al hacerlo*: el filtro RFC 9457 lee `message`, no `detail`; poner `detail`
      dejaba el texto redactado sin usar y salía «Bad Request Exception» — el mismo texto
      de librería que esto vino a sacar.
- [x] El aviso de Google Maps pasa a `<details>` plegado: son instrucciones de Google
      Cloud, y quien tiene que hacerlo lo hace una vez.
- [x] «Saltar al contenido» como primer elemento enfocable, y `aria-live="polite"` en la
      bajada de `PageHeader`, que es donde vive el conteo que cambia al refiltrar. Sin
      eso, quien usa lector filtra y escucha silencio.
- [ ] ⏳ Lint que prohíba colores a mano fuera de `tokens.css`. Los dos que importaban
      —los botones de B-03— ya salieron; los que quedan son de la portada y del logo.

---

## Etapa 12 — Lo que pidió el dueño ⏳ POR EMPEZAR

> Tres pedidos de producto de la sesión del 06/08, con el diseño ya resuelto y
> el detalle completo en `docs/CONTINUAR.md` §5. Los tres primeros puntos son
> **el mismo error #3**: columnas que existen, tienen sentido y no lee nadie.

### 12.1 · Config de comisiones por inmobiliaria

- [x] `tenant.comisiones` existe desde la migración 008 y **nadie lo leía**. Su
      default ya es el modelo que pidió el dueño: 3% + 3% a las puntas y 25% +
      25% puertas adentro, o sea 1,5% al captador, 1,5% al que vende y 3% a la
      casa sobre un total de 6%. `GET`/`PUT /v1/comisiones/config` + pantalla.
- [x] **Las dos unidades a la vista.** El motor pide el nivel 3 en % de lo que
      le queda a la casa; la inmobiliaria piensa en % de la venta. Se guarda en
      la del motor —cuando la operación se comparte, lo que queda se parte, y un
      % fijo sobre la venta dejaría de cerrar— y se muestran las dos.
- [x] **Las dos puntas, acopladas al total.** Mover una ajusta la otra para que
      sigan sumando el total, que arranca en 6% y es editable.
- [ ] `propiedad.agente_captador_id` también existe y no pre-llena nada.
- [ ] El pre-llenado es un **valor por defecto editable**: el captador no
      siempre es quien cargó la propiedad.
- [ ] El % de cada agente en su membresía, editable desde el listado de equipo,
      con sus estadísticas y las propiedades que trajo.

### 12.4 · Garantes ✅ el circuito base

- [x] `garantia` existía desde la 007 y **no la leía nadie**. Ahora tiene
      persona, documentos, firma y veredicto.
- [x] Los cinco documentos sobre S3: las dos caras del DNI y los tres últimos
      recibos de sueldo. Volver a subir uno reemplaza al anterior.
- [x] **Central de Deudores del BCRA**, contrato verificado contra la API real.
      Del DNI se derivan los CUIL posibles. Sólo situación 1 se acepta y el
      veredicto se **congela** con su fecha: la decisión se tomó con ese dato.
- [x] Mínimo 2 garantes, con la verificación diciendo qué falta en castellano.
- [ ] El recordatorio `garantia_por_vencer` sigue sin emisor.
- [ ] Cheques rechazados: el endpoint del BCRA existe y no se consulta.
- [ ] Re-consulta periódica: hoy es a pedido, y un contrato dura tres años.

**Hecho cuando**: cargar una venta no obliga a tipear ningún porcentaje, y la
pantalla muestra «captador 25% de lo que queda ≡ 1,5% de la venta».

*Se empezó el servicio en la sesión del 06/08 y se revirtió a propósito*: quedaba
a medias y con `puntas` opcional sin fallback el reparto rompía. Media feature
no va.

### 12.2 · Personas por rol

- [ ] Derivar los **tres roles que la base ya sabe**: inquilino
      (`contrato_parte` rol locatario), garante (rol garante/fiador) y comprador
      (`operacion_venta.comprador_id`). Hoy sólo salen propietario, interesado y
      reservante.
- [ ] Cuatro pantallas —Leads, Inquilinos, Propietarios, Garantes— más filtro
      por rol en Personas.
- [ ] **Estados derivados, no un campo manual.** Un inquilino está «en mora»
      porque tiene cuotas vencidas; un lead está en «negociación» porque su
      oportunidad lo está. Es la misma decisión que la etapa 3 tomó para los
      roles: un dato derivado no se desincroniza.
- [ ] **«Locador» y «vendedor» NO llevan pantalla propia**: son el propietario
      visto desde un contrato o desde una venta, y serían dos pantallas con los
      mismos nombres y otro título.

### 12.3 · El IPC, que sigue siendo manual

- [ ] Avisar en el inicio cuando el mes ya pasó y falta el IPC de ese período.
      **No** raspar INDEC: no tiene API estable y un número equivocado en un
      aviso de aumento es de lo peor que este producto puede hacer. La decisión
      de la etapa 4 no cambia; lo que falta es que la ausencia se vea.

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
