<script setup lang="ts">
import { computed } from 'vue';
import StatusChip from './StatusChip.vue';
import UiIcon from './UiIcon.vue';
import { atributosDe, superficieDe } from '../dominio/atributos';
import {
  ETIQUETA_OPERACION, ETIQUETA_TIPO, etiquetaSituacion, money, tonoSituacion,
} from '../dominio/formato';
import type { OperacionDeTarjeta, PropiedadTarjeta } from '../dominio/propiedad';

/**
 * Una propiedad, como una fila con foto.
 *
 * ── Para qué existe, habiendo tabla y tarjetas ──
 *
 * La tabla es densa y no tiene foto: sirve para trabajar sobre la cartera. Las
 * tarjetas tienen foto grande pero entran cuatro por pantalla: sirven para
 * mostrarle la cartera a alguien.
 *
 * Falta la de RECORRER buscando: foto suficiente para reconocer la propiedad,
 * y ocho o diez por pantalla. Es la forma en que se mira un portal y por eso
 * es la que la gente de este rubro ya sabe leer.
 *
 * ── La foto a la izquierda y fija ──
 *
 * Ancho fijo y no proporcional: con anchos variables las columnas de precio y
 * atributos bailan de fila en fila, y el ojo pierde la referencia vertical que
 * es justo lo que hace rápido recorrer una lista.
 */

const props = defineProps<{
  propiedad: PropiedadTarjeta;
  modo?: 'general' | 'venta' | 'alquiler';
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

const atributos = computed(() => atributosDe(props.propiedad));
const superficie = computed(() => superficieDe(props.propiedad));

/** Igual que en la tarjeta: sólo lo que NO es «disponible». */
const situacionesDestacadas = computed(() =>
  operaciones.value.filter((o) => o.estado !== 'disponible'));

const precio = (o: OperacionDeTarjeta) =>
  o.precio === null ? 'Consultar' : money(o.precio, o.moneda);

function alternarFavorita(ev: Event) {
  ev.preventDefault();
  ev.stopPropagation();
  emit('favorita', !props.favorita);
}
</script>

<template>
  <RouterLink class="fila elevar" :to="`/propiedades/${propiedad.id}`">
    <div class="foto">
      <img
        v-if="propiedad.fotoPortada"
        :src="propiedad.fotoPortada"
        alt=""
        loading="lazy"
        decoding="async"
        width="200"
        height="150"
      />
      <div v-else class="sin-foto">
        <UiIcon nombre="edificio" :tam="22" />
        <span>{{ tipoEnPalabras }}</span>
      </div>
    </div>

    <div class="cuerpo">
      <!-- El precio primero, como en la tarjeta y como en los portales: es lo
           que decide si se sigue leyendo la fila. -->
      <div class="precios">
        <span v-for="o in operaciones" :key="o.id" class="precio">
          {{ precio(o) }}
          <small v-if="operaciones.length > 1">{{ ETIQUETA_OPERACION[o.tipo] ?? o.tipo }}</small>
        </span>
        <span v-if="!operaciones.length" class="sin-op">Sin operación</span>
      </div>

      <p class="dir">{{ propiedad.direccion }}</p>

      <ul class="atributos">
        <li v-for="a in atributos" :key="a.clave" :class="a.estado" :title="a.titulo">
          <UiIcon :nombre="a.icono" :tam="14" />
          <span>{{ a.texto }}</span>
        </li>
        <li v-if="superficie">
          <UiIcon nombre="superficie" :tam="14" />
          <span>{{ superficie }}</span>
        </li>
      </ul>
    </div>

    <div class="lado">
      <button
        class="corazon"
        :class="{ marcada: favorita }"
        type="button"
        :aria-pressed="favorita === true"
        :aria-label="favorita ? 'Quitar de mis marcadas' : 'Marcar esta propiedad'"
        @click="alternarFavorita"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13z"
            :fill="favorita ? 'currentColor' : 'none'"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
      </button>

      <StatusChip
        v-for="o in situacionesDestacadas"
        :key="o.id"
        :texto="etiquetaSituacion(o.estado, o.tipo)"
        :tono="tonoSituacion(o.estado)"
      />

      <span class="cod mono">{{ propiedad.etiqueta }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.fila {
  display: grid;
  grid-template-columns: 200px 1fr auto;
  gap: var(--s-lg);
  align-items: stretch;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: clip;
  text-decoration: none; color: inherit;
}

/* Ancho FIJO: con anchos proporcionales, las columnas de precio y atributos
   bailan de fila en fila y el ojo pierde la referencia vertical, que es lo que
   hace rápido recorrer una lista. */
.foto { aspect-ratio: 4 / 3; background: var(--surface-3); }
.foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sin-foto {
  height: 100%; display: grid; place-content: center; justify-items: center;
  gap: 4px; color: var(--muted); font-size: 11px;
}

.cuerpo { display: grid; gap: var(--s-xs); align-content: center; padding: var(--s-md) 0; min-width: 0; }
.precios { display: flex; gap: var(--s-lg); flex-wrap: wrap; align-items: baseline; }
.precio {
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  font-size: 18px; color: var(--ink);
}
.precio small {
  font-family: var(--font-ui); font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: .04em; margin-left: 4px;
}
.sin-op { font-size: 13px; color: var(--muted-2); }

.dir { margin: 0; font-size: 13px; color: var(--ink-2); }

.atributos { display: flex; flex-wrap: wrap; gap: var(--s-sm) var(--s-md); margin: 0; padding: 0; list-style: none; }
.atributos li { display: inline-flex; align-items: center; gap: var(--s-xs); font-size: 12.5px; color: var(--ink-2); }
.atributos li svg { color: var(--muted); flex: none; }
.atributos li.cero { color: var(--muted); }
.atributos li.sin_dato { color: var(--warning-ink); }
.atributos li.sin_dato svg { color: var(--warning-ink); }

.lado {
  display: grid; gap: var(--s-sm); justify-items: end; align-content: space-between;
  padding: var(--s-md) var(--s-lg) var(--s-md) 0;
}
.cod { font-size: 11px; color: var(--muted); }

.corazon {
  display: grid; place-items: center;
  width: 30px; height: 30px; border-radius: var(--r-full);
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
}
.corazon:hover { background: var(--surface-2); color: var(--ink-2); }
.corazon.marcada { color: var(--danger); }

@media (max-width: 40rem) {
  /* En el teléfono la foto pasa arriba y a todo el ancho: 200px al costado
     dejan la dirección en una columna de dos palabras. */
  .fila { grid-template-columns: 1fr; }
  .foto { aspect-ratio: 16 / 9; }
  .cuerpo { padding: 0 var(--s-lg); }
  .lado {
    grid-auto-flow: column; justify-items: start; align-items: center;
    padding: 0 var(--s-lg) var(--s-md);
  }
}
</style>
