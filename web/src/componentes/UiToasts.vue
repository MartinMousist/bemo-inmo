<script setup lang="ts">
import { useUi } from '../stores/ui';
import UiIcon from './UiIcon.vue';

const ui = useUi();
</script>

<template>
  <!--
    `aria-live="polite"` y no `assertive`: un lector de pantalla anuncia el toast
    cuando termina lo que está diciendo, en vez de interrumpir al usuario en
    medio de un formulario.
  -->
  <div class="pila" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <article v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.tono">
        <div class="texto">
          <p class="titulo">{{ t.titulo }}</p>
          <!-- El detalle va en mono: casi siempre es un monto o un código. -->
          <p v-if="t.detalle" class="detalle mono">{{ t.detalle }}</p>
        </div>
        <button type="button" aria-label="Cerrar aviso" @click="ui.cerrarToast(t.id)">
          <UiIcon nombre="cerrar" :tam="14" />
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.pila {
  position: fixed;
  bottom: var(--s-lg);
  right: var(--s-lg);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  /* El contenedor no bloquea clics; cada toast sí los recibe. */
  pointer-events: none;
  max-width: min(380px, calc(100vw - var(--s-xl)));
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: var(--s-md);
  padding: var(--s-md) var(--s-md) var(--s-md) var(--s-lg);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-left: 3px solid var(--muted-2);
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
}
.toast.ok  { border-left-color: var(--success); }
.toast.err { border-left-color: var(--danger); }
.toast.info { border-left-color: var(--accent); }

.texto { flex: 1; min-width: 0; }
.titulo { margin: 0; font-size: 13px; font-weight: 500; color: var(--ink); }
.detalle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

button {
  flex: none;
  display: inline-flex;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--muted-2);
  cursor: pointer;
  border-radius: var(--r-sm);
}
button:hover { color: var(--ink); background: var(--surface-2); }

/* Entra desde la derecha. Corto: 170ms es "rápido", y rápido es confianza. */
.toast-enter-active,
.toast-leave-active { transition: opacity var(--t-short), transform var(--t-short); }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(16px); }
.toast-move { transition: transform var(--t-short); }

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move { transition: none; }
}

@media (max-width: 560px) {
  .pila { left: var(--s-md); right: var(--s-md); bottom: var(--s-md); max-width: none; }
}
</style>
