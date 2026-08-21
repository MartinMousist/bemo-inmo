<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * Un filtro que vive detrás de una pastilla.
 *
 * ── Qué reemplaza ──
 *
 * La pantalla de propiedades tenía TREINTA campos de filtro en una sola
 * columna. Plegados detrás de «Más filtros» no molestaban, pero abiertos eran
 * una pared: para poner un mínimo de ambientes había que reconocer un par
 * «Desde / Hasta» entre otros siete pares idénticos.
 *
 * Acá cada dimensión —precio, ambientes, superficie— es una pastilla. Cerrada
 * dice su nombre, o el valor elegido si hay uno. Abierta muestra sólo sus
 * campos. Es como filtran Zonaprop y Zillow, y es lo que la gente de este rubro
 * ya sabe usar sin que nadie le explique.
 *
 * ── Las tres decisiones ──
 *
 * **La pastilla muestra el VALOR, no una marca.** Un puntito que avisa «hay algo
 * acá» obliga a abrir para saber qué. «Desde 2 amb.» se lee sin abrir nada.
 *
 * **Se aplica al cerrar, no en cada tecla.** Escribir «1500» dispararía cuatro
 * búsquedas, tres de ellas con números que nadie quiso buscar.
 *
 * **Limpiar vive adentro del panel.** Es lo que se busca cuando la búsqueda no
 * devuelve nada, y ponerlo lejos del campo que sobra lo vuelve una cacería.
 */
const props = defineProps<{
  etiqueta: string;
  /** Lo elegido, en una línea corta. `null` = sin filtrar. */
  valor?: string | null;
  /** Ancho del panel. Los de rango necesitan menos que una lista de opciones. */
  ancho?: number;
}>();

const emit = defineEmits<{ (e: 'aplicar'): void; (e: 'limpiar'): void }>();

const abierto = ref(false);
const raiz = ref<HTMLElement | null>(null);
const disparador = ref<HTMLButtonElement | null>(null);

const activo = computed(() => !!props.valor);

function cerrar(devolverFoco = false) {
  if (!abierto.value) return;
  abierto.value = false;
  emit('aplicar');
  // El foco vuelve al disparador sólo cuando se cerró con el teclado. Al
  // cerrar con un clic afuera, robarle el foco a donde la persona acaba de
  // hacer clic es peor que no hacer nada.
  if (devolverFoco) disparador.value?.focus();
}

function alFuera(e: MouseEvent) {
  if (raiz.value && !raiz.value.contains(e.target as Node)) cerrar();
}

function alEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') cerrar(true);
}

// Los escuchas se enganchan SÓLO mientras hay un panel abierto. Con nueve
// pastillas en la barra, dejarlos siempre puestos son nueve escuchas de `click`
// sobre el documento haciendo nada en cada clic de la aplicación.
watch(abierto, (v) => {
  if (v) {
    document.addEventListener('mousedown', alFuera);
    document.addEventListener('keydown', alEscape);
  } else {
    document.removeEventListener('mousedown', alFuera);
    document.removeEventListener('keydown', alEscape);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', alFuera);
  document.removeEventListener('keydown', alEscape);
});

/** El panel se abre hacia la izquierda si no entra a la derecha. */
const haciaIzquierda = ref(false);
function alAbrir() {
  if (abierto.value) { cerrar(true); return; }
  abierto.value = true;
  const r = disparador.value?.getBoundingClientRect();
  haciaIzquierda.value = !!r && r.left + (props.ancho ?? 280) > window.innerWidth - 16;
}

function limpiar() {
  emit('limpiar');
  cerrar(true);
}

onMounted(() => { /* nada: los escuchas se enganchan al abrir */ });
</script>

<template>
  <div ref="raiz" class="filtro">
    <button
      ref="disparador"
      type="button"
      class="pastilla"
      :class="{ activo, abierto }"
      :aria-expanded="abierto"
      aria-haspopup="dialog"
      @click="alAbrir"
    >
      <span>{{ valor || etiqueta }}</span>
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div
      v-if="abierto"
      class="panel"
      :class="{ izq: haciaIzquierda }"
      :style="{ width: `${ancho ?? 280}px` }"
      role="dialog"
      :aria-label="etiqueta"
    >
      <div class="cuerpo"><slot /></div>
      <footer>
        <button type="button" class="limpiar" :disabled="!activo" @click="limpiar">
          Limpiar
        </button>
        <button type="button" class="btn sm" @click="cerrar(true)">Ver resultados</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.filtro { position: relative; }

.pastilla {
  display: inline-flex; align-items: center; gap: var(--s-sm);
  padding: 0 var(--s-md); height: 36px;
  border: 1px solid var(--line-strong); border-radius: var(--r-full);
  background: var(--surface); color: var(--ink-2);
  font-size: 13px; cursor: pointer; white-space: nowrap;
  transition: border-color var(--t-short), background var(--t-short);
}
.pastilla:hover { border-color: var(--muted); }
.pastilla svg { color: var(--muted); flex: none; }

/* Con un valor elegido la pastilla se marca. El color va en el BORDE y en el
   texto, no en un relleno sólido: cinco pastillas rellenas de acento compiten
   entre ellas y con el botón de acción de la pantalla. */
.pastilla.activo {
  border-color: var(--accent); color: var(--accent-ink);
  background: var(--accent-tint); font-weight: 500;
}
.pastilla.activo svg { color: var(--accent-ink); }
.pastilla.abierto { border-color: var(--accent); }
.pastilla.abierto svg { transform: rotate(180deg); }

.panel {
  position: absolute; z-index: 30; top: calc(100% + 6px); left: 0;
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); box-shadow: var(--sh-2);
  max-width: calc(100vw - 2rem);
}
.panel.izq { left: auto; right: 0; }

.cuerpo { padding: var(--s-md); display: grid; gap: var(--s-md); }

footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--s-sm); padding: var(--s-sm) var(--s-md);
  border-top: 1px solid var(--line);
}
.limpiar {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--muted); font-size: 13px; text-decoration: underline;
}
.limpiar:disabled { opacity: .4; cursor: default; text-decoration: none; }

@media (max-width: 40rem) {
  /* En el teléfono el panel se ancla al ancho de la pantalla y no al de la
     pastilla: uno de 280px colgando de una pastilla de 90px se sale del borde. */
  .panel { position: fixed; left: var(--s-lg); right: var(--s-lg); width: auto !important; }
}
</style>
