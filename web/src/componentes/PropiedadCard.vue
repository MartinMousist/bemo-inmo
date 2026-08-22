<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  /** Si esta persona la marcó. Lo sabe la pantalla, no la tarjeta. */
  favorita?: boolean;
}>();

const emit = defineEmits<{ (e: 'favorita', marcada: boolean): void }>();

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

/**
 * El carrusel.
 *
 * ── Por qué las flechas y no un scroll horizontal ──
 *
 * Un carrusel que se arrastra con el dedo anda bien en el teléfono y en el
 * escritorio obliga a hacer scroll lateral con el trackpad ADENTRO de una
 * grilla que ya scrollea vertical. Las dos direcciones peleando es el gesto
 * más frustrante que hay. Con flechas, cada foto es un clic.
 *
 * ── El índice se reinicia si cambian las fotos ──
 *
 * La grilla reusa los componentes al filtrar: sin esto, la tarjeta que estaba
 * en la foto 6 muestra la 6 de OTRA propiedad, que puede tener tres.
 */
const foto = ref(0);
const galeria = computed(() => {
  const f = props.propiedad.fotos ?? [];
  if (f.length) return f;
  return props.propiedad.fotoPortada ? [props.propiedad.fotoPortada] : [];
});
watch(galeria, () => { foto.value = 0; });

function mover(delta: number, ev: Event) {
  // Las flechas viven ADENTRO del RouterLink que es toda la tarjeta: sin
  // frenar el evento, pasar de foto abre la ficha.
  ev.preventDefault();
  ev.stopPropagation();
  const n = galeria.value.length;
  if (n < 2) return;
  foto.value = (foto.value + delta + n) % n;
}

function alternarFavorita(ev: Event) {
  ev.preventDefault();
  ev.stopPropagation();
  emit('favorita', !props.favorita);
}

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
    <!--
      La foto A SANGRE: sin marco, tocando los tres bordes de la tarjeta.

      No es gusto: en una grilla la foto es lo que hace que el ojo se detenga, y
      un margen alrededor la convierte en una ilustración adentro de una ficha.
      Sin margen, la tarjeta ES la propiedad. El recorte lo hace `.tarjeta` con
      su `overflow: clip`.

      El `<img>` va adentro de un `.media` con `aspect-ratio` y no suelto: un
      `aspect-ratio` sobre el propio `<img>` no se respeta cuando es hijo de una
      tarjeta flex, y la imagen sale estirada al doble de alto. El wrapper
      además reserva el hueco antes de que la foto llegue, así que la grilla no
      salta cuando cargan las de abajo del pliegue.
    -->
    <div class="media" :data-n="galeria.length">
      <img
        v-if="galeria.length"
        :key="galeria[foto]"
        :src="galeria[foto]"
        alt=""
        :loading="foto === 0 ? 'lazy' : 'eager'"
        decoding="async"
        width="480"
        height="360"
      />

      <!-- El placeholder digno: mismo bloque para que la grilla no salte, y
           dice QUÉ es la propiedad además de que no tiene foto. Nunca un
           `<img>` con src roto ni un rectángulo gris pelado. -->
      <div v-else class="placeholder">
        <UiIcon nombre="edificio" :tam="30" />
        <span class="ph-tipo">{{ tipoEnPalabras }}</span>
        <span class="ph-nota">Sin foto cargada</span>
      </div>

      <!--
        Las flechas aparecen con el cursor encima y sólo si hay más de una.
        Siempre visibles taparían la foto en las cincuenta tarjetas de la
        grilla; en pantalla táctil no hay hover, así que ahí quedan fijas (ver
        la media query).
      -->
      <template v-if="galeria.length > 1">
        <button class="flecha izq" type="button" aria-label="Foto anterior"
          @click="mover(-1, $event)">‹</button>
        <button class="flecha der" type="button" aria-label="Foto siguiente"
          @click="mover(1, $event)">›</button>

        <!-- Los puntos dicen CUÁNTAS hay y en cuál estás. Sin ellos, el
             carrusel no anuncia que existe y nadie toca las flechas. -->
        <span class="puntos" aria-hidden="true">
          <i v-for="(u, i) in galeria" :key="u" :class="{ act: i === foto }" />
        </span>
        <span class="solo-lectores">Foto {{ foto + 1 }} de {{ galeria.length }}</span>
      </template>

      <!--
        El corazón.

        `aria-pressed` y no un ícono distinto a secas: para quien no ve el
        relleno, «marcada» tiene que estar en el estado del botón y no en el
        color. Y `type="button"` porque esto vive adentro de un enlace.
      -->
      <button
        class="corazon"
        :class="{ marcada: favorita }"
        type="button"
        :aria-pressed="favorita === true"
        :aria-label="favorita ? 'Quitar de mis marcadas' : 'Marcar esta propiedad'"
        @click="alternarFavorita"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13z"
            :fill="favorita ? 'currentColor' : 'none'"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

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
  position: relative;
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

/* ── La foto a sangre y sus controles ─────────────────────────────────────── */
.media { position: relative; }

/* Las flechas: sólo con el cursor encima. Siempre visibles taparían la foto en
   las cincuenta tarjetas de una grilla. */
.flecha, .corazon {
  position: absolute;
  border: 0; cursor: pointer;
  display: grid; place-items: center;
  transition: opacity var(--t-short), background var(--t-short);
}
.flecha {
  top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; border-radius: var(--r-full);
  background: rgba(255, 255, 255, .92); color: var(--ink);
  font-size: 20px; line-height: 1; padding-bottom: 3px;
  opacity: 0;
}
.flecha.izq { left: 8px; }
.flecha.der { right: 8px; }
.tarjeta:hover .flecha, .flecha:focus-visible { opacity: 1; }
.flecha:hover { background: #fff; }

.puntos {
  position: absolute; bottom: 8px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 5px;
  pointer-events: none;
}
.puntos i {
  width: 5px; height: 5px; border-radius: var(--r-full);
  background: rgba(255, 255, 255, .55);
  /* Una sombra mínima: sobre una foto clara, blanco al 55% desaparece. */
  box-shadow: 0 0 2px rgba(0, 0, 0, .4);
}
.puntos i.act { background: #fff; }

/* El corazón SÍ está siempre: es una acción, no una ayuda de navegación, y si
   sólo aparece al pasar por encima nadie descubre que se puede marcar. */
.corazon {
  top: 8px; right: 8px;
  width: 30px; height: 30px; border-radius: var(--r-full);
  background: rgba(255, 255, 255, .88);
  color: var(--ink-2);
}
.corazon:hover { background: #fff; }
/* El rojo del sistema, no uno nuevo. `--danger` significa «peligro» en toda la
   app, pero un corazón lleno se lee como marcado y no como alarma: el
   significado lo pone la forma, no el color. */
.corazon.marcada { color: var(--danger); }

.solo-lectores {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

/* En pantalla táctil no hay hover: las flechas quedan fijas o el carrusel es
   invisible para quien usa el teléfono, que es justo donde más se usa. */
@media (hover: none) {
  .flecha { opacity: 1; }
}

/* Quien pidió menos movimiento no quiere transiciones de opacidad en cada
   tarjeta que toca el cursor. */
@media (prefers-reduced-motion: reduce) {
  .flecha, .corazon { transition: none; }
}
</style>
