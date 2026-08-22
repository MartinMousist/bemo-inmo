<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/cliente';
import UiIcon from './UiIcon.vue';
import { proximidad } from '../dominio/formato';

/**
 * La campanita de avisos.
 *
 * ── Qué muestra ──
 *
 * Los avisos SIN VER, no los pendientes de resolver. Un contrato que vence en
 * dos meses es pendiente durante dos meses; si contara para el badge, el número
 * nunca bajaría a cero y la campanita se apagaría en la cabeza de la gente —
 * que es la única forma en que una notificación falla del todo.
 *
 * ── Por qué cada aviso es un enlace ──
 *
 * Un aviso que dice «Camila Rossi debe 3 cuotas» y no lleva a Camila Rossi
 * obliga a buscarla a mano, y en ese viaje se pierde la mitad de la gente. El
 * `entidadTipo` dice a qué pantalla ir.
 */

interface AvisoCorto {
  id: string; tipo: string; titulo: string; detalle: string | null;
  disparaEl: string; entidadTipo: string; entidadId: string;
}

const router = useRouter();
const abierto = ref(false);
const total = ref(0);
const items = ref<AvisoCorto[]>([]);
const caja = ref<HTMLElement>();

/**
 * Adónde lleva cada aviso.
 *
 * Los que apuntan a un período o a una garantía llevan al CONTRATO: no hay
 * pantalla de una cuota suelta, y mandar a un 404 es peor que mandar al lugar
 * donde el dato se ve en contexto.
 */
const DESTINO: Record<string, (id: string) => string> = {
  contrato: (id) => `/contratos/${id}`,
  periodo: () => '/vencimientos',
  propiedad: (id) => `/propiedades/${id}`,
  persona: (id) => `/personas/${id}/cuenta`,
  reserva: () => '/reservas',
  garantia: () => '/garantes',
  oportunidad: () => '/leads',
  conversacion: () => '/inbox',
  visita: () => '/agenda',
};

async function cargar() {
  try {
    const r = await api<{ total: number; items: AvisoCorto[] }>('/avisos/sin-ver');
    total.value = r.total;
    items.value = r.items;
  } catch {
    // Si falla, la campanita queda en cero. Es un badge: no vale romper la
    // barra de toda la aplicación por él.
  }
}

async function irA(a: AvisoCorto) {
  abierto.value = false;
  // Se marca visto ANTES de navegar y sin esperar: si la marca falla, lo peor
  // que pasa es que el aviso siga ahí — mucho mejor que demorar la navegación
  // que la persona acaba de pedir.
  void api(`/avisos/${a.id}/visto`, { method: 'POST' }).then(cargar).catch(() => undefined);
  const ir = DESTINO[a.entidadTipo];
  await router.push(ir ? ir(a.entidadId) : '/avisos');
}

const hay = computed(() => total.value > 0);
/** Más de 9 se dice «9+»: el ancho del badge no puede depender del número. */
const badge = computed(() => (total.value > 9 ? '9+' : String(total.value)));

function afuera(e: MouseEvent) {
  if (abierto.value && caja.value && !caja.value.contains(e.target as Node)) abierto.value = false;
}
function escape(e: KeyboardEvent) { if (e.key === 'Escape') abierto.value = false; }

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void cargar();
  // Cada dos minutos. Los avisos los genera un proceso, no llegan por push:
  // más seguido sería pedirle a la base cada pocos segundos algo que cambia
  // una vez por día.
  timer = setInterval(() => void cargar(), 120_000);
  document.addEventListener('click', afuera);
  document.addEventListener('keydown', escape);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('click', afuera);
  document.removeEventListener('keydown', escape);
});
</script>

<template>
  <div ref="caja" class="campana">
    <button
      class="disparador"
      type="button"
      :aria-expanded="abierto"
      aria-haspopup="menu"
      :aria-label="hay ? `${total} avisos sin ver` : 'Avisos'"
      @click="abierto = !abierto"
    >
      <UiIcon nombre="campana" :tam="18" />
      <span v-if="hay" class="badge">{{ badge }}</span>
    </button>

    <div v-if="abierto" class="panel" role="menu">
      <header>
        <strong>Avisos</strong>
        <RouterLink to="/avisos" @click="abierto = false">Ver todos</RouterLink>
      </header>

      <p v-if="!items.length" class="nada">
        Nada sin ver. Los avisos aparecen solos cuando algo vence, un aumento
        toca o alguien se atrasa.
      </p>

      <ul v-else>
        <li v-for="a in items" :key="a.id">
          <button type="button" class="aviso" @click="irA(a)">
            <span class="tit">{{ a.titulo }}</span>
            <span v-if="a.detalle" class="det">{{ a.detalle }}</span>
            <span class="cuando" :class="proximidad(a.disparaEl).tono">
              {{ proximidad(a.disparaEl).texto }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.campana { position: relative; }

.disparador {
  position: relative; display: grid; place-items: center;
  width: 34px; height: 34px; border-radius: var(--r-full);
  border: 1px solid transparent; background: transparent;
  color: var(--muted); cursor: pointer;
  transition: background var(--t-micro), border-color var(--t-micro);
}
.disparador:hover { background: var(--surface-2); border-color: var(--line); }

/* El badge NO usa el acento: el acento es el color de «acción disponible» en
   toda la app, y esto es «hay algo que mirar». Va en el ámbar de los
   semánticos, que es lo que ya significa eso. */
.badge {
  position: absolute; top: 1px; right: 0;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: var(--r-full);
  background: var(--warning); color: #fff;
  font-size: 10px; font-weight: 600; line-height: 16px;
  font-variant-numeric: tabular-nums;
}

.panel {
  position: absolute; z-index: 40; top: calc(100% + 8px); right: 0;
  width: 22rem; max-width: calc(100vw - 2rem);
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); box-shadow: var(--sh-2);
  overflow: hidden;
}
.panel header {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line);
}
.panel header a { font-size: 12px; color: var(--accent-ink); }
.nada { margin: 0; padding: var(--s-lg); font-size: 13px; color: var(--muted); line-height: 1.5; }

.panel ul { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow-y: auto; }
.panel li + li { border-top: 1px solid var(--line); }

.aviso {
  display: grid; gap: 2px; width: 100%; text-align: left;
  padding: var(--s-md) var(--s-lg);
  background: none; border: 0; cursor: pointer; font: inherit;
}
.aviso:hover { background: var(--surface-2); }
.tit { font-size: 13px; font-weight: 500; color: var(--ink); }
.det { font-size: 12px; color: var(--muted); line-height: 1.4; }
.cuando { font-size: 11px; color: var(--muted-2); }
.cuando.err, .cuando.vencido { color: var(--danger); }
.cuando.warn { color: var(--warning-ink); }
</style>
