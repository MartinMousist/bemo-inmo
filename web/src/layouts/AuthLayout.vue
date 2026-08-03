<script setup lang="ts">
import BemoLogo from '../componentes/BemoLogo.vue';

/**
 * Pantalla partida. A la izquierda la promesa y tres capacidades REALES —no
 * adjetivos—; a la derecha la tarjeta, máximo 400px.
 *
 * Bajo 860px el panel izquierdo se OCULTA ENTERO, no se apila arriba del
 * formulario: en un teléfono, empujar el login abajo del pliegue para mostrar
 * marketing es hostil.
 */
const capacidades = [
  {
    titulo: 'Los aumentos se calculan solos',
    detalle: 'IPC, ICL y UVA al día, con la memoria de cálculo lista para mostrar.',
  },
  {
    titulo: 'Ningún vencimiento se pasa',
    detalle: 'Aviso a los 90, 60 y 30 días, para vos y para las partes.',
  },
  {
    titulo: 'La liquidación cuadra',
    detalle: 'Honorarios y gastos descontados, y el reparto de condominio hecho.',
  },
];
</script>

<template>
  <div class="auth">
    <aside class="promesa">
      <RouterLink to="/" class="marca">
        <BemoLogo :tam="36" con-nombre invertido />
      </RouterLink>

      <div class="centro">
        <h1>El alquiler se administra solo.</h1>
        <ul>
          <li v-for="c in capacidades" :key="c.titulo">
            <span class="marca-item" aria-hidden="true" />
            <div>
              <p class="c-titulo">{{ c.titulo }}</p>
              <p class="c-detalle">{{ c.detalle }}</p>
            </div>
          </li>
        </ul>
      </div>

      <p class="pie">Bemo INMO · parte del grupo BEMO</p>
    </aside>

    <main class="panel">
      <RouterLink to="/" class="marca-movil">
        <BemoLogo :tam="34" con-nombre />
      </RouterLink>
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
  grid-template-columns: 1.05fr 1fr;
}

.promesa {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--s-2xl);
  padding: var(--s-3xl);
  overflow: hidden;
  /* Tinta profunda: el panel de marca es el único lugar donde el producto se
     permite un fondo oscuro. Da contraste con la tarjeta blanca de al lado. */
  background: #131f30;
  color: #e8eaee;
}

/* Textura sutil, no un gradiente: dos halos muy tenues del naranja de marca y
   del acento. Sin blobs ni formas decorativas. */
.promesa::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 50% at 12% 8%, rgba(210, 112, 63, 0.16), transparent 70%),
    radial-gradient(50% 40% at 95% 95%, rgba(120, 165, 215, 0.1), transparent 70%);
  pointer-events: none;
}

.promesa > * {
  position: relative;
}

.marca,
.marca-movil {
  text-decoration: none;
  align-self: flex-start;
}

.centro {
  display: flex;
  flex-direction: column;
  gap: var(--s-2xl);
  max-width: 30rem;
}

.promesa h1 {
  font-size: clamp(30px, 3.4vw, 42px);
  line-height: 1.12;
  color: #fff;
  max-width: 13ch;
}

.promesa ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-lg);
}

.promesa li {
  display: flex;
  gap: var(--s-md);
  align-items: flex-start;
}

.marca-item {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 2px;
  background: var(--marca);
}

.c-titulo {
  margin: 0;
  font-weight: 500;
  color: #f2f0ec;
  font-size: 15px;
}
.c-detalle {
  margin: 2px 0 0;
  color: #9aa4b2;
  font-size: 13px;
  line-height: 1.5;
}

.pie {
  margin: 0;
  font-size: 12px;
  color: #6f7b8b;
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2xl);
  padding: var(--s-xl);
  background: var(--bg);
}

.tarjeta {
  width: 100%;
  max-width: 400px;
}

.marca-movil {
  display: none;
}

@media (max-width: 860px) {
  .auth {
    grid-template-columns: 1fr;
  }
  /* Se oculta entero, no se apila. */
  .promesa {
    display: none;
  }
  .marca-movil {
    display: inline-flex;
  }
}
</style>
