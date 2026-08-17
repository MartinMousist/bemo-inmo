<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useAuth } from '../stores/auth';
import { useEquipo } from '../stores/equipo';
import { etiquetaRol } from '../dominio/roles';
import { todoElEquipo } from '../dominio/vocabulario';
import { AGENTE_SIN_ASIGNAR, AGENTE_TODOS, AGENTE_YO } from '../dominio/agente';

/**
 * El filtro por agente, uno solo para las seis pantallas que lo tienen.
 *
 * Un asesor ve la cartera **entera** de la inmobiliaria y puede acotarla a lo
 * suyo con un clic: este control es una herramienta, no un permiso. La única
 * excepción declarada son los leads, donde el rol `agente` ve sólo los propios
 * por una regla de negocio escrita en `oportunidades.service.ts`; ahí la
 * pantalla pasa `solo-propias` y el desplegable no ofrece compañeros, porque
 * elegir uno devolvería un 403 y un botón que sólo sirve para dar error no es
 * un botón.
 *
 * El valor que sale de acá es el que la pantalla **guarda**: `''`, `'yo'`,
 * `'sin-asignar'` o un uuid. La traducción a parámetros de la API la hace
 * `paramsDeAgente()`, no este componente: quien arma la consulta es la pantalla
 * y ahí es donde se ve, junto al resto de los filtros.
 */
const valor = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    /** Etiqueta del control. En alquileres es «Captador» y no «Agente». */
    etiqueta?: string;
    /** Ofrecer «Sin captador». Sólo el listado de propiedades lo soporta. */
    conSinAsignar?: boolean;
    /**
     * El que mira sólo puede verse a sí mismo (leads, rol `agente`). El
     * desplegable desaparece y queda el chip, que es lo único que puede hacer.
     */
    soloPropias?: boolean;
  }>(),
  { etiqueta: 'Agente', conSinAsignar: false, soloPropias: false },
);

const auth = useAuth();
const equipo = useEquipo();

/** Los del equipo, menos uno mismo: «yo» ya tiene su propio chip. */
const otros = computed(() =>
  equipo.activos.filter((m) => m.usuarioId !== auth.usuario?.id),
);

const esMio = computed(() => valor.value === AGENTE_YO);

function alternarMias() {
  valor.value = esMio.value ? AGENTE_TODOS : AGENTE_YO;
}

/**
 * Regla 2 de `dominio/filtros.ts`, diferida.
 *
 * Un uuid guardado de alguien que ya no está en la inmobiliaria dejaría la
 * pantalla en cero filas sin que el usuario haya elegido nada. No se puede
 * validar en el constructor del filtro porque el equipo llega por fetch: se
 * revalida cuando llegó.
 */
watch(
  () => equipo.cargado,
  (listo) => {
    if (!listo) return;
    const v = valor.value;
    if (v === AGENTE_TODOS || v === AGENTE_YO || v === AGENTE_SIN_ASIGNAR) return;
    if (!equipo.activos.some((m) => m.usuarioId === v)) valor.value = AGENTE_TODOS;
  },
  { immediate: true },
);

onMounted(() => void equipo.cargar());
</script>

<template>
  <div class="filtro-agente">
    <label v-if="!props.soloPropias" class="campo suave">
      <span>{{ props.etiqueta }}</span>
      <select v-model="valor" :disabled="equipo.cargando && !equipo.cargado">
        <option :value="AGENTE_TODOS">{{ todoElEquipo(auth.tipoCuenta) }}</option>
        <option v-if="auth.usuario" :value="AGENTE_YO">{{ auth.usuario.nombre }} (yo)</option>
        <option v-for="m in otros" :key="m.usuarioId" :value="m.usuarioId">
          {{ m.nombre }} · {{ etiquetaRol(m.rol, auth.tipoCuenta) }}
        </option>
        <option v-if="props.conSinAsignar" :value="AGENTE_SIN_ASIGNAR">Sin captador</option>
      </select>
    </label>

    <!-- El atajo. Es el 90% del uso —«¿qué tengo yo?»— y merece un clic, no
         abrir un desplegable y buscarse en una lista de doce nombres. -->
    <button
      type="button"
      class="chip"
      :aria-pressed="esMio"
      :disabled="!auth.usuario"
      @click="alternarMias"
    >
      Las mías
    </button>

    <!-- Si el equipo no cargó se dice, en vez de mostrar un desplegable con una
         sola opción que parece una inmobiliaria de una persona. -->
    <span v-if="equipo.error" class="fallo">{{ equipo.error }}</span>
  </div>
</template>

<style scoped>
.filtro-agente {
  display: inline-flex;
  align-items: flex-end;
  gap: var(--s-sm);
}
.chip {
  font: inherit;
  font-size: 12px;
  padding: 6px 11px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--t-micro), color var(--t-micro), border-color var(--t-micro);
}
.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--accent-line); }
.chip[aria-pressed='true'] {
  background: var(--accent-tint);
  border-color: var(--accent-line);
  color: var(--accent-ink);
  font-weight: 500;
}
.chip:disabled { opacity: 0.5; cursor: default; }
.chip:focus-visible { outline: 0; box-shadow: var(--ring); }
.fallo { font-size: 12px; color: var(--warning-ink); align-self: center; }
</style>
