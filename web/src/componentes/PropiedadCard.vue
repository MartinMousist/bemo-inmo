<script setup lang="ts">
import { computed } from 'vue';
import StatusChip from './StatusChip.vue';
import UiIcon from './UiIcon.vue';
import { atributosDe, superficieDe } from '../dominio/atributos';
import {
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  etiquetaSituacion,
  moneyCorto,
  tonoSituacion,
} from '../dominio/formato';
import type { OperacionDeTarjeta, PropiedadTarjeta } from '../dominio/propiedad';

/**
 * Una propiedad, vista como tarjeta.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────────
 *
 * La tabla es y sigue siendo el default: se trabaja con ella. La tarjeta es la
 * vista que se da vuelta sobre el escritorio para mostrarle la cartera a
 * alguien, y ahí la foto y el precio pesan más que la densidad.
 *
 * ── Toda la tarjeta es UN `<RouterLink>` ────────────────────────────────────
 *
 * No un `<div>` con `@click` + `@keydown.enter`, que es lo que hacen las filas
 * de la tabla y lo que ya se pagó una vez: un control adentro de un contenedor
 * clicable necesita `@click.stop` **y** `@keydown.stop`, y si se olvida uno, el
 * Enter que confirma un valor abre la ficha. Con un enlace de verdad no hay
 * nada que interceptar: el navegador ya sabe qué hacer con Enter, con el clic
 * del medio y con «abrir en pestaña nueva», que en un listado es lo que uno
 * quiere hacer.
 *
 * Por lo mismo, la tarjeta NO trae los honorarios editables que tiene la tabla.
 * No es un olvido: el honorario es política de la casa y esta es la vista que
 * se le muestra a un tercero. Se edita en la tabla y en la ficha.
 *
 * ── Ningún texto encima de la foto ──────────────────────────────────────────
 *
 * Sobre una imagen arbitraria el contraste no se puede medir, y acá el
 * contraste se mide (DESIGN.md §6). El precio y los chips van abajo, sobre una
 * superficie del sistema.
 */

const props = defineProps<{
  propiedad: PropiedadTarjeta;
  /**
   * Qué listado la está mostrando. En las carteras se destaca la operación de
   * ese listado: en la de venta, el precio de venta. Sin esto, una propiedad
   * que está en venta Y en alquiler mostraría el alquiler primero en la
   * cartera de venta, que es el número equivocado en la pantalla equivocada.
   */
  modo?: 'general' | 'venta' | 'alquiler';
}>();

const tipoEnPalabras = computed(
  () => ETIQUETA_TIPO[props.propiedad.tipo] ?? props.propiedad.tipo,
);

const operaciones = computed(() => {
  const todas = props.propiedad.operaciones ?? [];
  if (props.modo === 'venta') return todas.filter((o) => o.tipo === 'venta');
  if (props.modo === 'alquiler') return todas.filter((o) => o.tipo.startsWith('alquiler'));
  return todas;
});

/**
 * El chip que dice «Venta» o «Alquiler» sólo aparece si hay DOS operaciones.
 *
 * Con una sola, la palabra no agrega nada —en la cartera de venta todo es
 * venta— y compite con el chip de situación, que es el que sí cambia entre
 * tarjetas.
 */
const mostrarTipoOperacion = computed(() => operaciones.value.length > 1);

/**
 * Las operaciones cuya situación merece un chip.
 *
 * «Disponible» es lo que uno asume al abrir una cartera, así que decirlo en
 * cada tarjeta gasta color sin informar — y peor: con veinticuatro chips verdes
 * iguales, la única que dice «Reservada» deja de saltar a la vista, que es lo
 * único para lo que servía el chip.
 */
const situacionesDestacadas = computed(() =>
  operaciones.value.filter((o) => o.estado !== 'disponible'));

const atributos = computed(() => atributosDe(props.propiedad));
const superficie = computed(() => superficieDe(props.propiedad));

function precio(o: OperacionDeTarjeta): string {
  // Un precio sin cargar no es cero ni un guión suelto: se dice.
  return o.precio === null ? 'sin precio' : moneyCorto(o.precio, o.moneda);
}

/**
 * El nombre accesible de la tarjeta.
 *
 * Un `aria-label` en el enlace REEMPLAZA lo que se lee adentro, así que tiene
 * que traer todo lo que la tarjeta muestra o el lector de pantalla ve menos que
 * la vista. Por eso se arma con las mismas piezas y en el mismo orden.
 */
const etiquetaAccesible = computed(() => {
  const partes = [
    props.propiedad.etiqueta,
    tipoEnPalabras.value,
    props.propiedad.direccion,
  ];
  for (const o of operaciones.value) {
    partes.push(
      `${ETIQUETA_OPERACION[o.tipo] ?? o.tipo} ${precio(o)}, ` +
        etiquetaSituacion(o.estado, o.tipo),
    );
  }
  if (!operaciones.value.length) partes.push('sin operación');
  for (const a of atributos.value) partes.push(a.titulo);
  if (superficie.value) partes.push(superficie.value.replace(/·/g, 'y'));
  return partes.join('. ');
});
</script>

<template>
  <RouterLink
    class="tarjeta elevar"
    :to="`/propiedades/${propiedad.id}`"
    :aria-label="etiquetaAccesible"
  >
    <!-- El `<img>` va adentro de un `.media` con `aspect-ratio` y no suelto: un
         `aspect-ratio` sobre el propio `<img>` no se respeta cuando es hijo de
         una tarjeta flex, y la imagen sale estirada al doble de alto. El
         wrapper además reserva el hueco antes de que la foto llegue, así que la
         grilla no salta cuando cargan las de abajo del pliegue. -->
    <div class="media">
      <img
        v-if="propiedad.fotoPortada"
        :src="propiedad.fotoPortada"
        alt=""
        loading="lazy"
        decoding="async"
        width="480"
        height="360"
      />
      <!-- El placeholder digno: mismo bloque 4:3 para que la grilla no salte,
           y dice QUÉ es la propiedad además de que no tiene foto. Nunca un
           `<img>` con src roto ni un rectángulo gris pelado.
           Los grises son `--ink-2` (9,15 claro / 10,89 oscuro) y `--muted`
           (4,98 / 4,83) sobre `--surface-3`: `--muted-2` ahí da 4,42 en oscuro,
           por debajo de AA, y a ojo se ve igual. -->
      <div v-else class="placeholder">
        <UiIcon nombre="edificio" :tam="30" />
        <span class="ph-tipo">{{ tipoEnPalabras }}</span>
        <span class="ph-nota">Sin foto cargada</span>
      </div>
    </div>

    <!--
      El orden es el de Zillow y el de Zonaprop, y no por copiar: es el orden en
      que se mira una propiedad. Primero cuánto sale, después qué es, después
      dónde queda. El código y el tipo bajaron al pie —en la vista de tarjetas
      nadie busca por «PROP-0017»; para eso está la tabla— y el chip de
      situación aparece SÓLO cuando no es la corriente.
    -->
    <div class="cuerpo">
      <div v-for="o in operaciones" :key="o.id" class="op">
        <span class="precio" :class="{ vacio: o.precio === null }">{{ precio(o) }}</span>
        <!-- La palabra «Venta» va como texto chico al lado del número y no como
             chip de acento: con dos operaciones eran cuatro chips por tarjeta y
             veinticuatro tarjetas en pantalla. -->
        <span v-if="mostrarTipoOperacion" class="op-tipo">
          {{ ETIQUETA_OPERACION[o.tipo] ?? o.tipo }}
        </span>
      </div>
      <!-- «Sin operación» y no «sin operación cargada»: en el listado general
           las operaciones CERRADAS no vienen, así que una propiedad vendida
           llega acá con el array vacío. Decir «cargada» afirmaría algo que este
           listado no sabe. Es el mismo texto que usa la tabla. -->
      <p v-if="!operaciones.length" class="vacio sin-op">Sin operación</p>

      <!-- Los atributos suben: son lo segundo que se mira y lo que descarta una
           propiedad de un vistazo. Antes iban al fondo, después de un divisor. -->
      <ul v-if="atributos.length" class="atributos">
        <li v-for="a in atributos" :key="a.clave" :class="a.estado" :title="a.titulo">
          <UiIcon :nombre="a.icono" :tam="15" />
          <span>{{ a.texto }}</span>
        </li>
        <li v-if="superficie" :title="superficie">
          <UiIcon nombre="superficie" :tam="15" />
          <span>{{ superficie }}</span>
        </li>
      </ul>
      <!-- Clase propia y NO `.atributos`: un terreno no tiene ambientes ni
           baños, y un test comprueba justamente que esa lista no exista. Meter
           la superficie ahí lo dejaba en rojo, con razón. -->
      <p v-else-if="superficie" class="solo-sup">
        <UiIcon nombre="superficie" :tam="15" />
        <span>{{ superficie }}</span>
      </p>

      <p class="dir">{{ propiedad.direccion }}</p>

      <footer class="pie">
        <span class="cod">{{ propiedad.etiqueta }}</span>
        <span class="tipo">{{ tipoEnPalabras }}</span>
        <!--
          Sólo lo que NO es «Disponible».

          Un chip verde que dice «Disponible» en las veinticuatro tarjetas no
          informa: es el estado que uno asume al abrir la cartera. Lo que hay
          que ver de lejos es la excepción — reservada, alquilada, suspendida —
          y con veinticuatro chips iguales al lado, esa una se pierde.

          El estado sigue en el `aria-label`, que se arma aparte: para un lector
          de pantalla no hay «de un vistazo» y omitirlo sí sería perder el dato.
        -->
        <StatusChip
          v-for="o in situacionesDestacadas"
          :key="o.id"
          :texto="etiquetaSituacion(o.estado, o.tipo)"
          :tono="tonoSituacion(o.estado)"
        />
      </footer>
    </div>
  </RouterLink>
</template>

<style scoped>
.tarjeta {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-1);
  /* `clip` y no `hidden`, igual que `.card.sin-padding`: recorta la foto contra
     el radio sin crear un contenedor de scroll. */
  overflow: clip;
  color: inherit;
  text-decoration: none;
}
/* El enlace hereda `color: var(--accent)` de la capa familia y adentro hay
   texto de cuerpo: se devuelve a los tokens de tinta. */
.tarjeta:hover { color: inherit; }

/* El anillo de foco, repuesto a mano — y no es cosmética.
   `familia.css` tiene `:focus-visible { box-shadow: var(--ring) }`, que es
   (0,1,0). Esta regla está en un `<style scoped>`, así que Vue le agrega el
   `[data-v-…]` y `.tarjeta` pasa a (0,2,0): el `box-shadow: var(--sh-1)` de
   arriba le GANA al del foco y la tarjeta enfocada queda idéntica a las demás.
   Se descubrió tabulando la grilla en el navegador —`:focus-visible` daba
   `true` y el `box-shadow` computado seguía siendo `sh-1`—, no leyendo el CSS.
   Es la misma trampa de especificidad que ya está anotada para `h3` contra
   `.text-lg` en DESIGN.md. */
.tarjeta:focus-visible {
  box-shadow: var(--ring), var(--sh-2);
  border-color: var(--accent-line);
}

.media {
  aspect-ratio: 4 / 3;
  flex: none;
  overflow: hidden;
  background: var(--surface-3);
}
.media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2xs);
  color: var(--muted);
}
.ph-tipo { color: var(--ink-2); font-size: 13px; font-weight: 500; margin-top: var(--s-xs); }
.ph-nota { color: var(--muted); font-size: 11px; }

.cuerpo {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-md) var(--s-lg) var(--s-lg);
}

/* El pie: identidad y excepciones. Separado por una línea porque es otra clase
   de dato —de qué se trata la fila, no de qué se trata la propiedad— y sin ella
   se lee como una atributo más. */
.pie {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  margin-top: auto;
  padding-top: var(--s-sm);
  border-top: 1px solid var(--line);
}
/* El chip de excepción se empuja al extremo: es lo único del pie que cambia
   entre tarjetas, y contra el borde se encuentra recorriendo una columna. */
.pie :deep(.chip) { margin-left: auto; }

.cod {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.tipo {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted-2);
}

.op {
  display: flex;
  align-items: baseline;
  gap: var(--s-sm);
  flex-wrap: wrap;
  row-gap: var(--s-2xs);
}
/* El precio manda. Es lo primero que se mira en una tarjeta y antes competía
   con dos chips de color al lado. */
.precio {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 19px;
  line-height: 1.2;
  color: var(--ink);
}
.op-tipo {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.vacio { color: var(--muted-2); font-size: 13px; font-family: var(--font-ui); }
.sin-op { font-size: 13px; }

.dir {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.4;
  /* Dos renglones y corta: una dirección larga no puede hacer más alta a una
     tarjeta que las de al lado, o la grilla queda con escalones. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.atributos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-sm) var(--s-md);
  margin: 0;
  padding: 0;
  list-style: none;
}
.atributos li {
  display: inline-flex;
  align-items: center;
  gap: var(--s-xs);
  font-size: 13px;
  color: var(--ink-2);
}
.atributos li svg { color: var(--muted); flex: none; }
/* Un 0 es un dato y se dice con palabras, apagado. */
.atributos li.cero { color: var(--muted); font-size: 12px; }
/* Un dato SIN CARGAR es lo único de la tarjeta que pide una acción, así que se
   ve distinto de un 0: va en el ámbar de los semánticos —`--warning-ink`, 5,01
   sobre su tint y AA sobre superficie— y no en gris. Es una decisión
   reversible: hoy afecta a muy pocas propiedades, y si con la cartera cargada
   ensucia la grilla, baja a `--muted`. */
.atributos li.sin_dato { color: var(--warning-ink); }
.atributos li.sin_dato svg { color: var(--warning-ink); }

/* La superficie entró en la MISMA fila que los atributos, como un ítem más.
   Antes era un renglón aparte debajo de un divisor: dos líneas de metadatos
   donde alcanza una. */
.atributos li { font-variant-numeric: tabular-nums; }
.solo-sup {
  display: inline-flex;
  align-items: center;
  gap: var(--s-xs);
  font-size: 13px;
  color: var(--ink-2);
}
.solo-sup svg { color: var(--muted); flex: none; }
</style>
