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

*Última sesión: 2026-08-19.*

| | |
|---|---|
| Commits | 56 |
| Migraciones | 34 (la última: `034_aviso_visita.sql`) |
| Tests | **1020 de API** contra Postgres real + **194 de front**. Todo en verde |
| Pantallas | 49 |
| CI | ✅ **Verde en los cuatro jobs** — `api`, `web`, `secretos`, `dependencias` |

### Etapas

| # | Etapa | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 0 | Validación | ⚠️ **ABIERTA** | Que alguien diga un precio concreto |
| 1–3 | Fundaciones · Auth · Espina | ✅ | — |
| 4 | Alquileres | ⚠️ construida | **Tres liquidaciones reales tuyas** |
| 5 | Ventas y comisiones | ⚠️ construida | Una venta real con su reparto |
| 6 | Publicaciones | ⚠️ Plan B listo | Convenio con un portal (no es código) |
| 7 | Recordatorios | ⚠️ generación lista | Proveedor de mail · verificación de WhatsApp |
| 8 | Piloto | ⚠️ lista | 30 días de uso diario |
| 9 | Planes | ⚠️ lista | Un cliente y un medio de pago |
| 10–11 | Mejoras · Lo que se ve usando la app | ✅ | — |
| 12 | Lo que pidió el dueño | ✅ salvo 12.3 | Avisar cuando falta el IPC del mes |
| 13–14 | Garantes · Editor Word · Tipo de cuenta | ✅ | — |
| 15 | Lo que le falta a un sistema así | ⏳ **en curso** | sólo **15.3** (ARCA), que espera un trámite y no código |
| 16 | Lo que un portal te enseñó a esperar | ✅ **CERRADA** | — |
| 17 | Sellado de seguridad | ⏳ **en curso** | 17.1 y 17.3 cerradas; faltan 17.2, 17.4, 17.5 |
| 18 | Inbox omnicanal | ⏳ por empezar | Todo. Ojo con la dependencia externa |

**Ningún gate abierto de las etapas 0 a 9 depende de código.** Están marcados así
a propósito: dar por cerrado un gate cuya evidencia no existe es el error #2 del
playbook con otra cara.

⚠️ **Nueve gates abiertos y vamos por la etapa 18.** Es literalmente el error #1
del playbook. Ninguna herramienta nueva los cierra: hacen falta tus
liquidaciones, una venta tuya y treinta días de uso.

### Integraciones

| Integración | Estado |
|---|---|
| **BCRA** (Central de Deudores) | ✅ **Funcionando.** Contrato verificado contra la API real: `GET /CentralDeDeudores/v1.0/Deudas/{cuit}` y `…/Deudas/ChequesRechazados/{cuit}`, los dos con el mismo botón. Del DNI se derivan los CUIL posibles y se prueban en orden. El 404 **no es un error**: es «ninguna entidad lo informa», o sea sin deuda ni cheques. Sólo situación 1 se acepta; el veredicto se congela con su fecha y las consultas nuevas se agregan al historial en vez de pisarlo. ⚠️ No consultarlo con datos demo: los DNI del seed son de personas reales |
| **BCRA** (ICL + UVA) | ✅ **Funcionando y automático.** Contrato verificado contra la API real (v4.0, variables 40 y 31). Se sincroniza solo cada 12 h (`SINCRONIZAR_INDICES`), y sigue estando `POST /v1/indices/sincronizar` a mano. Idempotente |
| **INDEC** (IPC) | ❌ Manual **a propósito**. No hay API estable; raspar un HTML que cambia sin aviso pondría un número equivocado en un aviso de aumento |
| **Google Maps** | ⚙️ **Son dos capacidades, y una ya funciona.** `GET /propiedades/capacidades` devuelve `{ geocodificacion, mapaEmbebido }` por separado. **El mapa de la ficha anda HOY, sin key**: es un `<iframe>` a `www.google.com/maps?…&output=embed`, que no lleva key ninguna — verificado con un `fetch` desde el contenedor (HTTP 200) y **visto en el navegador** en PROP-0032. Lo que falta la key es **geocodificar** (dirección → lat/lng): sin ella no se inventan coordenadas, se ofrece cargarlas a mano y la ficha dice de dónde salió cada una. Hay diagnóstico que le pega a Google de verdad y backfill de las cargadas antes. Los pasos exactos para el dueño están en §5 bis |
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
| **El bucket era de lectura pública, con los DNI adentro** | Ninguno. Todo «funcionaba» | `mc anonymous set download` sobre el bucket ENTERO, y un solo `AlmacenamientoService` para fotos de propiedades y para los documentos de garantes. La clave lleva 8 bytes aleatorios —no se adivina— pero era pública, `inline` e `immutable`: quien tuviera la URL leía un DNI para siempre. Cerrado en 17.1 con prefijos `publico/` y `privado/`. **Si agregás un tipo de archivo nuevo, `subirImagen()` te va a obligar a declarar la visibilidad: no le pongas un default** |
| **SigV4 firma el `Host`** | La URL firmada sale linda en el JSON y da `ERR_NAME_NOT_RESOLVED` en el navegador | El cliente de S3 apunta a `S3_ENDPOINT`, que dentro de compose es `http://s3:9000` — un nombre que resuelve el DNS de contenedores y ningún browser. **No se arregla reemplazando el host después**: la firma lo cubre y MinIO contesta `SignatureDoesNotMatch`. Hay un segundo cliente, `firmador`, apuntado al endpoint público |
| **`docker compose exec` se come el stdin de un `while read`** | Un script que recorre una lista procesa **el primer elemento** y termina como si hubiera andado. Movió 1 de 711 objetos | `exec` hereda el stdin del bucle y lo consume entero. Va con `< /dev/null` en la llamada de adentro. Está anotado en `scripts/migrar-bucket-029.sh` |
| **`A AND B OR C` en SQL** | Un filtro con sólo el máximo cargado devuelve la cartera completa | Agrupa como `(A AND B) OR C`. En un `donde` con «si no vino, no filtres» eso desactiva la condición entera. Los dos `IS NULL` van entre paréntesis. Costó un test en 16.1 |
| **Una nota de estado que nadie vuelve a verificar envejece hasta volverse mentira** | El roadmap mandaba a «hacer correr el CI» algo que ya corría hacía dos semanas | Tres notas de este repo eran falsas a la vez: `familia.css` fuera de git (estaba), el CI bloqueado por no haber remoto (había), y gitleaks pendiente en CI (ya corría). **Antes de creerle a un documento, comprobá con la máquina**: `git ls-files`, `gh run list`, `npm test` |

---

## 5. Lo que sigue, en orden

> El detalle de diseño de cada punto está en `docs/roadmap.md`, en su etapa.
> Acá va sólo el ORDEN y por qué ese orden.
>
> **Regla que no se negocia**: cada punto entra completo —migración con RLS,
> servicio, controlador con roles, tests (camino feliz + cada denegación +
> aislamiento), pantalla y verificación en el navegador— o no entra. Un punto a
> medias no cuenta aunque esté «casi».

### ✅ Sprint 1 — cerrado el 2026-08-19

15.6 cuenta corriente · 16.4 historial de precio y consultas · 16.6 ficha
técnica para imprimir. Los tres con tests y verificados en el navegador.

**Lo que dejó de aprendizaje**: la cuenta corriente, apenas se encendió, mostró
saldos NEGATIVOS. Eran 207 cuotas de la demo con el cobro duplicado, y la causa
era el seed —el id del cobro salía de `md5(id_del_período)` y los períodos se
habían migrado a UUID v4—. Ningún test lo veía. **La primera pantalla que suma
un número es la que encuentra los errores de los datos**, y por eso conviene
construirla temprano.

### ✅ Sprint 2 — cerrado el 2026-08-19

15.5 cotización del día · 16.2 búsqueda por radio · 16.3 comparar propiedades.

**Lo que dejó de decisión reusable**: el BCRA publica el dólar oficial, pero ese
NO es el tipo de cambio con el que se vende una propiedad en dólares, y el que
sí se usa no lo publica nadie. El modelo admite los dos —oficial global, propia
por inmobiliaria— y **la pantalla dice cuál es cuál** en vez de dejar que se
asuma. Misma familia de decisión que el IPC manual y que el botón *Publicar* que
no publicaba.

### ✅ Sprint 3 — cerrado el 2026-08-19

15.4 portal del inquilino · 16.5 agenda de visitas.

**Los dos aprendizajes, que se repiten:**

- **Reusar una pieza de seguridad exige mirar los DOS caminos.** El portal del
  inquilino reusó la tabla y el token del propietario, y quedó faltando el
  chequeo de rol en el camino VIEJO: un inquilino que cambiaba una palabra en su
  URL veía las liquidaciones del dueño. Compilaba, los tests pasaban. Apareció
  probándolo a mano.
- **Antes de construir, buscar si ya está.** 16.5 parecía una entidad nueva y
  era media feature ya construida: `visita` existe desde la 006 y
  `visita_agendada` estaba en el CHECK desde la 010. Faltaban la consulta y el
  emisor. Es el error #3 del playbook y ya pasó tres veces en este repo.

### Lo próximo

**Etapa 17 — el resto del sellado de seguridad**, que es lo único con trabajo de
código pendiente además de la 18:

### Seguridad — lo que falta de la etapa 17

- **17.2 · Datos personales.** Un legajo de garante es dato sensible bajo la Ley
  25.326 y hoy se guarda sin política de retención y sin forma de borrarlo.
  Falta también auditar quién mira un DNI.
- **17.4 · Superficie.** CSP propia (helmet sólo pone sus defaults), rate limit
  fuera de `/auth` —hoy sólo el login tiene techo—, 2FA para el titular.
- **17.5 · Aislamiento contra un atacante**, no contra un test amable: ids de
  otro tenant en el cuerpo de un PATCH, en un filtro, en un import CSV. Y un
  test que falle si alguien agrega un endpoint sin `@Roles`.
- **Nest 10 → 11.** Es el fix de los dos `high` de `npm audit` que quedan en
  producción. Uno (multer, DoS) **no es alcanzable** —no se parsea multipart en
  ningún lado—; el otro es express/body-parser transitivo. Migración mayor sobre
  967 tests: va sola, no adentro de un `audit fix --force`.

### Etapa 18 — Inbox omnicanal

Está diseñada en el roadmap, con su dependencia externa anotada ARRIBA para que
no se descubra a mitad de camino:

- El modelo (`conversacion` + `mensaje`) y **el email primero**, que es el único
  canal que se pone a andar sin trámite.
- WhatsApp y Meta necesitan verificación de negocio y plantillas aprobadas:
  semanas de trámite, cero líneas de código.
- **La regla que manda sobre la pantalla**: mientras el canal no pueda enviar,
  el cuadro de respuesta dice que queda en cola y **no simula que salió**. Es la
  misma decisión de la etapa 6 con el botón *Publicar* que no publicaba.

### Fuera de sprint, por trámite ajeno

- **15.3 · Facturación ARCA.** Necesita certificado y punto de venta que sólo el
  dueño puede tramitar. Cuando esté, es una constante que se cambia.
- **La API key de Google Maps.** Los pasos exactos están en §5 bis, acá abajo.

## 5 bis. Lo único que está esperando algo tuyo

### La API key de Google Maps, paso a paso

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

---

## 6. Prompt para arrancar la próxima sesión

Pegá esto tal cual en una sesión nueva:

```
Seguimos con Bemo INMO, en ~/Documents/bemo-inmo.

Leé docs/CONTINUAR.md y después CLAUDE.md, PLAYBOOK.md, DESIGN.md y
docs/roadmap.md.

Estado (2026-08-19): 34 migraciones, 1020 tests de API contra Postgres real y
194 de front, todo en verde. El CI corre y está verde en los cuatro jobs.
Entrás con owner@andes.test / unaclavelarga1.

Lo último que se cerró: los **tres sprints completos**. La etapa 16 quedó
cerrada entera y de la 15 sólo falta ARCA, que espera un trámite y no código.

Lo que sigue es el **resto de la etapa 17** (17.2 datos personales, 17.4 CSP y
rate limit, 17.5 aislamiento hostil, y la migración Nest 10→11) y después la
etapa 18, el inbox omnicanal.

Antes de escribir código, verificá el estado real en vez de creerle a este
documento: `git log --oneline -5`, `gh run list --limit 3` y
`docker compose exec -T api npm test`. Este archivo ya tuvo tres notas de
estado que envejecieron hasta volverse mentira.

Trabajamos como siempre:
- Cada feature va completa: migración con RLS, servicio, controlador con roles,
  tests (camino feliz + cada denegación + aislamiento) y pantalla.
- Verificá de verdad: tests contra la base real y la app en el navegador.
- Si algo queda sin hacer o no lo pudiste probar, decímelo explícitamente.
- Nada de datos falsos: lo que no existe se marca "en desarrollo" con el motivo.
```

### Si acabás de hacer `git pull` y no sabés dónde quedó

```bash
git log --oneline -8              # qué entró último
gh run list --limit 3             # cómo salió el CI
docker compose up -d              # levantar todo
docker compose exec -T api npm test
```

Y después leé §5 de este archivo: el primer punto del Sprint 1 es por dónde
sigue. Si algo de acá no coincide con lo que ves, **le creés a la máquina, no
al documento**.

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
