# Los tres planes

> Definidos en la migración `044_tres_planes.sql`. Este documento explica **por
> qué** son así; la migración es la fuente de verdad de **qué** incluye cada uno.

## El problema que había

La migración 011 dejó cuatro planes con trece nombres de módulo. De esos trece,
el código exigía **dos** (`multisucursal` y `api`) y el front escondía cinco. Los
otros seis eran texto: el plan «Inicial» declaraba no incluir liquidaciones, y
las liquidaciones funcionaban igual.

Peor todavía: el catálogo se escribió antes de las etapas 12 a 19. Bandeja
omnicanal, portal, conciliación bancaria, actas, emprendimientos en pozo y la Red
no figuraban en ningún plan, así que los tenía cualquiera.

Definir los planes «a la perfección» era, entonces, dos trabajos: **declararlos**
y **hacerlos valer**. La 044 hace el primero; el `ModuloGuard` hace el segundo.

---

## 1 · Base

**Para quien trabaja solo o son dos, y hoy tiene la cartera en un Excel y las
consultas en el WhatsApp personal.**

La idea es que entre sin pensarlo. Por eso **no le falta ninguna pieza del flujo
de su día**: carga propiedades, recibe consultas, hace seguimiento, firma un
contrato, cobra el alquiler y ajusta por índice. Todo eso anda.

Lo que tiene son **techos**, no agujeros:

| | |
|---|---|
| Propiedades | 150 |
| Contratos vigentes | 25 |
| Usuarios | 2 |
| Envíos a clientes | 10 por mes |

Y lo que no incluye es lo que **todavía no necesita**: liquidarle a propietarios
de terceros, repartir comisiones entre agentes, publicar en portales, atender por
seis canales.

> **La decisión de fondo.** Un plan de entrada al que le falta un paso del flujo
> se abandona antes de terminar de cargar la cartera: la persona descubre a mitad
> de camino que no puede hacer lo que vino a hacer. Un tope, en cambio, se
> descubre cuando el sistema ya le sirve, y ese es el momento en que subir de
> plan es una buena noticia y no un rescate.

---

## 2 · Inmobiliaria

**Para la oficina con equipo que además administra alquileres de terceros.**

Acá aparece lo que más tiempo ahorra y lo que reparte plata:

- **Liquidaciones** al propietario, con honorarios, gastos y retenciones
- **Portales** de propietario y de inquilino — el enlace que corta los llamados
- **Comisiones** de la casa y de cada agente
- **Publicaciones** y feed XML a los portales inmobiliarios
- **Bandeja omnicanal** — hasta 2 canales
- **Documentos y pre-contratos**
- **La Red** — buscar sin límite, ofrecer hasta 20 propiedades

Topes: 1.000 propiedades, 10 usuarios, contratos y envíos sin límite.

> **Por qué la Red viene capada y no completa.** Ofrecer 20 propiedades alcanza
> para ver si la Red le trae algo. Si le trae, va a querer poner las 200.

---

## 3 · Total

**Para quien administra a escala, desarrolla emprendimientos o tiene más de una
sucursal.**

Todo lo anterior **sin un solo techo**, más:

- **Conciliación bancaria** — el extracto cruzado contra los cobros
- **Emprendimientos en pozo** — unidades por planilla, planes de pago,
  calculadora de cuotas y de inversión
- **Actas** de inicio y cierre con fotos
- **Multisucursal**
- **API y webhooks**
- **Marca blanca**
- **ARCA**

---

## El precio

**Todavía no está decidido, y por eso la columna `precio_usd` está vacía.** El
catálogo público dice «A convenir» hasta que alguien escriba un número. Es la
regla que este repo tiene desde la etapa 0 y que un test cuida: no se publica un
precio que nadie decidió.

### Lo que se propone

| Plan | Propuesta | Referencia |
|---|---|---|
| Base | **USD 25 / mes** | Menos que una publicación destacada en un portal |
| Inmobiliaria | **USD 79 / mes** | Alrededor de la mitad de lo que sale Tokko |
| Total | **USD 199 / mes** | Más barato que Tokko y hace lo que Tokko no hace |

**En dólares y no en pesos**: un número en pesos queda viejo solo. Se cobra el
equivalente del día.

**Cómo se carga**, cuando esté decidido:

```sql
UPDATE plan SET precio_usd = 25  WHERE codigo = 'base';
UPDATE plan SET precio_usd = 79  WHERE codigo = 'inmobiliaria';
UPDATE plan SET precio_usd = 199 WHERE codigo = 'total';
```

Vive en la base y no en el código justamente para que cambiarlo no sea un
despliegue.

---

## Lo que los planes NO hacen

**No bloquean por falta de pago.** Los topes son del **plan**, no del estado de
la suscripción. Una cuenta con la cuota vencida sigue viendo sus contratos, sus
liquidaciones y sus propiedades.

**Bajar de plan no esconde el trabajo hecho.** El `ModuloGuard` acepta
`lecturaLibre`, y los módulos que guardan registros —liquidaciones, ventas,
comisiones, actas, documentos— lo usan: se deja de **emitir**, no de **leer**.

Los que no lo usan son aquellos donde leer **es** el servicio: la Red y la
bandeja. Ahí un GET libre regalaría justo lo que se cobra.

> Cortarle a alguien el acceso a sus propios registros para presionarlo a pagar
> no es un límite comercial. Es tomarle el trabajo de rehén.
