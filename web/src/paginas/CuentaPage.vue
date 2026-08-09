<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

/**
 * Qué clase de cuenta es esta y qué módulos usa.
 *
 * No toda la gente que administra alquileres es una inmobiliaria. Quien
 * gestiona veinte departamentos no vende ni reparte comisiones, y esas
 * secciones en el menú no son neutras: dicen «esto no está hecho para vos».
 *
 * Dos decisiones de esta pantalla:
 *
 * **Apagar es esconder, no borrar.** Se dice con todas las letras arriba de los
 * interruptores, porque la duda razonable de cualquiera al ver un switch que
 * apaga «Ventas» es si se le van las ventas cargadas. No se toca un dato: se
 * saca del menú y se bloquea la ruta.
 *
 * **El tipo no es una jaula.** Se cambia acá, y cada módulo tiene su
 * interruptor por si alguien no entra en ninguno de los dos moldes: una
 * inmobiliaria que no publica en portales, un gestor que arrancó a vender.
 */

interface Modulo {
  clave: string;
  nombre: string;
  detalle: string;
  activo: boolean;
  motivo: 'tipo' | 'prendido' | 'apagado' | 'fuera-del-plan';
}

interface Cuenta {
  tipo: string;
  tipoTexto: string;
  tipoDetalle: string;
  activos: string[];
  modulos: Modulo[];
  tipos: Array<{ clave: string; nombre: string; detalle: string }>;
}

const auth = useAuth();
const ui = useUi();

const cuenta = ref<Cuenta | null>(null);
const cargando = ref(true);
const guardando = ref('');
const error = ref('');

const esTitular = () => auth.rol === 'owner';

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    cuenta.value = await api<Cuenta>('/cuenta');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la cuenta.';
  } finally { cargando.value = false; }
}

async function cambiarTipo(tipo: string) {
  if (tipo === cuenta.value?.tipo) return;
  guardando.value = 'tipo';
  try {
    cuenta.value = await api<Cuenta>('/cuenta/tipo', {
      method: 'PUT',
      body: JSON.stringify({ tipo }),
    });
    // El menú se arma con esto: si no se recarga, la barra lateral queda con lo
    // de antes hasta el próximo refresco y parece que no pasó nada.
    await auth.cargarCuenta();
    ui.ok('Listo', cuenta.value.tipoDetalle);
  } catch (e) {
    ui.error('No se pudo cambiar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { guardando.value = ''; }
}

async function cambiarModulo(m: Modulo) {
  guardando.value = m.clave;
  try {
    cuenta.value = await api<Cuenta>(`/cuenta/modulos/${m.clave}`, {
      method: 'PUT',
      body: JSON.stringify({ activo: !m.activo }),
    });
    await auth.cargarCuenta();
  } catch (e) {
    ui.error('No se pudo cambiar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { guardando.value = ''; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Tu cuenta"
      bajada="Qué hacés y qué partes del sistema usás. Se cambia cuando quieras." />

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="2" :alto="120" />

    <template v-else-if="cuenta">
      <section class="card stack">
        <h2>¿Qué hacés?</h2>
        <div class="tipos">
          <button
            v-for="t in cuenta.tipos"
            :key="t.clave"
            type="button"
            class="tipo"
            :class="{ elegido: t.clave === cuenta.tipo }"
            :aria-pressed="t.clave === cuenta.tipo"
            :disabled="!esTitular() || guardando === 'tipo'"
            @click="cambiarTipo(t.clave)"
          >
            <strong>{{ t.nombre }}</strong>
            <span class="detalle">{{ t.detalle }}</span>
          </button>
        </div>
        <p v-if="!esTitular()" class="nota">
          Sólo el titular cambia el tipo de cuenta: le cambia la aplicación a todo el equipo.
        </p>
      </section>

      <section class="card stack">
        <h2>Módulos</h2>
        <p class="nota">
          <strong>Apagar un módulo lo esconde, no borra nada.</strong> Sale del menú y su
          pantalla deja de estar; los datos que ya cargaste siguen ahí y vuelven a
          aparecer el día que lo prendas.
        </p>

        <ul class="modulos">
          <li v-for="m in cuenta.modulos" :key="m.clave">
            <div class="que">
              <strong>{{ m.nombre }}</strong>
              <span class="detalle">{{ m.detalle }}</span>
            </div>

            <StatusChip
              v-if="m.motivo === 'fuera-del-plan'"
              texto="No está en tu plan" tono="neutro" />
            <button
              v-else
              type="button"
              class="btn secondary sm"
              :disabled="!esTitular() || guardando === m.clave"
              :aria-pressed="m.activo"
              @click="cambiarModulo(m)"
            >
              {{ m.activo ? 'Apagar' : 'Prender' }}
            </button>

            <StatusChip
              :texto="m.activo ? 'Se ve' : 'Escondido'"
              :tono="m.activo ? 'ok' : 'neutro'" />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 72ch; line-height: 1.6; }
.tipos { display: flex; gap: var(--s-md); flex-wrap: wrap; }
.tipo {
  flex: 1 1 260px; text-align: left; padding: var(--s-md);
  border: 1px solid var(--line); border-radius: var(--r-md);
  background: var(--surface); font: inherit; color: inherit; cursor: pointer;
}
.tipo:hover:not(:disabled) { background: var(--surface-2); }
.tipo:disabled { cursor: default; opacity: 0.75; }
.tipo.elegido { border-color: var(--acento); background: var(--surface-2); }
.tipo strong { display: block; font-size: 14px; }
.detalle { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.modulos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.modulos li {
  display: flex; align-items: center; gap: var(--s-md);
  padding: var(--s-md) 0; border-bottom: 1px solid var(--line);
}
.modulos li:last-child { border-bottom: none; }
.que { margin-right: auto; min-width: 0; }
</style>
