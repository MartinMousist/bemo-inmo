# PLAYBOOK — cómo se construye acá

> **⚠️ Este archivo es una reconstrucción.**
>
> El playbook original nació en **Bemo MED** y no estaba en este repositorio, pero
> `CLAUDE.md` decía que se sigue al pie de la letra y sus errores se citan **por
> número** desde `docs/roadmap.md`, `docs/CONTINUAR.md`, `api/migrations/002_tenant.sql`
> y `web/src/stores/auth.ts`. Una sesión nueva lo buscaba y no lo encontraba.
>
> Lo de acá está reconstruido **de lo que el propio repositorio ya afirma** — no
> hay nada inventado. Si tenés el original de Bemo MED, reemplazalo: es el
> canónico. Ojo con una cosa que ya está anotada en `docs/suite.md` (punto G5):
> **el original dice que el stack es "Vue 3 + NestJS + Postgres" y eso es de este
> proyecto, no del playbook.** El método es correcto; la línea del stack no.

---

## La idea, en una línea

**Un gate no se cierra con código: se cierra con evidencia.**

Todo lo demás sale de ahí.

---

## 1. Etapas con gates

El trabajo va en etapas numeradas. Cada una tiene un **gate**: un criterio de
salida escrito de antemano. No se pasa a la siguiente sin cumplirlo.

Las etapas de negocio son tan obligatorias como las técnicas. La etapa 0 —
confirmar que hay demanda con un número y no con entusiasmo — es una etapa, no
un trámite previo.

**Si el gate es un test y no hay test, el gate no está cerrado: sólo se escribió
código.**

Un gate abierto se marca abierto. Dar por cerrado uno cuya evidencia no existe
es el error #2, y es el que hace que un proyecto parezca terminado cuando no
empezó.

## 2. Cada feature va completa o no va

```
migración (tabla + RLS + permisos)
   → servicio con sus reglas de negocio
   → controlador con sus roles
   → tests: camino feliz + cada denegación + aislamiento entre inquilinos
   → pantalla
   → verificación en el navegador
   → marcarla como disponible en el catálogo
```

**Si falta tiempo se cortan features enteras, nunca las capas de una feature.**
Media feature no es media feature: es una feature que no existe más una promesa
en la interfaz.

Una feature "hecha en el back" no está hecha.

## 3. Verificar de verdad

- Tests contra la base **real**, con las **mismas migraciones que producción**.
  Un schema armado a mano para los tests prueba otra cosa que la que se despliega.
- La aplicación corriendo **en el navegador**.
- Y decir explícitamente lo que quedó sin hacer o sin probar.

Corolario que costó caro: **la configuración de la aplicación va en un solo
lugar**. Duplicarla entre `main.ts` y el arnés de tests hizo que la suite corriera
contra una app sin `helmet` — es decir, contra una app que no era la que se
despliega, y justo en la capa de seguridad.

## 4. Honestidad de producto

Nada de datos falsos en la interfaz. Lo que no existe dice **"En desarrollo" con
el motivo**, no un ✓. Sin precios inventados, sin cobro simulado, sin
`Visa •••• 4242`, sin testimonios de clientes que no son clientes.

Es una regla de producto, no de estética: un sistema que miente en una pantalla
chica es un sistema en el que no se puede confiar en la pantalla grande — y acá
las pantallas grandes tienen plata de terceros.

---

## Los siete errores que ya sabemos que se cometen

Se citan por número a lo largo del repositorio. Debajo de cada uno, **lo que
costó en este proyecto** — porque los siete se cometieron o se estuvieron por
cometer, y ésa es la parte que sirve.

### #1 · Construir cinco etapas sin cerrar la etapa 0

Se construyen sobre una hipótesis sin verificar.

*Acá*: la etapa 0 **sigue abierta**. Hay diez etapas construidas y todavía nadie
dijo un precio concreto. Está marcado así en el roadmap a propósito, en vez de
tildarlo.

### #2 · Gates que son tests, sin tests

Se cierran etapas que nunca se verificaron.

*Acá*: cinco gates están marcados ⚠️ ABIERTO aunque el código esté completo,
porque necesitan liquidaciones reales, un convenio comercial o un cliente. Y la
etapa 1 arrastró un pendiente durante dos días —"CI sin verificar, no hay repo
remoto"— hasta que hubo repo. **La primera corrida del CI falló**: no levantaba
S3, así que los diez tests de fotos nunca habían corrido en CI.

### #3 · Crear una tabla que ningún código lee

La feature no existe en la práctica.

*Acá*: la etapa 10 entera salió de encontrar esto. `punitorio_diario_pct` se
cargaba, se guardaba y **se imprimía en el contrato** —«devengará un interés
punitorio del X% diario»— y ningún código lo calculaba: el sistema imprimía una
cláusula legal que después no aplicaba. Lo mismo con `contrato_anterior_id`
(renovación), `deposito_devuelto_el` (depósito) y el estado `pagada` de las
liquidaciones.

**Corolario**: no crear una tabla sin su endpoint y su pantalla en el mismo
movimiento.

### #4 · Arreglar el síntoma

Un reintento que baja la frecuencia del deadlock no lo elimina.

*Acá*: los contratos solapados se resuelven con un constraint `EXCLUDE` **más**
un advisory lock que serializa antes de tocarlo — no con un `SELECT` previo, que
no sobrevive a dos requests simultáneos. Y la variante de este error: optimizar
sobre una hipótesis. "La cartera va a andar lenta con 500 propiedades" se
**midió** antes de tocar nada (`scripts/medir-cartera.sh`): 20 ms. No hacía falta
optimizar.

### #5 · Hacer asíncrono algo que no lo necesita

*Acá*: la renovación de sesión es **single-flight**. Si cinco requests fallan a
la vez con 401 y cada uno renueva por su cuenta, el token rota cinco veces,
cuatro quedan consumidos, y el backend lo lee —correctamente— como reuso y cierra
todas las sesiones del usuario.

### #6 · Confiar en un test flaky

Falla una de cada cuatro veces y es un 500 real bajo contención.

*Acá*: el `ECONNRESET` con requests en paralelo parecía un bug de concurrencia de
la aplicación y era del arnés de test — supertest hace `listen(0)` por request si
el server no está escuchando. Se arregló el arnés, no se bajó la concurrencia del
test.

### #7 · Instalar dependencias sólo en el host

Cuando el contenedor tiene su propio volumen de `node_modules`, no rompe al
instalar: **rompe al reiniciar**.

*Acá*: se instala adentro (`docker compose exec api npm i <paquete>`) o se
reconstruye la imagen. Está en la primera línea de "trampas conocidas" de
`docs/CONTINUAR.md` por algo.

---

## Lo que este proyecto agregó al playbook

Salieron de trabajar acá y valen para cualquier cosa que maneje plata ajena:

**Un cero es un número.** En una pantalla de plata, mostrar `0` cuando no hay
permiso o no hay dato es mentir. Va `null`, y la pantalla dice por qué.

**Ningún monto sin su moneda.** ARS y USD conviven en el mismo listado. Un total
que los mezcle no significa nada, y un `$` ambiguo es un error de plata, no de
diseño.

**Todo cálculo lleva su memoria.** Qué índice, qué período, qué coeficiente, qué
base. Un aumento que el usuario no le puede explicar al inquilino no sirve.

**Un permiso que se puede esquivar por otra puerta no es un permiso.** Si un rol
recibe 403 en `/liquidaciones`, la pantalla de inicio tampoco puede mostrarle el
cobrado del mes.

**Truncar no es paginar.** Un `LIMIT 200` pelado devuelve 200 filas sin decir que
hay una 201 ni cómo llegar a ella.

**Lo que queda sin hacer se escribe con su motivo.** "Sin paginar" tiene que ser
una decisión con su razón en un test, no un olvido que nadie notó.

---

## Cómo se lee este repositorio

| Archivo | Qué es |
|---|---|
| [`docs/CONTINUAR.md`](docs/CONTINUAR.md) | **Estado real y qué sigue.** Se lee primero, siempre |
| [`CLAUDE.md`](CLAUDE.md) | Las reglas del proyecto que no se negocian |
| [`PLAYBOOK.md`](PLAYBOOK.md) | Esto: el método, que no depende del proyecto |
| [`DESIGN.md`](DESIGN.md) | Fuente de verdad visual |
| [`docs/roadmap.md`](docs/roadmap.md) | Las etapas con sus gates |
| [`docs/spec.md`](docs/spec.md) | Modelo de datos, permisos, reglas de negocio |
