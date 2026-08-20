<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAuth } from '../stores/auth';
import { guardarPlegado, leerPlegado } from '../dominio/sidebar';
import UiIcon from './UiIcon.vue';
import BemoLogo from './BemoLogo.vue';
import MenuUsuario from './MenuUsuario.vue';
import CommandPalette from './CommandPalette.vue';

const auth = useAuth();

/** Sidebar agrupado por función, no una lista plana de 12 ítems. */
const grupos = [
  {
    // El tablero va acá y no en Administración: es el MISMO usuario en el mismo
    // momento del día. `Inicio` contesta "qué tengo que hacer hoy" y `Tablero`
    // "cómo viene el mes"; separarlos por grupo haría buscar el segundo.
    titulo: 'Hoy',
    items: [
      { a: '/inicio', icono: 'monitor', texto: 'Inicio' },
      { a: '/tablero', icono: 'grafico', texto: 'Tablero' },
    ],
  },
  {
    // Cartera queda con tres ítems y deja de mezclar dos tipos de entidad:
    // «Cartera» es lo que se administra, «Personas» es con quién.
    titulo: 'Cartera',
    items: [
      { a: '/propiedades', icono: 'edificio', texto: 'Todas' },
      { a: '/propiedades/venta', icono: 'moneda', texto: 'En venta' },
      { a: '/propiedades/alquiler', icono: 'documento', texto: 'En alquiler' },
    ],
  },
  {
    // `Personas` sale de Cartera y se vuelve grupo propio con EXACTAMENTE el
    // patrón que Cartera ya usa —Todas / En venta / En alquiler—, así que no
    // hay forma nueva que aprender.
    //
    // Garantes tiene tensión: también es papelería de alquiler, o sea grupo
    // Alquileres. Va acá porque es una lista de personas y porque la pregunta
    // que contesta —«¿a quién le falta el legajo?»— es de personas.
    //
    // Leads NO se mueve de Comercial: ya está ahí, es donde se lo busca, y
    // mover un ítem existente rompe memoria muscular a cambio de nada.
    titulo: 'Personas',
    items: [
      { a: '/personas', icono: 'personas', texto: 'Todas' },
      { a: '/propietarios', icono: 'edificio', texto: 'Propietarios' },
      { a: '/inquilinos', icono: 'documento', texto: 'Inquilinos' },
      { a: '/garantes', icono: 'equipo', texto: 'Garantes' },
    ],
  },
  {
    titulo: 'Alquileres',
    items: [
      { a: '/avisos', icono: 'campana', texto: 'Avisos' },
      { a: '/inbox', icono: 'chat', texto: 'Bandeja' },
      { a: '/vencimientos', icono: 'calendario', texto: 'Vencimientos' },
      { a: '/contratos', icono: 'documento', texto: 'Contratos' },
      { a: '/liquidaciones', icono: 'moneda', texto: 'Liquidaciones' },
      { a: '/caja', icono: 'sena', texto: 'Caja' },
      // Al lado de Caja porque es la misma pregunta desde el otro lado: Caja es
      // lo que el sistema dice que entró, Conciliación es lo que el banco dice.
      { a: '/conciliacion', icono: 'moneda', texto: 'Conciliación' },
      // Reclamos y gastos van en Alquileres y no en un grupo propio: son el día
      // a día de administrar, y quien los usa ya está mirando esta columna.
      { a: '/reclamos', icono: 'campana', texto: 'Reclamos' },
      { a: '/gastos', icono: 'moneda', texto: 'Gastos' },
      { a: '/indices', icono: 'grafico', texto: 'Índices' },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { a: '/leads', icono: 'embudo', texto: 'Leads', modulo: 'leads' },
      // Con el módulo Leads: una visita cuelga de una oportunidad, así que en
      // una cuenta sin embudo la agenda estaría siempre vacía.
      { a: '/agenda', icono: 'calendario', texto: 'Agenda', modulo: 'leads' },
      { a: '/reservas', icono: 'sena', texto: 'Reservas', modulo: 'reservas' },
      { a: '/ventas', icono: 'grafico', texto: 'Ventas', modulo: 'ventas' },
      { a: '/publicaciones', icono: 'mapa', texto: 'Publicaciones', modulo: 'publicaciones' },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      { a: '/plantillas', icono: 'documento', texto: 'Pre-contratos' },
      { a: '/equipo', icono: 'equipo', texto: 'Equipo' },
      { a: '/comisiones', icono: 'moneda', texto: 'Comisiones', modulo: 'comisiones' },
      { a: '/importar', icono: 'mas', texto: 'Importar' },
      { a: '/movimientos', icono: 'grafico', texto: 'Movimientos' },
      { a: '/cuenta', icono: 'panel', texto: 'Tu cuenta' },
      { a: '/seguridad', icono: 'candado', texto: 'Seguridad' },
      { a: '/plan', icono: 'documento', texto: 'Tu plan' },
    ],
  },
];

/**
 * El menú que corresponde a esta cuenta.
 *
 * Una cuenta de gestión de alquileres no vende ni reparte comisiones: mostrarle
 * Ventas, Comisiones, Leads, Publicaciones y Reservas son cinco entradas que no
 * va a abrir nunca, y su sola presencia dice «esto no es para vos».
 *
 * El grupo se descarta cuando se queda sin ítems: un título «Comercial» sobre
 * la nada es peor que no tener la sección.
 */
const gruposVisibles = computed(() =>
  grupos
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.modulo || auth.tieneModulo(i.modulo)) }))
    .filter((g) => g.items.length > 0),
);

const drawerAbierto = ref(false);
const paletaAbierta = ref(false);

/**
 * Barra lateral plegada.
 *
 * La preferencia se guarda: quien plegó la barra para ver la cartera completa en
 * un portátil de 13" no quiere volver a plegarla en cada carga.
 *
 * En pantalla angosta no aplica —ahí la barra ya es un cajón— y eso lo cancela
 * `familia.css` por media query, no acá: así la preferencia sobrevive a que
 * alguien achique y vuelva a agrandar la ventana.
 */
const plegado = ref(leerPlegado());
watch(plegado, guardarPlegado);

// ⌘K / Ctrl+K abre la paleta desde cualquier pantalla.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletaAbierta.value = true;
  }
});
</script>

<template>
  <div class="shell">
    <!-- Primer elemento enfocable del documento, a propósito: es lo primero que
         encuentra quien navega por teclado. Sin esto recorría los veinte ítems
         de la barra antes de llegar a la tabla, en cada carga. -->
    <a class="saltar" href="#contenido">Saltar al contenido</a>

    <aside id="barra-lateral" class="sidebar" :class="{ abierto: drawerAbierto, collapsed: plegado }">
      <RouterLink to="/inicio" class="marca" :title="plegado ? 'Bemo INMO' : undefined">
        <!-- Plegada, el wordmark no se oculta por CSS: se deja de renderizar.
             Ocultarlo con `display: none` lo dejaba en el árbol de
             accesibilidad, anunciando un nombre que no está en pantalla. -->
        <BemoLogo :tam="30" :con-nombre="!plegado" />
      </RouterLink>

      <nav>
        <div v-for="g in gruposVisibles" :key="g.titulo" class="grupo">
          <p class="grupo-titulo">{{ g.titulo }}</p>
          <RouterLink
            v-for="i in g.items"
            :key="i.a"
            :to="i.a"
            class="nav-item"
            :title="plegado ? i.texto : undefined"
            :aria-label="plegado ? i.texto : undefined"
            @click="drawerAbierto = false"
          >
            <UiIcon :nombre="i.icono" />
            <span class="nav-label">{{ i.texto }}</span>
          </RouterLink>
        </div>
      </nav>

      <button
        class="atajo"
        type="button"
        :title="plegado ? 'Buscar (⌘K)' : undefined"
        :aria-label="plegado ? 'Buscar' : undefined"
        @click="paletaAbierta = true"
      >
        <UiIcon nombre="buscar" />
        <span>Buscar</span>
        <kbd>⌘K</kbd>
      </button>
    </aside>

    <div v-if="drawerAbierto" class="velo-drawer" @click="drawerAbierto = false" />

    <div class="principal">
      <header class="topbar">
        <button class="hamburguesa" type="button" aria-label="Menú" @click="drawerAbierto = true">
          <UiIcon nombre="menu" />
        </button>

        <!-- Va en la topbar y no dentro de la barra: plegada, un control que
             viviera adentro quedaría a 64px de ancho y sin etiqueta. Acá la
             posición no se mueve, esté plegada o no. -->
        <button
          class="icon-btn plegar"
          type="button"
          :aria-expanded="!plegado"
          aria-controls="barra-lateral"
          :aria-label="plegado ? 'Desplegar la barra lateral' : 'Plegar la barra lateral'"
          :title="plegado ? 'Desplegar la barra lateral' : 'Plegar la barra lateral'"
          @click="plegado = !plegado"
        >
          <UiIcon nombre="panel" />
        </button>

        <span class="tenant">{{ auth.tenant?.nombre }}</span>
        <span class="separador" />

        <MenuUsuario />
      </header>

      <main id="contenido" class="contenido" tabindex="-1">
        <slot />
      </main>
    </div>

    <CommandPalette v-model:abierta="paletaAbierta" />
  </div>
</template>

<style scoped>
/* La forma del shell —grilla, sidebar, topbar pegada, contenido y el
   comportamiento de cajón en pantalla angosta— vive en `styles/familia.css`.
   Acá queda sólo lo que es de ESTE componente y de ningún otro. */

/* `velo-drawer` y no `velo`: el CSS scoped del padre alcanza al elemento RAÍZ
   del componente hijo, así que un `.velo { display: none }` acá le pegaba
   también a la raíz de CommandPalette y la paleta nunca se veía. */
.hamburguesa,
.velo-drawer {
  display: none;
}

@media (max-width: 900px) {
  /* En angosto manda la hamburguesa: dos controles para la misma barra, uno al
     lado del otro, es una pregunta que el usuario no tiene por qué contestar. */
  .plegar { display: none; }
  .velo-drawer {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(26, 24, 21, 0.35);
  }
  .hamburguesa {
    display: inline-flex;
    padding: 6px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
  }
}
</style>
