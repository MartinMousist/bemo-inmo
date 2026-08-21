# Los planes

> Definidos en `046_dos_familias_de_planes.sql`. Este documento explica **por
> qué** son así; la migración es la fuente de verdad de **qué** incluye cada uno.

## Dos familias, no una escalera

```
Gestión de alquileres      Esencial · Al día
Inmobiliaria               Básico · Medio · Todo
```

Quien administra veinte departamentos **no es una inmobiliaria chica**. No capta,
no vende, no reparte comisiones entre agentes y no publica en portales — y no va
a hacerlo nunca. Ponerlo como el escalón de abajo de una escalera de
inmobiliarias le dice, cada vez que abre la página de precios, que está en el
peldaño más bajo de algo que no quiere subir.

Son dos productos que comparten un motor.

---

## Familia Gestión — compite con el Excel

Y el Excel es **gratis y ya lo saben usar**. Así que el precio tiene que ser tan
bajo que la pregunta no sea «¿me conviene?» sino «¿por qué no?».

### Esencial

**Los contratos, el ajuste que corresponde y la rendición al propietario.**

Lo que trae es exactamente lo que una planilla no puede hacer:

- Calcular bien el ajuste por **IPC, ICL, UVA o Casa Propia** el mes que toca,
  guardando qué índice, qué período y qué coeficiente se usó
- Armar la **liquidación al propietario** con honorarios, gastos y retenciones
- **Una persona, todos sus roles**: propietario, inquilino, garante, comprador,
  interesado o reservante se DERIVAN de lo que la persona hace. El mismo Juan
  que alquila hoy es el comprador de mañana, sin cargarlo dos veces
- **Garantes con lo que falta a la vista**: recibo de sueldo —las dos caras del
  DNI y tres recibos— o seguro de caución, con «2 de 2 en regla» o exactamente
  qué documento falta
- Ver qué vence, quién debe y cuánto

Topes: 1 usuario, 40 propiedades, 25 contratos vigentes.

> **Los garantes son núcleo, no un extra.** Sin garantes no se alquila, y un
> plan de entrada que no deja cargarlos no sirve para alquilar. Lo que Esencial
> no trae es la CONSULTA al BCRA.

> **La liquidación va en el plan más barato aunque sea lo más caro de
> construir.** Sin eso no le gana a una planilla, y un plan de entrada que no le
> gana a lo que la persona ya tiene no es barato: es inútil.

### Al día

**Todo lo de Esencial, más que el sistema te avise y puedas contestar.**

- **Consulta al BCRA** — la situación en la Central de Deudores y los **cheques
  rechazados** de un garante, antes de firmar. Queda asentado en el legajo con
  quién lo consultó y cuándo
- **Pre-contratos** — las plantillas de la casa y el contrato generado, listo
  para firmar
- **Avisos de vencimiento** que se generan solos: qué contrato vence, qué aumento
  toca, qué garantía se cae
- **Bandeja de mensajes**: WhatsApp, Instagram y mail en un lugar, con las
  plantillas de contratos a mano
- **Portales** de propietario e inquilino

Topes: 3 usuarios, 120 propiedades, 80 contratos, 1 canal.

> **Por qué el BCRA se vende y los garantes no.** Cargar un garante es el
> trabajo; averiguar si debe en el banco es la ventaja. La diferencia entre los
> dos planes de Gestión queda concreta: Esencial te deja cargar el garante, Al
> día te dice si debe.
>
> La integración es real y está verificada contra la API del BCRA —deudas y
> cheques rechazados, con su contrato documentado en `deudores.service.ts`—. No
> es una promesa: el 404 del BCRA se trata como «no tiene deuda informada», que
> es lo que significa, y no como una falla.

> **Por qué los pre-contratos bajaron acá.** Estaban de «Medio» para arriba, o
> sea que ninguna cuenta de la familia Gestión podía generar un contrato desde
> una plantilla. Escribir cada contrato a mano en Word es exactamente el dolor
> de quien administra alquileres, y era la razón por la que este plan no
> alcanzaba para dejar la planilla.

> **El corte entre los dos es «mirar» contra «que te avise».** Esencial es entrar
> y ver. Al día es que el sistema lo levante solo y que puedas responder sin
> salir del sistema.

⚠️ **Los avisos NO salen del sistema todavía.** Llegan a una bandeja adentro de
la aplicación. `recordatorios.service.ts` declara `email` y `whatsapp` como no
disponibles: falta el proveedor de correo y la verificación de negocio de Meta.
**Este plan no se vende como «te avisamos por WhatsApp»** hasta que eso exista.

---

## Familia Inmobiliaria — compite con Tokko

Hace lo que hace Tokko, y además administra lo que ya se vendió.

### Básico
**Administrar alquileres y además captar y vender.**
Todo lo de «Al día» + leads, ventas, reservas y publicaciones.
3 usuarios · 250 propiedades · 30 envíos por mes.

### Medio
**Más el equipo, la Red y las respuestas automáticas.**
+ comisiones, la Red (30 propiedades) y el bot.
10 usuarios · 1.500 propiedades · 2 sucursales · 3 canales.

### Todo
**El sistema entero, sin límites.**
+ emprendimientos en pozo, conciliación bancaria, actas, multisucursal, API,
marca blanca y ARCA.

---

## El bot se compra aparte de la bandeja

Centralizar mensajes es **infraestructura**: sirve desde el primer día y no hay
nada que configurar. Va desde «Al día».

Que algo **conteste solo** es una decisión: palabras de salida, escalado a una
persona, confirmaciones. Mal configurado le contesta cualquier cosa a un
inquilino, y hay quien no lo quiere ni gratis. Va recién en Medio.

---

## El precio

**No está decidido, y por eso `precio_usd` está vacía.** El catálogo dice «A
convenir» hasta que alguien escriba un número. Es la regla que este repo tiene
desde la etapa 0 y que un test cuida: no se publica un precio que nadie decidió.

### Lo que se propone

| Plan | Propuesta | Contra qué se mide |
|---|---|---|
| Gestión · Esencial | **USD 9 / mes** | Una planilla. Tiene que doler menos que pensarlo |
| Gestión · Al día | **USD 19 / mes** | Lo que cuesta que se te pase un aumento una vez |
| Inmobiliaria · Básico | **USD 39 / mes** | Menos que una publicación destacada en un portal |
| Inmobiliaria · Medio | **USD 89 / mes** | Alrededor de la mitad de Tokko |
| Inmobiliaria · Todo | **USD 199 / mes** | Más barato que Tokko y hace lo que Tokko no hace |

**En dólares y no en pesos**: un número en pesos queda viejo solo. Se cobra el
equivalente del día.

```sql
UPDATE plan SET precio_usd = 9   WHERE codigo = 'gestion_esencial';
UPDATE plan SET precio_usd = 19  WHERE codigo = 'gestion_dia';
UPDATE plan SET precio_usd = 39  WHERE codigo = 'inmo_basico';
UPDATE plan SET precio_usd = 89  WHERE codigo = 'inmo_medio';
UPDATE plan SET precio_usd = 199 WHERE codigo = 'inmo_total';
```

Vive en la base y no en el código para que cambiarlo no sea un despliegue.

---

## Lo que los planes NO hacen

**No bloquean por falta de pago.** Los topes son del **plan**, no del estado de
la suscripción. Una cuenta con la cuota vencida sigue viendo sus contratos, sus
liquidaciones y sus propiedades.

**Bajar de plan no esconde el trabajo hecho.** El `ModuloGuard` acepta
`lecturaLibre`, y los módulos que guardan registros —liquidaciones, ventas,
comisiones, actas, documentos, avisos— lo usan: se deja de **emitir**, no de
**leer**.

Los que no lo usan son aquellos donde leer **es** el servicio: la Red y la
bandeja. Ahí un GET libre regalaría justo lo que se cobra.

> Cortarle a alguien el acceso a sus propios registros para presionarlo a pagar
> no es un límite comercial. Es tomarle el trabajo de rehén.
