<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, moneyCorto, proximidad } from '../dominio/formato';
import type { Pagina } from '../dominio/pagina';

interface Vencimiento {
  tipo: 'contrato' | 'ajuste' | 'cuota';
  entidadId: string;
  contratoId: string;
  fecha: string;
  etiquetaPropiedad: string;
  referencia: string;
  monto: number | null;
  moneda: string;
  detalle: string | null;
}

/**
 * Es un tablero: se lee de corrido y agrupado por urgencia, no de a 25. Pero
 * `PaginacionDto` topea en `@Max(100)`, y pedir 200 devolvía **400**: la
 * pantalla no cargaba nunca y encima mostraba «0 en los próximos 90 días».
 * Se pide el máximo que el contrato admite y lo que sigue se trae con «Ver
 * más», que **agrega** a la lista en vez de reemplazarla: así el agrupado por
 * urgencia se mantiene y no se trunca en silencio. Truncar no es paginar.
 */
const POR_PAGINA = 100;

const items = ref<Vencimiento[]>([]);
const total = ref(0);
const pagina = ref(1);
const cargando = ref(true);
const trayendoMas = ref(false);
const error = ref('');
const dias = ref(90);

/** Hay dato para mostrar. Con `error` en pie no hay nada que contar. */
const hayDatos = computed(() => !cargando.value && !error.value);
const faltan = computed(() => Math.max(0, total.value - items.value.length));

const TITULO: Record<string, string> = {
  contrato: 'Vence el contrato',
  ajuste: 'Aumento',
  cuota: 'Cuota impaga',
};

async function pedir(p: number): Promise<Pagina<Vencimiento>> {
  return api<Pagina<Vencimiento>>(
    `/contratos/vencimientos?dias=${dias.value}&pagina=${p}&porPagina=${POR_PAGINA}`,
  );
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await pedir(1);
    items.value = r.items;
    total.value = r.total;
    pagina.value = 1;
  } catch (e) {
    // La lista se vacía junto con el error. Dejar los ítems de la corrida
    // anterior debajo de un cartel rojo es mostrar datos viejos como si
    // fueran los de ahora.
    items.value = [];
    total.value = 0;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los vencimientos.';
  } finally { cargando.value = false; }
}

async function verMas() {
  if (trayendoMas.value) return;
  trayendoMas.value = true;
  try {
    const r = await pedir(pagina.value + 1);
    items.value = [...items.value, ...r.items];
    total.value = r.total;
    pagina.value += 1;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron traer los que faltan.';
  } finally { trayendoMas.value = false; }
}

function cambiarDias(d: number) {
  dias.value = d;
  void cargar();
}

// Agrupado por urgencia y no por tipo: lo que importa es qué hay que hacer hoy.
const grupos = computed(() => {
  const g: Record<string, Vencimiento[]> = { vencido: [], estaSemana: [], esteMes: [], despues: [] };
  for (const v of items.value) {
    const p = proximidad(v.fecha);
    if (p.tono === 'vencido') g.vencido.push(v);
    else if (p.dias !== null && p.dias <= 7) g.estaSemana.push(v);
    else if (p.dias !== null && p.dias <= 30) g.esteMes.push(v);
    else g.despues.push(v);
  }
  return [
    { clave: 'vencido', titulo: 'Vencido', tono: 'err' as const, items: g.vencido },
    { clave: 'estaSemana', titulo: 'Esta semana', tono: 'err' as const, items: g.estaSemana },
    { clave: 'esteMes', titulo: 'Este mes', tono: 'warn' as const, items: g.esteMes },
    { clave: 'despues', titulo: 'Más adelante', tono: 'neutro' as const, items: g.despues },
  ].filter((x) => x.items.length);
});

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <!-- El total real, no `items.length`: si hay más de los que entran en la
         página, decirlo es la diferencia entre "hay 200" y "vi 200".
         Y si la carga falló, la bajada va VACÍA: un total al lado de un error
         es un número inventado, que es justo lo que esta pantalla hacía. -->
    <PageHeader
      titulo="Vencimientos"
      :bajada="hayDatos ? `${total} en los próximos ${dias} días${
        faltan ? ` · se muestran los ${items.length} más próximos` : ''
      }` : ''"
    >
      <template #acciones>
        <div class="segmented">
          <button v-for="d in [30, 90, 365]" :key="d" type="button"
                  :class="{ activo: dias === d }" @click="cambiarDias(d)">
            {{ d }} d
          </button>
        </div>
      </template>
    </PageHeader>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <UiSkeleton v-if="cargando" :filas="4" :alto="56" />

    <!-- El vacío sólo se afirma cuando hubo respuesta. Con `error` en pie no se
         sabe si no hay nada o si no se pudo preguntar, y decir "Nada por
         vencer" en ese caso es afirmar lo que no se sabe. -->
    <UiEmpty v-else-if="!error && !items.length" titulo="Nada por vencer"
      detalle="Cuando haya contratos, aumentos o cuotas próximas, aparecen acá ordenados por urgencia." />

    <section v-for="g in grupos" v-else :key="g.clave" class="grupo">
      <div class="grupo-cab">
        <h2>{{ g.titulo }}</h2>
        <StatusChip :texto="String(g.items.length)" :tono="g.tono" />
      </div>
      <div class="card sin-padding">
        <ul>
          <li v-for="v in g.items" :key="`${v.tipo}${v.entidadId}`">
            <span class="mono cod">{{ v.etiquetaPropiedad }}</span>
            <div class="que">
              <span class="titulo">{{ TITULO[v.tipo] }}</span>
              <span class="ref">{{ v.referencia }}</span>
            </div>
            <span v-if="v.monto !== null" class="mono monto">{{ moneyCorto(v.monto, v.moneda) }}</span>
            <span v-else class="monto" />
            <span class="mono fecha">{{ fecha(v.fecha) }}</span>
            <StatusChip :texto="proximidad(v.fecha).texto"
              :tono="proximidad(v.fecha).tono === 'vencido' ? 'err' : proximidad(v.fecha).tono === 'err' ? 'err' : proximidad(v.fecha).tono === 'warn' ? 'warn' : 'neutro'" />
          </li>
        </ul>
      </div>
    </section>

    <!-- La salida hacia el ítem 101. Sin esto, `porPagina` sería un tope
         silencioso y la bajada estaría avisando de un resto inalcanzable. -->
    <div v-if="hayDatos && faltan" class="mas">
      <button class="btn secondary" type="button" :disabled="trayendoMas" @click="verMas">
        {{ trayendoMas ? 'Trayendo…' : `Ver ${faltan} más` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.grupo { display: flex; flex-direction: column; gap: var(--s-sm); }
.grupo-cab { display: flex; align-items: center; gap: var(--s-sm); }
ul { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 92px 1fr auto 88px auto; align-items: center; gap: var(--s-md); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); font-size: 13px; }
li:last-child { border-bottom: none; }
.cod { color: var(--muted); font-size: 12px; }
.que { display: flex; flex-direction: column; }
.titulo { color: var(--ink); }
.ref { color: var(--muted); font-size: 12px; }
.monto { text-align: right; color: var(--ink); }
.fecha { color: var(--muted); text-align: right; }
.mas { display: flex; justify-content: center; }
@media (max-width: 760px) { li { grid-template-columns: 1fr auto; } .cod, .fecha { display: none; } }
</style>
