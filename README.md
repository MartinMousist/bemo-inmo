# Bemo INMO

Sistema de gestión para inmobiliarias argentinas. Producto del grupo **BEMO**,
junto a Bemo MED.

Alquileres con índice (IPC · ICL · UVA · Casa Propia), liquidación a
propietarios, ventas con comisiones en tres niveles, y portal de sólo lectura
para el dueño. Multi-tenant con aislamiento en la base, no sólo en la aplicación.

**Vue 3 + Vite + Pinia** · **NestJS** · **PostgreSQL 16 con RLS** · Docker Compose

[![CI](https://github.com/MartinMousist/bemo-inmo/actions/workflows/ci.yml/badge.svg)](https://github.com/MartinMousist/bemo-inmo/actions/workflows/ci.yml)

---

## Arrancar una sesión de trabajo

Si vas a seguir el desarrollo —con Claude o con quien sea— **el orden de lectura
importa**, y es éste:

1. **[`docs/CONTINUAR.md`](docs/CONTINUAR.md)** — el estado real: qué está hecho,
   qué gates siguen abiertos, las trampas ya descubiertas y qué sigue en orden.
   Se lee primero, siempre.
2. **[`CLAUDE.md`](CLAUDE.md)** — las reglas del proyecto que no se negocian.
3. **[`PLAYBOOK.md`](PLAYBOOK.md)** — el método: etapas con gates, y los siete
   errores que ya sabemos que se cometen.
4. **[`DESIGN.md`](DESIGN.md)** — fuente de verdad visual.
5. **[`docs/roadmap.md`](docs/roadmap.md)** — las etapas con sus criterios de
   salida.

Para el detalle de la última jornada —qué se construyó, **qué se rompió y por
qué**— está [`docs/SESION-2026-08-04.md`](docs/SESION-2026-08-04.md). Se lee una
vez y no se vuelve.

### Prompt para arrancar

```
Seguimos con Bemo INMO, en ~/Documents/bemo-inmo.

Leé docs/CONTINUAR.md y después CLAUDE.md, PLAYBOOK.md, DESIGN.md y
docs/roadmap.md.

Estado: once etapas cerradas, 480 tests de API contra Postgres real y 57 de
front, todo en verde. El seed trae 16 propiedades, 15 contratos y su ciclo de
cobranza: entrás con owner@andes.test / unaclavelarga1.

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

## Levantar el proyecto

Requiere Docker con Compose v2.

```bash
cp .env.example .env      # y cambiar las contraseñas
docker compose up --build
git config core.hooksPath .githooks   # una vez por clon: hook de secretos
```

| Qué | Dónde | Credenciales |
|---|---|---|
| App | http://localhost:5173 | `owner@andes.test` / `unaclavelarga1` |
| API | http://localhost:3000/v1/health | — |
| Consola de MinIO | http://localhost:9001 | las de `.env` |

En dev la API migra y siembra sola al arrancar (`MIGRATE_ON_BOOT`, `SEED_ON_BOOT`).
En producción el seed **no existe en la imagen** y además `env.ts` lo rechaza.

> **Trampa conocida**: las dependencias se instalan **dentro** del contenedor
> (`docker compose exec api npm i <paquete>`). El `node_modules` vive en un
> volumen anónimo: instalar sólo en el host no rompe al instalar, rompe al
> reiniciar. Es el error #7 del playbook.

## Tests

Contra **Postgres real** y **S3 real**, con las **mismas migraciones que
producción**. Un schema armado a mano para los tests prueba otra cosa que la que
se despliega.

```bash
docker compose exec api npm test            # 480 tests
docker compose exec web npm test            #  57 tests
docker compose exec api npx tsc --noEmit
docker compose exec web npx vue-tsc --noEmit
```

## Herramientas

```bash
./scripts/backup.sh                     # backup a mano, verificado restaurando
docker compose --profile backup up -d   # backup automático y diario
./scripts/medir-cartera.sh 500          # carga 500 contratos, mide y borra
```

## Producción

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

La guía completa —servidor, DNS, TLS, backups fuera del disco y lo que este
deploy **no** resuelve— está en [`docs/deploy.md`](docs/deploy.md).

> Los artefactos están probados hasta donde se puede sin servidor: las imágenes
> compilan, el compose valida y el Caddyfile valida. **Un deploy real todavía no
> se hizo.**

---

## Estructura

```
api/
  migrations/       SQL versionado. Una migración aplicada es INMUTABLE.
  seeds/            Datos demo. Nunca corre en producción.
  src/
    config/env.ts   Validación de entorno al arrancar. Sin defaults inseguros.
    common/         Error RFC 9457, paginación, request-id, logger JSON
    database/       Pool restringido, withTenant(), migrador
    auth/           Login, refresh con rotación, guards, límite de intentos
    alquileres/     El motor: ajustes, punitorios, cuotas, cobros, liquidación
    ventas/         Comisiones en tres niveles
    portal/         Acceso de sólo lectura del propietario
  test/             Aislamiento entre inmobiliarias + contrato de error
db/init/            Creación de roles. Corre una sola vez, como superusuario.
web/
  src/styles/       Tokens de DESIGN.md. Ningún componente define un color.
  src/dominio/      Formato y reglas de negocio del front
  test/             Vitest
```

**Los motores puros** —`ajustes`, `punitorios`, `comisiones`, `aviso` y
`plantillas`— no tocan base ni red: entra data, sale un resultado. Ahí es donde
hay que agregar casos cuando aparezca una regla nueva: son baratos de testear y
es donde un error se paga caro.

## Dos cosas que hay que entender antes de tocar la base

**Hay dos roles de Postgres, a propósito.** El *owner* es dueño del schema y sólo
lo usa el migrador. La app corre con `app_role`, que no es dueño de nada — por
eso las policies de RLS le aplican de verdad. Un rol dueño saltea RLS salvo
`FORCE ROW LEVEL SECURITY`, y con eso puesto el migrador tampoco podría sembrar.

**Sin contexto de tenant no se ve nada.** `app_current_tenant()` devuelve `NULL`
si nadie lo fijó, y `tenant_id = NULL` no es `TRUE`: las policies no dejan pasar
ninguna fila. El default de un olvido es "cero filas", no "la base entera". Hay
un test que lo prueba y otro que verifica que el pool no quede contaminado entre
requests.

Todo acceso a datos de inmobiliaria va por `db.withTenant(tenantId, ...)` y usa
el ejecutor que recibe el callback. Una consulta por fuera sale por otra conexión
del pool, sin contexto, y no ve nada.

---

## Estado

**Once etapas cerradas.** 480 tests de API contra Postgres real y 57 de front,
todo en verde.

La etapa 11 salió de **abrir la aplicación y usarla**, no de leer código: dos
pantallas estaban rotas en `main` y ningún test las agarró, porque los gates que
las cubrían eran de API. Un gate de API no cierra una feature que tiene pantalla.

Los gates que quedan abiertos **no dependen de código**: necesitan un precio
concreto, tres liquidaciones reales, un convenio comercial, una API key o un
servidor. Están marcados así a propósito — dar por cerrado un gate cuya evidencia
no existe es el error #2 del playbook.

Ver [`docs/CONTINUAR.md`](docs/CONTINUAR.md) para el detalle.

**No hay datos falsos en la interfaz**: lo que no existe dice "En desarrollo" con
el motivo.
