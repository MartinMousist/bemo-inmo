# Bemo INMO — sistema de gestión para inmobiliarias (Argentina)

Producto del grupo **BEMO**, junto a Bemo MED (agenda y fichas clínicas). BEMO es una
**marca compartida, no un stack compartido**: cada producto es independiente. Ver
`docs/suite.md`.

Multi-tenant. Cada inmobiliaria es un tenant aislado. Maneja plata de terceros
(liquidaciones a propietarios) y contratos con validez legal: los números tienen que
estar bien y tienen que poder explicarse.

**➜ Si arrancás una sesión nueva, leé primero `docs/CONTINUAR.md`.** Tiene el estado
real, las decisiones ya tomadas, las trampas descubiertas y qué sigue en orden.

Documentos clave:
- `docs/CONTINUAR.md` — **traspaso entre sesiones**. Empezá por acá.
- `docs/spec.md` — spec técnico: modelo de datos, permisos, reglas de negocio, criterios de aceptación.
- `docs/roadmap.md` — las etapas con sus gates. No se pasa de etapa sin cerrar el gate.
- `docs/suite.md` — arquitectura del grupo BEMO y convenciones de nombres.
- `DESIGN.md` — sistema de diseño. Fuente de verdad visual.

Stack: **Vue 3 + Vite + Pinia** (front) · **NestJS** (back) · **PostgreSQL 16 con RLS** ·
Docker Compose para dev. Node 20 en todos los contenedores.

El playbook (`PLAYBOOK.md`) se sigue **al pie de la letra**. Bemo MED corre otro stack
(Spring + MariaDB); es historia de MED y no condiciona nada acá.

## Cómo se trabaja acá

**Cada feature va completa o no va.** Migración con RLS y permisos → servicio con sus
reglas → controlador con sus roles → tests (camino feliz + cada denegación + aislamiento
entre tenants) → pantalla → verificación en el navegador. Una feature "hecha en el back"
no está hecha. Si falta tiempo, se cortan features enteras, nunca capas de una feature.

**No crear una tabla sin su endpoint y su pantalla en el mismo movimiento.** Una tabla que
nadie lee es una feature que no existe.

**Verificar de verdad.** Tests contra Postgres real con las mismas migraciones de
producción. La app corriendo en el navegador. Y decir explícitamente lo que quedó sin
hacer o sin probar.

## Reglas del dominio que no se negocian

- **Ningún monto sin su moneda.** ARS y USD conviven en el mismo listado. Un número
  suelto en una pantalla de plata es un bug.
- **Todo cálculo lleva su memoria de cálculo** consultable desde la UI: qué índice, qué
  período, qué coeficiente, qué base. Un aumento que el usuario no puede explicarle al
  inquilino no sirve.
- **Un ajuste confirmado es inmutable.** Si INDEC revisa el IPC después, el ajuste ya
  notificado no se recalcula. Se guarda el valor del índice usado, no se lo vuelve a leer.
- **Los valores de índices son dato público y global**, no van scopeados por tenant.
- **Fechas en dd/mm/aaaa.** Nunca formato US.

## Honestidad de producto

Nada de datos falsos en la UI. Cada capacidad del catálogo lleva `status: 'available' |
'soon'`; lo que no existe se muestra como "En desarrollo", no con un ✓. Controles reales
deshabilitados con la nota de cuándo llegan. Nunca facturas falsas ni tarjetas de mentira.

## Design System

Leé `DESIGN.md` antes de cualquier decisión visual. Tipografías, colores, espaciado y
dirección estética están definidos ahí. No te desvíes sin aprobación explícita.
