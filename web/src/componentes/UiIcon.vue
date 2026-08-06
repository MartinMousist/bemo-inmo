<script setup lang="ts">
/**
 * Íconos SVG inline. Sin dependencias: una librería de íconos son cientos de KB
 * para usar doce, y ata el proyecto a las decisiones estéticas de otro.
 *
 * Trazo de 1.5, esquinas suaves, sin relleno. Nada de íconos dentro de círculos
 * de colores (regla anti-slop de DESIGN.md).
 */
const props = defineProps<{ nombre: string; tam?: number }>();

const PATHS: Record<string, string> = {
  edificio: 'M3 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M12 21V10a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v11M2 21h20M6 8h3M6 12h3M6 16h3M15 13h2M15 17h2',
  personas: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  embudo: 'M3 4h18l-7 8v7l-4 2v-9L3 4Z',
  sena: 'M3 7h18v12H3zM3 7l2-3h14l2 3M8 12h8',
  equipo: 'M17 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6',
  buscar: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sol: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  luna: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  mas: 'M12 5v14M5 12h14',
  mapa: 'M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3ZM9 3v15M15 6v15',
  cerrar: 'M18 6 6 18M6 6l12 12',
  volver: 'M19 12H5M12 19l-7-7 7-7',
  calendario: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
  moneda: 'M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.3 5 1.4 5 3.4-2.2 3.3-5 3.3-5-1.4-5-3.3',
  documento: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  monitor: 'M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8 20h8M12 16v4',
  chevron: 'M6 9l6 6 6-6',
  tilde: 'M20 6 9 17l-5-5',
  // Para "En desarrollo": lo que todavía no está, se marca con tiempo, no con
  // una cruz. Una cruz dice "no lo vas a tener".
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  // Plegar/desplegar la barra lateral: el marco de la pantalla con su columna.
  // Dice qué hace por su forma, que es más que lo que dice un chevron suelto.
  panel: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1M9.5 4v16',
  grafico: 'M3 3v18h18M7 15l3-4 3 3 5-7',
  campana: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
};
</script>

<template>
  <svg
    :width="props.tam ?? 18"
    :height="props.tam ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[props.nombre] ?? ''" />
  </svg>
</template>
