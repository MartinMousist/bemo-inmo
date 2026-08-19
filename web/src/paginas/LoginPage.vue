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

/**
 * El pase del segundo factor.
 *
 * Con esto puesto, el formulario cambia de paso: ya no se pide contraseña sino
 * el código. Es una sola pantalla y no una ruta aparte porque el pase dura
 * cinco minutos y vive en memoria —una ruta `/login/2fa` recargada a mano
 * llegaría sin él y dejaría a la persona en un formulario que no puede
 * funcionar—.
 */
const desafio = ref('');
const codigo = ref('');

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
    const pase = await auth.login(email.value, password.value);
    if (pase) {
      desafio.value = pase;
      return;
    }
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

async function enviarCodigo() {
  error.value = '';
  enviando.value = true;
  try {
    await auth.completarSegundoFactor(desafio.value, codigo.value);
    await router.replace((route.query.next as string) || '/inicio');
  } catch (e) {
    error.value =
      e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar con el servidor.';
    codigo.value = '';
  } finally {
    enviando.value = false;
  }
}

/** Volver atrás limpia el pase: quedaría inservible y confundiría el error. */
function volverAlPrimerPaso() {
  desafio.value = '';
  codigo.value = '';
  password.value = '';
  error.value = '';
}
</script>

<template>
  <AuthLayout>
    <!-- Segundo paso: el código. -->
    <form v-if="desafio" class="card" @submit.prevent="enviarCodigo">
      <header>
        <h2 class="text-lg">Verificación en dos pasos</h2>
        <p class="sub">
          Abrí tu app de autenticación y escribí el código de seis dígitos.
        </p>
      </header>

      <label class="campo">
        <span>Código</span>
        <input
          v-model="codigo"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          autofocus
          required
          maxlength="24"
          placeholder="123456"
          class="codigo"
        />
      </label>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Verificando…' : 'Verificar' }}
      </button>

      <!-- Se dice acá, no en una página de ayuda: es el momento en que alguien
           que perdió el teléfono está mirando esta pantalla. -->
      <p class="pie">
        ¿Perdiste el teléfono? Escribí uno de tus códigos de recuperación en el
        mismo casillero.
        <button type="button" class="enlace" @click="volverAlPrimerPaso">Volver</button>
      </p>
    </form>

    <form v-else class="card" @submit.prevent="enviar">
      <header>
        <h2 class="text-lg">Entrar</h2>
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
/* El código se lee de a dígitos: monoespaciado y con aire entre caracteres. */
.codigo { font-family: var(--font-mono); letter-spacing: 0.18em; }

.enlace {
  background: none; border: 0; padding: 0; font: inherit;
  color: var(--accent-ink); cursor: pointer; text-decoration: underline;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--s-lg);
  padding: var(--s-2xl);
}

.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
  font-size: 13px;
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

.btn.block {
  width: 100%;
  padding: 10px var(--s-lg);
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
