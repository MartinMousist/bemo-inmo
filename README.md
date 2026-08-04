# Bemo INMO

Sistema de gestión para inmobiliarias argentinas. Producto del grupo **BEMO**.

Documentos que gobiernan el proyecto:

| Archivo | Qué es |
|---|---|
| [`docs/CONTINUAR.md`](docs/CONTINUAR.md) | **Estado actual y qué sigue.** Empezá por acá |
| [`CLAUDE.md`](CLAUDE.md) | Las reglas que no se negocian |
| [`DESIGN.md`](DESIGN.md) | Sistema de diseño. Fuente de verdad visual |
| [`docs/spec.md`](docs/spec.md) | Modelo de datos, permisos, reglas de negocio |
| [`docs/roadmap.md`](docs/roadmap.md) | Las 10 etapas con sus gates |
| [`docs/suite.md`](docs/suite.md) | El grupo BEMO y sus convenciones |

---

## Levantar el proyecto

Requiere Docker con Compose v2.

```bash
cp .env.example .env   # y cambiar las contraseñas
docker compose up --build
```

- API — http://localhost:3000/v1/health
- Web — http://localhost:5173

En dev, la API migra y siembra sola al arrancar (`MIGRATE_ON_BOOT`, `SEED_ON_BOOT`).

Activar el hook de secretos, una vez por clon:

```bash
git config core.hooksPath .githooks
```

## Tests

Corren contra **Postgres real** con las **mismas migraciones que producción**. Un schema
armado a mano para los tests prueba otra cosa que la que se despliega.

```bash
docker compose up -d db && docker compose run --rm api npm test
```

## Estructura

```
api/
  migrations/       SQL versionado. Una migración aplicada es inmutable.
  seeds/            Datos demo. Nunca corre en producción.
  src/
    config/env.ts   Validación de entorno al arrancar. Sin defaults inseguros.
    common/         Contrato de error RFC 9457 + catálogo de códigos
    database/       Pool restringido, withTenant(), migrador
    health/
  test/             Aislamiento entre inmobiliarias + contrato de error
db/init/            Creación de roles. Corre una sola vez, como superusuario.
web/
  src/styles/       Tokens de DESIGN.md. Ningún componente define un color.
```

## Dos cosas que hay que entender antes de tocar la base

**Hay dos roles de Postgres, a propósito.** El *owner* es dueño del schema y sólo lo usa el
migrador. La app corre con `app_role`, que no es dueño de nada — por eso las policies de RLS
le aplican de verdad. Un rol dueño saltea RLS salvo `FORCE ROW LEVEL SECURITY`, y con eso
puesto el migrador tampoco podría sembrar.

**Sin contexto de tenant no se ve nada.** `app_current_tenant()` devuelve `NULL` si nadie lo
fijó, y `tenant_id = NULL` no es `TRUE`: las policies no dejan pasar ninguna fila. El default
de un olvido es "cero filas", no "la base entera". Hay un test que lo prueba, y otro que
verifica que el pool no quede contaminado entre requests.

Todo acceso a datos de inmobiliaria va por `db.withTenant(tenantId, ...)` y usa el ejecutor
que recibe el callback. Una consulta por fuera sale por otra conexión del pool, sin contexto,
y no ve nada.

## Estado

**Las nueve etapas construibles están hechas.** 300 tests en verde contra Postgres
real. Los gates que quedan abiertos no dependen de código: necesitan datos reales,
un convenio comercial, un cliente o tiempo.

Ver [`docs/CONTINUAR.md`](docs/CONTINUAR.md) para el detalle y qué sigue.

No hay datos falsos en la UI: lo que no existe dice "En desarrollo" con el motivo.
