<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { filtrosRecordados } from '../dominio/filtros';
import { fecha, plural } from '../dominio/formato';

/**
 * La agenda de visitas.
 *
 * ── Lo que esta pantalla NO es ──
 *
 * No es un calendario. Una grilla de mes con casilleros vacíos ocupa toda la
 * pantalla para decir «hay tres visitas», y la pregunta real de un asesor a la
 * mañana es **qué tengo hoy y qué tengo mañana**, en ese orden. Por eso es una
 * lista agrupada por día, con hoy arriba.
 *
 * ── Por qué no hubo tabla nueva ──
 *
 * `visita` existe desde la migración 006 con su fecha, su agente y su estado, y
 * agendar ya funcionaba desde la ficha del lead. Lo único que faltaba era poder
 * preguntar «¿qué tengo esta semana?». Es el error #3 del playbook: media
 * feature construida que no se notaba porque nadie la podía ver.
 */

interface Visita {
  id: string;
  fechaHora: string;
  oportunidadId: string;
  persona: string | null;
  telefono: string | null;
  propiedad: string | null;
  agente: string | null;
  agenteId: string | null;
}

const auth = useAuth();
const visitas = ref<Visita[]>([]);
const cargando = ref(true);
const error = ref('');

const { valores: filtros } = filtrosRecordados('agenda', { agente: '' });

/** Agrupadas por día: es como se lee una agenda, no como se guarda. */
const porDia = computed(() => {
  const mapa = new Map<string, Visita[]>();
  for (const v of visitas.value) {
    const dia = v.fechaHora.slice(0, 10);
    mapa.set(dia, [...(mapa.get(dia) ?? []), v]);
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

const hoy = new Date().toISOString().slice(0, 10);

function etiquetaDia(dia: string): string {
  if (dia === hoy) return 'Hoy';
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (dia === manana) return 'Mañana';
  return fecha(dia);
}

/**
 * `HH:MM` en 24 horas. `fechaHora` es `timestamptz`, así que sí lleva zona —la
 * trampa del día corrido es de las columnas `date`.
 *
 * `hour12: false` explícito: sin eso `es-AR` devuelve «01:00 p. m.», que no es
 * como se escribe ni se lee una hora acá. Con `hourCycle` de por medio Safari y
 * Chrome además difieren en si el mediodía es 00 o 24.
 */
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * El enlace de WhatsApp para confirmar.
 *
 * `null` cuando el teléfono no se puede normalizar: un `wa.me` mal armado abre
 * el chat de otra persona, y eso es peor que no ofrecer el botón. La regla vive
 * en el back (`telefono.motor.ts`); acá alcanza con exigir que haya algo.
 */
function whatsapp(v: Visita): string | null {
  if (!v.telefono) return null;
  const solo = v.telefono.replace(/\D/g, '');
  if (solo.length < 8) return null;
  const texto = encodeURIComponent(
    `Hola${v.persona ? ` ${v.persona.split(' ')[0]}` : ''}, te escribo para confirmar la visita.`,
  );
  return `https://wa.me/${solo}?text=${texto}`;
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(
      paramsDeAgente(filtros.value.agente, auth.usuario?.id ?? null),
    )) {
      // La agenda usa `agenteId`, no el par que arman los listados: acá el
      // «sin asignar» no aplica —una visita sin agente igual hay que hacerla—.
      if (k === 'agenteId' && v !== undefined) params.set('agenteId', v);
    }
    visitas.value = await api<Visita[]>(`/oportunidades/agenda?${params}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la agenda.';
  } finally { cargando.value = false; }
}

watch(filtros, () => void cargar(), { deep: true });
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Agenda"
      :bajada="cargando ? 'Cargando…' : `${plural(visitas.length, 'visita agendada', 'visitas agendadas')} en los próximos 14 días`">
      <template #acciones>
        <SelectAgente v-model="filtros.agente" etiqueta="Asesor" />
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-else-if="cargando" :filas="3" :alto="70" />

    <UiEmpty
      v-else-if="!visitas.length"
      titulo="No hay visitas agendadas"
      :detalle="hayFiltroDeAgente(filtros.agente)
        ? 'Probá sacando el filtro por asesor.'
        : 'Las visitas se agendan desde la ficha de un lead, en Leads.'" />

    <section v-for="[dia, delDia] in porDia" v-else :key="dia" class="card stack dia">
      <h2 :class="{ hoy: dia === hoy }">{{ etiquetaDia(dia) }}</h2>

      <div v-for="v in delDia" :key="v.id" class="visita">
        <span class="hora mono">{{ hora(v.fechaHora) }}</span>
        <div class="quien">
          <RouterLink :to="`/leads`" class="nombre">{{ v.persona ?? 'Sin persona' }}</RouterLink>
          <span class="donde">{{ v.propiedad ?? 'Sin propiedad asignada' }}</span>
          <!-- Se dice cuando no hay asesor: una visita sin dueño es la que
               nadie hace. -->
          <span v-if="!v.agente" class="sin-agente">Sin asesor asignado</span>
          <span v-else class="agente">{{ v.agente }}</span>
        </div>
        <a
          v-if="whatsapp(v)"
          class="btn secondary sm"
          :href="whatsapp(v) as string"
          target="_blank"
          rel="noopener noreferrer"
        >Confirmar</a>
      </div>
    </section>

    <!-- Honestidad: el aviso queda en la bandeja del sistema. Que le llegue
         solo al interesado depende del proveedor que la etapa 7 no tiene, y no
         se promete lo que no ocurre. -->
    <p v-if="visitas.length" class="nota">
      El recordatorio se genera el día anterior y aparece en <RouterLink to="/avisos">Avisos</RouterLink>.
      El envío automático al interesado todavía no está: hace falta configurar el canal.
    </p>
  </div>
</template>

<style scoped>
.dia h2 { margin: 0; font-size: 14px; color: var(--muted); }
.dia h2.hoy { color: var(--ink); }
.visita {
  display: flex; align-items: center; gap: var(--s-md);
  padding: var(--s-sm) 0;
}
.visita + .visita { border-top: 1px solid var(--line); }
.hora { font-size: 15px; color: var(--ink); min-width: 6ch; }
.quien { display: flex; flex-direction: column; gap: 1px; margin-right: auto; min-width: 0; }
.nombre { font-weight: 500; }
.donde { font-size: 12px; color: var(--muted); }
.agente { font-size: 11px; color: var(--muted-2); }
.sin-agente { font-size: 11px; color: var(--warning); }
.nota { margin: 0; font-size: 12px; color: var(--muted); max-width: 76ch; line-height: 1.6; }
</style>
