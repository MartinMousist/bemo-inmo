# BEMO — el grupo

> Este documento es **del grupo, no de Bemo INMO**. Vive acá porque INMO es el primer
> producto que lo necesita.

---

## Los productos

**BEMO** es el grupo. Cada producto es un SaaS vertical, con su propio cliente, su propio
código, su propia base y su propio deploy.

| Producto | Vertical | Estado |
|---|---|---|
| **Bemo MED** | Agenda y fichas clínicas | En producción |
| **Bemo INMO** | Gestión inmobiliaria | Etapa 1 |
| Bemo `<X>` | — | Futuro |

---

## La decisión central: BEMO es una marca, no una plataforma

**No se comparte código, ni base, ni runtime, ni stack.** Cada producto se construye
entero, siguiendo el mismo método.

Lo que se comparte:

1. **El nombre y la reputación.** Un cliente de MED que conoce a alguien del rubro
   inmobiliario ya confía en la marca.
2. **El método** — `PLAYBOOK.md`. Las ocho etapas con sus gates, el inventario de
   componentes, los patrones de backend, la lista de errores que no hay que repetir.
3. **La estética de familia** — la capa compartida de `DESIGN.md` (ver §0 de ese archivo):
   la rampa de neutros, el espaciado, los radios, la tipografía y la forma de los
   componentes. Cada producto aporta sólo su acento.

Nada de eso es una dependencia en tiempo de ejecución ni un paquete que haya que versionar.
Se copia y se adapta.

### Por qué no compartir código

Suena a desperdicio y no lo es:

1. **Runtime compartido es caída compartida.** Un servicio de identidad común hace que un
   incidente en un producto se lleve puestos a todos. Para un equipo chico es el peor trade
   disponible.
2. **El solapamiento de clientes es cero.** Una inmobiliaria no es un consultorio. La cuenta
   única no le ahorra nada a nadie que exista hoy.
3. **Acopla los ciclos de release.** Un cambio para MED obliga a regresionar INMO antes de
   poder desplegarlo.
4. **Los stacks ya difieren de hecho.** Bemo MED corre Spring Boot + MariaDB; Bemo INMO va
   en NestJS + Postgres, siguiendo el playbook. No hay un artefacto que los dos puedan usar.

**El mecanismo de reuso es el playbook, no un paquete npm.** Copiar la receta cuesta unos
días por producto; desacoplar mal cuesta meses y no se termina nunca.

Esto se revisa el día que haya tres productos con el mismo stack y una pieza idéntica
mantenida en tres lugares. Recién ahí el paquete compartido se paga solo.

### Lo único que conviene copiar entre productos, tal cual

Del playbook, sección 5 y 6: los ~20 componentes de UI, el login con refresh single-flight,
el contrato de error, la matriz de permisos table-driven. **Se copian los archivos.** El
tercer producto de BEMO va a arrancar con las etapas 1 y 2 en días, no en semanas, sin que
exista ninguna dependencia entre repos.

---

## Convenciones

| Cosa | Convención | Bemo INMO | Bemo MED |
|---|---|---|---|
| Marca | `Bemo <VERTICAL>` | Bemo INMO | Bemo MED |
| Repo | `bemo-<vertical>` | `bemo-inmo` | `bemo-main` (legacy) |
| Dominio | `<vertical>.bemo.<tld>` | `inmo.bemo.com.ar` | `med.bemo.com.ar` |
| Base | `bemo_<vertical>` | `bemo_inmo` | — |
| Rol de app | `<vertical>_app` | `inmo_app` | — |
| Prefijo de API | `/v1` en todos | | |

**El wordmark**: "Bemo" con la vertical en mayúsculas y peso más liviano —
Bemo **INMO**. La vertical nunca va sola: el producto es "Bemo INMO", no "INMO".

### Cookies y dominios — la trampa

El refresh token va en cookie httpOnly seteada en el **subdominio exacto**
(`inmo.bemo.com.ar`), nunca en el dominio padre (`.bemo.com.ar`).

Una cookie de dominio padre la comparten todos los subdominios: es acoplamiento que nadie
pidió y superficie de ataque de regalo — un XSS en cualquier producto, o en la landing del
grupo, alcanza la sesión de los demás.

Consecuencia práctica: **la landing del grupo (`bemo.com.ar`) es un sitio estático
separado**, sin acceso a ninguna sesión.

---

## Lo que el grupo NO promete

Conviene no venderlo, porque no existe y construirlo costaría caro:

- Cuenta única entre productos. Los clientes no se solapan.
- Datos cruzados entre verticales. No los hay y no debería haberlos.
- Descuento por comprar dos productos. No hay a quién vendérselo.

---

## Pendientes del grupo

| # | Pendiente | Bloquea |
|---|---|---|
| G1 | Confirmar qué familias tipográficas usa Bemo MED. Si difieren de Newsreader + IBM Plex Sans/Mono, hay que unificar la capa familia de `DESIGN.md`. | Nada duro; la coherencia visual del grupo |
| G2 | Definir el rango de acentos disponible para futuras verticales, para que no colisionen entre sí ni con los semánticos. | Nada urgente |
| G3 | Registrar `bemo.com.ar` y los subdominios por vertical. | La etapa 8 de INMO |
| G4 | Verificar disponibilidad de la marca "BEMO" en la clase que corresponda (INPI). | Antes de gastar en material de marca |
| G5 | Corregir `PLAYBOOK.md`: dice que bemo es "Vue 3 + NestJS + Postgres" y el proyecto del que sale (Bemo MED) es Spring Boot + MariaDB. El método es correcto; la línea del stack no. | Nada, pero cuesta cinco minutos y evita repetir la confusión |

**G4 no es un detalle.** Es más barato descubrir hoy que el nombre está tomado que después
de haber armado la identidad de tres productos.
