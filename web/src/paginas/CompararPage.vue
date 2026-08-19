<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import {
  etiquetaAmenity, etiquetaCalefaccion, etiquetaDisposicion,
  etiquetaOrientacion, etiquetaUrbanizacion,
} from '../dominio/catalogos-propiedad';
import { ETIQUETA_TIPO, money, numero } from '../dominio/formato';

/**
 * Dos a cuatro propiedades, lado a lado.
 *
 * ── Por qué no hay endpoint nuevo ──
 *
 * Es exactamente `GET /propiedades/:id` repetido. Un endpoint «comparar» que
 * reciba una lista de ids no traería un solo dato que no esté ya, y sería una
 * segunda forma de leer una propiedad que hay que mantener sincronizada con la
 * primera.
 *
 * ── La decisión que hace útil la tabla ──
 *
 * **Las filas donde las cuatro dicen lo mismo se pueden esconder.** Comparar es
 * buscar diferencias, y una tabla de treinta filas donde veintiocho son iguales
 * las entierra. El interruptor arranca en «sólo lo que difiere» y se puede
 * apagar para ver todo, porque a veces se quiere confirmar que algo coincide.
 */

interface Operacion {
  id: string; tipo: string; precio: number | null; moneda: string;
  expensas: number | null; expensasMoneda: string;
}
interface Propiedad {
  id: string; etiqueta: string; direccion: string; tipo: string;
  localidad: string | null;
  supTotal: number | null; supCubierta: number | null;
  ambientes: number | null; dormitorios: number | null;
  banos: number | null; cocheras: number | null;
  plantas: number | null; toilettes: number | null;
  antiguedad: number | null;
  orientacion: string | null; disposicion: string | null; calefaccion: string | null;
  tipoUrbanizacion: string | null; nombreComplejo: string | null;
  amenities: string[];
  fotoPortada: string | null;
  operaciones: Operacion[];
}

const route = useRoute();
const props = ref<Propiedad[]>([]);
const cargando = ref(true);
const error = ref('');
const soloDiferencias = ref(true);

/** Los ids vienen en la URL: así el enlace se puede compartir. */
const ids = computed(() => {
  const q = route.query.ids;
  const crudo = Array.isArray(q) ? q.join(',') : (q ?? '');
  return String(crudo).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
});

onMounted(async () => {
  if (!ids.value.length) { cargando.value = false; return; }
  try {
    // En paralelo: son hasta cuatro y no dependen entre sí.
    props.value = await Promise.all(
      ids.value.map((i) => api<Propiedad>(`/propiedades/${i}`)),
    );
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las propiedades.';
  } finally { cargando.value = false; }
});

function precioDe(p: Propiedad, tipo: string): string {
  const o = p.operaciones.find((x) => x.tipo === tipo);
  if (!o) return '—';
  return o.precio === null ? 'Consultar' : money(o.precio, o.moneda);
}

interface Fila { etiqueta: string; valores: string[] }

const filas = computed<Fila[]>(() => {
  const ps = props.value;
  if (!ps.length) return [];

  const todas: Fila[] = [
    { etiqueta: 'Tipo', valores: ps.map((p) => ETIQUETA_TIPO[p.tipo] ?? p.tipo) },
    { etiqueta: 'Localidad', valores: ps.map((p) => p.localidad || '—') },
    { etiqueta: 'Venta', valores: ps.map((p) => precioDe(p, 'venta')) },
    { etiqueta: 'Alquiler', valores: ps.map((p) => precioDe(p, 'alquiler')) },
    { etiqueta: 'Sup. total', valores: ps.map((p) => numero(p.supTotal, ' m²')) },
    { etiqueta: 'Sup. cubierta', valores: ps.map((p) => numero(p.supCubierta, ' m²')) },
    { etiqueta: 'Ambientes', valores: ps.map((p) => numero(p.ambientes)) },
    { etiqueta: 'Dormitorios', valores: ps.map((p) => numero(p.dormitorios)) },
    { etiqueta: 'Baños', valores: ps.map((p) => numero(p.banos)) },
    { etiqueta: 'Toilettes', valores: ps.map((p) => numero(p.toilettes)) },
    { etiqueta: 'Cocheras', valores: ps.map((p) => numero(p.cocheras)) },
    { etiqueta: 'Plantas', valores: ps.map((p) => numero(p.plantas)) },
    { etiqueta: 'Antigüedad', valores: ps.map((p) => numero(p.antiguedad, ' años')) },
    { etiqueta: 'Orientación', valores: ps.map((p) => (p.orientacion ? etiquetaOrientacion(p.orientacion) : '—')) },
    { etiqueta: 'Disposición', valores: ps.map((p) => (p.disposicion ? etiquetaDisposicion(p.disposicion) : '—')) },
    { etiqueta: 'Calefacción', valores: ps.map((p) => (p.calefaccion ? etiquetaCalefaccion(p.calefaccion) : '—')) },
    {
      etiqueta: 'Urbanización',
      valores: ps.map((p) => (p.tipoUrbanizacion
        ? etiquetaUrbanizacion(p.tipoUrbanizacion) + (p.nombreComplejo ? ` · ${p.nombreComplejo}` : '')
        : '—')),
    },
  ];

  // Los amenities se comparan como conjunto, no como texto: se muestra lo que
  // tiene cada una y el ojo hace el resto.
  todas.push({
    etiqueta: 'Amenities',
    valores: ps.map((p) => (p.amenities.length
      ? p.amenities.map(etiquetaAmenity).join(', ')
      : '—')),
  });

  if (!soloDiferencias.value) return todas;
  return todas.filter((f) => new Set(f.valores).size > 1);
});

const escondidas = computed(() => {
  if (!soloDiferencias.value) return 0;
  const ps = props.value;
  if (!ps.length) return 0;
  return 18 - filas.value.length;
});
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Comparar"
      :bajada="props.length ? `${props.length} propiedades, lado a lado` : 'Elegí propiedades desde el listado'">
      <template #acciones>
        <label class="toggle">
          <input v-model="soloDiferencias" type="checkbox" />
          <span>Sólo lo que difiere</span>
        </label>
      </template>
    </PageHeader>

    <UiSkeleton v-if="cargando" :filas="4" :alto="70" />
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>

    <UiEmpty
      v-else-if="props.length < 2"
      titulo="Hacen falta al menos dos"
      detalle="Desde Propiedades, marcá dos a cuatro y tocá «Comparar». También podés armar el enlace a mano con ?ids=uno,otro." />

    <template v-else>
      <div class="tabla-wrap">
        <table class="comparar">
          <thead>
            <tr>
              <th class="et"></th>
              <th v-for="p in props" :key="p.id">
                <RouterLink :to="`/propiedades/${p.id}`">
                  <img v-if="p.fotoPortada" :src="p.fotoPortada" alt="" />
                  <span class="cod mono">{{ p.etiqueta }}</span>
                  <span class="dir">{{ p.direccion }}</span>
                </RouterLink>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in filas" :key="f.etiqueta">
              <th class="et" scope="row">{{ f.etiqueta }}</th>
              <td v-for="(v, i) in f.valores" :key="i">{{ v }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Se dice cuántas se escondieron. Una tabla que oculta filas sin
           avisar deja a alguien buscando un dato que sí está. -->
      <p v-if="escondidas > 0" class="nota">
        {{ escondidas }} filas iguales en las {{ props.length }} están ocultas.
        Destildá «Sólo lo que difiere» para verlas.
      </p>
      <p v-else-if="soloDiferencias && !filas.length" class="nota">
        Estas propiedades no se diferencian en ninguno de los datos cargados.
      </p>
    </template>
  </div>
</template>

<style scoped>
.toggle { display: inline-flex; align-items: center; gap: var(--s-xs); font-size: 13px; }
.toggle input { accent-color: var(--accent); }

.tabla-wrap { overflow-x: auto; }
.comparar { width: 100%; border-collapse: collapse; min-width: 520px; }
.comparar th, .comparar td {
  padding: var(--s-sm) var(--s-md); border-bottom: 1px solid var(--line);
  text-align: left; font-size: 13px; vertical-align: top;
}
.comparar thead th { border-bottom: 2px solid var(--line-strong); }
.comparar thead img {
  width: 100%; max-width: 140px; aspect-ratio: 4 / 3;
  object-fit: cover; border-radius: var(--r-md); display: block; margin-bottom: var(--s-xs);
}
.cod { display: block; font-size: 11px; color: var(--muted); }
.dir { display: block; color: var(--ink); font-weight: 500; }
.et {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted-2); font-weight: 500; white-space: nowrap;
}
.nota { margin: 0; font-size: 12px; color: var(--muted); }
</style>
