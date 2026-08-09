<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { etiquetaRol } from '../dominio/roles';
import { fecha, money, moneyCorto, plural } from '../dominio/formato';
import { ETIQUETA_ESTADO, TONO_ESTADO, pct } from '../dominio/comisiones';

/**
 * El perfil de una persona del equipo.
 *
 * **La regla que decide todo lo de esta pantalla**: un agente ve SUS montos, no
 * los de sus compañeros. Y por eso el bloque de la inmobiliaria cambia según
 * quién mira: al titular, a administración y a contaduría les muestra el pozo
 * de comisiones; a un agente le muestra VOLUMEN —operaciones, monto operado,
 * contratos—. Con un equipo de dos asesores, «el total de la casa» menos «lo
 * mío» ES «lo del compañero»: un permiso que se esquiva restando no es un
 * permiso.
 *
 * Dos cosas más, que son reglas del producto y no decisiones de esta pantalla:
 *
 * **Nunca un total que mezcle monedas.** ARS y USD van en filas separadas. Un
 * número que sume las dos no significa nada.
 *
 * **Un cero no reemplaza a un «no sé» ni a un «no podés».** Sin comisiones dice
 * «sin comisiones todavía»; sin permiso, dice por qué.
 */

interface MontoPorMoneda { moneda: string; estado: string; total: number; lineas?: number }

interface Perfil {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  estado: string;
  sucursal: string | null;
  esPropio: boolean;
  comisionCaptadorPct: number | null;
  comisionCerradorPct: number | null;
  heredado: { captador: number; cerrador: number };
  comisiones: MontoPorMoneda[] | null;
  comisionesMotivo: string | null;
  captadas: Array<{
    id: string; etiqueta: string; direccion: string; tipo: string;
    operaciones: Array<{ tipo: string; precio: number | null; moneda: string; estado: string }>;
  }>;
  contratos: Array<{
    id: string; etiqueta: string; direccion: string; desde: string; hasta: string;
    monto: number; moneda: string; estado: string;
  }>;
  ventas: Array<{
    id: string; etiqueta: string; direccion: string; precioCierre: number;
    moneda: string; estado: string; fechaEscritura: string | null;
  }>;
  inmobiliaria: {
    ventasCerradas: number;
    contratosVigentes: number;
    propiedades: number;
    operado: Array<{ moneda: string; total: number; operaciones: number }>;
    comisionesDeAgentes: MontoPorMoneda[] | null;
    comisionesMotivo: string | null;
  };
}

const ETIQUETA_VENTA: Record<string, string> = {
  en_curso: 'En curso', boleto: 'Con boleto', escriturada: 'Escriturada', caida: 'Caída',
};

const route = useRoute();
const auth = useAuth();

const p = ref<Perfil | null>(null);
const cargando = ref(true);
const error = ref('');

/** Las comisiones agrupadas por moneda, con sus estados adentro. */
const porMoneda = computed(() => {
  const filas = p.value?.comisiones ?? [];
  const monedas = [...new Set(filas.map((f) => f.moneda))].sort();
  return monedas.map((moneda) => {
    const dela = filas.filter((f) => f.moneda === moneda);
    return {
      moneda,
      estados: dela,
      // El total por moneda excluye las anuladas —el back ya las filtra— y
      // NUNCA cruza monedas.
      total: dela.reduce((a, f) => a + f.total, 0),
    };
  });
});

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    p.value = await api<Perfil>(`/equipo/${route.params.usuarioId}/perfil`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el perfil.';
  } finally { cargando.value = false; }
}

watch(() => route.params.usuarioId, () => void cargar());
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="90" />
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>

    <template v-else-if="p">
      <PageHeader
        :titulo="p.nombre"
        :bajada="`${etiquetaRol(p.rol)}${p.sucursal ? ' · ' + p.sucursal : ''} · ${p.email}`"
      >
        <template #acciones>
          <RouterLink class="btn secondary" to="/equipo">Volver al equipo</RouterLink>
        </template>
      </PageHeader>

      <p v-if="p.estado !== 'activa'" class="alert" role="status">
        Esta membresía está <strong>{{ p.estado }}</strong>: la persona no puede entrar al
        sistema. Lo que ya cobró sigue en el historial.
      </p>

      <!-- ── Su reparto ─────────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>Su porcentaje</h2>
        <p class="nota">
          En <strong>% de lo que le queda a la inmobiliaria</strong> después de repartir
          con otra agencia, si la hubo — no % de la operación. Es la unidad del motor de
          comisiones, y mezclarla con la otra es la razón por la que estas cuentas dan mal.
        </p>
        <div class="chips">
          <div>
            <span class="et">Cuando capta</span>
            <span class="mono grande">
              {{ pct(p.comisionCaptadorPct ?? p.heredado.captador) }}
            </span>
            <span v-if="p.comisionCaptadorPct === null" class="hered">
              heredado de la inmobiliaria
            </span>
            <span v-else class="propio">propio</span>
          </div>
          <div>
            <span class="et">Cuando cierra</span>
            <span class="mono grande">
              {{ pct(p.comisionCerradorPct ?? p.heredado.cerrador) }}
            </span>
            <span v-if="p.comisionCerradorPct === null" class="hered">
              heredado de la inmobiliaria
            </span>
            <span v-else class="propio">propio</span>
          </div>
        </div>
      </section>

      <!-- ── Sus comisiones ─────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>{{ p.esPropio ? 'Mis comisiones' : 'Sus comisiones' }}</h2>

        <p v-if="p.comisiones === null" class="nota bloqueado">
          {{ p.comisionesMotivo }}
        </p>

        <p v-else-if="!p.comisiones.length" class="nota">
          Sin comisiones todavía. Aparecen cuando una venta o un contrato se reparte y le
          toca una parte.
        </p>

        <div v-else class="monedas">
          <div v-for="m in porMoneda" :key="m.moneda" class="card interna">
            <div class="row entre">
              <strong>{{ m.moneda }}</strong>
              <span class="mono grande">{{ money(m.total, m.moneda) }}</span>
            </div>
            <table>
              <tbody>
                <tr v-for="e in m.estados" :key="e.estado">
                  <th scope="row">
                    <StatusChip
                      :texto="ETIQUETA_ESTADO[e.estado] ?? e.estado"
                      :tono="TONO_ESTADO[e.estado] ?? 'neutro'" />
                  </th>
                  <td class="mono der">{{ money(e.total, m.moneda) }}</td>
                  <td class="chica">{{ plural(e.lineas ?? 0, 'línea', 'líneas') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="p.comisiones && p.comisiones.length" class="nota chica">
          Los totales no cruzan monedas: un número que sume pesos y dólares no significa nada.
        </p>
      </section>

      <!-- ── Lo que captó ───────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>Propiedades que captó · {{ p.captadas.length }}</h2>
        <p v-if="!p.captadas.length" class="nota">
          Ninguna propiedad tiene a esta persona como captadora. Se carga desde la ficha de
          la propiedad, y es lo que después pre-llena el reparto de la comisión.
        </p>
        <table v-else>
          <thead><tr><th>Código</th><th>Dirección</th><th>Operaciones</th></tr></thead>
          <tbody>
            <tr v-for="c in p.captadas" :key="c.id">
              <td class="mono cod">
                <RouterLink :to="`/propiedades/${c.id}`">{{ c.etiqueta }}</RouterLink>
              </td>
              <td>{{ c.direccion }}</td>
              <td>
                <span v-for="(o, i) in c.operaciones" :key="i" class="op">
                  {{ o.tipo }} · <span class="mono">{{ moneyCorto(o.precio, o.moneda) }}</span>
                </span>
                <span v-if="!c.operaciones.length" class="chica">sin operación</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── Contratos ──────────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>Contratos de sus captaciones · {{ p.contratos.length }}</h2>
        <p v-if="!p.contratos.length" class="nota">
          Todavía no se firmó ningún contrato sobre las propiedades que captó.
        </p>
        <table v-else>
          <thead>
            <tr><th>Propiedad</th><th>Desde</th><th>Hasta</th>
                <th class="der">Alquiler</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in p.contratos" :key="c.id">
              <td>
                <RouterLink :to="`/contratos/${c.id}`" class="mono cod">{{ c.etiqueta }}</RouterLink>
                <span class="dir">{{ c.direccion }}</span>
              </td>
              <td class="mono">{{ fecha(c.desde) }}</td>
              <td class="mono">{{ fecha(c.hasta) }}</td>
              <td class="der mono">{{ money(c.monto, c.moneda) }}</td>
              <td>
                <StatusChip :texto="c.estado" :tono="c.estado === 'vigente' ? 'ok' : 'neutro'" />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── Ventas ─────────────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>Ventas en las que participó · {{ p.ventas.length }}</h2>
        <p v-if="!p.ventas.length" class="nota">
          Ninguna venta le asignó todavía una parte de la comisión.
        </p>
        <table v-else>
          <thead>
            <tr><th>Propiedad</th><th class="der">Cierre</th><th>Estado</th><th>Escritura</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in p.ventas" :key="v.id">
              <td>
                <RouterLink :to="`/ventas/${v.id}`" class="mono cod">{{ v.etiqueta }}</RouterLink>
                <span class="dir">{{ v.direccion }}</span>
              </td>
              <td class="der mono">{{ money(v.precioCierre, v.moneda) }}</td>
              <td>
                <StatusChip
                  :texto="ETIQUETA_VENTA[v.estado] ?? v.estado"
                  :tono="v.estado === 'escriturada' ? 'ok' : v.estado === 'caida' ? 'err' : 'warn'" />
              </td>
              <td class="mono">{{ fecha(v.fechaEscritura) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── La inmobiliaria ────────────────────────────────────────────── -->
      <section class="card stack">
        <h2>La inmobiliaria · {{ auth.tenant?.nombre }}</h2>

        <div class="chips">
          <div>
            <span class="et">Ventas escrituradas</span>
            <span class="mono grande">{{ p.inmobiliaria.ventasCerradas }}</span>
          </div>
          <div>
            <span class="et">Contratos vigentes</span>
            <span class="mono grande">{{ p.inmobiliaria.contratosVigentes }}</span>
          </div>
          <div>
            <span class="et">Propiedades en cartera</span>
            <span class="mono grande">{{ p.inmobiliaria.propiedades }}</span>
          </div>
          <div v-for="o in p.inmobiliaria.operado" :key="o.moneda">
            <span class="et">Operado en {{ o.moneda }}</span>
            <span class="mono grande">{{ moneyCorto(o.total, o.moneda) }}</span>
            <span class="chica">{{ plural(o.operaciones, 'escritura', 'escrituras') }}</span>
          </div>
        </div>

        <template v-if="p.inmobiliaria.comisionesDeAgentes">
          <h3>Comisiones de todos los agentes</h3>
          <table>
            <thead><tr><th>Moneda</th><th>Estado</th><th class="der">Total</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in p.inmobiliaria.comisionesDeAgentes" :key="i">
                <td class="mono">{{ c.moneda }}</td>
                <td>
                  <StatusChip
                    :texto="ETIQUETA_ESTADO[c.estado] ?? c.estado"
                    :tono="TONO_ESTADO[c.estado] ?? 'neutro'" />
                </td>
                <td class="der mono">{{ money(c.total, c.moneda) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <p v-else class="nota bloqueado">{{ p.inmobiliaria.comisionesMotivo }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 78ch; line-height: 1.6; }
.chica { font-size: 11px; color: var(--muted-2); }
.bloqueado {
  padding: var(--s-sm) var(--s-md); background: var(--surface-2);
  border: 1px solid var(--line); border-radius: var(--r-md); color: var(--ink-2);
}
.chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--s-lg); }
.chips > div { display: flex; flex-direction: column; gap: 2px; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 20px; color: var(--ink); }
.hered { font-size: 11px; color: var(--muted-2); }
.propio { font-size: 11px; color: var(--accent-ink); }
.monedas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s-lg); }
.card.interna { background: var(--surface-2); }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding-bottom: var(--s-sm); }
/* El padding horizontal NO es estética: sin él «ARS 99.500,00» y «1 línea»
   quedan pegados y se leen como un solo número. */
td { padding: var(--s-sm) var(--s-md) var(--s-sm) 0; border-bottom: 1px solid var(--line); color: var(--ink-2); font-size: 13px; }
td:last-child { padding-right: 0; }
tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.cod { color: var(--muted); white-space: nowrap; }
.dir { display: block; font-size: 11px; color: var(--muted-2); }
.op { display: inline-block; margin-right: var(--s-md); font-size: 12px; }
</style>
