<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../layouts/AuthLayout.vue';
import CampoPassword from '../componentes/CampoPassword.vue';
import { useAuth } from '../stores/auth';
import { ApiError } from '../api/cliente';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

/** El guard manda `motivo=expirada` cuando la renovación falló. */
const aviso = computed(() =>
  route.query.motivo === 'expirada'
    ? 'Tu sesión venció por seguridad. Ingresá de nuevo.'
    : '',
);

async function enviar() {
  error.value = '';
  enviando.value = true;
  try {
    await auth.login(email.value, password.value);
    // Vuelve adonde estaba antes de que lo rebotara el guard.
    await router.replace((route.query.next as string) || '/inicio');
  } catch (e) {
    // El mensaje real de la API: el back ya se ocupa de no revelar si el
    // correo existe, así que no hace falta genericarlo acá otra vez.
    error.value =
      e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar con el servidor.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <form class="card" @submit.prevent="enviar">
      <header>
        <h2>Entrar</h2>
        <p class="sub">Ingresá con tu cuenta de la inmobiliaria.</p>
      </header>

      <p v-if="aviso" class="nota" role="status">{{ aviso }}</p>

      <label class="campo">
        <span>Correo</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          inputmode="email"
          autofocus
          required
          placeholder="vos@inmobiliaria.com"
        />
      </label>

      <CampoPassword
        v-model="password"
        etiqueta="Contraseña"
        autocomplete="current-password"
      />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Entrando…' : 'Entrar' }}
      </button>

      <p class="pie">
        ¿No tenés cuenta?
        <RouterLink to="/registrar">Registrá tu inmobiliaria</RouterLink>
      </p>
    </form>
  </AuthLayout>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--s-lg);
  padding: var(--s-2xl);
}

h2 {
  font-size: 22px;
}
.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
  font-size: 13px;
}

.campo {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.campo > span {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.campo input {
  font: inherit;
  padding: 10px var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  transition: border-color var(--t-micro);
}
.campo input:hover {
  border-color: var(--muted-2);
}

.nota {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint);
  border: 1px solid var(--warning-line);
  border-radius: var(--r-md);
  color: var(--warning);
  font-size: 13px;
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

.btn.block {
  width: 100%;
  padding: 10px var(--s-lg);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.pie {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.pie a {
  color: var(--accent);
  font-weight: 500;
}
</style>
