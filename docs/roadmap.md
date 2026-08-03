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
- [ ] CI (GitHub Actions) corriendo la suite — pendiente, no hay remoto todavía
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
- [ ] Importador CSV de cartera — **pendiente**
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

## Etapa 4 — Alquileres vivos (el primer corte vertical)

**Qué**: el motor. Es la razón de ser del producto.

- [ ] `contrato_alquiler` + partes + garantías
- [ ] Ingesta de índices: IPC (INDEC), ICL y UVA (BCRA), ICP. Job diario + carga manual de respaldo
- [ ] Motor de ajustes: proyectado → confirmado → notificado → aplicado, con memoria congelada
- [ ] Constraint `EXCLUDE` de contratos solapados + advisory lock + reintento de `40001`/`40P01`
- [ ] Calendario de vencimientos con semáforo (90/60/30/7 días)
- [ ] Generación idempotente de períodos
- [ ] Cobros y estado de cuenta por contrato
- [ ] Liquidación mensual al propietario, con reparto por condominio
- [ ] Avisos de aumento y de vencimiento (email + in-app)

**Gate — el más importante de todos**: se toman **tres liquidaciones reales del mes
pasado** y el sistema devuelve exactamente los mismos números. Si difiere en un peso, el
gate no está cerrado.
**Esfuerzo**: 3 semanas.
**Trampa conocida**: aflojar el gate porque "difiere poco". La diferencia de un peso
siempre es una regla que no se entendió.

---

## Etapa 5 — Cierre de ventas

**Qué**: lo que pasa después de la reserva en una operación de venta.

- [ ] `operacion_venta`: reserva → boleto → escritura
- [ ] Calculadora de comisiones de tres niveles: cuánto cobra la operación, cómo se reparte
      entre inmobiliarias, cómo se reparte puertas adentro
- [ ] Comisiones proyectadas / devengadas / cobradas, con vista por agente
- [ ] Pre-contratos y plantillas de documento con variables

**Gate**: una operación de venta real, liquidada, con las tres puntas repartidas
correctamente y verificadas por quien las cobra.
**Esfuerzo**: 1,5 semanas.

---

## Etapa 6 — Publicaciones

**Qué**: sacar la propiedad al mundo.

- [ ] Generador de aviso: texto, atributos y fotos ordenadas, por portal
- [ ] **Plan B primero**: exportar el aviso completo para pegar. Esto se construye antes
      que cualquier integración, porque no depende de nadie
- [ ] Feed XML propio, estable y público por tenant
- [ ] Integración con el primer portal que dé convenio
- [ ] Estado de publicación por operación, con último sync y último error

**Gate**: un aviso real publicado en al menos un portal, y el estado reflejado en el sistema.
**Esfuerzo**: 1 semana el generador + lo que tarde el convenio.
**Riesgo**: el convenio no depende del código. **Nunca bloquear el roadmap esperándolo.**

---

## Etapa 7 — Recordatorios y automatización

**Qué**: que el sistema avise sin que nadie se lo pida.

- [ ] `evento_programado` con reintentos y registro de fallos
- [ ] WhatsApp Business Cloud API con plantillas aprobadas
- [ ] Recordatorios: vencimiento de contrato, aumento próximo, cuota impaga, reserva por
      vencer, visita agendada
- [ ] Preferencias de canal por persona

**Gate**: la inmobiliaria dejó de mirar el Excel de vencimientos. Verificado preguntando,
no suponiendo.
**Esfuerzo**: 1,5 semanas.

---

## Etapa 8 — Piloto sostenido

**Qué**: usarlo de verdad, todos los días.

- [ ] Backup automatizado + restore **probado** contra una base de ensayo
- [ ] Dockerfile de producción multi-stage, sin devDeps, usuario sin privilegios
- [ ] Estilos de impresión + export CSV de todo lo que sea una tabla
- [ ] Suite de permisos completa en verde
- [ ] Revisión de seguridad del sistema entero

**Gate**: 30 días de uso diario sin volver al sistema viejo para nada.
**Esfuerzo**: 1 semana + los 30 días de uso.

---

## Etapa 9 — Segundo cliente y monetización

**Qué**: dejar de ser un sistema interno y ser un producto.

- [ ] Onboarding autoservicio con datos demo
- [ ] Los tres planes con sus límites aplicados de verdad (no sólo en la pantalla de precios)
- [ ] Cobro
- [ ] Campañas Meta (App Review y Business Verification arrancan **acá**, no antes)
- [ ] Multi-sucursal y API pública

**Gate**: una inmobiliaria ajena, pagando, usándolo un mes completo.

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
