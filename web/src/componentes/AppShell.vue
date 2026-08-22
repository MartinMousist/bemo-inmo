<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '../stores/auth';
import {
  guardarPlegado, leerPlegado,
} from '../dominio/sidebar';
import UiIcon from './UiIcon.vue';
import BemoLogo from './BemoLogo.vue';
import Campana from './Campana.vue';
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
      // La bandeja va acá y NO bajo «Alquileres»: entra un lead de venta, una
      // consulta de un propietario y un reclamo de un inquilino por el mismo
      // lugar. Colgarla de Alquileres decía que era sólo para eso —el lugar en
      // el menú comunica el alcance— y encima la dejaba en el ítem 8, donde no
      // se encuentra.
      { a: '/inbox', icono: 'chat', texto: 'Bandeja', modulo: 'bandeja' },
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
      { a: '/avisos', icono: 'campana', texto: 'Avisos', modulo: 'avisos' },
      { a: '/vencimientos', icono: 'calendario', texto: 'Vencimientos' },
      { a: '/contratos', icono: 'documento', texto: 'Contratos' },
      { a: '/liquidaciones', icono: 'moneda', texto: 'Liquidaciones', modulo: 'liquidaciones' },
      { a: '/caja', icono: 'sena', texto: 'Caja' },
      // Al lado de Caja porque es la misma pregunta desde el otro lado: Caja es
      // lo que el sistema dice que entró, Conciliación es lo que el banco dice.
      { a: '/conciliacion', icono: 'moneda', texto: 'Conciliación', modulo: 'conciliacion' },
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
      { a: '/emprendimientos', icono: 'edificio', texto: 'Emprendimientos', modulo: 'emprendimientos' },
      { a: '/reservas', icono: 'sena', texto: 'Reservas', modulo: 'reservas' },
      { a: '/ventas', icono: 'grafico', texto: 'Ventas', modulo: 'ventas' },
      { a: '/publicaciones', icono: 'mapa', texto: 'Publicaciones', modulo: 'publicaciones' },
      { a: '/envios', icono: 'documento', texto: 'Envíos a clientes' },
      { a: '/red', icono: 'mapa', texto: 'La Red', modulo: 'red' },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      { a: '/plantillas', icono: 'documento', texto: 'Pre-contratos', modulo: 'documentos' },
      { a: '/equipo', icono: 'equipo', texto: 'Equipo' },
      { a: '/comisiones', icono: 'moneda', texto: 'Comisiones', modulo: 'comisiones' },
      { a: '/importar', icono: 'mas', texto: 'Importar' },
      { a: '/movimientos', icono: 'grafico', texto: 'Movimientos' },
      { a: '/cuenta', icono: 'panel', texto: 'Tu cuenta' },
      { a: '/bot', icono: 'chat', texto: 'Respuestas automáticas', modulo: 'bot' },
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

const ruta = useRoute();

const drawerAbierto = ref(false);
const paletaAbierta = ref(false);

/**
 * Grupos plegados.
 *
 * ── Por qué hizo falta ──
 *
 * Son más de treinta entradas en seis secciones. Abiertas todas de una no
 * entran en pantalla, así que la número ocho —«Bandeja»— sólo se encuentra
 * scrolleando. Una pantalla que hay que buscar es una pantalla que no existe.
 *
 * ── Por qué NO se recuerda, aunque parezca que debería ──
 *
 * La primera versión guardaba qué grupos estaban CERRADOS. Se degradaba sola:
 * nadie cierra un grupo a mano —sólo los abre para navegar— y cada navegación
 * borraba uno del conjunto guardado. Después de recorrer las seis secciones una
 * vez, quedaba vacío PARA SIEMPRE y el menú volvía a mostrar las treinta y
 * cinco entradas. La función estaba diseñada para dejar de funcionar, y así
 * llegó a manos del usuario: se descubrió mirando el `localStorage` de una
 * cuenta de uso real, que tenía `[]`.
 *
 * Ahora no se guarda nada. Abierto está el grupo donde estás parado, más los
 * que hayas abierto en ESTA visita. Recargar vuelve a la vista limpia, que es
 * el estado que uno quiere al empezar el día — y no puede acumularse hasta
 * dejar de servir.
 */
const abiertosAMano = ref<Set<string>>(new Set());

/** El grupo al que pertenece la ruta actual. Siempre abierto. */
const grupoActivo = computed(() => {
  const p = ruta.path;
  // Se elige la coincidencia MÁS LARGA: `/propiedades/venta` tiene que ganarle
  // a `/propiedades`, o el grupo que se abre es el equivocado.
  let mejor = { titulo: '', largo: -1 };
  for (const g of gruposVisibles.value) {
    for (const i of g.items) {
      if ((p === i.a || p.startsWith(`${i.a}/`)) && i.a.length > mejor.largo) {
        mejor = { titulo: g.titulo, largo: i.a.length };
      }
    }
  }
  return mejor.titulo;
});

function abierto(titulo: string): boolean {
  // Plegada a iconos no hay títulos donde tocar: si además se plegaran los
  // grupos, la barra quedaría sin forma de navegar.
  if (plegado.value) return true;
  return titulo === grupoActivo.value || abiertosAMano.value.has(titulo);
}

function alternar(titulo: string) {
  // El grupo activo no se pliega: dejaría la pantalla en la que estás sin su
  // entrada marcada, y el menú sin decir dónde estás parado.
  if (titulo === grupoActivo.value) return;

  const s = new Set(abiertosAMano.value);
  if (s.has(titulo)) s.delete(titulo);
  else s.add(titulo);
  abiertosAMano.value = s;
}

// Al cambiar de sección, lo abierto a mano se suelta. Si no, abrir tres grupos
// buscando algo los dejaría abiertos el resto de la sesión y se llegaría al
// mismo menú de treinta y cinco entradas, sólo que más despacio.
watch(grupoActivo, () => { abiertosAMano.value = new Set(); });

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
          <!-- Botón y no <p>: se abre y se cierra, así que tiene que ser
               alcanzable por teclado y anunciarse como plegable. -->
          <button
            v-if="!plegado"
            type="button"
            class="grupo-titulo"
            :aria-expanded="abierto(g.titulo)"
            @click="alternar(g.titulo)"
          >
            <span>{{ g.titulo }}</span>
            <UiIcon nombre="chevron" :class="{ girado: abierto(g.titulo) }" />
          </button>

          <template v-if="abierto(g.titulo)">
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
          </template>
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

        <Campana />
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
