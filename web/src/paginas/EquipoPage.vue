<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { etiquetaRol, ROLES_INVITABLES } from '../dominio/roles';

interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  estado: string;
}

const auth = useAuth();
const miembros = ref<Miembro[]>([]);
const cargando = ref(true);
const error = ref('');

// Sólo el titular invita. El botón se muestra deshabilitado para los demás con
// la razón escrita: un control apagado y explicado se lee como permiso ajeno;
// uno ausente se lee como que la app está incompleta.
const puedeInvitar = () => auth.rol === 'owner';

const invitando = ref(false);
const emailInvitado = ref('');
const rolInvitado = ref('agente');
const enlaceGenerado = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    miembros.value = await api<Miembro[]>('/equipo');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el equipo.';
  } finally {
    cargando.value = false;
  }
}

async function invitar() {
  error.value = '';
  enlaceGenerado.value = '';
  try {
    const r = await api<{ token: string }>('/equipo/invitaciones', {
      method: 'POST',
      body: JSON.stringify({ email: emailInvitado.value, rol: rolInvitado.value }),
    });
    enlaceGenerado.value = `${location.origin}/invitacion/${r.token}`;
    emailInvitado.value = '';
    invitando.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo invitar.';
  }
}

onMounted(cargar);
</script>

<template>
  <section class="stack">
    <div class="encabezado">
      <div>
        <h2>Equipo</h2>
        <p class="sub">{{ auth.tenant?.nombre }}</p>
      </div>
      <button
        class="btn"
        type="button"
        :disabled="!puedeInvitar()"
        :title="puedeInvitar() ? '' : 'Sólo el titular puede sumar gente'"
        @click="invitando = !invitando"
      >
        Invitar
      </button>
    </div>

    <form v-if="invitando" class="card stack invitar" @submit.prevent="invitar">
      <div class="row">
        <input v-model="emailInvitado" type="email" required placeholder="correo@ejemplo.com" />
        <select v-model="rolInvitado">
          <option v-for="r in ROLES_INVITABLES" :key="r" :value="r">
            {{ etiquetaRol(r) }}
          </option>
        </select>
        <button class="btn" type="submit">Generar invitación</button>
      </div>
      <p class="nota">
        El envío por correo llega en la etapa 7. Por ahora copiá el enlace y mandalo vos.
      </p>
    </form>

    <div v-if="enlaceGenerado" class="card stack">
      <strong>Enlace de invitación</strong>
      <code class="mono enlace">{{ enlaceGenerado }}</code>
      <p class="nota">Se muestra una sola vez. Vence en 7 días.</p>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card">
      <div v-if="cargando" class="sk" />
      <table v-else>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Rol</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in miembros" :key="m.usuarioId">
            <td>{{ m.nombre }}</td>
            <td class="mono">{{ m.email }}</td>
            <td><span class="chip">{{ etiquetaRol(m.rol) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.encabezado {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-lg);
}
.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.invitar input,
.invitar select {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.invitar input {
  flex: 1;
}
.nota {
  margin: 0;
  font-size: 12px;
  color: var(--muted-2);
}
.enlace {
  display: block;
  padding: var(--s-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 12px;
  overflow-wrap: anywhere;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  padding-bottom: var(--s-sm);
  border-bottom: 1px solid var(--line);
}
td {
  padding: var(--s-md) 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
}
tr:last-child td {
  border-bottom: none;
}
.sk {
  height: 120px;
  border-radius: var(--r-md);
  background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
  background-size: 200% 100%;
  animation: brillo 1.2s ease-in-out infinite;
}
@keyframes brillo {
  to {
    background-position: -200% 0;
  }
}
.alert {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--danger-tint);
  border: 1px solid var(--danger-line);
  border-radius: var(--r-md);
  color: var(--danger);
  font-size: 13px;
}
</style>
