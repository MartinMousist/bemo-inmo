<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { fecha } from '../dominio/formato';

/**
 * El enlace de sólo lectura para un propietario.
 *
 * El token se muestra **una sola vez**: en la base queda su hash. Si se pierde,
 * se genera otro — es la misma regla que las claves de API, y por el mismo
 * motivo: si alguien se lleva la base, no se lleva los enlaces.
 */
interface Acceso {
  id: string; expiraEl: string; revocadoEl: string | null;
  ultimoUso: string | null; usos: number; creadoEl: string; vigente: boolean;
}

/**
 * `rol` sin default: los dos portales muestran plata de una persona, y elegir
 * por descuido cuál sería mostrarle a un inquilino la liquidación de un dueño.
 * Es la misma regla que el servicio se impone del otro lado.
 */
const props = defineProps<{
  personaId: string;
  nombre: string;
  rol: 'propietario' | 'inquilino';
}>();

/** El recurso REST de cada portal: `/propietarios` o `/inquilinos`. */
const base = computed(() => (props.rol === 'propietario' ? 'propietarios' : 'inquilinos'));

const auth = useAuth();
const ui = useUi();
const abierto = ref(false);
const accesos = ref<Acceso[]>([]);
const cargando = ref(false);
const recien = ref<{ url: string; expiraEl: string } | null>(null);

const puede = () => auth.rol === 'owner' || auth.rol === 'admin';

async function abrir() {
  abierto.value = !abierto.value;
  if (!abierto.value) return;
  cargando.value = true;
  try {
    accesos.value = await api<Acceso[]>(`/${base.value}/${props.personaId}/accesos`);
  } catch (e) {
    ui.error('No se pudo cargar', e instanceof ApiError ? e.paraMostrar : '');
  } finally {
    cargando.value = false;
  }
}

async function generar() {
  const vigente = accesos.value.find((a) => a.vigente);
  if (vigente) {
    const ok = await ui.confirmar({
      titulo: '¿Generar un enlace nuevo?',
      detalle:
        `${props.nombre} ya tiene un enlace activo. Al generar otro, el anterior ` +
        'deja de funcionar al instante — si ya se lo mandaste, va a tener que ' +
        'usar el nuevo.',
      confirmar: 'Generar uno nuevo',
    });
    if (!ok) return;
  }

  try {
    const r = await api<{ ruta: string; expiraEl: string }>(
      `/${base.value}/${props.personaId}/accesos`,
      { method: 'POST' },
    );
    // La URL completa, porque lo que se copia y se manda por WhatsApp es esto.
    recien.value = { url: `${location.origin}${r.ruta}`, expiraEl: r.expiraEl };
    accesos.value = await api<Acceso[]>(`/${base.value}/${props.personaId}/accesos`);
    ui.ok('Enlace generado', 'Copialo ahora: no se vuelve a mostrar.');
  } catch (e) {
    ui.error('No se pudo generar', e instanceof ApiError ? e.paraMostrar : '');
  }
}

async function copiar() {
  if (!recien.value) return;
  await navigator.clipboard.writeText(recien.value.url);
  ui.ok('Enlace copiado');
}

async function revocar(a: Acceso) {
  const ok = await ui.confirmar({
    titulo: '¿Dar de baja el enlace?',
    detalle: `${props.nombre} va a dejar de ver su información al instante.`,
    confirmar: 'Dar de baja',
    peligroso: true,
  });
  if (!ok) return;

  try {
    await api(`/propietarios/accesos/${a.id}`, { method: 'DELETE' });
    accesos.value = await api<Acceso[]>(`/${base.value}/${props.personaId}/accesos`);
    recien.value = null;
    ui.ok('Enlace dado de baja');
  } catch (e) {
    ui.error('No se pudo dar de baja', e instanceof ApiError ? e.paraMostrar : '');
  }
}
</script>

<template>
  <div v-if="puede()" class="enlace-prop">
    <button class="mini" type="button" @click="abrir">
      {{ abierto ? 'Cerrar' : 'Acceso del propietario' }}
    </button>

    <div v-if="abierto" class="panel">
      <p class="que">
        Un enlace de sólo lectura donde {{ nombre }} ve el estado de cobranza de
        su propiedad y sus liquidaciones cerradas. No entra al sistema ni puede
        modificar nada.
      </p>

      <!-- Se muestra UNA vez. Después queda sólo el hash. -->
      <div v-if="recien" class="recien">
        <p class="aviso">Copialo ahora: no se vuelve a mostrar.</p>
        <div class="fila">
          <code class="mono url">{{ recien.url }}</code>
          <button class="btn sm" type="button" @click="copiar">Copiar</button>
        </div>
        <p class="chico">Vence el {{ fecha(recien.expiraEl.slice(0, 10)) }}.</p>
      </div>

      <p v-if="cargando" class="chico">Cargando…</p>

      <ul v-else-if="accesos.length" class="lista">
        <li v-for="a in accesos.slice(0, 3)" :key="a.id">
          <span :class="a.vigente ? 'ok' : 'baja'">
            {{ a.vigente ? `Activo hasta ${fecha(a.expiraEl.slice(0, 10))}` : 'Dado de baja' }}
          </span>
          <span class="chico">
            {{ a.usos }} {{ a.usos === 1 ? 'apertura' : 'aperturas' }}
          </span>
          <button v-if="a.vigente" class="mini" type="button" @click="revocar(a)">
            Dar de baja
          </button>
        </li>
      </ul>

      <button class="btn sm" type="button" @click="generar">
        {{ accesos.some((a) => a.vigente) ? 'Generar uno nuevo' : 'Generar el enlace' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.enlace-prop { margin-top: var(--s-xs); }
.mini {
  font: inherit; font-size: 11px;
  border: none; background: none; padding: 0;
  color: var(--muted); cursor: pointer; text-decoration: underline;
}
.mini:hover { color: var(--accent); }

.panel {
  margin-top: var(--s-sm);
  padding: var(--s-md);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  display: flex; flex-direction: column; gap: var(--s-sm);
  align-items: flex-start;
}
.que { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.55; max-width: 60ch; }
.chico { margin: 0; font-size: 11px; color: var(--muted-2); }

.recien { width: 100%; display: flex; flex-direction: column; gap: var(--s-xs); }
.aviso { margin: 0; font-size: 12px; color: var(--warning); font-weight: 500; }
.fila { display: flex; gap: var(--s-sm); align-items: center; }
.url {
  flex: 1; min-width: 0;
  padding: var(--s-xs) var(--s-sm);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-sm); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.lista { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 2px; }
.lista li { display: flex; align-items: center; gap: var(--s-sm); font-size: 12px; }
.lista .ok { color: var(--success); }
.lista .baja { color: var(--muted-2); }
</style>
