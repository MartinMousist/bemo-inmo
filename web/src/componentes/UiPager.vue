<script setup lang="ts">
/**
 * Paginador. Uno solo para todas las listas.
 *
 * Muestra el rango real —"26–50 de 312"— y no sólo "página 2 de 13". En un
 * producto que maneja plata, saber cuántos registros hay y cuáles se están
 * mirando es parte del dato, no decoración: es la diferencia entre "vi todas las
 * liquidaciones del mes" y "vi las primeras 25".
 */
const props = defineProps<{
  pagina: number;
  paginas: number;
  total: number;
  porPagina: number;
  /** Cómo se llama lo que se está listando, en plural. */
  sustantivo?: string;
}>();

const emit = defineEmits<{ (e: 'update:pagina', v: number): void }>();

const desde = () => (props.total === 0 ? 0 : (props.pagina - 1) * props.porPagina + 1);
const hasta = () => Math.min(props.pagina * props.porPagina, props.total);
</script>

<template>
  <!--
    Se muestra aunque haya una sola página: el total es información útil por sí
    misma. Los botones se deshabilitan, no desaparecen — un control que aparece y
    desaparece hace saltar el layout.
  -->
  <div v-if="total > 0" class="pager">
    <span class="rango mono">
      {{ desde() }}–{{ hasta() }} de {{ total }}<span v-if="sustantivo"> {{ sustantivo }}</span>
    </span>

    <div v-if="paginas > 1" class="controles">
      <button
        class="btn secondary sm"
        type="button"
        :disabled="pagina === 1"
        @click="emit('update:pagina', pagina - 1)"
      >
        Anterior
      </button>
      <span class="mono cuenta">{{ pagina }} / {{ paginas }}</span>
      <button
        class="btn secondary sm"
        type="button"
        :disabled="pagina >= paginas"
        @click="emit('update:pagina', pagina + 1)"
      >
        Siguiente
      </button>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-md);
  flex-wrap: wrap;
}
.rango {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.controles {
  display: flex;
  align-items: center;
  gap: var(--s-md);
}
.cuenta {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: center;
}
</style>
