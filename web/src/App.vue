<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

/**
 * Shell de la etapa 1. No hay datos falsos: el estado de la API es real y el
 * catálogo dice la verdad sobre qué existe y qué no.
 *
 * Regla del playbook §9: no se simulan datos, se simula el futuro. Cada capacidad
 * lleva su estado; cuando una se termina se cambia acá y la pantalla se actualiza
 * sola. Un control apagado y explicado se lee como roadmap; uno ausente se lee
 * como olvido.
 */

type Estado = 'available' | 'soon';

const capacidades: Array<{ etapa: number; nombre: string; estado: Estado }> = [
  { etapa: 1, nombre: 'Fundaciones: base, migraciones y RLS', estado: 'available' },
  { etapa: 2, nombre: 'Auth, roles y aislamiento entre inmobiliarias', estado: 'soon' },
  { etapa: 3, nombre: 'Propiedades, personas y oportunidades', estado: 'soon' },
  { etapa: 4, nombre: 'Alquileres: contratos, índices y liquidaciones', estado: 'soon' },
  { etapa: 5, nombre: 'Ventas y comisiones por punta', estado: 'soon' },
  { etapa: 6, nombre: 'Publicación a portales', estado: 'soon' },
];

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

type Salud = { estado: 'cargando' | 'ok' | 'caida'; detalle: string };
const salud = ref<Salud>({ estado: 'cargando', detalle: 'Consultando…' });

async function verificarApi(): Promise<void> {
  salud.value = { estado: 'cargando', detalle: 'Consultando…' };
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) {
      // El contrato de error es RFC 9457: el front lee `code`, no `detail`.
      const problema = await res.json().catch(() => null);
      salud.value = {
        estado: 'caida',
        detalle: problema?.code ?? `HTTP ${res.status}`,
      };
      return;
    }
    const cuerpo = await res.json();
    salud.value = { estado: 'ok', detalle: `API y base respondiendo · db: ${cuerpo.db}` };
  } catch {
    salud.value = { estado: 'caida', detalle: 'No se pudo contactar la API' };
  }
}

onMounted(verificarApi);

const tema = ref<'light' | 'dark'>(
  (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light',
);

function alternarTema(): void {
  tema.value = tema.value === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', tema.value);
  localStorage.setItem('bemo-inmo:theme', tema.value);
}

const chipSalud = computed(() => {
  if (salud.value.estado === 'ok') return 'chip ok';
  if (salud.value.estado === 'caida') return 'chip err';
  return 'chip';
});
</script>

<template>
  <main class="shell">
    <header class="cabecera">
      <div>
        <h1>Bemo <span class="vertical">INMO</span></h1>
        <p class="bajada">Gestión inmobiliaria — alquileres, ventas y publicaciones</p>
      </div>
      <button class="btn secondary" type="button" @click="alternarTema">
        {{ tema === 'dark' ? 'Tema claro' : 'Tema oscuro' }}
      </button>
    </header>

    <section class="card stack">
      <div class="row" style="justify-content: space-between">
        <h2>Estado del sistema</h2>
        <span :class="chipSalud">{{
          salud.estado === 'ok' ? 'En línea' : salud.estado === 'caida' ? 'Caída' : '…'
        }}</span>
      </div>
      <p class="detalle mono">{{ salud.detalle }}</p>
      <div class="row">
        <button class="btn secondary" type="button" @click="verificarApi">
          Volver a verificar
        </button>
        <span class="endpoint mono">{{ API }}/health</span>
      </div>
    </section>

    <section class="card stack">
      <h2>Qué existe hoy</h2>
      <ul class="lista">
        <li v-for="c in capacidades" :key="c.etapa" class="item">
          <span class="etapa mono">Etapa {{ c.etapa }}</span>
          <span class="nombre">{{ c.nombre }}</span>
          <span :class="c.estado === 'available' ? 'chip ok' : 'chip'">
            {{ c.estado === 'available' ? 'Disponible' : 'En desarrollo' }}
          </span>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.shell {
  max-width: 780px;
  margin: 0 auto;
  padding: var(--s-3xl) var(--s-xl);
  display: flex;
  flex-direction: column;
  gap: var(--s-xl);
}

.cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-lg);
}

.vertical {
  font-family: var(--font-ui);
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--accent);
}

.bajada {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}

.detalle {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.endpoint {
  color: var(--muted-2);
  font-size: 12px;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.item {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-md) 0;
  border-bottom: 1px solid var(--line);
}
.item:last-child {
  border-bottom: none;
}

.etapa {
  font-size: 12px;
  color: var(--muted-2);
}

.nombre {
  color: var(--ink-2);
}

@media (max-width: 560px) {
  .item {
    grid-template-columns: 1fr auto;
  }
  .etapa {
    grid-column: 1 / -1;
  }
}
</style>
