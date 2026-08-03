<script setup lang="ts">
/**
 * Marca de Bemo: la "B" blanca sobre un cuadrado naranja de esquinas suaves.
 *
 * El naranja es el color de MARCA del grupo, no el acento de la interfaz. El
 * acento sigue siendo el azul tinta de DESIGN.md: la UI maneja plata y contratos
 * y necesita leerse sobria. El naranja aparece sólo donde firma la marca — logo,
 * favicon, portada — y por eso puede ser cálido sin que el producto entero se
 * vuelva un aviso clasificado.
 */
withDefaults(
  defineProps<{
    tam?: number;
    /** Muestra "Bemo INMO" al lado del isotipo. */
    conNombre?: boolean;
    /** Para fondos oscuros: el wordmark pasa a blanco. */
    invertido?: boolean;
  }>(),
  { tam: 32, conNombre: false, invertido: false },
);
</script>

<template>
  <span class="logo" :class="{ invertido }">
    <svg
      :width="tam"
      :height="tam"
      viewBox="0 0 40 40"
      role="img"
      aria-label="Bemo"
      class="marca"
    >
      <rect width="40" height="40" rx="10" fill="var(--marca)" />
      <!-- B trazada a mano: dos panzas con el mismo eje, contragrafismos
           generosos para que se lea a 16px en la pestaña del navegador. -->
      <path
        d="M13.4 10.2h8.05c2.32 0 4.12.5 5.38 1.5 1.27 1 1.9 2.4 1.9 4.2 0 1.2-.3 2.22-.9 3.06-.6.83-1.44 1.43-2.5 1.8v.12c1.32.3 2.34.92 3.05 1.86.72.94 1.08 2.1 1.08 3.5 0 1.94-.68 3.45-2.03 4.53-1.35 1.08-3.25 1.62-5.7 1.62H13.4V10.2Zm4.36 8.94h3.3c1.06 0 1.88-.24 2.45-.72.58-.48.87-1.16.87-2.04 0-.88-.3-1.55-.87-2-.57-.46-1.4-.7-2.46-.7h-3.29v5.46Zm0 9.66h3.75c1.15 0 2.04-.26 2.66-.79.63-.53.94-1.28.94-2.25s-.31-1.72-.94-2.25c-.62-.53-1.51-.8-2.66-.8h-3.75v6.09Z"
        fill="#ffffff"
      />
    </svg>

    <span v-if="conNombre" class="nombre">
      Bemo<span class="vertical">INMO</span>
    </span>
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: var(--s-sm);
}
.marca {
  display: block;
  flex: none;
}
.nombre {
  font-family: var(--font-title);
  font-size: 18px;
  color: var(--ink);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.vertical {
  font-family: var(--font-ui);
  font-weight: 500;
  font-size: 0.78em;
  letter-spacing: 0.06em;
  color: var(--marca);
  margin-left: 0.4em;
  vertical-align: 1px;
}
.invertido .nombre {
  color: #fff;
}
</style>
