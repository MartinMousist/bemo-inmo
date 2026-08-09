<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthLayout from '../layouts/AuthLayout.vue';
import CampoPassword from '../componentes/CampoPassword.vue';
import { useAuth } from '../stores/auth';
import { ApiError } from '../api/cliente';

const auth = useAuth();
const router = useRouter();

/**
 * Lo primero que se pregunta, antes que el nombre.
 *
 * No toda la gente que administra alquileres es una inmobiliaria: hay quien
 * gestiona veinte departamentos y no vende, no reparte comisiones y no tiene
 * embudo de captación. Preguntarlo acá —y no esconderlo en Ajustes— es lo que
 * hace que esa persona entre y vea un sistema hecho para ella en vez de cinco
 * secciones que no va a abrir nunca.
 *
 * No es una jaula: se cambia después, y cada módulo tiene su interruptor.
 */
const TIPOS = [
  {
    clave: 'inmobiliaria',
    nombre: 'Inmobiliaria',
    detalle: 'Vendo y alquilo. Necesito captación, publicación en portales y comisiones.',
  },
  {
    clave: 'gestor',
    nombre: 'Gestión de alquileres',
    detalle: 'Administro alquileres, propios o de terceros. No trabajo con ventas ni comisiones.',
  },
] as const;

const tipo = ref<'inmobiliaria' | 'gestor'>('inmobiliaria');
const inmobiliaria = ref('');
const provincia = ref('');
const nombre = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

async function enviar() {
  error.value = '';
  enviando.value = true;
  try {
    await auth.registrar({
      inmobiliaria: inmobiliaria.value,
      tipo: tipo.value,
      provincia: provincia.value || undefined,
      email: email.value,
      password: password.value,
      nombre: nombre.value,
    });
    await router.replace('/inicio');
  } catch (e) {
    error.value =
      e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar con el servidor.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <form class="card stack" @submit.prevent="enviar">
      <div>
        <h2 class="text-lg">Crear cuenta</h2>
        <p class="sub">Quedás como titular. Esto se cambia después.</p>
      </div>

      <fieldset class="tipos">
        <legend>¿Qué hacés?</legend>
        <label v-for="t in TIPOS" :key="t.clave" class="tipo" :class="{ elegido: tipo === t.clave }">
          <input v-model="tipo" type="radio" name="tipo" :value="t.clave" />
          <span>
            <strong>{{ t.nombre }}</strong>
            <span class="detalle">{{ t.detalle }}</span>
          </span>
        </label>
      </fieldset>

      <label class="campo">
        <span>{{ tipo === 'gestor' ? 'Nombre de tu gestión' : 'Inmobiliaria' }}</span>
        <input v-model="inmobiliaria" autofocus required maxlength="120" />
      </label>

      <label class="campo">
        <span>Provincia</span>
        <input v-model="provincia" maxlength="60" placeholder="Opcional" />
      </label>

      <label class="campo">
        <span>Tu nombre</span>
        <input v-model="nombre" required maxlength="120" autocomplete="name" />
      </label>

      <label class="campo">
        <span>Correo</span>
        <input v-model="email" type="email" required autocomplete="username" />
      </label>

      <CampoPassword
        v-model="password"
        etiqueta="Contraseña"
        autocomplete="new-password"
        ayuda="Al menos 10 caracteres."
      />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Creando…' : 'Crear cuenta' }}
      </button>

      <p class="pie">¿Ya tenés cuenta? <RouterLink to="/login">Entrar</RouterLink></p>
    </form>
  </AuthLayout>
</template>

<style scoped>
.tipos { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-sm); }
.tipos legend { padding: 0 0 var(--s-sm); font-size: 13px; color: var(--muted); }
.tipo {
  display: flex; align-items: flex-start; gap: var(--s-sm);
  padding: var(--s-md); border: 1px solid var(--line); border-radius: var(--r-md);
  cursor: pointer;
}
.tipo.elegido { border-color: var(--acento); background: var(--surface-2); }
.tipo input { margin-top: 3px; flex: none; }
.tipo strong { display: block; font-size: 14px; }
.detalle { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); line-height: 1.5; }

.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}
.campo input {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.pie {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.pie a {
  color: var(--accent);
}
</style>
