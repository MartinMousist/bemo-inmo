<script setup lang="ts">
// Pantalla partida. A la izquierda una promesa corta y tres capacidades REALES
// —no adjetivos—; a la derecha la tarjeta, máximo 400px.
//
// Bajo 860px el panel izquierdo se OCULTA ENTERO, no se apila arriba del
// formulario: en un teléfono, empujar el login abajo del pliegue para mostrar
// marketing es hostil.

const capacidades = [
  'Actualización automática por IPC, ICL y UVA',
  'Vencimientos de contrato avisados con 90 días',
  'Liquidación al propietario con la comisión descontada',
];
</script>

<template>
  <div class="auth">
    <aside class="promesa">
      <div class="marca">Bemo <span>INMO</span></div>
      <h1>El alquiler se administra solo.</h1>
      <ul>
        <li v-for="c in capacidades" :key="c">{{ c }}</li>
      </ul>
    </aside>

    <main class="panel">
      <div class="tarjeta">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.promesa {
  background: var(--surface-2);
  border-right: 1px solid var(--line);
  padding: var(--s-3xl);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--s-xl);
}

.marca {
  font-family: var(--font-title);
  font-size: 20px;
  color: var(--ink);
}
.marca span {
  font-family: var(--font-ui);
  font-weight: 400;
  color: var(--accent);
}

.promesa h1 {
  font-size: 34px;
  line-height: 1.2;
  max-width: 12ch;
}

.promesa ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  max-width: 42ch;
}

.promesa li {
  color: var(--muted);
  padding-left: var(--s-lg);
  position: relative;
}
.promesa li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  width: 6px;
  height: 1px;
  background: var(--accent);
}

.panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-xl);
}

.tarjeta {
  width: 100%;
  max-width: 400px;
}

@media (max-width: 860px) {
  .auth {
    grid-template-columns: 1fr;
  }
  /* Se oculta entero, no se apila. */
  .promesa {
    display: none;
  }
}
</style>
