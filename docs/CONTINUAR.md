# Bemo INMO — dónde estamos y qué sigue

> Documento de traspaso. Si arrancás una sesión nueva, **leé esto primero** y
> después `CLAUDE.md`, `DESIGN.md` y `docs/roadmap.md`.
>
> Para el detalle de una jornada vieja está `docs/SESION-2026-08-04.md`. Se lee
> una vez y no se vuelve.
>
> Última actualización: 2026-08-06. La etapa 11 quedó cerrada; lo que sigue
> está en la sección 5, con su diseño ya resuelto.

---

## 1. Arrancar en dos minutos

```bash
cd ~/Documents/bemo-inmo
docker compose up -d          # db + s3 (MinIO) + api + web
```

| Qué | Dónde | Credenciales |
|---|---|---|
| App | http://localhost:5173 | `owner@andes.test` / `unaclavelarga1` |
| Portada pública | http://localhost:5173/ | — |
| API | http://localhost:3000/v1/health | — |
| Consola de MinIO | http://localhost:9001 | las de `.env` (`S3_ACCESS_KEY` / `S3_SECRET_KEY`) |

```bash
docker compose exec api npm test           # 480 tests contra Postgres real
docker compose exec web npm test           # 57 tests de front (Vitest)
docker compose exec api npx tsc --noEmit   # typecheck backend
docker compose exec web npx vue-tsc --noEmit

./scripts/backup.sh                        # backup a mano, con verificación
docker compose --profile backup up -d      # backup automático, diario, verificado
./scripts/medir-cartera.sh 500             # carga 500 contratos, mide y borra
```

**Trampa conocida**: las dependencias se instalan **dentro** del contenedor
(`docker compose exec api npm i <paquete>`). El `node_modules` vive en un volumen
anónimo; instalar sólo en el host no rompe al instalar, rompe al reiniciar.

---

## 2. Estado real

| | |
|---|---|
| Commits | 40 |
| Migraciones | 16 |
| Tests | **480 de API** contra Postgres real + **57 de front**. Todo en verde |
| Pantallas | 34 |

### Etapas

| # | Etapa | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 0 | Validación | ⚠️ **ABIERTA** | Que alguien diga un precio concreto |
| 1 | Fundaciones | ✅ | — |
| 2 | Auth y aislamiento | ✅ | — |
| 3 | Espina compartida | ✅ | — |
| 4 | Alquileres | ⚠️ construida | **Tres liquidaciones reales tuyas** |
| 5 | Ventas y comisiones | ⚠️ construida | Una venta real con su reparto |
| 6 | Publicaciones | ⚠️ Plan B listo | Convenio con un portal (no es código) |
| 7 | Recordatorios | ⚠️ generación lista | Proveedor de mail · verificación de WhatsApp |
| 8 | Piloto | ⚠️ lista | 30 días de uso diario |
| 9 | Planes | ⚠️ lista | Un cliente y un medio de pago |
| 10 | Mejoras | ✅ | — |
| 11 | Lo que se ve usando la app | ✅ | — |

**Ningún gate abierto depende de código.** Están marcados así a propósito: dar por
cerrado un gate cuya evidencia no existe es el error #2 del playbook con otra cara.

### Integraciones

| Integración | Estado |
|---|---|
| **BCRA** (ICL + UVA) | ✅ **Funcionando y automático.** Contrato verificado contra la API real (v4.0, variables 40 y 31). Se sincroniza solo cada 12 h (`SINCRONIZAR_INDICES`), y sigue estando `POST /v1/indices/sincronizar` a mano. Idempotente |
| **INDEC** (IPC) | ❌ Manual **a propósito**. No hay API estable; raspar un HTML que cambia sin aviso pondría un número equivocado en un aviso de aumento |
| **Google Maps** | ⚙️ Todo el circuito listo, **falta sólo la API key**. Con la key puesta en `.env` ya llega al contenedor (antes el compose no la pasaba), hay diagnóstico que le pega a Google de verdad y un backfill de las propiedades cargadas antes. Sin key no inventa coordenadas: ofrece cargarlas a mano y dice por qué |
| **S3** (fotos) | ✅ Funcionando con MinIO en dev. Mismo protocolo que S3/R2/Spaces |
| **Portales** | ⛔ Bloqueado por convenio comercial. El generador de aviso funciona hoy (copiar y pegar) |
| **WhatsApp / email** | ⛔ Los avisos se generan y se ven; el envío necesita verificación de negocio |
| **Meta Ads** | ⛔ No empezado. App Review + Business Verification son semanas |
| **Cobro** | ⛔ No integrado, y la app lo dice en vez de simularlo |

---

## 3. Decisiones ya tomadas — no volver a discutirlas

Están en `docs/roadmap.md` y `DESIGN.md` con su razón. Las que más se tientan de
revisar:

1. **BEMO es una marca, no una plataforma.** No se comparte código, base ni
   runtime con Bemo MED. Ver `docs/suite.md`.
2. **El naranja firma, el azul opera.** El isotipo es naranja `#d2703f`; el acento
   de la interfaz sigue siendo azul tinta. La app maneja plata y el ancla es
   "exacto".
3. **Los roles de una persona se derivan**, no se guardan. No existe `persona_rol`.
4. **Una propiedad puede estar en venta Y en alquiler a la vez.**
5. **Se liquida lo COBRADO, no lo facturado.**
6. **Un ajuste confirmado y una liquidación cerrada son inmutables**, por trigger.
7. **Los índices son globales y no se pisan.** Una inmobiliaria no puede corregirle
   el IPC a las demás.
8. **Nada de datos falsos.** Sin precios inventados, sin cobro simulado, sin
   `Visa •••• 4242`. Lo que no existe dice "En desarrollo" con el motivo.

---

## 4. Trampas descubiertas — no volver a pisarlas

Cada una costó un rato de diagnóstico:

| Trampa | Síntoma | Causa |
|---|---|---|
| `tsconfig.build.json` | La API no arranca: busca `/app/dist/migrations` | Incluir `test/` empuja el `rootDir` y la salida cae en `dist/src/` |
| Healthcheck con `localhost` | "Connection refused" con la app sana | Dentro del contenedor resuelve a `::1` y la app escucha IPv4 |
| CSS `scoped` del padre | La paleta ⌘K no se veía | El scoped del padre alcanza al **elemento raíz** del hijo |
| Columnas `date` de Postgres | Un contrato del 01/01 se mostraba del 31/12 | `date` no tiene zona; convertirlo a `Date` inventa medianoche UTC |
| `PATCH` parcial | Cargar titulares borraba número, ambientes y metros | Los campos ausentes se escribían como `NULL` |
| supertest sin `listen` | `ECONNRESET` con requests en paralelo | Hace `listen(0)` por request |
| Arnés sin `helmet` | Los tests pasaban sin headers de seguridad | Configuración duplicada entre `main.ts` y el arnés |
| `BODY_LIMIT` 1 MB | Ninguna foto real entraba | El test usaba un PNG de 2×2 |
| Prototipos en plantillas | `{{ constructor }}` devolvía internals de JS | Acceso normal sube por la cadena de prototipos |
| `@SkipThrottle()` sin argumentos | Saltaba el contador `default`, y los nuestros se llaman `ip` y `cuenta`: no saltaba nada. `/auth/yo` habría quedado limitado a 10 por ventana, y el front lo llama en cada carga | Los contadores con nombre no participan del `default` |
| Rearmar una liquidación | Borraba **todas** las líneas y después sumaba los gastos de la tabla que acababa de vaciar: `totalGastos` daba siempre 0 | El `DELETE` no filtraba por tipo. Un gasto adelantado se le transfería de más al propietario |
| `unnest` y el orden del `RETURNING` | — | El orden de las filas que devuelve un `INSERT` no lo garantiza el motor. En `ventas` el encadenado padre→hijo se mapea por `punta`, no por posición |
| Índices en los tests | Un test cargó `icp` "porque estaba vacío" y rompió otro que afirmaba que `icp` no tiene valores | Los índices son **globales** y no se limpian entre corridas. Cada suite usa su propio año y acota con `desde`+`hasta` |
| El índice del ajuste | Cargar el IPC sólo de los meses del ajuste no proyecta nada | El motor usa el índice del **mes anterior**: el IPC de un mes se publica a mediados del siguiente |
| `GOOGLE_MAPS_API_KEY` | Con la key en `.env`, la API seguía sin verla | El `docker-compose.yml` no la pasaba al servicio `api` |
| Contraste "que se ve bien" | `--muted-2` daba **3,01** sobre `--surface-2`, por debajo de AA, en los dos temas | A ojo un gris apagado sobre papel parece correcto. Se mide calculando el ratio, no mirando |
| El motor de plantillas | No tiene negación (`!`) ni filtro `periodo` | Y no se los voy a agregar: el día que tenga `!`, `&&` y paréntesis es un lenguaje que alguien ejecuta desde un textarea. Lo que haga falta se calcula en el contexto |
| Una tabla nueva sin RLS | El test de seguridad falla | Y está bien. `limite_intento` no lleva RLS a propósito y ahora está escrito por qué |

---

## 5. Lo que sigue, en orden

### 🔴 Prioridad 0 — sin esto lo demás vale menos

**Cerrar la etapa 0.** Tres liquidaciones y tres contratos reales del mes pasado,
anonimizados si hace falta. Se toman los números, se cargan en el sistema y tienen
que dar **exactamente lo mismo**. Si difiere en un peso, hay una regla que no se
entendió.

Lo que no sé y estoy interpretando:
- ¿Los honorarios van sobre el bruto o sobre el neto?
- ¿Las expensas las cobra la inmobiliaria y las pasa, o van aparte?
- ~~¿Cómo se tratan los punitorios en la liquidación?~~ **Resuelto**: se calculan,
  se pueden condonar con motivo, y a quién le corresponden lo decide cada contrato
  (`punitorio_para`). Falta que confirmes que el default —al propietario— es el
  que usás.
- ¿El aumento se redondea? ¿A cuánto?
- ¿Los porcentajes de honorarios de venta cambian por provincia?

---

### ✅ Hecho en la sesión del 2026-08-06

La etapa 11 entera, más tres pedidos de producto. El detalle de cada decisión
está en los mensajes de commit; acá va el titular y **lo que apareció al
hacerlo**, que es lo que sirve.

| Qué | Lo que apareció en el camino |
|---|---|
| **11.1 · Cinco defectos** encontrados usando la app | Vencimientos no cargaba y mostraba «0» en vez de decirlo; la primera fila de Propiedades era invisible; blanco sobre `--danger` daba 3,13:1 en oscuro |
| **11.2 · Gastos y reclamos** con entidad propia | El gasto sólo entraba si el propietario también había cobrado ese mes: un mes con una unidad vacía y techo roto no generaba nada |
| **11.3 · El tablero** | «Subir» no siempre es bueno: el delta de días de cobro se pintaba verde al empeorar. Y «Perdida · 200%» era un porcentaje de nada |
| **11.4 · Ordenar, totales, tarjetas** | `columnas['constructor']` devuelve una función, no `undefined`. La misma trampa de prototipos del motor de plantillas |
| **11.5 · Copy y accesibilidad** | El filtro RFC 9457 lee `message`, no `detail`: el texto redactado quedaba sin usar y salía «Bad Request Exception» |
| **Seed con volumen real** | Corre como OWNER y **saltea RLS**: sin filtro por `tenant_id` marcó como pagadas siete cuotas de una inmobiliaria ajena |
| **Carteras de venta y alquiler** separadas | La de alquiler mostraba **3 de 13**: el filtro excluía `estado = 'cerrada'`, que es el estado de una unidad alquilada |
| **Pre-contratos**: la pantalla que faltaba | El motor estaba entero e invisible. La sintaxis `{{ }}` no se puede mostrar dentro de un template de Vue |
| **Índices que se sincronizan solos** | El «pensado para un cron» de la etapa 4 no tenía cron |
| **El seed carga las plantillas y los avisos** | Las plantillas se veían en dev porque alguien había apretado «Traer las base»: en una base limpia, Pre-contratos y Publicaciones arrancaban vacías. Ninguna de las dos se puede escribir en el `.sql` sin copiar el texto legal y el formato del aviso, así que el seed tiene un segundo paso en TypeScript que usa las mismas funciones que la app |
| **Dos avisos de la misma propiedad** | Una casa en venta Y en alquiler daba dos filas idénticas salvo el portal. `tipoOperacion` venía en la respuesta desde el primer día y no se mostraba. Y la fila era un `header` con `@click`: lo único de esa pantalla que no se podía usar con el teclado |

---

### 🟠 Lo que sigue, con su diseño ya resuelto

Ordenado por lo que más duele. Los tres primeros son **el mismo error #3**:
columnas que existen, tienen sentido y **no las lee nadie**.

#### 1. Config de comisiones por inmobiliaria ← *empezado y revertido a propósito*

**`tenant.comisiones` existe desde la migración 008** con este default:

```json
{"venta": {"compradora": 3, "vendedora": 3},
 "alquiler": {"locataria": 0, "locadora": 0},
 "repartoInterno": {"captador": 25, "cerrador": 25}}
```

Que es exactamente el modelo que pidió el dueño: 1,5% al captador, 1,5% al que
vende, 3% a la casa, 6% total. **Nadie lo lee.** Cada venta obliga a tipear los
cuatro números, y el día que alguien tipea 30 donde iba 25 no se entera nadie.

**`propiedad.agente_captador_id`** también existe, se guarda desde la ficha, y
no pre-llena nada. El captador está ahí y el reparto lo pide a mano.

**La trampa de unidades, que es la razón por la que estas cuentas dan mal.** El
motor pide el nivel 3 en **% de lo que le queda a la casa**; una inmobiliaria
piensa en **% de la venta**. Con 6% de honorarios: `captador 25% de lo que queda
== 1,5% de la venta`.

Se guarda en la unidad del motor y se **muestran las dos**. Guardar «% de la
venta» sería peor y no es obvio por qué: cuando la operación se comparte con
otra inmobiliaria lo que queda se parte al medio, y un captador con 1,5% fijo
sobre la venta se llevaría la mitad de lo que entró. La proporción es lo que se
mantiene.

Qué falta: `GET`/`PUT` de la config, la sugerencia de reparto con captador desde
la propiedad y cerrador desde el usuario que carga, la pantalla con las dos
unidades al lado, y tests. **Se empezó el servicio y se revirtió**: quedaba a
medias y `puntas` opcional sin fallback rompía el reparto. Media feature no va.

Y un cuidado que no es técnico: el captador no siempre es quien cargó la
propiedad. Lo automático tiene que ser un **valor por defecto editable**.

#### 2. Personas por rol

Los roles **se derivan, no se guardan** — decisión de la etapa 3, escrita en
`personas.service.ts`: *«una persona es propietaria porque tiene una
titularidad, no porque alguien marcó una casilla»*.

Hoy se derivan tres —propietario, interesado, reservante— y **la base sabe tres
más que nadie calcula**:

| Rol | De dónde sale |
|---|---|
| Inquilino | `contrato_parte` rol `locatario` |
| Garante | `contrato_parte` rol `garante`/`fiador` |
| Comprador | `operacion_venta.comprador_id` |

Plan acordado: **cuatro pantallas** —Leads, Inquilinos, Propietarios, Garantes—
más filtro por rol en Personas, con **estados derivados** y no un campo manual.

**«Locador» y «vendedor» NO llevan pantalla propia**: son el propietario visto
desde un contrato o desde una venta. Dos pantallas con los mismos nombres y otro
título.

#### 3. El IPC sigue siendo manual

ICL y UVA ahora se traen solos del BCRA cada 12 h. El IPC no: INDEC no tiene API
estable y raspar un HTML que cambia sin aviso pondría un número equivocado en un
aviso de aumento. Lo que sí se puede hacer sin romper esa decisión: **avisar en
el inicio** cuando el mes ya pasó y el IPC de ese período no está cargado.

#### 4. `garantia`: la tabla que no lee nadie

Existe desde la migración 007 con sus seis tipos —propietaria, recibo de
sueldo, seguro de caución, garante solidario, depósito ampliado, otra—, tiene
RLS y `vence_el`. **Ningún servicio la escribe ni la lee**, y los
recordatorios ya tienen el evento `garantia_por_vencer` esperándola. Es el
error #3 en su forma más pura, y por eso no está en el seed: sembrar filas que
ninguna pantalla muestra sería dibujar volumen, no cargar datos.

Falta el circuito entero: cargar la garantía desde el contrato, verla en su
ficha y que el recordatorio avise cuando vence.

#### 5. Lo demás, marcado con ⏳ en el roadmap

`metrica_mes` persistida para la comparación interanual · gastos y reclamos en
el portal del propietario · columnas configurables · lint de colores a mano ·
archivar lo viejo.

---

### ⚠️ Dos cosas del entorno, no del código

**El CI falló por una caída de GitHub Actions**, no por los cambios: *«The job
was not acquired by Runner»*, *«Service Unavailable»*. Hay que reintentarlo.

**El hostname de la máquina cambió** y git dejó de autodetectar la identidad.
Ya está configurado en global (`bemotech.ok@gmail.com`). Los commits de esta
sesión quedaron con el hostname viejo, igual que todos los anteriores.

---

### 🔑 Lo único que está esperando algo tuyo

1. **El precio.** Sigue siendo el gate de la etapa 0 y no lo destraba ningún código.
2. **La API key de Google Maps.** El circuito completo está listo y probado sin key;
   con la key puesta en `.env` (ver `.env.example`, tiene los tres pasos) funciona
   solo. Ojo: la restricción va **por IP**, no por referrer HTTP.
3. **Capturas de `appmiti.com`.** No pude verlo: el dominio resuelve pero el servidor
   no responde desde acá, ni por navegador, ni por `curl`, ni por búsqueda. La
   portada de hoy es la arquitectura estándar del género con marca propia.

---

## 6. Prompt para arrancar la próxima sesión

```
Seguimos con Bemo INMO, en ~/Documents/bemo-inmo.

Leé docs/CONTINUAR.md y después CLAUDE.md, PLAYBOOK.md, DESIGN.md y
docs/roadmap.md.

Estado: once etapas cerradas, 480 tests de API contra Postgres real y 57 de
front, todo en verde. El seed trae 16 propiedades, 15 contratos y su ciclo de
cobranza, las cuatro plantillas base en las dos inmobiliarias y siete avisos
de la cartera: entrás con owner@andes.test / unaclavelarga1.

Lo que sigue es la etapa 12 del roadmap, con el diseño ya resuelto en
CONTINUAR.md §5. Arrancá por 12.1, la config de comisiones — el servicio se
empezó y se revirtió a propósito porque quedaba a medias.

Trabajamos como siempre:
- Cada feature va completa: migración con RLS, servicio, controlador con roles,
  tests (camino feliz + cada denegación + aislamiento) y pantalla.
- Verificá de verdad: tests contra la base real y la app en el navegador. La
  etapa 11 entera salió de mirar la app, no el código.
- Si algo queda sin hacer o no lo pudiste probar, decímelo explícitamente.
- Nada de datos falsos: lo que no existe se marca "en desarrollo" con el motivo.
```

---

## 7. Mapa del código

```
api/src/
  configurar-app.ts     TODA la configuración; la usan main.ts y los tests
  common/               error RFC 9457, paginación, CSV
  auth/                 login, refresh con rotación, guards, roles
  personas/  propiedades/  oportunidades/     ← espina compartida (etapa 3)
  inicio/               el tablero del día y la caja: un endpoint, una vuelta
  auditoria/            quién tocó la plata
  notas/                seguimiento sobre cualquier entidad
  portal/               lo que ve el propietario, sin sesión
  tablero/              los KPIs del mes: cobranza, cartera, negocio y embudo
  gastos/               gasto, reclamo y proveedor. La liquidación TOMA el gasto
  alquileres/
    ajustes.motor.ts    el cálculo del aumento. PURO, 17 tests de papel
    bcra.service.ts     ICL y UVA. Contrato verificado
    contratos.service.ts  contratos, ajustes, cuotas, cobros, vencimientos
    cartera.service.ts  la vista de gestión + las acciones en lote
    ciclo.service.ts    renovación y devolución del depósito
    punitorios.motor.ts el interés por mora. PURO, 14 tests de papel
    liquidaciones.service.ts
    indices.cron.ts     ICL y UVA del BCRA, solos, cada 12 h. Idempotente
  ventas/
    comisiones.motor.ts los TRES niveles de reparto. PURO, 11 tests
  publicaciones/
    aviso.motor.ts      generador de aviso + feed XML. PURO
  recordatorios/        eventos idempotentes por clave única
  plantillas/
    plantillas.motor.ts variables, condicionales y listas. NO es un lenguaje
  archivos/             fotos sobre S3, validación por firma de bytes
  importar/             parser CSV propio + importador con previsualización
  planes/  exportar/

web/src/
  dominio/formato.ts    money/fecha/periodo. Reglas de negocio, no cosmética
  api/cliente.ts        refresh single-flight + descarga autenticada
  dominio/pagina.ts     la forma de una lista paginada, igual que en el back
  dominio/filtros.ts    filtros que se recuerdan, con sus tres reglas escritas
  stores/ui.ts          toasts + confirmar() como promesa
  componentes/          AppShell, CommandPalette, GaleriaFotos, UiPager, primitivos
  paginas/              34 pantallas
```

**Los seis motores puros** (`ajustes`, `punitorios`, `comisiones`, `aviso`,
`plantillas` y `orden`) no
tocan base ni red: entra data, sale un resultado. Ahí es donde hay que agregar
casos cuando aparezca una regla nueva — son baratos de testear y es donde un error
se paga caro.

---

## 8. Lo que NO hay que hacer

- **No cerrar un gate sin su evidencia.** Si el criterio es "tres liquidaciones
  reales cuadran", no vale un test con datos inventados.
- **No inventar precios ni simular cobro.** El catálogo devuelve `precio: null` a
  propósito.
- **No estimar un índice que no se publicó.** El sistema informa qué falta.
- **No dejar una feature a medias.** Si falta tiempo se corta la feature entera:
  es la regla del playbook y ya se aplicó una vez (los pre-contratos, que después
  se completaron).
- **No subir el `BODY_LIMIT` global** para resolver un caso puntual. Hay límites
  por ruta.
- **No publicar la dirección exacta** en un aviso: va la zona.
