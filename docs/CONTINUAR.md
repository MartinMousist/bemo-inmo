# Bemo INMO — dónde estamos y qué sigue

> Documento de traspaso. Si arrancás una sesión nueva, **leé esto primero** y
> después `CLAUDE.md`, `DESIGN.md` y `docs/roadmap.md`.
>
> Última actualización: 2026-08-04 (segunda sesión del día).

---

## 1. Arrancar en dos minutos

```bash
cd ~/Documents/bemo-inmo
docker compose up -d          # db + s3 (MinIO) + api + web
```

| Qué | Dónde | Credenciales |
|---|---|---|
| App | http://localhost:5173 | `owner@prueba.test` / `unaclavelarga1` |
| Portada pública | http://localhost:5173/ | — |
| API | http://localhost:3000/v1/health | — |
| Consola de MinIO | http://localhost:9001 | las de `.env` (`S3_ACCESS_KEY` / `S3_SECRET_KEY`) |

```bash
docker compose exec api npm test          # 300 tests contra Postgres real
docker compose exec api npx tsc --noEmit  # typecheck backend
docker compose exec web npx vue-tsc --noEmit
./scripts/backup.sh                       # backup + verificación automática
```

**Trampa conocida**: las dependencias se instalan **dentro** del contenedor
(`docker compose exec api npm i <paquete>`). El `node_modules` vive en un volumen
anónimo; instalar sólo en el host no rompe al instalar, rompe al reiniciar.

---

## 2. Estado real

| | |
|---|---|
| Commits | 19 |
| Migraciones | 12 |
| Tests | **359, en verde**, contra Postgres real |
| Rutas de API | 142 |
| Pantallas | 26 |

### Etapas

| # | Etapa | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 0 | Validación | ⚠️ **ABIERTA** | Que alguien diga un precio concreto |
| 1 | Fundaciones | ✅ | CI sin verificar: falta repo remoto |
| 2 | Auth y aislamiento | ✅ | — |
| 3 | Espina compartida | ✅ | — |
| 4 | Alquileres | ⚠️ construida | **Tres liquidaciones reales tuyas** |
| 5 | Ventas y comisiones | ⚠️ construida | Una venta real con su reparto |
| 6 | Publicaciones | ⚠️ Plan B listo | Convenio con un portal (no es código) |
| 7 | Recordatorios | ⚠️ generación lista | Proveedor de mail · verificación de WhatsApp |
| 8 | Piloto | ⚠️ lista | 30 días de uso diario |
| 9 | Planes | ⚠️ lista | Un cliente y un medio de pago |

**Ningún gate abierto depende de código.** Están marcados así a propósito: dar por
cerrado un gate cuya evidencia no existe es el error #2 del playbook con otra cara.

### Integraciones

| Integración | Estado |
|---|---|
| **BCRA** (ICL + UVA) | ✅ **Funcionando.** Contrato verificado contra la API real (v4.0, variables 40 y 31). 74 períodos cargados de cada uno. Idempotente. `POST /v1/indices/sincronizar` |
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
- ¿Cómo se tratan los punitorios en la liquidación?
- ¿El aumento se redondea? ¿A cuánto?
- ¿Los porcentajes de honorarios de venta cambian por provincia?

---

### ✅ Hecho en esta sesión

Todo lo que era prioridad 1 y 2 está cerrado, con tests. El detalle de cada
decisión está en los mensajes de commit; acá va sólo el titular y lo que
apareció en el camino.

| | Qué | Lo que apareció al hacerlo |
|---|---|---|
| 1.1 | Límite de intentos en `/auth`: por IP **y** por cuenta | `@SkipThrottle()` pelado no salta contadores con nombre. Habría limitado `/auth/yo` |
| 1.2 | Paginación en los cinco endpoints + `UiPager` | `avisos` tenía un `LIMIT 200` pelado: eso no es paginar, es truncar en silencio |
| 1.3 | Seis N+1 pasados a lote | **Bug de plata**: rearmar una liquidación borraba los gastos cargados a mano y se los transfería de más al propietario |
| 2.1 | Pantalla de inicio en `/` | Los bloques de plata vienen en `null` para el asesor, no en cero |
| 2.2 | Cartera de alquileres con acciones en línea y en lote | Un aumento confirmado y en vigencia **no** es el "próximo aumento" |
| 2.3 | Portada: el problema, las garantías y el cierre | La portada prometía el **dólar como índice**, que no existe. Corregido |
| 2.4 | `UiToasts` + `UiConfirm` como promesa | — |
| — | Google Maps: diagnóstico + backfill | El compose **nunca** le pasaba la key al contenedor |

---

### 🟠 Lo que sigue

Está todo en **`docs/roadmap.md`, etapa 10**, con el porqué de cada uno y cómo se
sabe que está hecho. El titular:

- **10.1 · Huecos del dominio.** Columnas que se escriben y nadie lee: punitorios
  (¡que se imprimen en el contrato!), renovación, devolución del depósito.
- **10.2 · Auditoría de la plata.** Cerrar una liquidación no guarda quién la cerró.
- **10.3 · Lo que se rompe con volumen.** La segunda tanda de paginación y los
  agregados de la cartera.
- **10.4 · Diagnóstico en producción.** Request-id, backup automático con
  restauración probada, deploy, tests de frontend.
- **10.5 · Producto.** Portal del propietario, caja del día.

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

Leé docs/CONTINUAR.md y después CLAUDE.md, DESIGN.md y docs/roadmap.md.
Ya están las nueve etapas construidas y 359 tests en verde.

Trabajamos como siempre:
- Cada feature va completa: migración con RLS, servicio, controlador con roles,
  tests (camino feliz + cada denegación + aislamiento) y pantalla.
- Verificá de verdad: tests contra la base real y la app en el navegador.
- Si algo queda sin hacer o no lo pudiste probar, decímelo explícitamente.
- Nada de datos falsos: lo que no existe se marca "en desarrollo" con el motivo.

Empezá por [el punto que elijas de la etapa 10 del roadmap].
```

---

## 7. Mapa del código

```
api/src/
  configurar-app.ts     TODA la configuración; la usan main.ts y los tests
  common/               error RFC 9457, paginación, CSV
  auth/                 login, refresh con rotación, guards, roles
  personas/  propiedades/  oportunidades/     ← espina compartida (etapa 3)
  inicio/               el tablero del día: un endpoint, una vuelta
  alquileres/
    ajustes.motor.ts    el cálculo del aumento. PURO, 17 tests de papel
    bcra.service.ts     ICL y UVA. Contrato verificado
    contratos.service.ts  contratos, ajustes, cuotas, cobros, vencimientos
    cartera.service.ts  la vista de gestión + las acciones en lote
    liquidaciones.service.ts
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
  stores/ui.ts          toasts + confirmar() como promesa
  componentes/          AppShell, CommandPalette, GaleriaFotos, UiPager, primitivos
  paginas/              26 pantallas
```

**Los cuatro motores puros** (`ajustes`, `comisiones`, `aviso`, `plantillas`) no
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
