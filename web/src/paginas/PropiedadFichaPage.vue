<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { atributosDe, superficieDe } from '../dominio/atributos';
import {
  etiquetaAmenity, etiquetaCalefaccion, etiquetaDisposicion,
  etiquetaOrientacion, etiquetaUrbanizacion,
} from '../dominio/catalogos-propiedad';
import { ETIQUETA_OPERACION, ETIQUETA_TIPO, money, numero } from '../dominio/formato';

/**
 * La ficha técnica de una propiedad, lista para imprimir o mandar.
 *
 * ── Por qué NO genera el PDF el servidor ──
 *
 * Porque el navegador ya ofrece «Guardar como PDF» en su diálogo de impresión,
 * y armarlo en el back sería meter una dependencia pesada —un Chromium
 * headless— adentro del contenedor para resolver algo que ya está resuelto. Es
 * la misma decisión que ya tomó el pre-contrato imprimible, y por eso esta
 * pantalla **no promete un PDF**: promete una hoja lista para imprimir.
 *
 * ── Por qué es una página aparte y no un botón en la ficha ──
 *
 * El `@media print` global esconde `.btn` y `nav`, pero imprime todo el resto.
 * Si esto viviera dentro de `PropiedadDetallePage`, atrás de la ficha saldrían
 * impresos los honorarios, el reparto de comisiones y las notas internas — o
 * sea, lo que NO se le manda a un interesado. Acá la página es el documento.
 *
 * ── Qué NO sale impreso, a propósito ──
 *
 * Honorarios, comisiones, notas internas y el número exacto de puerta. Lo
 * último sigue la misma regla que el generador de avisos de la etapa 6: la
 * dirección exacta es para quien ya llamó.
 */

interface Operacion {
  id: string; tipo: string; precio: number | null; moneda: string;
  expensas: number | null; expensasMoneda: string; estado: string;
}
interface Propiedad {
  id: string; etiqueta: string; direccion: string; tipo: string;
  calle: string; numero: string | null; localidad: string | null; provincia: string | null;
  supTotal: number | null; supCubierta: number | null;
  ambientes: number | null; dormitorios: number | null;
  banos: number | null; cocheras: number | null;
  plantas: number | null; toilettes: number | null;
  antiguedad: number | null; descripcion: string | null;
  orientacion: string | null; disposicion: string | null; calefaccion: string | null;
  tipoUrbanizacion: string | null; nombreComplejo: string | null;
  amenities: string[];
  fotoPortada: string | null;
  operaciones: Operacion[];
}

const route = useRoute();
const auth = useAuth();
const id = route.params.id as string;

const p = ref<Propiedad | null>(null);
const fotos = ref<Array<{ id: string; url: string }>>([]);
const cargando = ref(true);
const error = ref('');

/**
 * La zona, NO el número de puerta.
 *
 * Misma regla que el generador de avisos: esta hoja se le manda a alguien que
 * todavía no llamó, y la dirección exacta es para después.
 */
const zona = computed(() => {
  if (!p.value) return '';
  return [p.value.calle, p.value.localidad, p.value.provincia].filter(Boolean).join(', ');
});

/** `window` no está en el scope del template: va por una función. */
function imprimir() { window.print(); }

const chips = computed(() => (p.value ? atributosDe(p.value) : []));
const superficie = computed(() => (p.value ? superficieDe(p.value) : null));

onMounted(async () => {
  try {
    p.value = await api<Propiedad>(`/propiedades/${id}`);
    try {
      fotos.value = await api<Array<{ id: string; url: string }>>(`/propiedades/${id}/fotos`);
    } catch {
      // Sin fotos la ficha se imprime igual: es una hoja de datos, no un álbum.
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la propiedad.';
  } finally { cargando.value = false; }
});
</script>

<template>
  <div class="hoja">
    <p v-if="error" class="alert acciones" role="alert">{{ error }}</p>
    <p v-else-if="cargando" class="acciones">Cargando…</p>

    <template v-else-if="p">
      <div class="acciones">
        <button class="btn" type="button" @click="imprimir">Imprimir o guardar en PDF</button>
        <RouterLink class="btn secondary" :to="`/propiedades/${p.id}`">Volver a la ficha</RouterLink>
      </div>

      <header class="membrete">
        <strong>{{ auth.tenant?.nombre }}</strong>
        <span class="cod mono">{{ p.etiqueta }}</span>
      </header>

      <h1>{{ ETIQUETA_TIPO[p.tipo] ?? p.tipo }} en {{ p.localidad || 'consultar' }}</h1>
      <p class="zona">{{ zona }}</p>

      <!-- El precio de cada punta. Una propiedad puede estar en venta Y en
           alquiler, y las dos van con su moneda. -->
      <ul class="precios">
        <li v-for="o in p.operaciones" :key="o.id">
          <span class="et">{{ ETIQUETA_OPERACION[o.tipo] ?? o.tipo }}</span>
          <strong class="mono">
            {{ o.precio === null ? 'Consultar' : money(o.precio, o.moneda) }}
          </strong>
          <span v-if="o.expensas" class="exp mono">
            + {{ money(o.expensas, o.expensasMoneda) }} de expensas
          </span>
        </li>
      </ul>

      <p v-if="p.tipoUrbanizacion && p.tipoUrbanizacion !== 'abierto'" class="urbanizacion">
        {{ etiquetaUrbanizacion(p.tipoUrbanizacion) }}
        <template v-if="p.nombreComplejo"> · {{ p.nombreComplejo }}</template>
      </p>

      <section v-if="fotos.length" class="fotos">
        <img v-for="f in fotos.slice(0, 6)" :key="f.id" :src="f.url" alt="" />
      </section>

      <section class="datos">
        <h2>Características</h2>
        <ul class="chips">
          <li v-for="c in chips" :key="c.clave">{{ c.titulo }}</li>
          <li v-if="superficie">{{ superficie }}</li>
        </ul>

        <dl>
          <div v-if="p.plantas !== null"><dt>Plantas</dt><dd>{{ numero(p.plantas) }}</dd></div>
          <div v-if="p.toilettes !== null"><dt>Toilettes</dt><dd>{{ numero(p.toilettes) }}</dd></div>
          <div v-if="p.antiguedad !== null">
            <dt>Antigüedad</dt><dd>{{ numero(p.antiguedad, ' años') }}</dd>
          </div>
          <div v-if="p.orientacion">
            <dt>Orientación</dt><dd>{{ etiquetaOrientacion(p.orientacion) }}</dd>
          </div>
          <div v-if="p.disposicion">
            <dt>Disposición</dt><dd>{{ etiquetaDisposicion(p.disposicion) }}</dd>
          </div>
          <div v-if="p.calefaccion">
            <dt>Calefacción</dt><dd>{{ etiquetaCalefaccion(p.calefaccion) }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="p.amenities.length" class="datos">
        <h2>Amenities</h2>
        <ul class="chips">
          <li v-for="a in p.amenities" :key="a">{{ etiquetaAmenity(a) }}</li>
        </ul>
      </section>

      <section v-if="p.descripcion" class="datos">
        <h2>Descripción</h2>
        <p class="desc">{{ p.descripcion }}</p>
      </section>

      <!-- Se dice que la dirección exacta no está, en vez de que el interesado
           crea que la hoja está incompleta. -->
      <footer class="pie">
        {{ auth.tenant?.nombre }} · {{ p.etiqueta }} — la dirección exacta se
        informa en la visita.
      </footer>
    </template>
  </div>
</template>

<style scoped>
.hoja { max-width: 800px; margin: 0 auto; padding: var(--s-xl); }
.acciones { display: flex; gap: var(--s-sm); margin-bottom: var(--s-lg); }

.membrete {
  display: flex; align-items: baseline; gap: var(--s-md);
  padding-bottom: var(--s-sm); border-bottom: 2px solid var(--ink);
}
.membrete strong { margin-right: auto; font-size: 15px; }
.cod { color: var(--muted); font-size: 13px; }

h1 { margin: var(--s-lg) 0 var(--s-2xs); font-size: 24px; }
.zona { margin: 0 0 var(--s-md); color: var(--muted); }

.precios { list-style: none; margin: 0 0 var(--s-md); padding: 0; display: flex; gap: var(--s-xl); flex-wrap: wrap; }
.precios li { display: flex; flex-direction: column; gap: 2px; }
.et { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.precios strong { font-size: 20px; }
.exp { font-size: 12px; color: var(--muted); }

.urbanizacion { margin: 0 0 var(--s-md); font-weight: 600; color: var(--accent-ink); }

.fotos { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-sm); margin-bottom: var(--s-lg); }
.fotos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--r-md); }

.datos { margin-bottom: var(--s-lg); }
.datos h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 var(--s-sm); }
.chips { list-style: none; margin: 0 0 var(--s-sm); padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-xs); }
.chips li { border: 1px solid var(--line); border-radius: 999px; padding: 2px var(--s-sm); font-size: 13px; }
dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-sm); margin: 0; }
dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
dd { margin: 0; font-size: 14px; }
.desc { margin: 0; white-space: pre-wrap; line-height: 1.6; }

.pie { margin-top: var(--s-xl); padding-top: var(--s-sm); border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }

/* En papel: sin sombras, sin fondos, y las fotos que no entran no se cortan a
   la mitad de una página. El `@media print` global ya esconde `.btn`. */
@media print {
  .hoja { padding: 0; max-width: none; }
  .fotos { break-inside: avoid; }
  .datos { break-inside: avoid; }
}
</style>
