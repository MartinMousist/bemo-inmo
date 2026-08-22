<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { etiquetaRol } from '../dominio/roles';
import { aplicar, escucharSistema, leerPreferencia, type Preferencia } from '../dominio/tema';
import UiIcon from './UiIcon.vue';

const auth = useAuth();
const router = useRouter();

const abierto = ref(false);
const caja = ref<HTMLElement>();
const preferencia = ref<Preferencia>(leerPreferencia());

const OPCIONES: Array<{ v: Preferencia; texto: string; icono: string }> = [
  { v: 'claro', texto: 'Claro', icono: 'sol' },
  { v: 'oscuro', texto: 'Oscuro', icono: 'luna' },
  { v: 'sistema', texto: 'El del sistema', icono: 'monitor' },
];

const iniciales = computed(() =>
  (auth.usuario?.nombre ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join(''),
);

/**
 * Qué dice la línea del plan, según el estado REAL de la suscripción.
 *
 * Los cuatro estados existen en la base (`prueba`, `activa`, `morosa`,
 * `cancelada`) y cada uno dice algo distinto. El único que lleva números es la
 * prueba, porque es el único con una fecha de verdad.
 */
const textoPlan = computed(() => {
  const p = auth.plan;
  if (!p) return '';
  if (p.estado === 'prueba') {
    const d = p.diasDePrueba;
    if (d === null) return 'En prueba';
    if (d < 0) return 'La prueba terminó';
    if (d === 0) return 'La prueba termina hoy';
    return `Prueba · ${d} ${d === 1 ? 'día' : 'días'}`;
  }
  if (p.estado === 'morosa') return 'Con un pago pendiente';
  if (p.estado === 'cancelada') return 'Cancelado';
  // `activa`: no hay fecha de renovación en la base, así que no se dice
  // ninguna. Ver el comentario del bloque en la plantilla.
  return 'Activo';
});

const tonoPlan = computed(() => {
  const p = auth.plan;
  if (!p) return '';
  if (p.estado === 'morosa' || p.estado === 'cancelada') return 'alerta';
  // Los últimos siete días de prueba se marcan: es cuando hay que hacer algo.
  if (p.estado === 'prueba' && (p.diasDePrueba ?? 99) <= 7) return 'aviso';
  return '';
});

function elegirTema(p: Preferencia) {
  preferencia.value = p;
  aplicar(p);
}

function afuera(e: MouseEvent) {
  if (abierto.value && caja.value && !caja.value.contains(e.target as Node)) {
    abierto.value = false;
  }
}
function escape(e: KeyboardEvent) {
  if (e.key === 'Escape') abierto.value = false;
}

let dejarDeEscuchar: (() => void) | undefined;

onMounted(() => {
  document.addEventListener('click', afuera);
  document.addEventListener('keydown', escape);
  dejarDeEscuchar = escucharSistema(() => undefined);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', afuera);
  document.removeEventListener('keydown', escape);
  dejarDeEscuchar?.();
});

async function salir() {
  abierto.value = false;
  await auth.logout();
  router.replace('/login');
}
</script>

<template>
  <div ref="caja" class="menu">
    <button
      class="disparador"
      type="button"
      :aria-expanded="abierto"
      aria-haspopup="menu"
      @click="abierto = !abierto"
    >
      <span class="avatar">{{ iniciales }}</span>
      <!--
        El NOMBRE primero y el rol a la derecha.

        Antes el disparador mostraba sólo el rol —«Titular»— y el nombre estaba
        escondido adentro del panel. En una cuenta compartida, saber con QUÉ
        usuario estás es la primera pregunta, y era la única que la barra no
        contestaba sin abrir nada.
      -->
      <span class="quien">
        <span class="nom">{{ auth.usuario?.nombre }}</span>
        <span class="rol">{{ etiquetaRol(auth.rol, auth.tipoCuenta) }}</span>
      </span>
      <UiIcon nombre="chevron" :tam="14" />
    </button>

    <div v-if="abierto" class="panel" role="menu">
      <!-- La cabecera es un ENLACE: tocar tu propio nombre y que no pase nada
           es lo que hace que la gente busque «mi perfil» en el menú. -->
      <RouterLink class="cabecera" to="/cuenta" role="menuitem" @click="abierto = false">
        <span class="nombre">{{ auth.usuario?.nombre }}</span>
        <span class="tenant">{{ auth.tenant?.nombre }}</span>
        <span class="ir">Ver mi cuenta</span>
      </RouterLink>

      <!--
        El plan.

        `diasDePrueba` es la ÚNICA cuenta regresiva real: sale de `prueba_hasta`.
        Un plan pago NO tiene fecha de vencimiento en la base porque no hay cobro
        integrado, así que cuando la suscripción está activa no se muestra
        ninguna — inventar «te vence en 23 días» sería el peor dato posible de
        toda la pantalla.
      -->
      <RouterLink v-if="auth.plan" class="plan" to="/plan" role="menuitem"
        @click="abierto = false">
        <span class="plan-nombre">
          {{ auth.plan.familia === 'gestion' ? 'Gestión' : 'Inmobiliaria' }}
          · {{ auth.plan.nombre }}
        </span>
        <span class="plan-estado" :class="tonoPlan">{{ textoPlan }}</span>
      </RouterLink>

      <div class="seccion">
        <p class="titulo">Tema</p>
        <button
          v-for="o in OPCIONES"
          :key="o.v"
          class="opcion"
          type="button"
          role="menuitemradio"
          :aria-checked="preferencia === o.v"
          @click="elegirTema(o.v)"
        >
          <UiIcon :nombre="o.icono" :tam="15" />
          <span>{{ o.texto }}</span>
          <UiIcon v-if="preferencia === o.v" nombre="tilde" :tam="15" class="tilde" />
        </button>
      </div>

      <div class="seccion sin-borde">
        <button class="opcion" type="button" role="menuitem" @click="salir">
          <UiIcon nombre="salir" :tam="15" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: relative;
}

.disparador {
  display: inline-flex;
  align-items: center;
  gap: var(--s-sm);
  padding: 4px 8px 4px 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--t-micro), border-color var(--t-micro);
}
.disparador:hover {
  background: var(--surface-2);
  border-color: var(--line);
}

/* `--accent-ink`, no `--accent`. Es literalmente el caso que `tokens.css`
   documenta como el motivo por el que existe la variante —«medido, `--accent`
   sobre `--accent-tint` da 4,25:1»— y este avatar era el que se había quedado
   con el color base: 4,25 a 11px, por debajo de AA. Con `-ink`, 5,83.
   La definición de la capa familia ya lo hacía bien; esta copia local es la que
   se desincronizó. */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 600;
}

.rol {
  color: var(--ink-2);
}

.panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  min-width: 232px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
  overflow: hidden;
}

.cabecera {
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
}
.nombre {
  margin: 0;
  color: var(--ink);
  font-weight: 500;
  font-size: 13px;
}
.tenant {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.seccion {
  padding: var(--s-xs);
  border-bottom: 1px solid var(--line);
}
.seccion.sin-borde {
  border-bottom: none;
}

.titulo {
  margin: var(--s-xs) var(--s-sm) var(--s-xs);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.opcion {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  width: 100%;
  padding: var(--s-sm) var(--s-md);
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.opcion:hover {
  background: var(--surface-2);
}
.opcion[aria-checked='true'] {
  color: var(--accent);
}
.tilde {
  margin-left: auto;
}

/* ── El disparador, con nombre y rol ─────────────────────────────────────── */
.quien { display: flex; align-items: baseline; gap: var(--s-sm); min-width: 0; }
.nom {
  color: var(--ink-2); font-weight: 500;
  max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* El rol va apagado y más chico: es el contexto del nombre, no un dato aparte.
   En pantalla angosta desaparece antes que el nombre, porque saber QUIÉN sos
   importa más que saber con qué permisos. */
.rol { color: var(--muted); font-size: 12px; white-space: nowrap; }
@media (max-width: 40rem) { .rol { display: none; } }

/* ── La cabecera, ahora enlace ───────────────────────────────────────────── */
.cabecera {
  display: grid; gap: 1px;
  padding: var(--s-md) var(--s-lg);
  text-decoration: none; color: inherit;
  border-bottom: 1px solid var(--line);
}
.cabecera:hover { background: var(--surface-2); }
.cabecera .nombre { font-weight: 600; color: var(--ink); }
.cabecera .tenant { font-size: 13px; color: var(--muted); }
.cabecera .ir { font-size: 12px; color: var(--accent-ink); margin-top: 2px; }

/* ── El plan ─────────────────────────────────────────────────────────────── */
.plan {
  display: grid; gap: 1px;
  padding: var(--s-md) var(--s-lg);
  text-decoration: none; color: inherit;
  border-bottom: 1px solid var(--line);
}
.plan:hover { background: var(--surface-2); }
.plan-nombre { font-size: 13px; color: var(--ink-2); }
.plan-estado { font-size: 12px; color: var(--muted); }
/* El color sólo cuando hay algo que hacer. Un estado «Activo» en verde en cada
   apertura del menú gasta color sin informar. */
.plan-estado.aviso { color: var(--warning-ink); }
.plan-estado.alerta { color: var(--danger); }
</style>
