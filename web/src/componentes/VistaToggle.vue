<script setup lang="ts">
import type { Vista } from '../dominio/vista';

/**
 * El interruptor tabla ⇄ tarjetas.
 *
 * Va en el `#acciones` del `PageHeader`, al lado de «Exportar» y «Nueva
 * propiedad»: es una decisión sobre la pantalla, no sobre los datos, y por eso
 * no vive en la barra de filtros. La consecuencia práctica es que el botón
 * «Limpiar» de los filtros no lo toca.
 *
 * **Sin íconos.** Dos cuadraditos y unas rayas es el patrón de la industria y
 * es indistinguible sin aprenderlo; «Tabla» y «Tarjetas» en palabras se
 * entienden la primera vez y no necesitan `title`. Dos palabras cortas ocupan
 * lo mismo que dos íconos con su padding.
 *
 * `role="group"` con su `aria-label` y `aria-pressed` en cada botón: es un par
 * de interruptores, no una navegación. `.segmented` de la capa familia ya
 * estiliza `[aria-pressed='true']`, así que no hace falta la clase `.activo`
 * —el estado accesible y el visual salen del mismo atributo, que es lo que
 * impide que se desincronicen.
 */
const props = defineProps<{ modelo: Vista }>();
const emit = defineEmits<{ (e: 'update:modelo', v: Vista): void }>();

const OPCIONES: Array<{ valor: Vista; texto: string }> = [
  { valor: 'tabla', texto: 'Tabla' },
  { valor: 'tarjetas', texto: 'Tarjetas' },
];
</script>

<template>
  <div class="segmented" role="group" aria-label="Cómo se ve el listado">
    <button
      v-for="o in OPCIONES"
      :key="o.valor"
      type="button"
      :aria-pressed="props.modelo === o.valor"
      @click="emit('update:modelo', o.valor)"
    >
      {{ o.texto }}
    </button>
  </div>
</template>
