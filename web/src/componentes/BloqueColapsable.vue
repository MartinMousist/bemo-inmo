<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UiIcon from './UiIcon.vue';

/**
 * Un bloque de ficha que se pliega, con su resumen a la vista cuando está
 * cerrado.
 *
 * Existe como componente y no como siete copias porque la ficha del contrato son
 * siete bloques y cuatro de ellos ya son componentes propios: sin esto, el
 * patrón de cabecera + botón + `aria-*` + montaje diferido se copiaría siete
 * veces y las siete se separarían en el primer arreglo.
 *
 * ── Las cuatro decisiones ──
 *
 * **El botón envuelve SÓLO el título, no la fila entera.** `PublicacionesPage`
 * hace clicable toda la fila y ahí está bien: la fila no tiene nada interactivo
 * adentro. Acá el resumen lleva chips, montos y a veces un botón de acción, y la
 * trampa ya está paga en este repo —un control in-line adentro de una fila
 * clicable necesita `@click.stop` **y** `@keydown.stop`, o con el teclado el
 * Enter que confirma un valor termina abriendo otra cosa—. Un `<button>` nativo
 * además trae Enter, Espacio y el estado anunciado sin escribir nada.
 *
 * **Montaje lazy-once: `v-if` hasta la primera apertura, `hidden` después.** Un
 * bloque cerrado que nunca se abrió no monta y no pide nada — la ficha pasa de
 * once requests al montar a cuatro—. Pero cerrar **no** desmonta: si desmontara
 * se irían el borrador de WhatsApp de `GarantesContrato` (el `mensajes`
 * reactivo se recalcula desde cero) y el textarea a medio editar de
 * `PanelDocumentos`. Perder lo que alguien escribió para ahorrar un nodo es un
 * mal negocio.
 *
 * **El resumen no sale del contenido.** Lo pasa el padre desde el endpoint de la
 * ficha. Un bloque cerrado que para decir su número tuviera que montar su
 * contenido no habría ahorrado nada, que es todo el punto.
 *
 * **Sin animación de altura.** Medir `auto` con JS pelea con
 * `prefers-reduced-motion` y con el contenido que llega asincrónico. Lo único
 * que se mueve es el chevron, 90 ms, y la regla global de `familia.css` lo apaga
 * entero.
 *
 * ── Contraste, medido calculando el ratio y no mirando ──
 * (la trampa de `--muted-2` a 3,01 sobre `--surface-2` está en la tabla de
 * `docs/CONTINUAR.md`: a ojo un gris apagado sobre papel parece correcto)
 *
 * | Elemento | Color | Sobre | Claro | Oscuro |
 * |---|---|---|---|---|
 * | Título | `--ink` | `--surface` | 16,72 | 14,49 |
 * | Chevron | `--muted` | `--surface` | 5,87 | 6,42 |
 * | Resumen | `--ink-2` | `--surface` | 10,79 | 11,34 |
 * | Resumen apagado | `--muted` | `--surface` | 5,87 | 6,42 |
 * | Cabecera al pasar | `--muted` | `--surface-2` | 5,29 | 5,66 |
 *
 * Los chips del resumen reusan `StatusChip`, que ya tiene sus `-ink` medidos.
 */

const props = withDefaults(
  defineProps<{
    /** Estable: es el id del bloque en la preferencia y el ancla del `aria`. */
    id: string;
    titulo: string;
    abierto: boolean;
    /** Se dice al lado del título cuando el bloque está cerrado y no hay más. */
    vacio?: string;
  }>(),
  { vacio: '' },
);

const emit = defineEmits<{ 'update:abierto': [boolean] }>();

const panelId = computed(() => `bloque-${props.id}`);
const tituloId = computed(() => `bloque-${props.id}-titulo`);

/**
 * Lazy-once. Arranca en `true` si el bloque nace abierto, y una vez que se
 * prendió no se apaga nunca: es lo que hace que cerrar no pierda trabajo.
 */
const seAbrioAlgunaVez = ref(props.abierto);
watch(
  () => props.abierto,
  (v) => {
    if (v) seAbrioAlgunaVez.value = true;
  },
);
</script>

<template>
  <section class="card stack bloque" :class="{ plegado: !abierto }">
    <div class="cab">
      <h2 :id="tituloId" class="titulo">
        <button
          type="button"
          class="disparador"
          :aria-expanded="abierto"
          :aria-controls="panelId"
          @click="emit('update:abierto', !abierto)"
        >
          <UiIcon nombre="chevron" :tam="16" class="chevron" />
          <span>{{ titulo }}</span>
        </button>
      </h2>

      <!-- Fuera del botón, a propósito: acá van chips y montos, y meterlos
           adentro de un `<button>` es HTML inválido y un objetivo de clic que
           dice una cosa y hace otra. -->
      <div class="resumen"><slot name="resumen" /></div>

      <!-- Las acciones del bloque —«Calcular pendientes», «Generar hasta hoy»—
           se ven SIEMPRE, abierto o cerrado: son lo que se viene a hacer. -->
      <div class="acciones"><slot name="acciones" /></div>
    </div>

    <div
      :id="panelId"
      role="region"
      :aria-labelledby="tituloId"
      :hidden="!abierto"
      class="cuerpo stack"
    >
      <slot v-if="seAbrioAlgunaVez" />
    </div>
  </section>
</template>

<style scoped>
/* Ojo: el `scoped` del PADRE alcanza al elemento raíz de este componente —la
   trampa de la paleta ⌘K, ya anotada—. Y al revés, lo que entre por el slot se
   compila en el scope del padre: acá no se estiliza nada de adentro del slot,
   sólo el contenedor. */
.bloque { gap: var(--s-lg); }

/* Cerrado, el card se achica a su cabecera: si conservara el padding de arriba
   y de abajo, siete bloques plegados serían una columna de rectángulos vacíos. */
.bloque.plegado { padding-top: var(--s-lg); padding-bottom: var(--s-lg); }

.cab {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  flex-wrap: wrap;
}

.titulo { margin: 0; flex: none; }

.disparador {
  display: inline-flex;
  align-items: center;
  gap: var(--s-sm);
  margin: 0;
  padding: var(--s-xs) var(--s-sm);
  margin-left: calc(var(--s-sm) * -1);
  border: none;
  border-radius: var(--r-md);
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.disparador:hover { background: var(--surface-2); }
.disparador:focus-visible { outline: none; box-shadow: var(--ring); }

.chevron {
  flex: none;
  color: var(--muted);
  transform: rotate(0deg);
  transition: transform var(--t-micro) ease;
}
/* Cerrado apunta a la derecha, abierto hacia abajo. El ícono `chevron` del
   set apunta hacia abajo, así que el estado plegado es el que rota. */
.bloque.plegado .chevron { transform: rotate(-90deg); }

.resumen {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  flex-wrap: wrap;
  min-width: 0;
  font-size: 13px;
  color: var(--ink-2);
}

.acciones { margin-left: auto; display: flex; gap: var(--s-sm); flex: none; }

.cuerpo { display: flex; flex-direction: column; gap: var(--s-lg); }
/* Más específico que `.cuerpo`, si no el `display:flex` le gana al `hidden`
   nativo y el bloque «cerrado» se seguiría viendo entero. */
.cuerpo[hidden] { display: none; }

/* ── Impresión ────────────────────────────────────────────────────────────────
   El `@media print` global de `tokens.css` aplica a esta pantalla, y un bloque
   plegado con `display:none` desaparece del papel EN SILENCIO: alguien cierra
   Cuotas, imprime la ficha y entrega una hoja sin la cobranza, sin ninguna
   señal de que faltaba algo.

   Lo que se decide acá: la cabecera con su resumen se imprime SIEMPRE —así el
   papel dice al menos «3 impagas · ARS 1.543.000»— y el contenido plegado no.
   Quien quiere el papel completo tiene «Abrir todo» arriba, y la ficha del
   contrato nunca fue el papel legal: el pre-contrato tiene ruta propia
   justamente por esto. La ficha agrega al pie cuántos bloques salieron sólo con
   su resumen; eso vive en la página, que es la que sabe la cuenta. */
@media print {
  .bloque { break-inside: avoid; }
  /* El botón es un `.btn`… no: es `.disparador`. Aun así el `@media print`
     global esconde `.btn` y `nav`, y el título vive DENTRO del disparador —si
     se escondiera, el bloque saldría sin nombre—. Se fuerza visible. */
  .disparador { display: inline-flex !important; }
  .chevron { display: none; }
  /* Las acciones sí se van: son botones y en papel no se aprietan. */
  .acciones { display: none; }
}
</style>
