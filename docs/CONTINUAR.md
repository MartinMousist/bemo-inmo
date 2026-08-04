# Bemo INMO — dónde estamos y qué sigue

> Documento de traspaso. Si arrancás una sesión nueva, **leé esto primero** y
> después `CLAUDE.md`, `DESIGN.md` y `docs/roadmap.md`.
>
> Última actualización: 2026-08-04.

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
| Commits | 12 |
| Migraciones | 12 |
| Tests | **300, en verde**, contra Postgres real |
| Rutas de API | 134 |
| Pantallas | 25 |
| Líneas (sin tests) | ~15.900 |

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
| **Google Maps** | ⚙️ Código listo, **falta la API key**. Sin ella la app no inventa coordenadas: ofrece cargarlas a mano y dice por qué |
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

### 🟠 Prioridad 1 — fallan solas, no hipotéticamente

**1.1 · Límite de intentos en el login.**
Verificado: **no hay ninguno**. `bcrypt` costo 12 hace lento cada intento pero no
frena un ataque sostenido.
→ `@nestjs/throttler` en `POST /auth/login`, `/auth/refresh` y
`/auth/invitacion/aceptar`. Sugerido: 10 intentos por IP cada 15 min.
→ Test: el intento 11 devuelve 429.

**1.2 · Paginación en cinco endpoints que devuelven todo.**
Sin paginar: `ventas`, `liquidaciones`, `publicaciones`, `avisos`, `indices`.
El plan Medio permite **500 propiedades**, así que esto se rompe **dentro del
límite que vendemos**.
→ Usar `PaginacionDto` + `armarPagina` de `src/common/paginacion.ts`, que ya
existen y se usan en personas, propiedades, oportunidades y contratos.

**1.3 · Cinco consultas dentro de bucles (N+1).**
La peor: `liquidaciones.service.ts` hace una consulta por línea. Cerrar el mes con
200 contratos se vuelve lento justo el día que más se usa.
Archivos: `planes.service.ts:53`, `contratos.service.ts:159`,
`ventas.service.ts:156`, `propiedades.service.ts:323`, `plantillas.service.ts:49`.
→ Insertar en lote con `unnest()` o `INSERT ... SELECT`.

---

### 🟡 Prioridad 2 — lo que pediste

**2.1 · Pantalla de inicio (dashboard).**
Hoy se entra a Propiedades, que es un archivo. Un administrador abre el sistema
para saber **qué tiene que hacer hoy**. Los datos ya existen todos.

Contenido propuesto:
- Qué vence esta semana (de `GET /v1/contratos/vencimientos`)
- Aumentos por confirmar, con el monto (de `contrato_ajuste` en estado `proyectado`)
- Cuotas impagas y el total adeudado
- Liquidaciones del mes en borrador
- Oportunidades sin contactar hace más de N días
- Cuatro números arriba: cartera, contratos vigentes, cobrado del mes, por cobrar

Ruta `/` cuando hay sesión (hoy redirige a `/propiedades`).
**Nada de gráficos decorativos**: números y listas accionables, cada una con su link.

**2.2 · Gestión de alquileres en formato lista.**
Hoy `ContratosPage` es una tabla básica. Falta:
- Vista de **cartera de alquileres** con una fila por contrato y sus columnas de
  gestión: próximo aumento, última cuota, saldo, estado de cobranza
- Filtros por estado de cobranza, índice, mes de vencimiento
- Acciones en línea sin entrar a la ficha: confirmar aumento, registrar cobro
- Selección múltiple para generar cuotas o proyectar ajustes en tanda
- Alternar entre lista compacta y tarjetas

**2.3 · Landing como appmiti.**
⚠️ **No pude ver appmiti**: la navegación fue denegada y `appmiti.com` devuelve
**403** a la descarga. La portada actual (`web/src/paginas/LandingPage.vue`) es un
diseño propio con la estructura estándar del género.
→ **Hace falta que pases capturas** de `appmiti.com` y `appmiti.com/login`. Con eso
se replica la arquitectura visual, con copy y marca propios (copiar textos e
imágenes de otra empresa deja expuesto legalmente y diría cosas que no son de este
producto).

**2.4 · Estética, siguiente pasada.**
- Un `UiToasts` + store de UI: hoy los errores se muestran como bloques rojos
  dentro de la página. Un toast con detalle (*"Cobro registrado · ARS 485.000"*)
  es lo que falta.
- `UiConfirm` como promesa (`await ui.confirm({...})`) para lo destructivo: hoy
  borrar no pide confirmación en ningún lado.
- Estados de carga por fila, no sólo skeletons de pantalla completa.
- Revisar la app entera a 375px: sólo se verificó que los breakpoints existan.
- Pasada de accesibilidad: foco visible ya está, falta revisar contraste en modo
  oscuro y navegación por teclado en las tablas.

---

### 🟢 Prioridad 3 — sostenibilidad

**3.1 · Tests de frontend.** Hoy hay **cero**. Los cuatro bugs de UI de esta
construcción se encontraron mirando el navegador a mano.
→ Vitest + Testing Library. Cubrir: login y refresh single-flight, ⌘K, el
importador, la galería de fotos, y el formateo de `dominio/formato.ts` (que ya tuvo
un bug de zona horaria).

**3.2 · Observabilidad.** No hay request-id ni logging estructurado. Diagnosticar
algo en producción sería `grep` sobre logs sueltos.
→ Middleware de request-id + logger JSON. Después, un servicio de errores.

**3.3 · El backup no corre solo.** El script existe y lo ejecuta una persona.
→ Cron en el servidor, o un contenedor con `ofelia`/`cron`.

**3.4 · Deploy.** No hay servidor, dominio ni TLS. El `Dockerfile` de producción
está listo (multi-stage, sin devDeps, usuario sin privilegios).
→ Decidir dónde. Con `docker compose` + Caddy alcanza para empezar.

**3.5 · Google Maps.** El código está; falta la key.
→ Crear el proyecto, habilitar **Geocoding API** y **Maps Embed**, restringir por
dominio y poner `GOOGLE_MAPS_API_KEY` en `.env`. Ojo con el costo: ya está resuelto
que se geocodifica una vez y el mapa interactivo va bajo demanda.

---

## 6. Prompt para arrancar la próxima sesión

```
Seguimos con Bemo INMO, en ~/Documents/bemo-inmo.

Leé docs/CONTINUAR.md y después CLAUDE.md, DESIGN.md y docs/roadmap.md.
Ya están las nueve etapas construidas y 300 tests en verde.

Trabajamos como siempre:
- Cada feature va completa: migración con RLS, servicio, controlador con roles,
  tests (camino feliz + cada denegación + aislamiento) y pantalla.
- Verificá de verdad: tests contra la base real y la app en el navegador.
- Si algo queda sin hacer o no lo pudiste probar, decímelo explícitamente.
- Nada de datos falsos: lo que no existe se marca "en desarrollo" con el motivo.

Empezá por [la prioridad que elijas de la sección 5].
```

---

## 7. Mapa del código

```
api/src/
  configurar-app.ts     TODA la configuración; la usan main.ts y los tests
  common/               error RFC 9457, paginación, CSV
  auth/                 login, refresh con rotación, guards, roles
  personas/  propiedades/  oportunidades/     ← espina compartida (etapa 3)
  alquileres/
    ajustes.motor.ts    el cálculo del aumento. PURO, 17 tests de papel
    bcra.service.ts     ICL y UVA. Contrato verificado
    contratos.service.ts  contratos, ajustes, cuotas, cobros, vencimientos
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
  componentes/          AppShell, CommandPalette, GaleriaFotos, primitivos
  paginas/              25 pantallas
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
