<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useUi } from '../stores/ui';

/**
 * Confirmación para lo que no tiene vuelta atrás.
 *
 * Se usa desde el store como promesa:
 *
 *   if (!(await ui.confirmar({ titulo: '…', peligroso: true }))) return;
 *
 * Reglas que no son cosméticas:
 *  - El botón dice QUÉ hace ("Borrar la propiedad"), no "Aceptar". Un "Aceptar"
 *    obliga a leer el título para saber qué se está por hacer.
 *  - El foco arranca en **Cancelar**. Un Enter reflejo no puede borrar nada.
 *  - Con `escribir`, hay que tipear el nombre exacto. Es para lo que arrastra
 *    otras cosas — una propiedad se lleva sus operaciones, sus fotos y su
 *    historial.
 */
const ui = useUi();
const tipeado = ref('');
const botonCancelar = ref<HTMLButtonElement | null>(null);

watch(
  () => ui.confirmacion,
  async (c) => {
    tipeado.value = '';
    if (!c) return;
    await nextTick();
    botonCancelar.value?.focus();
  },
);

function puedeConfirmar(): boolean {
  const exigido = ui.confirmacion?.escribir;
  return !exigido || tipeado.value.trim() === exigido;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.confirmacion"
      class="velo"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-titulo"
      @keydown.esc="ui.responder(false)"
    >
      <!-- Clic en el velo = cancelar. Nunca confirmar: lo accidental tiene que
           caer siempre del lado seguro. -->
      <div class="fondo" @click="ui.responder(false)" />

      <div class="caja card">
        <h2 id="confirm-titulo">{{ ui.confirmacion.titulo }}</h2>
        <p v-if="ui.confirmacion.detalle" class="detalle">{{ ui.confirmacion.detalle }}</p>

        <label v-if="ui.confirmacion.escribir" class="campo">
          <span>Escribí <b class="mono">{{ ui.confirmacion.escribir }}</b> para confirmar</span>
          <input
            v-model="tipeado"
            type="text"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter.prevent="puedeConfirmar() && ui.responder(true)"
          />
        </label>

        <div class="acciones">
          <button ref="botonCancelar" class="btn secondary" type="button" @click="ui.responder(false)">
            {{ ui.confirmacion.cancelar ?? 'Cancelar' }}
          </button>
          <button
            class="btn"
            :class="{ peligroso: ui.confirmacion.peligroso }"
            type="button"
            :disabled="!puedeConfirmar()"
            @click="ui.responder(true)"
          >
            {{ ui.confirmacion.confirmar ?? 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.velo {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: var(--s-lg);
}
.fondo { position: absolute; inset: 0; background: rgba(26, 24, 21, .45); }

.caja {
  position: relative;
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}

h2 {
  margin: 0;
  font-family: var(--font-title);
  font-size: 19px;
  font-weight: 500;
  color: var(--ink);
}
.detalle { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }

.campo { display: flex; flex-direction: column; gap: var(--s-xs); font-size: 13px; color: var(--muted); }
.campo b { color: var(--ink); }
.campo input {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.campo input:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--accent); }

.acciones { display: flex; justify-content: flex-end; gap: var(--s-sm); }
.btn.peligroso { background: var(--danger); border-color: var(--danger); color: #fff; }
.btn.peligroso:hover { filter: brightness(.92); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
