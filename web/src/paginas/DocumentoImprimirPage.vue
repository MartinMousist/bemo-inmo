<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { fecha } from '../dominio/formato';

/**
 * La hoja imprimible de un documento.
 *
 * ── Por qué es una RUTA y no un modal ───────────────────────────────────────
 *
 * El `@media print` de `styles/tokens.css` esconde `.btn`, `nav` y `.acciones`,
 * pero **imprime todo el resto de la página**. Si esto viviera dentro de la
 * ficha del contrato, atrás del pre-contrato saldrían impresos los aumentos, las
 * cuotas y los garantes. Acá la página es el documento y nada más.
 *
 * ── Por qué no genera un PDF el servidor ────────────────────────────────────
 *
 * Porque el navegador ya ofrece «Guardar como PDF» en su propio diálogo de
 * impresión, y armarlo en el back es una dependencia nueva adentro del
 * contenedor para resolver algo que ya está resuelto. La pantalla no promete un
 * PDF: promete una hoja lista para imprimir, que es lo que hace.
 *
 * ── Por qué registra la impresión al abrirse ────────────────────────────────
 *
 * Porque un pre-contrato impreso y entregado en mano salió igual que uno mandado
 * por mail. Si sólo se anotaran los canales electrónicos, la mitad de las
 * entregas de una inmobiliaria de barrio no existirían para el sistema. Y
 * hacerlo acá —y no en el botón— hace que «volver a imprimir» desde el historial
 * también quede anotado.
 *
 * Va **con sesión**: el pre-contrato tiene los DNI y los domicilios de las
 * partes. No es un enlace para compartir.
 */

interface Envio { canal: string }
interface Documento {
  id: string;
  plantillaNombre: string;
  titulo: string | null;
  textoFinal: string;
  /**
   * Congelado al generar (migración 023).
   *
   * `html` → el texto se pinta con `v-html` y la tipografía de `DESIGN.md`.
   * `texto` → sigue el `<pre>` monoespaciado de siempre, sin tocar: un papel
   * que salió en Courier salió así, y esta hoja tiene que poder reproducirlo
   * seis meses después aunque su plantilla ya se haya convertido. Es la misma
   * regla que congela `plantillaNombre`.
   */
  formato: 'texto' | 'html';
  editado: boolean;
  faltantes: string[];
  generadoPor: string | null;
  createdAt: string;
  envios: Envio[];
  contrato: { etiqueta: string; direccion: string; inmobiliaria: string };
}

const route = useRoute();
const id = route.params.id as string;

const doc = ref<Documento | null>(null);
const error = ref('');

/** `created_at` es un timestamptz: el día se toma en la zona de Argentina. */
function diaDe(iso: string): string {
  const d = new Date(iso);
  return fecha(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d),
  );
}

onMounted(async () => {
  try {
    doc.value = await api<Documento>(`/documentos/${id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir el documento.';
    return;
  }

  // Se registra ANTES de abrir el diálogo: `window.print()` bloquea el hilo
  // hasta que la persona lo cierra, y con el registro después una impresión
  // cancelada quedaría sin anotar aunque la hoja ya se vio en pantalla.
  try {
    await api(`/documentos/${id}/envios`, {
      method: 'POST',
      body: JSON.stringify({ canal: 'impresion' }),
    });
  } catch {
    // Un fallo al anotar no puede impedir imprimir un contrato: se avisa arriba
    // de la hoja —donde no se imprime— y la impresión sigue.
    error.value =
      'La hoja está lista, pero no se pudo anotar la impresión en el historial. ' +
      'Volvé a abrirla más tarde si necesitás que quede registrada.';
  }

  // Esperar un tick al pintado: sin esto, Chrome abre el diálogo con la hoja a
  // medio renderizar y la vista previa sale en blanco.
  requestAnimationFrame(() => setTimeout(imprimir, 120));
});

function imprimir(): void {
  window.print();
}
</script>

<template>
  <!-- `.acciones` NO envuelve nada del documento: el @media print global la
       esconde entera, y el texto desaparecería de la hoja. -->
  <div class="hoja">
    <p v-if="error" class="alert acciones" role="alert">{{ error }}</p>

    <template v-if="doc">
      <header class="membrete">
        <div>
          <p class="inmo">{{ doc.contrato.inmobiliaria }}</p>
          <p class="ref">
            {{ doc.contrato.etiqueta }} · {{ doc.contrato.direccion }}
          </p>
        </div>
        <div class="derecha">
          <p class="titulo">{{ doc.titulo ?? doc.plantillaNombre }}</p>
          <p class="ref">{{ diaDe(doc.createdAt) }}</p>
        </div>
      </header>

      <!-- Las variables sin dato se imprimen igual, marcadas: un hueco visible
           en la hoja es lo que hace que alguien lo complete a mano antes de
           firmar. Esconderlo sería el mismo error que truncar un mensaje. -->
      <p v-if="doc.faltantes.length" class="faltan">
        Faltan datos: {{ doc.faltantes.join(', ') }}. Quedan marcados en el texto
        entre comillas angulares y hay que completarlos a mano.
      </p>

      <!--
        `v-html` con el HTML que YA pasó por el sanitizador del backend.

        Dos capas lo sostienen, y las dos hacen falta: `plantillas.sanitizar.ts`
        limpia todo lo que entra por `guardar()`, `previsualizar()`, `crear()` y
        `actualizar()` —los cuatro únicos puntos de escritura—, y el motor
        escapa los VALORES del contexto, que entran después de sanitizar y son
        el agujero de verdad (el apellido de una persona con `<img onerror>`).
        La CSP del Caddyfile es la tercera: si algún día apareciera un quinto
        camino de escritura, un `<script>` filtrado igual no correría.
      -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="doc.formato === 'html'" class="documento" lang="es-AR" v-html="doc.textoFinal" />
      <pre v-else class="texto">{{ doc.textoFinal }}</pre>

      <footer class="pie">
        <span>
          Generado por {{ doc.generadoPor ?? 'el sistema' }} el {{ diaDe(doc.createdAt) }}
          <template v-if="doc.editado"> · editado antes de imprimirse</template>
        </span>
        <span>{{ doc.contrato.inmobiliaria }} · Bemo INMO</span>
      </footer>

      <div class="acciones barra">
        <button class="btn" type="button" @click="imprimir">Imprimir de nuevo</button>
        <RouterLink class="btn secondary" to="/contratos">Volver</RouterLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hoja {
  max-width: 78ch;
  margin: 0 auto;
  padding: var(--s-2xl) var(--s-xl);
  background: var(--surface);
  color: var(--ink);
}

.membrete {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--s-xl);
  padding-bottom: var(--s-md);
  border-bottom: 1px solid var(--line-strong);
}
.membrete p { margin: 0; }
.derecha { text-align: right; }
.inmo { font-size: 15px; font-weight: 600; color: var(--ink); }
.titulo { font-size: 13px; color: var(--ink-2); }
.ref { font-size: 11px; color: var(--muted); }

.faltan {
  margin: var(--s-lg) 0 0;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--warning);
  border-radius: var(--r-sm);
  font-size: 11px;
  color: var(--warning-ink);
}

/* El `.documento` global (styles/documento.css) trae la letra, la interlínea,
   el justificado y el control de viudas. Acá sólo su lugar en la hoja. */
.documento { margin: var(--s-xl) 0; }

.texto {
  margin: var(--s-xl) 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ink);
}

.pie {
  display: flex; justify-content: space-between; gap: var(--s-lg);
  padding-top: var(--s-md);
  border-top: 1px solid var(--line);
  font-size: 10px;
  color: var(--muted);
}

.barra { display: flex; gap: var(--s-sm); margin-top: var(--s-xl); }

@media print {
  .hoja { max-width: none; margin: 0; padding: 0; }
}
</style>
