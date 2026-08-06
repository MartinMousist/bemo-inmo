<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  etiqueta: string;
  autocomplete?: string;
  ayuda?: string;
}>();

const valor = defineModel<string>({ required: true });
const visible = ref(false);
</script>

<template>
  <label class="campo">
    <span>{{ etiqueta }}</span>
    <div class="caja">
      <input
        v-model="valor"
        :type="visible ? 'text' : 'password'"
        :autocomplete="autocomplete"
        required
      />
      <button
        type="button"
        class="ojo"
        :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :aria-pressed="visible"
        @click="visible = !visible"
      >
        <!-- SVG inline: sin dependencias de iconos -->
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path
            v-if="!visible"
            d="M1 10s3.5-5.5 9-5.5S19 10 19 10s-3.5 5.5-9 5.5S1 10 1 10Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path
            v-else
            d="M3 3l14 14M1 10s3.5-5.5 9-5.5c1.6 0 3 .5 4.2 1.1M19 10s-1.3 2-3.5 3.6c-1.5 1.1-3.4 1.9-5.5 1.9-.8 0-1.5-.1-2.2-.3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <circle
            v-if="!visible"
            cx="10"
            cy="10"
            r="2.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
        </svg>
      </button>
    </div>
    <small v-if="ayuda">{{ ayuda }}</small>
  </label>
</template>

<style scoped>

.caja {
  display: flex;
  align-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
}
.caja:focus-within {
  box-shadow: var(--ring);
}

.caja input {
  font: inherit;
  flex: 1;
  min-width: 0;
  padding: var(--s-sm) var(--s-md);
  border: none;
  background: transparent;
  color: var(--ink);
}
.caja input:focus {
  outline: none;
  box-shadow: none;
}

.ojo {
  display: flex;
  align-items: center;
  padding: var(--s-sm) var(--s-md);
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ojo:hover {
  color: var(--ink-2);
}

small {
  color: var(--muted-2);
  font-size: 12px;
}
</style>
