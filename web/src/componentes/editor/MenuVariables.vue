<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
/**
 * El menú de variables y bloques.
 *
 * Es un `listbox` de verdad, con `aria-activedescendant`: flechas para moverse,
 * Enter para insertar, Escape para cerrar, y el foco se queda en el campo de
 * filtro todo el tiempo. Un menú que sólo se puede usar con el mouse no cumple
 * la regla de accesibilidad del repo, y acá la regla no es formal: quien redacta
 * un contrato de tres carillas trabaja con las manos en el teclado.
 *
 * **El catálogo viene del backend** (`GET /plantillas/variables`). Escribirlo en
 * el front sería tener una segunda lista que se desincroniza del `SELECT` que
 * arma el contexto, y entonces el menú ofrece variables que no existen: la
 * persona inserta «Piso», el documento sale con ««propiedad.piso»» entre
 * comillas angulares y nadie entiende por qué.
 */

import type { BloqueDelCatalogo, VariableDelCatalogo } from './catalogo';

const props = defineProps<{
  variables: VariableDelCatalogo[];
  bloques: BloqueDelCatalogo[];
  /** Las variables que sólo existen adentro del bloque donde está el cursor. */
  contextuales?: VariableDelCatalogo[];
  abierto: boolean;
}>();

const emit = defineEmits<{
  variable: [v: VariableDelCatalogo, formato: string | null];
  bloque: [b: BloqueDelCatalogo];
  cerrar: [];
}>();

const filtro = ref('');
const activo = ref(0);
const campo = ref<HTMLInputElement | null>(null);
const lista = ref<HTMLElement | null>(null);

/** Una fila del listbox: variable o bloque, ya aplanadas para navegar. */
interface Fila {
  clave: string;
  tipo: 'variable' | 'bloque';
  grupo: string;
  etiqueta: string;
  detalle: string;
  variable?: VariableDelCatalogo;
  bloque?: BloqueDelCatalogo;
}

const filas = computed<Fila[]>(() => {
  const q = filtro.value.trim().toLowerCase();
  const pasa = (...campos: string[]) =>
    !q || campos.some((c) => c.toLowerCase().includes(q));

  const out: Fila[] = [];

  // Las del bloque donde está parado el cursor van PRIMERO: adentro de un
  // `{% para g en garantes %}`, lo que se quiere escribir es `{{ g.nombre }}`.
  for (const v of props.contextuales ?? []) {
    if (!pasa(v.etiqueta, v.ruta, v.grupo)) continue;
    out.push({
      clave: `ctx-${v.ruta}`, tipo: 'variable', grupo: 'Del bloque donde estás',
      etiqueta: v.etiqueta, detalle: v.ejemplo, variable: v,
    });
  }
  for (const v of props.variables) {
    if (!pasa(v.etiqueta, v.ruta, v.grupo)) continue;
    out.push({
      clave: `v-${v.ruta}`, tipo: 'variable', grupo: v.grupo,
      etiqueta: v.etiqueta, detalle: v.ejemplo, variable: v,
    });
  }
  for (const b of props.bloques) {
    if (!pasa(b.etiqueta, b.expr, 'condición lista bloque')) continue;
    out.push({
      clave: `b-${b.clase}-${b.expr}`, tipo: 'bloque', grupo: 'Condiciones y listas',
      etiqueta: b.etiqueta, detalle: b.ayuda, bloque: b,
    });
  }
  return out;
});

/** Agrupadas para mostrar; la navegación va sobre `filas`, que es plana. */
const grupos = computed(() => {
  const m = new Map<string, Fila[]>();
  for (const f of filas.value) {
    if (!m.has(f.grupo)) m.set(f.grupo, []);
    m.get(f.grupo)!.push(f);
  }
  return [...m.entries()].map(([grupo, items]) => ({ grupo, items }));
});

const filaActiva = computed(() => filas.value[activo.value]);
const idActivo = computed(() => (filaActiva.value ? `var-op-${filaActiva.value.clave}` : undefined));

/** Los formatos que ofrece la variable resaltada. Se eligen con Alt+1..6. */
const formatosDeLaActiva = computed(() => filaActiva.value?.variable?.formatos ?? []);

watch(filtro, () => { activo.value = 0; });
watch(
  () => props.abierto,
  async (v) => {
    if (!v) return;
    filtro.value = '';
    activo.value = 0;
    await nextTick();
    campo.value?.focus();
  },
);

function mover(delta: number) {
  if (!filas.value.length) return;
  activo.value = (activo.value + delta + filas.value.length) % filas.value.length;
  void nextTick(() => {
    lista.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  });
}

function elegir(f: Fila | undefined, formato: string | null = null) {
  if (!f) return;
  if (f.tipo === 'bloque' && f.bloque) emit('bloque', f.bloque);
  else if (f.variable) emit('variable', f.variable, formato);
}

function alTeclado(ev: KeyboardEvent) {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); mover(1); return; }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); mover(-1); return; }
  if (ev.key === 'Home') { ev.preventDefault(); activo.value = 0; return; }
  if (ev.key === 'End') { ev.preventDefault(); activo.value = filas.value.length - 1; return; }
  if (ev.key === 'Enter') { ev.preventDefault(); elegir(filaActiva.value); return; }
  if (ev.key === 'Escape') { ev.preventDefault(); emit('cerrar'); return; }
  // Alt+1..6: el formato de la variable resaltada, sin soltar el teclado.
  if (ev.altKey && /^[1-9]$/.test(ev.key)) {
    const f = formatosDeLaActiva.value[Number(ev.key) - 1];
    if (f) { ev.preventDefault(); elegir(filaActiva.value, f); }
  }
}
</script>

<template>
  <div v-if="abierto" class="menu" role="dialog" aria-label="Insertar variable o bloque">
    <label class="campo suave">
      <span class="visualmente-oculto">Buscar variable</span>
      <input
        ref="campo"
        v-model="filtro"
        type="text"
        placeholder="Buscar: precio, inquilino, garante…"
        role="combobox"
        aria-expanded="true"
        aria-controls="lista-variables"
        aria-autocomplete="list"
        :aria-activedescendant="idActivo"
        @keydown="alTeclado"
      />
    </label>

    <ul id="lista-variables" ref="lista" class="opciones" role="listbox" tabindex="-1">
      <template v-for="g in grupos" :key="g.grupo">
        <li class="grupo" role="presentation">{{ g.grupo }}</li>
        <li
          v-for="f in g.items"
          :id="`var-op-${f.clave}`"
          :key="f.clave"
          class="op"
          :class="{ activa: filaActiva?.clave === f.clave, esBloque: f.tipo === 'bloque' }"
          role="option"
          :aria-selected="filaActiva?.clave === f.clave"
          @mousedown.prevent="elegir(f)"
          @mousemove="activo = filas.findIndex((x) => x.clave === f.clave)"
        >
          <span class="et">{{ f.etiqueta }}</span>
          <span class="det">{{ f.detalle }}</span>
          <!--
            `tabindex="-1"` NO es un descuido: es lo que exige el patrón.

            Un `role="option"` no puede contener paradas de Tab —el foco vive en
            el campo de filtro y la selección viaja por `aria-activedescendant`—,
            y sin esto estos botones sí la eran: se tabulaba desde el buscador y
            el foco caía adentro de la lista, sobre un botón que **no hace nada**
            con el teclado (sólo tiene `mousedown`, y Enter dispara `click`).
            Encima, parado ahí, Escape tampoco cerraba: el handler está en el
            input. O sea tres teclas muertas en fila. Se probó en el navegador.

            El camino de teclado para el formato existe y es Alt+1…6, que está
            escrito en el pie del menú. Estos botones quedan como atajo de mouse.
          -->
          <span v-if="f.variable?.formatos.length" class="fmt">
            <button
              v-for="(fm, i) in f.variable.formatos"
              :key="fm"
              type="button"
              class="btn enlace sm"
              tabindex="-1"
              :title="`Insertar con formato ${fm} (Alt+${i + 1})`"
              @mousedown.prevent.stop="elegir(f, fm)"
              @keydown.stop
            >{{ fm }}</button>
          </span>
        </li>
      </template>
      <li v-if="!filas.length" class="vacio" role="presentation">
        Nada con «{{ filtro }}». Las variables salen de los datos del contrato:
        si el campo no está en la lista, el sistema todavía no lo tiene.
      </li>
    </ul>

    <p class="pie">
      ↑↓ para moverse · Enter inserta · Alt+1…6 inserta con formato · Esc cierra
    </p>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  width: min(460px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-sm);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}

.opciones {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
}

.grupo {
  padding: var(--s-xs) var(--s-sm) 2px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .06em;
  /* `--muted` y no `--muted-2`: el gris apagado daba 3,01 sobre `--surface-2`,
     por debajo de AA, en los dos temas. Está en la tabla de trampas.
     Medido acá: `--muted` sobre `--surface` da 5,87 en claro y 6,42 en oscuro. */
  color: var(--muted);
}

.op {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--s-sm);
  padding: 5px var(--s-sm);
  border-radius: var(--r-sm);
  cursor: pointer;
}
.op .et { font-size: 13px; color: var(--ink); }
.op .det {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.45;
}
.op.activa { background: var(--surface-2); outline: 2px solid var(--accent); outline-offset: -2px; }
.op.esBloque .et::before { content: '⌗ '; color: var(--accent); }
.fmt { display: flex; gap: 2px; align-items: center; }
.fmt .btn { font-size: 10.5px; }

.vacio { padding: var(--s-md); font-size: 12px; color: var(--muted); line-height: 1.6; }
.pie { margin: 0; padding: 2px var(--s-sm) 0; font-size: 10.5px; color: var(--muted); }

.visualmente-oculto {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
