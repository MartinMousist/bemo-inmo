# Bemo INMO — dónde estamos y qué sigue

> Documento de traspaso. Si arrancás una sesión nueva, **leé esto primero** y
> después `CLAUDE.md`, `DESIGN.md` y `docs/roadmap.md`.
>
> Para el detalle de una jornada vieja está `docs/SESION-2026-08-04.md`. Se lee
> una vez y no se vuelve.
>
> Última actualización: 2026-08-07. La etapa 11 quedó cerrada; lo que sigue
> está en la sección 5, con su diseño ya resuelto. Lo último en entrar es la
> migración 021 — **comisiones**: compartir con otra inmobiliaria, el % por
> agente, el % por propiedad, el perfil de cada agente y la comisión del
> alquiler. Ver §5.1, que ya no es un pendiente.

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
docker compose exec api npm test           # 801 tests contra Postgres real
docker compose exec web npm test           # 139 tests de front (Vitest)
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
| Migraciones | 23 |
| Tests | **865 de API** contra Postgres real + **194 de front**. Todo en verde |
| Pantallas | 38 |

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
| **BCRA** (Central de Deudores) | ✅ **Funcionando.** Contrato verificado contra la API real: `GET /CentralDeDeudores/v1.0/Deudas/{cuit}` y `…/Deudas/ChequesRechazados/{cuit}`, los dos con el mismo botón. Del DNI se derivan los CUIL posibles y se prueban en orden. El 404 **no es un error**: es «ninguna entidad lo informa», o sea sin deuda ni cheques. Sólo situación 1 se acepta; el veredicto se congela con su fecha y las consultas nuevas se agregan al historial en vez de pisarlo. ⚠️ No consultarlo con datos demo: los DNI del seed son de personas reales |
| **BCRA** (ICL + UVA) | ✅ **Funcionando y automático.** Contrato verificado contra la API real (v4.0, variables 40 y 31). Se sincroniza solo cada 12 h (`SINCRONIZAR_INDICES`), y sigue estando `POST /v1/indices/sincronizar` a mano. Idempotente |
| **INDEC** (IPC) | ❌ Manual **a propósito**. No hay API estable; raspar un HTML que cambia sin aviso pondría un número equivocado en un aviso de aumento |
| **Google Maps** | ⚙️ **Son dos capacidades, y una ya funciona.** `GET /propiedades/capacidades` devuelve `{ geocodificacion, mapaEmbebido }` por separado. **El mapa de la ficha anda HOY, sin key**: es un `<iframe>` a `www.google.com/maps?…&output=embed`, que no lleva key ninguna — verificado con un `fetch` desde el contenedor (HTTP 200) y **visto en el navegador** en PROP-0032. Lo que falta la key es **geocodificar** (dirección → lat/lng): sin ella no se inventan coordenadas, se ofrece cargarlas a mano y la ficha dice de dónde salió cada una. Hay diagnóstico que le pega a Google de verdad y backfill de las cargadas antes. Los pasos exactos para el dueño están en §5, «La API key de Google Maps» |
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
| **Los DNI del seed son de personas reales** | Consultar la Central de Deudores con un garante del seed devolvió el nombre y la deuda bancaria de una persona real, y quedó guardado en la base de desarrollo | Un DNI «inventado» de ocho dígitos le pertenece a alguien. Se borró el registro. **No consultar el BCRA con datos demo**: es un tercero que no dio su consentimiento. El seed no trae ninguna consulta hecha, a propósito |
| **El monto de los cheques rechazados NO viene en miles** | Un cheque de $115.000 se mostraría como $115.000.000 y el garante quedaría rechazado por mil veces lo que debe | En `Deudas` el BCRA informa saldos **en miles** y por eso `evaluar()` multiplica por 1000. En `Deudas/ChequesRechazados` el campo `monto` es el importe del cheque, **en pesos**. Son dos endpoints de la misma API con dos unidades distintas: `evaluarCheques()` no toca esa constante y hay un test que se llama así, en mayúsculas |
| Un tipo de evento nuevo vive en **dos** listas | El generador crea el aviso y el desplegable de Avisos devuelve 400 «El campo «tipo» no es válido» | El CHECK de `evento_programado` y `TIPOS_EVENTO` del DTO enumeran lo mismo en dos archivos. Apareció con `garantia_revision_bcra`, usando la app. Hay un test que lee el CHECK de `pg_constraint` y pide 200 por cada tipo: es lo que mantiene las dos listas juntas |
| Un backtick dentro de un SQL en template literal | `tsc` tira `TS1005: ',' expected` en la línea de abajo, no en la del comentario | Un comentario `-- \`columna\`` dentro de un `` ` ``…`` ` `` cierra el literal. En los SQL embebidos los nombres de columna van sin comillas invertidas |
| **Un pre-contrato NO entra en un `mailto:`** | El mail llega con la mitad de las cláusulas y parece completo | El límite duro son **2.048 caracteres de URL** (shell de Windows y Outlook clásico; el Outlook nuevo subió a 8.192 y Gmail ronda 4.096). Y `encodeURIComponent` infla el texto ~1,5×: cada salto de línea son tres caracteres y cada acento seis. Medido, no estimado: un pre-contrato de 2.087 caracteres queda en una URL de 3.377. Por eso `envio.motor.ts` decide `completo` vs `adjunto` **por el largo** y devuelve el motivo escrito. Nunca se trunca |
| **El IPC del seed estaba vacío** | Un contrato que ajusta por IPC no proyectaba ni un aumento en una base limpia | El ICL y el UVA los trae el cron del BCRA; el IPC es carga manual **a propósito**. `seed.ts` siembra una serie demo con `fuente = 'demo · valor de ejemplo…'`, y **la ancla a los valores que ya existen** (hacia atrás desde el más viejo, hacia adelante desde el más nuevo, interpolando los agujeros). Sin ese anclaje, un demo en escala 100 al lado de un IPC real de 8.412 daría un coeficiente que baja el alquiler un 98%. **ICL y UVA no se siembran nunca**: un mes demo entre once reales es peor |
| **El árbol de comisiones del seed NO era el del motor** | Diez de las once ventas de demostración no cuadraban: PROP-0011 mostraba «Comisión USD 4.860 / A la casa USD 4.860» con un agente llevándose 1.215 | El seed entra por SQL directo y **no pasa por `repartir()`**, que es donde vive la validación. El árbol escrito a mano colgaba el nivel 3 del nivel 2 y emitía filas de nivel 2 con beneficiario `casa`, que el motor nunca produce. En pantalla no se notaba: cada número se veía razonable por separado. Ahora hay un test que recorre TODAS las comisiones de la base y exige `externas + agentes + casa = operación` |
| **`@IsObject()` pelado no valida nada adentro** | `POST /ventas/:id/reparto` con `{"puntas":{"foo":3}}` devolvía **500** | class-validator no mira adentro de un `@IsObject()`: el valor llegaba al motor, se armaba una fila con `punta='foo'` y la que cortaba era la CHECK de Postgres. Lo mismo con una externa sin `nombre`. Estaba tapado porque ninguna pantalla mandaba `externas`; destaparlo era justo el pedido. Ahora son DTOs anidados y dan 400 |
| **El orden de las clases en un DTO no es cosmético** | La API no arrancaba: «Cannot access 'PuntasVentaDto' before initialization», y `tsc --noEmit` pasaba perfecto | Con `emitDecoratorMetadata`, el decorador guarda el tipo de la propiedad **al definir la clase**. Referenciar una clase declarada más abajo explota en el arranque, no en el typecheck. Un DTO que usa otro va SIEMPRE después |
| **`Object.keys` sobre un DTO trae los campos que no vinieron** | Cualquier reparto de alquiler daba 422 por una «punta compradora» que nadie mandó | class-transformer arma la instancia con **todos** los campos declarados; los ausentes quedan en `undefined`. Validar recorriendo las claves necesita filtrar por valor, no por presencia |
| `null` con significado en un PATCH | — | La regla del repo es que un PATCH no escriba NULL sobre lo que no vino. El % de un agente es la **excepción**: `null` significa «heredá el de la inmobiliaria» (COMMENT de la 017), así que con `coalesce($2, columna)` nunca se podría volver de un override a heredar y el usuario vería que borrar el número no hace nada. Se mandan y se escriben los dos campos siempre, y el DTO usa `@ValidateIf(v !== null)` en vez de `@IsOptional()` para que **omitir** el campo sea un 400 |
| Un control in-line en una fila clicable | Tocar el input de honorarios abría la ficha de la propiedad | Las filas de `PropiedadesPage` navegan enteras (`@click` + `@keydown.enter`). Todo lo interactivo que viva adentro necesita `@click.stop` **y** `@keydown.stop`, o con el teclado el Enter que confirma el valor abre la propiedad |
| `monto_vigente` no es una columna | «column c.monto_vigente does not exist» al leer los contratos de un agente | Es un `coalesce` calculado dentro de `SELECT_CONTRATO`: el último ajuste ya vigente, o el monto inicial. Copiar el nombre sin la cuenta rompe; usar `monto_inicial` en su lugar muestra un alquiler viejo |
| El esqueleto de «Nueva plantilla» enseñaba Handlebars | `{{#if contrato.deposito }}` salía **literal** dentro del contrato que se firma, y ni figuraba como variable faltante | El motor usa `{% si x %}…{% fin %}` y `{% para x en lista %}`; nunca tuvo `{{#if}}` ni `{{#each}}`. Estaba en el esqueleto y en la ayuda del editor, o sea que toda plantilla nacida de ahí arrastraba el error |
| **Editar la localidad borraba la ubicación** | `PATCH /propiedades/:id {"localidad":"Godoy Cruz"}` devolvía **200** y la propiedad quedaba sin lat/lng. Idem `{"lat":-32.99}` sin `lng`: borraba las dos | La ubicación se resolvía con el **cuerpo del PATCH**, que no trae `calle`; sin `calle` la función devolvía todo `null` y el UPDATE lo escribía. Ahora se geocodifica la dirección que va a **quedar** —el PATCH sobre lo que ya está en la base—, media coordenada es 422, y cuando no se puede resolver **lo cargado a mano se respeta** (lo de Google se limpia: apuntaba a la dirección vieja). Se encontró probando la API contra la base de dev, no leyendo el código |
| Corregir la **provincia** no re-geocodificaba | El punto quedaba en la provincia vieja | El disparador miraba `calle`, `numero` y `localidad`; `direccionCompleta()` **usa la provincia**. Son cuatro campos, no tres |
| `docker compose restart api` no relee el `.env` | La key nueva «no funciona» | `restart` reinicia el contenedor con el entorno con el que se **creó**. Va `docker compose up -d api`. Y encima `loadEnv()` cachea en el proceso |
| Una capacidad que son dos | Una propiedad con lat/lng cargadas a mano decía «El mapa necesita la API key de Google» y **escondía un mapa que funcionaba** | `capacidades.mapas` mezclaba *geocodificar* (servidor, necesita key) con *mostrar el mapa* (iframe `output=embed`, no la necesita). Ahora son `geocodificacion` y `mapaEmbebido`, con un test de cada lado que impide volver a juntarlas |
| **Un `&nbsp;` entre las llaves rompe la variable en silencio** | En pantalla se ve `{{ contrato.monto }}` idéntico; el motor no lo matchea, no figura como variable faltante y **sale impreso tal cual adentro del contrato que se firma** | El regex del motor es `\{\{\s*([\w.]+)…` y `\s` no incluye U+00A0. Word mete espacios duros al pegar y el conversor los usa para el indentado del bloque de firmas. Se normalizan **sólo adentro de los `{{ }}`** en `plantillas.sanitizar.ts`, y `tokensRotos()` denuncia lo que no se pudo rescatar |
| **Word parte un `{{ }}` en cuatro `<span>`** | Lo mismo: la variable queda como texto muerto que nunca se sustituye | Word mete un `<span>` con identificador de revisión cada dos palabras. Por eso los nueve pasos de `limpiarPegado.ts` tienen un orden que **es el diseño**: los `mso-list` se leen ANTES de tirar los `style` (es el único lugar donde vive el nivel de anidado) y los `{{ }}` se buscan DESPUÉS de desenvolver los spans. Hay un fixture de portapapeles real por cada uno |
| **El largo del envío medido sobre HTML** | Nada falla: `envio.motor.ts` empieza a decir que TODO pre-contrato va «como adjunto», con un motivo que cita un número que no es | Decide `completo` vs `adjunto` con `texto.length`. Con las etiquetas adentro, el pre-contrato del seed pasa de 1.869 a 2.035 caracteres. `DocumentosService.armar()` le pasa `htmlATexto()`, y hay un test que fija los dos números |
| **El XSS entra por el VALOR, no por la plantilla** | Una persona apellidada `<img src=x onerror=…>` ejecuta código en la hoja imprimible de cualquiera | El sanitizador limpia la PLANTILLA; el motor inyecta el valor **después**, y el resultado va a un `v-html`. Lo tapa `renderizar(…, { escaparHtml: true })`, que es aditivo y está apagado por defecto. Si ese paso se saltea, la feature entra con un XSS del que nadie se entera hasta que alguien carga un inquilino con el apellido raro |
| **El chip «se veía bien» y daba 4,25** | — | `--accent` sobre `--accent-tint` en tema claro: por debajo de AA. Es la misma trampa del gris que daba 3,01, con otro color. Va `--accent-ink`: **5,83** en claro y **7,20** en oscuro, medidos calculando el ratio y comprobados contra lo que el navegador computa |
| `htmlparser2` v12 es ESM puro | `SyntaxError: Cannot use import statement outside a module` en Jest, con `sanitize-html` recién instalado | `sanitize-html` 2.17.2 en adelante depende de `htmlparser2` `^10`/`^12`, que ya no publica CJS, y ts-jest corre en CommonJS. Se pinnea **`sanitize-html` 2.17.1**, la última que depende de `htmlparser2 ^8` (dual). Está con `-E`: un `^` la volvería a subir sola |
| **La CSP de dev bloqueaba TODAS las fotos** | La API devuelve 200, `curl` a la URL de MinIO devuelve 200, y en pantalla no carga ninguna imagen: la ficha con `<img>` rotos y la cartera en tarjetas con treinta | `img-src 'self' data: blob: https:` en `vite.config.ts`. En producción el bucket es **https** y lo cubre el `https:`; MinIO en dev habla **http** por el 9000, así que caía afuera. El síntoma no está en la pestaña de red —dice FAILED sin motivo—: está en la **consola**, que lo dice con todas las letras. Se agregó `http://localhost:9000` sólo al bloque de dev; el Caddyfile de producción no se toca |
| **Un `<style scoped>` se come el anillo de foco** | Se tabula por la grilla de propiedades, `:focus-visible` da `true`… y la tarjeta enfocada se ve igual que las demás | `familia.css` tiene `:focus-visible { box-shadow: var(--ring) }`, que es (0,1,0). Dentro de un `<style scoped>`, Vue le agrega el `[data-v-…]` a `.tarjeta`, que pasa a (0,2,0) y su `box-shadow: var(--sh-1)` **le gana al del foco**. Cualquier componente scoped que declare su propia sombra tiene que reponer `:focus-visible` a mano. Es la misma trampa de especificidad que el `h3` scoped contra `.text-lg` |
| **`loading="lazy"` no ahorra tanto como parece** | Se abre la cartera en tarjetas con 25 propiedades y el navegador pide **23 de 24** imágenes, con sólo 8 en pantalla | Chrome usa un margen de precarga generoso —del orden de la altura del documento— cuando la conexión es rápida. Medido: página de 3.001px, viewport de 1.000px, 23 pedidos. Con las imágenes del seed (≈10 KB) no se nota; con fotos reales de celular de 8 MB, la primera carga de la cartera son decenas de MB. Ver el pendiente de las miniaturas |

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

### ✅ Hecho en la sesión del 2026-08-09 — la cartera en tarjetas

Segunda vista de las tres pantallas de propiedades, con la tabla como default.
**Sin migración**: `propiedad_foto` existe con su RLS desde la 006 y los cinco
atributos también, así que la 022 sigue libre. El único cambio de API es una
columna calculada (`fotoPortada`) en el `SELECT` del listado.

| Qué | Lo que apareció en el camino |
|---|---|
| **El interruptor tabla ⇄ tarjetas**, con la preferencia guardada (`dominio/vista.ts`), UNA clave para las tres pantallas | En tarjetas no hay `<thead>`, o sea que no hay `ThOrden`: sin un `<select>` «Ordenar» atado a los mismos `orden`/`dir`, cambiar de vista sacaba el orden de la cartera sin avisar |
| **La tarjeta**: foto 4:3, precio con su moneda, chip de situación, dirección, íconos y superficie | El anillo de foco no se veía: un `<style scoped>` con `box-shadow` propio le gana al `:focus-visible` de la capa familia (ver trampas) |
| **Cinco íconos nuevos** en `UiIcon.vue` — dormitorio, baño, cochera, superficie y ambientes | Verificados a 150/18/14px contra los seis que ya se usan al lado. Ninguno es casita, llave ni techo |
| **La regla de los faltantes** en `dominio/atributos.ts` | Un terreno no tiene dormitorios: el ícono **no existe** en esa tarjeta. Y `0` («sin cochera») no se muestra igual que `NULL` («s/d» en ámbar), porque uno es una respuesta y el otro es una tarea |
| **Fotos de verdad en el seed**, subidas a MinIO por `AlmacenamientoService.subirImagen()` | El PNG lo genera un motor puro nuevo con `node:zlib` —sin dependencias, sin red, sin fotos de nadie— y dice IMAGEN DE MUESTRA adentro. La primera versión salía sin volúmenes en la mitad de las propiedades: `s >> n` sobre un hash de 32 bits sin signo devuelve **negativo**, y un `rect` de ancho negativo no dibuja nada. Va `>>>` |
| **«Estado» ⇒ «Situación»**, con la etiqueta y el tono unificados | La etiqueta estaba en tres lugares y el tono en tres más, y no coincidían. Ver el Decisions Log de `DESIGN.md` |
| **La CSP de dev bloqueaba todas las fotos** | Un defecto **preexistente** que la cartera hizo visible: la ficha también mostraba imágenes rotas en dev. Ver trampas |

**Pendiente que sale de acá, con su motivo**: `fotos.service.ts` guarda el
**original** —hasta 8 MB— y no hay pipeline de miniaturas, así que la tarjeta
pide esa imagen para un hueco de 240px. Con las del seed (≈10 KB) no se nota, y
por eso es peligroso. `loading="lazy"` ayuda menos de lo esperado (medido: 23 de
24 imágenes pedidas con 8 en pantalla) y el `Cache-Control: immutable` lo arregla
recién a partir de la segunda visita. Redimensionar en Node necesita `sharp`, que
es un binario nativo en el contenedor: es el error #7 esperando, y por eso esto se
escribe como decisión y no se hace a las apuradas.

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

#### Pre-contratos: editar, mandar y que quede guardado (migración 020)

El motor de plantillas estaba entero y probado, pero **generaba y mostraba**: no
se podía cambiar una coma, no había forma de mandarlo y **el sistema no guardaba
nada**. «¿Qué pre-contrato le mandamos a esta gente, quién lo hizo y cuándo?» no
tenía respuesta.

Ahora: `documento_generado` + `documento_envio` con RLS, el texto editable antes
de mandarlo, los tres canales (WhatsApp, email, imprimir) y el historial por
contrato. Más los cuatro contratos ICL/IPC del seed que **proyectan de verdad**.

**Cinco decisiones que conviene no revisar sin motivo:**

1. **La columna se llama `abierto_el`, NO `enviado_el`.** El sistema abre
   `wa.me` o `mailto:`; no manda el mensaje y no sabe si la persona apretó
   enviar. Escribir «enviado el 06/08» en el historial de un papel con efecto
   legal sería afirmar un hecho que nadie verificó. La pantalla dice «se abrió
   WhatsApp».
2. **El largo decide el modo, y se avisa antes de apretar.** `completo` cuando
   el texto entra en la URL, `adjunto` cuando no —ahí baja el `.txt` y el
   mensaje lleva una carátula corta—. El motivo va escrito con su número de
   caracteres y su límite. **Nunca se trunca**: ver la trampa nueva de §4.
3. **Guardar y mandar son la misma llamada.** `POST /documentos/:id/envios`
   persiste la fila **y** devuelve la URL. Depender de que el front registre
   después de abrir el canal es depender de que la pestaña siga viva.
4. **Un documento que ya salió es inmutable**, por trigger (`documento_congelado`),
   igual que un ajuste confirmado. Editarlo da 409 y borrarlo también: es la
   constancia de qué recibió la otra parte.
5. **Imprimir va en ruta propia** (`/documentos/:id/imprimir`) y no en un modal:
   el `@media print` global esconde botones y navegación pero **imprime todo el
   resto de la página**, así que desde la ficha del contrato saldrían atrás del
   pre-contrato los aumentos, las cuotas y los garantes. La ruta registra la
   impresión al abrirse, así «volver a imprimir» desde el historial también
   queda anotado. No genera PDF: el navegador ya ofrece «Guardar como PDF» y no
   se promete uno.

**Lo que apareció en el camino:**

| Qué | Lo que apareció |
|---|---|
| El envío por mail | Un pre-contrato **no entra** en un `mailto:`. Medido: 2.087 caracteres → 3.377 de URL, contra un límite duro de 2.048 |
| El seed y el IPC | No cargaba **ni un valor** de `indice_valor`. Con el IPC vacío, dos de los cuatro contratos nuevos no proyectaban nada |
| La cadena del ajuste | Vivía suelta adentro de `contratos.service.ts` mezclada con consultas. Se extrajo `periodosDeAjuste()` al motor puro, con sus casos de papel. Lo que **no** se pudo extraer —el re-anclaje cuando un ajuste ya existe en la base— quedó comentado de los dos lados |
| El esqueleto de «Nueva plantilla» | Enseñaba `{{#if}}` y `{{#each}}`, sintaxis que el motor no tiene. Salía literal adentro del contrato firmado |
| Los códigos de propiedad del seed | `demo-cartera.sql` se reserva del 15 al 30. Los cuatro contratos nuevos arrancan en 31 |

---

### 🟠 Lo que sigue, con su diseño ya resuelto

Ordenado por lo que más duele. El primero —comisiones— **ya está cerrado**; se
deja escrito porque era el mismo error #3 cuatro veces seguidas y sirve de
recordatorio de cómo se ve una columna que nadie lee.

#### 1. Comisiones ← *cerrado (migración 021)*

Los tres pedidos que estaban abiertos acá —la config que nadie leía, el captador
que no pre-llenaba nada y la trampa de unidades— quedaron resueltos, y con ellos
**cuatro columnas que existían y no leía ningún código**, que es el error #3 del
playbook cuatro veces en el mismo módulo:

| Columna | Desde | Qué la lee ahora |
|---|---|---|
| `membresia.comision_captador_pct` / `_cerrador_pct` | 017 | Equipo, editable en la fila, y la sugerencia de reparto |
| `propiedad.agente_captador_id` | 006 | Se devuelve en la ficha y en el listado, y pre-llena el captador |
| `operacion.comision_config` | 006 | El % por propiedad, editable desde el listado |
| `comision.contrato_id` | 008 | La comisión del alquiler, que el sistema **no generaba** |

**Lo que entró:**

- **Compartir con otra inmobiliaria**, en venta y en alquiler. Tabla nueva
  `inmobiliaria_externa` (la única de la 021) con su pantalla adentro de
  Comisiones, autocompletar y alta al vuelo desde el reparto. `comision.externa_id`
  enlaza la ficha; `beneficiario_nombre` sigue guardando el nombre **congelado**,
  porque una comisión ya cobrada no cambia de acreedor si alguien renombra la
  agencia — misma regla que el ajuste confirmado.
- **El % por punta de cada agente**, editable in-line en Equipo, con el heredado
  en gris y la equivalencia en % de la venta al lado.
- **El perfil de cada agente** en `/equipo/:usuarioId`: sus números por moneda y
  estado, sus captaciones, sus contratos, sus ventas y el bloque de la casa.
- **El detalle de una venta** en `/ventas/:id`. **No existía**: la fila del
  listado navegaba ahí desde el primer día y caía en NoEncontradaPage.
- **La comisión del alquiler**, con su reparto igual al de una venta.
- **El % por propiedad**, editable desde el listado con la info a la vista.

**Cinco decisiones que conviene no revisar sin motivo:**

1. **El servidor sugiere, la persona confirma.** `GET …/reparto/sugerido` arma
   el reparto entero —puntas, captador, cerrador y sus porcentajes— y **todo
   llega editable**: el captador no siempre es quien cargó la propiedad.
   `puntas` sigue siendo **obligatorio** en el POST; hacerlo opcional sin
   fallback fue lo que se revirtió la vez anterior.
2. **La comisión del alquiler es UN MES y es `monto_inicial`.** No la cuota
   vigente: contra el monto de hoy, cada ajuste por índice recalcularía una
   comisión que quizás ya se cobró.
3. **Se genera con un paso explícito, como en ventas.** Un contrato cargado para
   probar no puede dejar una comisión proyectada en la caja. La pantalla la
   ofrece pre-llenada, así que cuesta un clic.
4. **Un agente ve SUS montos.** Puede abrir el perfil de un compañero y ver lo no
   monetario, pero los importes vienen en `null` con el motivo escrito. Y el
   bloque de la inmobiliaria, para el rol agente, es **volumen** y no el pozo de
   comisiones: con dos asesores, el total de la casa menos lo propio ES lo del
   compañero. Un permiso que se esquiva restando no es un permiso.
5. **El % de una propiedad NO recalcula un reparto ya hecho.** Pre-llena las
   operaciones nuevas; rehacer uno existente es un botón aparte, y se bloquea si
   hay algo cobrado.

**Lo que quedó afuera, con su motivo:**

- **El % de un agente es uno solo, no uno por tipo de operación.** `membresia`
  tiene dos columnas —captador y cerrador— y el mismo número vale para una venta
  de USD 300.000 y para un alquiler de un mes. Si en la práctica se paga
  distinto, son dos columnas más y **una migración nueva**: la 021 ya está
  aplicada y no se retoca.
- **Compartir es siempre por punta.** El motor sabe repartir `{vendedora: 50}`;
  el trato «partimos todo al medio sin importar las puntas» sería una regla
  nueva del motor.
- **El % por propiedad no toca el reparto interno**, a propósito: quién se lleva
  qué puertas adentro es política de la casa, no un atributo del inmueble.

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

#### 4. Garantes ← *cerrado, salvo el bot*

Hecho en la etapa anterior: legajo por contrato, los cinco documentos sobre S3,
el control contra la Central de Deudores con el veredicto congelado, la firma y
la verificación de mínimo 2.

**Hecho ahora (migración 019):**

- **`garantia_por_vencer` ya tiene emisor**, y el campo «Vence el» que lo
  alimenta. Iban juntos a propósito: emitir sobre una columna que ninguna
  pantalla llena es el error #3 disfrazado de feature nueva.
- **La revisión periódica del BCRA.** Al consultar se calcula
  `garantia.bcra_revisar_el` con un motor puro (`proximaRevision()`): cada
  **6 meses**, sólo si el contrato dura **24 o más**, nunca después de que
  termine el contrato ni de que venza la garantía, y sólo sobre los que hoy dan
  aptos. Cuando llega, sale el aviso `garantia_revision_bcra`.
- **El historial: `garantia_bcra_consulta`.** Re-consultar pisando
  `garantia.bcra_*` habría destruido el dato que justifica la decisión, que es
  justo lo que la 018 se propuso guardar. Ahora `garantia.bcra_*` es el cache de
  la última consulta y la tabla guarda todas. La **primera** es la que respaldó
  la firma —dato derivado, sin columna que marcarla— y la pantalla muestra
  «aceptado el DD/MM/AAAA · última revisión DD/MM/AAAA».
- **Cheques rechazados**, con su parser y su cache. Un fallo de cheques no
  invalida el veredicto de deudas: se guarda el bueno y la pantalla dice que los
  cheques quedaron sin consultar.
- **WhatsApp para coordinar la firma.** `<a href="wa.me/…">` con el texto ya
  redactado y editable, más «Copiar el texto» y `mailto:`. **No simula ningún
  envío**: abre el WhatsApp del usuario y el sistema no registra nada.
  `telefono.motor.ts` normaliza el número (motor puro, con tests) y si no cierra
  en los 10 dígitos nacionales el botón queda deshabilitado con el motivo.
- **El seed siembra cinco garantías** con su legajo real sobre MinIO —completo,
  a medias, sin firmar, y un seguro de caución que vence en 30 días—.

**Tres decisiones que quedaron tomadas y conviene no revisar sin motivo:**

1. **La re-consulta la aprieta una persona, no un cron.** El evento avisa; la
   consulta la dispara alguien y queda su nombre en
   `garantia_bcra_consulta.consultado_por`. Un cron que consultara solo estaría
   pidiendo el dato bancario de un tercero sin que nadie lo pida —el incidente
   de la tabla de trampas, a escala y cada seis meses— y encima contra una API
   con control de tráfico **por IP** (devuelve 429; lo vimos).
2. **Los cheques no tumban a nadie: se muestran.** La regla del dueño es «sólo
   situación 1» y un cheque no es una situación, así que van como advertencia,
   la misma categoría que «proceso judicial en curso». Es discutible y la
   decisión es suya.
3. **La revisión vencida informa, no bloquea.** Es un dato viejo, no un rechazo:
   el garante sigue contando como apto con el veredicto que tiene.

**Lo que sigue faltando:**

- **El bot de WhatsApp** que cargue documentos solo: el endpoint de subida ya
  recibe base64, así que lo que falta es el canal, no el back.
- **Confirmar los tres números** de la revisión —24 meses de contrato, cada 6,
  sólo los aptos—. Están juntos y con nombre en `situacion.motor.ts`
  (`MESES_CONTRATO_PARA_REVISAR`, `MESES_ENTRE_REVISIONES`): cambiarlos es una
  línea.
- **La demo del BCRA no se hace con un garante del seed.** Con `bcra_*` en NULL
  los cinco dicen «falta consultar el BCRA» y ningún contrato queda «en regla»:
  es correcto —sin consulta no hay veredicto— y hay que decirlo antes de que
  parezca un bug. Para verlo funcionando se consulta con un CUIT de sociedad
  (`30500001735` devolvió 20 entidades en situación 1 el 07/08) o con el
  documento propio.

#### 5. Filtro por agente y «las mías» ← *cerrado*

Un agente ve la **cartera entera** de la inmobiliaria y puede acotarla a lo suyo
con un clic. El filtro **no es un permiso**: es una herramienta.

Está en los **seis listados** que tienen a quién atribuirle una fila —propiedades
(y sus dos carteras, que pegan al mismo endpoint), cartera de alquileres, listado
de contratos, ventas, publicaciones y leads— con **un solo** parámetro,
`agenteId`, un solo componente (`web/src/componentes/SelectAgente.vue`) y un solo
DTO del que heredan todos (`api/src/common/filtro-agente.ts`).

**Seis decisiones que conviene no revisar sin motivo:**

1. **No existe `agenteId=mias`.** El backend tiene una sola semántica —«las de
   este uuid»— y así el titular pide «las de Sofía» con el mismo mecanismo con el
   que un asesor pide las suyas. «Las mías» es del front: manda su propio uuid.
2. **`'yo'` se guarda, el uuid no.** En `localStorage` va el centinela, que se
   traduce recién al armar la consulta. Motivo concreto: la PC del mostrador se
   comparte, y guardar el uuid haría que la segunda persona abra la pantalla
   filtrada por la primera y vea una lista vacía sin entender por qué. La regla 2
   de `dominio/filtros.ts` —descartar un valor que ya no es válido— no se puede
   aplicar a un uuid en el constructor porque el equipo llega por fetch: la
   aplica `SelectAgente` cuando llegó.
3. **En alquileres la columna dice «Captador», no «Agente».** `contrato_alquiler`
   no tiene agente propio: lo único que la base sabe es quién captó el inmueble, y
   quien coloca un inquilino puede ser otra persona. Llamarlo «Agente» sería
   afirmar algo que el dato no dice. Si algún día se quiere «lo que coloqué yo»,
   es una columna nueva (`agente_colocador_id`) con su migración.
4. **En ventas, «mis ventas» es comisión O captación.** Sólo por
   `comision.beneficiario_id` la lista aparecería **vacía** justo cuando la venta
   se acaba de cerrar, porque todavía no tiene reparto. Efecto lateral que la
   pantalla dice en una línea: la suma por agente puede dar más que el total,
   porque una venta captada por uno y cobrada por otro cuenta para los dos.
5. **Los leads siguen siendo privados**, y es la única excepción declarada. Lo que
   cambió es que un asesor que filtra por un compañero recibe **403 con el
   motivo** en vez de una lista vacía —antes eran dos condiciones sobre la misma
   columna, indistinguible de «ese agente no tiene leads»—, y que el desplegable
   ni siquiera le ofrece compañeros: un control que sólo sirve para dar error no
   es un control. El desglose de comisiones por agente tampoco se tocó: es plata
   del compañero.
6. **«Sin captador» es un estado real**, no un caso raro: el INSERT del importador
   de CSV ni siquiera lista la columna, así que toda propiedad importada nace así.
   Va como parámetro aparte (`sinCaptador`) y no como valor mágico de `agenteId`,
   que es un uuid validado. Y para que se pueda **salir** de ese estado, el
   captador dejó de ir por `coalesce`: un `null` explícito desasigna.

**Lo que apareció en el camino:**

| Qué | Lo que apareció |
|---|---|
| El captador era invisible | `SELECT p.*` lo traía y `aPropiedad()` no lo mapeaba: la API **nunca** lo devolvía y el formulario nunca lo mandaba. Filtrar por él habría sido filtrar por el seed |
| El botón «Exportar» | `GET /exportar/:recurso.csv` no toma filtros: al lado de una lista filtrada por agente baja **todo**. Se dice en la pantalla, debajo de los filtros, cuando hay filtro puesto |
| La bandeja de Avisos **no** lleva filtro | `evento_programado.destinatario_usuario_id` existe desde la 010 y no lo escribe ni lo lee nadie: «mis avisos» daría 0 siempre. Es el error #3 esperando; el filtro va cuando el generador llene la columna |
| `GET /reservas` tampoco | Devuelve todas las filas **sin paginar**. Agregarle un filtro sería sumarle una feature a algo que ya viola «truncar no es paginar» por el otro lado |
| El índice que no se agregó | `propiedad` no tiene índice por `agente_captador_id`. No se agregó: es el error #4 y la cartera se midió en 20 ms |

#### 6. El editor de plantillas tipo Word ← *cerrado (migración 023)*

Una plantilla era un `text` que se editaba en un textarea monoespaciado y se
imprimía dentro de un `<pre>`. Alcanzaba para probar el motor y no alcanzaba
para un contrato: el papel que firma una persona no sale en Courier. Y la
inmobiliaria que redacta en Word no podía traer su modelo sin perder el formato.

Ahora el editor con formato está en **los dos lugares donde hay texto que va a
salir impreso**: la plantilla (el modelo de la inmobiliaria) y el documento
generado antes de mandarlo.

**Ocho decisiones que conviene no revisar sin motivo:**

1. **TipTap/ProseMirror, no un contenteditable propio.** La razón no es que
   pegar y deshacer sean difíciles —que lo son—: es que el chip de variable
   tiene que ser un **átomo indivisible** y `contenteditable` no garantiza eso.
   En un `<span>` pelado el navegador parte el nodo cuando alguien escribe en el
   medio y el corrector inserta marcas adentro. Un `{{ contrato.monto }}`
   partido deja de matchear el regex del motor y sale literal adentro del
   contrato que se firma. ProseMirror valida **cada transacción contra un
   schema**: es la misma clase de garantía que un CHECK en Postgres. Se paga con
   389 KB (125 KB gzip) en un chunk propio, cargado con `defineAsyncComponent`:
   el bundle principal quedó igual, en 144 KB.
2. **El texto es la verdad en un chip; los atributos son la verdad en un
   bloque.** El backend re-deriva `data-var`/`data-formato` leyendo el `{{ }}`
   de adentro del span —así una plantilla vieja o un `PUT` hecho a mano se
   convierten solos en chips—, y re-escribe los `{% si %}`/`{% fin %}` desde los
   atributos del div. Las dos direcciones tienen su motivo escrito en el código:
   el token de una variable se sustituye en su lugar, el de una estructura es un
   **par** que tiene que quedar balanceado a través de varios párrafos.
3. **Los tokens de estructura van ADENTRO de su div, pegados a los bordes.**
   Sueltos entre párrafos, borrar un condicional en falso se lleva un `</p>` de
   un lado y deja un `<p>` abierto del otro. Con el div afuera, el rango que el
   motor borra es siempre HTML balanceado y queda un div vacío, que
   `[data-bloque]:empty { display: none }` esconde.
4. **El sanitizado va en el servicio, no en el editor.** `PUT /v1/plantillas`
   acepta un body y nada obliga a que haya pasado por TipTap. La frontera son
   `guardar()`, `previsualizar()`, `crear()` y `actualizar()`; el editor es
   comodidad.
5. **El formato es una COLUMNA, no un olfateo de `<`.** Olfatear es adivinar, y
   de eso dependen la vista imprimible, el `.txt` y el límite del `mailto:`. Un
   contrato que diga «menor a 30 m2» daría «html» y saldría con las etiquetas a
   la vista.
6. **Los documentos ya generados NO se convierten.** Un papel que salió
   monoespaciado salió así, y el trigger `documento_congelado` además lo impide
   para los ya enviados. `documento_generado.formato` se congela al generar,
   igual que `plantilla_nombre`.
7. **`plantillas.defecto.ts` sigue en texto plano** y se pasa por `textoAHtml()`
   al sembrar: una sola fuente del texto legal, y el conversor queda probado
   contra las cuatro plantillas reales en cada corrida del seed.
8. **El catálogo de variables vive en la API.** En `web/` se desincroniza del
   `SELECT` que arma el contexto y ofrece variables que no existen. Hay un test
   que lo confronta contra `EJEMPLO` **en las dos direcciones**: sin él, el menú
   miente a los seis meses.

**Lo que apareció en el camino:**

| Qué | Lo que apareció |
|---|---|
| El diff de render | Es el único test que puede decir que convertir no rompió nada: renderiza las cuatro plantillas reales en texto y en HTML y exige que digan **lo mismo**. Compara las líneas con contenido y no las vacías, porque un `{% si %}` inline abre su propio bloque y eso puede mover una línea en blanco. Las palabras, los números y el orden no cambian |
| El bloque de firmas | Está alineado a mano con espacios, y en HTML una corrida de espacios colapsa a uno: las dos firmas se pegaban. Una corrida de N espacios pasa a (N−1) espacios duros más uno normal, y `htmlATexto()` los devuelve. **Nunca adentro de un `{{ }}`** |
| El largo del envío | El pre-contrato del seed mide **1.869 caracteres de texto y 2.035 de HTML**. Es el mismo 1.869 que ya estaba escrito en `envio.motor.ts` desde la etapa 11: la proyección lo dejó igual, que es el punto |
| `sanitize-html` moderno no entra en Jest | Ver la trampa nueva de §4: se pinnea 2.17.1 con `-E` |
| El chip mostraba el token | «`{{ contrato.monto }}`» no es lo que tiene que leer quien redacta un contrato. Un node view de ProseMirror muestra «Precio mensual · moneda» y `renderHTML()` sigue serializando el token: el editor habla castellano, el motor no tiene por qué |
| La CSP no existía | El `Caddyfile` tenía HSTS, nosniff, X-Frame-Options y Permissions-Policy y **ninguna CSP**. Ahora está, y la misma en `server.headers` de Vite para que se rompa en dev y no el día del deploy. Comprobado en el navegador: Geist, Geist Mono y General Sans siguen cargando, sin una sola violación en consola |

**Lo que quedó afuera, con su motivo:**

- **Tablas.** Una tabla pegada de Word se aplana a párrafos **y se avisa en
  pantalla**, con el motivo. Una tabla en un contrato tiene que comportarse bien
  al cortar de página, y a medias es peor que no tenerla. El aviso no es
  cortesía: sin él alguien pega un cuadro de vencimientos y firma un contrato al
  que le falta la grilla.
- **Enlaces.** Un contrato no los usa, y `<a href>` es la superficie de
  `javascript:`. El backend ni siquiera los permite; ofrecer el botón sería
  ofrecer algo que el sanitizador va a tirar.
- **Numeración automática de cláusulas.** Se puede con
  `@counter-style { system: fixed }`, pero entonces «PRIMERA» vive en una hoja
  de estilos y no en el documento firmado: quien copie el texto se lleva un
  contrato sin ordinales. Materializarlo al guardar duplica la lista de
  ordinales entre `web/` y `api/`, que no comparten código.
- **Números de página.** Chrome no soporta contenido en los márgenes de
  `@page`; los pone el diálogo de impresión del navegador. Prometerlos sería
  exactamente lo que la regla de honestidad de este producto prohíbe.
- **PDF en el servidor.** Sigue sin generarse, por lo ya escrito en esa página.

#### 7. Lo demás, marcado con ⏳ en el roadmap

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
2. **La API key de Google Maps.** Ver abajo: es lo único que falta, y sirve para
   **una** cosa —geocodificar—. El mapa de la ficha ya funciona sin ella.
3. **Capturas de `appmiti.com`.** No pude verlo: el dominio resuelve pero el servidor
   no responde desde acá, ni por navegador, ni por `curl`, ni por búsqueda. La
   portada de hoy es la arquitectura estándar del género con marca propia.

#### La API key de Google Maps, paso a paso

**Antes que nada, qué habilita y qué no.** La key sirve para **geocodificar**:
pasar una dirección a latitud y longitud. Nada más. El **mapa** de la ficha es un
`<iframe>` a `www.google.com/maps?q=…&output=embed`, **no lleva key y ya
funciona**: se probó con un `fetch` desde el contenedor de la API (HTTP 200) y se
miró en el navegador, con la key vacía, en PROP-0032. O sea: sin key la app no
está a medias, le falta **una** cosa —resolver direcciones sola— y mientras tanto
las coordenadas se cargan a mano desde Editar.

Lo que hay que hacer, en orden, y que no puedo hacer yo:

1. **Google Cloud Console → APIs y servicios → Biblioteca → habilitar Geocoding
   API.** Sólo esa: el código no usa Maps JavaScript API ni Maps Embed API.
2. **Facturación → asociar una tarjeta al proyecto.** Google la exige aunque el
   uso entre en el crédito gratuito; sin esto el diagnóstico devuelve
   `OVER_QUERY_LIMIT`.
3. **Credenciales → Crear credencial → Clave de API.**
4. **Dos restricciones que Google llama parecido y son distintas**, las dos en la
   misma pantalla de la key:
   - **Restricción de aplicación → Direcciones IP**, con la IP pública de
     **salida** del servidor donde corre la API (se saca desde ahí con
     `curl -s ifconfig.me`). **Nunca «Sitios web (referente HTTP)»**: las
     consultas salen del backend con `fetch`, sin cabecera `Referer`, y una key
     restringida por referrer devuelve `REQUEST_DENIED` — que parece una key mal
     copiada y hace perder una tarde.
   - **Restricción de API → Geocoding API**, para que una key filtrada no
     habilite todo lo demás del proyecto.
5. **Tope de cuota** en «APIs y servicios → Geocoding API → Cuotas»: 200/día
   sobra, se geocodifica **una vez** por propiedad. Y una alerta de presupuesto
   en Facturación.
6. **`GOOGLE_MAPS_API_KEY=…` en el `.env`** (está en `.gitignore` y hay gitleaks
   en el pre-commit; igual, la key no se pega en un chat ni en un commit).

**Cómo se aplica y cómo se verifica** — acá es donde se pierde media hora:

```bash
docker compose up -d api      # NO `restart`: reinicia con el entorno viejo
docker compose exec -T api sh -c 'echo ${#GOOGLE_MAPS_API_KEY}'   # > 30 (hoy: 0)
```

Después, como titular: `GET /v1/propiedades/geocoding/diagnostico` tiene que dar
`{"funciona":true,"estado":"OK"}`. Si da `REQUEST_DENIED`, leer `mensajeDeGoogle`
tal cual: es lo único que dice **cuál** de las cuatro cosas falta.
`GET …/geocoding/pendientes` da 8 en Andes hoy;
`POST …/geocoding/sincronizar` ubica hasta 50, es idempotente y **nunca pisa un
`geocode_fuente = 'manual'`**. En el navegador, el panel «Mapas» de Propiedades
desaparece cuando no queda ninguna pendiente.

Si la API corre en una máquina de casa, la IP pública cambia y la restricción se
rompe sola: conviene una key aparte para desarrollo, con tope de cuota bajo.

**Lo que decidí NO hacer, y por qué**: `docs/spec.md:426` y `DESIGN.md:219`
prometen Static Maps en las tarjetas de los listados. No existen y **hay que
corregir el spec, no escribirlos**: son 25 imágenes pagas por página, y una
Static Maps se pide **desde el navegador**, o sea que haría falta una segunda key
restringida por referrer HTTP — exactamente lo contrario de la restricción por IP
que esta key necesita. Con el diseño de hoy —geocodificar en el back, embed sin
key en la ficha— **una sola key server-side alcanza**, y eso es lo que conviene
preservar.

---

## 6. Prompt para arrancar la próxima sesión

```
Seguimos con Bemo INMO, en ~/Documents/bemo-inmo.

Leé docs/CONTINUAR.md y después CLAUDE.md, PLAYBOOK.md, DESIGN.md y
docs/roadmap.md.

Estado: once etapas cerradas, 590 tests de API contra Postgres real y 57 de
front, todo en verde. El seed trae 20 propiedades, 19 contratos y su ciclo de
cobranza —cuatro de ellos ICL/IPC que proyectan sus tres aumentos con el motor
de verdad—, una serie de IPC demo marcada como tal, las cuatro plantillas base
en las dos inmobiliarias y siete avisos de la cartera: entrás con
owner@andes.test / unaclavelarga1.

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
  garantes/
    situacion.motor.ts  veredicto del BCRA + cheques + próxima revisión. PURO
    telefono.motor.ts   del teléfono de la ficha al wa.me. PURO
    deudores.service.ts los dos endpoints del BCRA. El 404 es una respuesta
    garantes.service.ts legajo, veredicto congelado e historial de consultas
  publicaciones/
    aviso.motor.ts      generador de aviso + feed XML. PURO
  recordatorios/        eventos idempotentes por clave única
  plantillas/
    plantillas.motor.ts variables, condicionales y listas. NO es un lenguaje
    envio.motor.ts      wa.me y mailto:, con el límite que decide adjunto. PURO
    documentos.service.ts  el documento generado, su edición y sus envíos
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

**Los nueve motores puros** (`ajustes`, `punitorios`, `comisiones`, `aviso`,
`plantillas`, `orden`, `situacion`, `telefono` y `envio`) no
tocan base ni red: entra data, sale un resultado. Ahí es donde hay que agregar
casos cuando aparezca una regla nueva — son baratos de testear y es donde un error
se paga caro.

`envio.motor.ts` (en `api/src/plantillas/`) arma el `wa.me` y el `mailto:` de un
documento y decide, **por el largo**, si el texto viaja en la URL o va como
archivo adjunto con una carátula. Ahí viven los dos límites con su fuente
escrita, y reusa `telefono.motor.ts` para el número en vez de tener su propia
copia de la regla.

Los dos últimos viven en `api/src/garantes/`: `situacion.motor.ts` decide el
veredicto del BCRA, lee los cheques rechazados y calcula la próxima revisión con
su memoria de cálculo; `telefono.motor.ts` lleva un teléfono argentino escrito
de cualquier manera al número de `wa.me` —y devuelve `null` con el motivo cuando
no cierra, porque un `wa.me` mal armado no falla: abre el chat de otra persona.

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
