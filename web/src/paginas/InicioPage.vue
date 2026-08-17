<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { laCasa } from '../dominio/vocabulario';
import {
  ETIQUETA_ESTADO_OPORTUNIDAD,
  fecha,
  money,
  moneyCorto,
  numero,
  periodo as fmtPeriodo,
} from '../dominio/formato';

/**
 * Qué tengo que hacer hoy.
 *
 * Antes se entraba a Propiedades, que es un archivo: contesta "qué tengo", no
 * "qué tengo que hacer". Acá no hay gráficos decorativos (regla anti-slop de
 * DESIGN.md): son números y listas, y cada fila lleva a la pantalla donde se
 * resuelve.
 *
 * Los importes vienen del backend agrupados **por moneda** y se muestran así.
 * ARS y USD conviven en la misma cartera y sumarlos daría un número que no
 * significa nada.
 */

interface Importe { moneda: string; monto: number }

interface Inicio {
  vePlata: boolean;
  cartera: {
    propiedades: number; disponibles: number; contratosVigentes: number;
    /** `null` en una cuenta que también vende: ahí «vacía» no se lee sola. */
    unidadesVacias: number | null;
  };
  mes: { periodo: string; cobrado: Importe[]; porCobrar: Importe[] } | null;
  vencenEstaSemana: Array<{
    tipo: 'contrato' | 'cuota'; entidadId: string; contratoId: string; fecha: string;
    etiquetaPropiedad: string; referencia: string; monto: number | null; moneda: string;
  }>;
  ajustesPorConfirmar: {
    total: number;
    items: Array<{
      id: string; contratoId: string; vigenteDesde: string; etiquetaPropiedad: string;
      referencia: string; montoAnterior: number; montoNuevo: number; moneda: string;
      indiceTipo: string; vencido: boolean;
    }>;
  };
  impagas: {
    total: number; adeudado: Importe[];
    items: Array<{
      id: string; contratoId: string; venceEl: string; diasDeMora: number;
      etiquetaPropiedad: string; referencia: string; saldo: number; moneda: string;
      inquilino: string | null;
    }>;
  } | null;
  liquidacionesBorrador: { total: number; neto: Importe[]; periodoMasViejo: string | null } | null;
  /** `null` sin el módulo Leads. */
  oportunidadesFrias: {
    total: number; dias: number;
    items: Array<{ id: string; nombre: string; desdeHace: number; estado: string; origen: string }>;
  };
}

const ETIQUETA_INDICE: Record<string, string> = {
  ipc: 'IPC', icl: 'ICL', uva: 'UVA', icp: 'Casa Propia',
  porcentaje_fijo: '% fijo', ninguno: 'sin índice',
};
/*
 * ⚠️ Acá había un `ETIQUETA_ESTADO_OP` local, y NO era el de las operaciones
 * de una propiedad: eran los estados de una OPORTUNIDAD, con el nombre
 * equivocado y en un archivo que además importa de `formato.ts`. Un
 * buscar-y-reemplazar por ese nombre lo habría roto en silencio —los dos maps
 * son `Record<string, string>`, así que seguiría compilando y mostraría
 * «Alquilada» donde dice «Contactada»—.
 *
 * Se reemplaza por `ETIQUETA_ESTADO_OPORTUNIDAD`, que ya existía en
 * `formato.ts` y es superconjunto de los cinco estados que devuelve
 * `inicio.service.ts` (le agrega `ganada` y `perdida`).
 */

const auth = useAuth();
const d = ref<Inicio | null>(null);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    d.value = await api<Inicio>('/inicio');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el inicio.';
  } finally {
    cargando.value = false;
  }
}

/** El saludo usa el nombre de pila: el apellido en un saludo suena a formulario. */
function saludo(): string {
  const h = new Date().getHours();
  const momento = h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = auth.usuario?.nombre?.trim().split(/\s+/)[0];
  return nombre ? `${momento}, ${nombre}` : momento;
}

/** Varias monedas se muestran una debajo de la otra, nunca sumadas. */
function importes(lista: Importe[] | undefined): Importe[] {
  return lista?.length ? lista : [];
}

/**
 * El enlace a Liquidaciones abre en el período donde están los borradores, no
 * en el mes corriente. La regla, que vale para todos los bloques de acá:
 * **ningún contador puede llevar a una pantalla que muestre menos de lo que el
 * contador prometió.**
 */
function linkLiquidaciones(b: { periodoMasViejo: string | null }) {
  const query: Record<string, string> = { estado: 'borrador' };
  if (b.periodoMasViejo) query.periodo = b.periodoMasViejo.slice(0, 7);
  return { path: '/liquidaciones', query };
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader :titulo="saludo()" :bajada="cargando ? '' : 'Esto es lo que hay para resolver.'">
      <template #acciones>
        <button class="btn secondary" type="button" :disabled="cargando" @click="cargar">
          Actualizar
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="5" :alto="72" />

    <template v-else-if="d">
      <!-- ── Los números de arriba ──────────────────────────────────────── -->
      <div class="cifras">
        <RouterLink class="cifra" to="/propiedades">
          <span class="et">En cartera</span>
          <span class="n mono">{{ numero(d.cartera.propiedades) }}</span>
          <span class="pie">{{ numero(d.cartera.disponibles) }} disponibles</span>
        </RouterLink>

        <RouterLink class="cifra" to="/contratos">
          <span class="et">Contratos vigentes</span>
          <span class="n mono">{{ numero(d.cartera.contratosVigentes) }}</span>
          <span class="pie">alquileres activos</span>
        </RouterLink>

        <!-- Sólo para quien no vende: una unidad vacía es un mes que no cobra.
             Quien además vende ya tiene su cartera partida en el menú. -->
        <RouterLink
          v-if="d.cartera.unidadesVacias !== null"
          class="cifra"
          to="/propiedades/alquiler"
        >
          <span class="et">Unidades vacías</span>
          <span class="n mono">{{ numero(d.cartera.unidadesVacias) }}</span>
          <span class="pie">sin contrato vigente</span>
        </RouterLink>

        <template v-if="d.mes">
          <RouterLink class="cifra" to="/liquidaciones">
            <span class="et">Cobrado en {{ fmtPeriodo(d.mes.periodo) }}</span>
            <span v-if="!importes(d.mes.cobrado).length" class="n mono vacio">—</span>
            <span
              v-for="i in importes(d.mes.cobrado)"
              :key="i.moneda"
              class="n mono"
            >{{ moneyCorto(i.monto, i.moneda) }}</span>
            <span class="pie">lo que entró este mes</span>
          </RouterLink>

          <RouterLink class="cifra" to="/vencimientos">
            <span class="et">Por cobrar</span>
            <span v-if="!importes(d.mes.porCobrar).length" class="n mono vacio">—</span>
            <span
              v-for="i in importes(d.mes.porCobrar)"
              :key="i.moneda"
              class="n mono"
            >{{ moneyCorto(i.monto, i.moneda) }}</span>
            <span class="pie">cuotas del mes sin saldar</span>
          </RouterLink>
        </template>

        <!--
          Honestidad: en vez de mostrar cero, se dice que no corresponde verlo.
          Un cero acá sería un número falso en una pantalla de plata.
        -->
        <div v-else class="cifra sin-permiso">
          <span class="et">Cobranzas</span>
          <span class="n mono vacio">—</span>
          <span class="pie">Tu rol no accede a los montos de {{ laCasa(auth.tipoCuenta) }}.</span>
        </div>
      </div>

      <div class="bloques">
        <!-- ── Aumentos por confirmar ─────────────────────────────────── -->
        <section class="card bloque">
          <header>
            <h2>Aumentos por confirmar</h2>
            <StatusChip
              v-if="d.ajustesPorConfirmar.total"
              :texto="String(d.ajustesPorConfirmar.total)"
              :tono="d.ajustesPorConfirmar.items.some((a) => a.vencido) ? 'err' : 'warn'"
            />
          </header>

          <p v-if="!d.ajustesPorConfirmar.total" class="nada">
            Ninguno esperando. Los que se proyecten aparecen acá con su cálculo.
          </p>

          <ul v-else class="lista">
            <li v-for="a in d.ajustesPorConfirmar.items" :key="a.id">
              <RouterLink :to="`/contratos/${a.contratoId}`">
                <span class="linea1">
                  <span class="mono cod">{{ a.etiquetaPropiedad }}</span>
                  <span class="ref">{{ a.referencia }}</span>
                </span>
                <span class="linea2 mono">
                  {{ money(a.montoAnterior, a.moneda) }} → <b>{{ money(a.montoNuevo, a.moneda) }}</b>
                  · {{ ETIQUETA_INDICE[a.indiceTipo] ?? a.indiceTipo }}
                </span>
              </RouterLink>
              <StatusChip
                :texto="a.vencido ? `Rige desde ${fecha(a.vigenteDesde)}` : fecha(a.vigenteDesde)"
                :tono="a.vencido ? 'err' : 'warn'"
              />
            </li>
          </ul>

          <RouterLink
            v-if="d.ajustesPorConfirmar.total > d.ajustesPorConfirmar.items.length"
            class="ver-todo"
            to="/vencimientos"
          >
            Ver los {{ d.ajustesPorConfirmar.total }}
          </RouterLink>
        </section>

        <!-- ── Cuotas impagas ─────────────────────────────────────────── -->
        <section v-if="d.impagas" class="card bloque">
          <header>
            <h2>Cuotas impagas</h2>
            <span v-for="i in importes(d.impagas.adeudado)" :key="i.moneda" class="mono deuda">
              {{ moneyCorto(i.monto, i.moneda) }}
            </span>
          </header>

          <p v-if="!d.impagas.total" class="nada">Nada en mora. Está todo al día.</p>

          <ul v-else class="lista">
            <li v-for="c in d.impagas.items" :key="c.id">
              <RouterLink :to="`/contratos/${c.contratoId}`">
                <span class="linea1">
                  <span class="mono cod">{{ c.etiquetaPropiedad }}</span>
                  <span class="ref">{{ c.inquilino ?? c.referencia }}</span>
                </span>
                <span class="linea2 mono">
                  Saldo <b>{{ money(c.saldo, c.moneda) }}</b> · vencía el {{ fecha(c.venceEl) }}
                </span>
              </RouterLink>
              <StatusChip :texto="`${c.diasDeMora} d de mora`" tono="err" />
            </li>
          </ul>

          <RouterLink
            v-if="d.impagas.total > d.impagas.items.length"
            class="ver-todo"
            to="/vencimientos"
          >
            Ver las {{ d.impagas.total }}
          </RouterLink>
        </section>

        <!-- ── Vence esta semana ──────────────────────────────────────── -->
        <section class="card bloque">
          <header>
            <h2>Vence esta semana</h2>
          </header>

          <p v-if="!d.vencenEstaSemana.length" class="nada">
            Nada vence en los próximos siete días.
          </p>

          <ul v-else class="lista">
            <li v-for="v in d.vencenEstaSemana" :key="`${v.tipo}-${v.entidadId}`">
              <RouterLink :to="`/contratos/${v.contratoId}`">
                <span class="linea1">
                  <span class="mono cod">{{ v.etiquetaPropiedad }}</span>
                  <span class="ref">{{ v.referencia }}</span>
                </span>
                <span class="linea2 mono">
                  {{ v.tipo === 'contrato' ? 'Termina el contrato' : 'Vence la cuota' }}
                  <template v-if="v.monto !== null"> · {{ money(v.monto, v.moneda) }}</template>
                </span>
              </RouterLink>
              <StatusChip :texto="fecha(v.fecha)" tono="warn" />
            </li>
          </ul>
        </section>

        <!-- ── Liquidaciones en borrador ──────────────────────────────── -->
        <section v-if="d.liquidacionesBorrador" class="card bloque compacto">
          <header>
            <h2>Liquidaciones sin cerrar</h2>
            <StatusChip
              v-if="d.liquidacionesBorrador.total"
              :texto="String(d.liquidacionesBorrador.total)"
              tono="warn"
            />
          </header>

          <p v-if="!d.liquidacionesBorrador.total" class="nada">
            No hay borradores. Lo del mes está cerrado.
          </p>

          <template v-else>
            <p class="neto">
              <span
                v-for="i in importes(d.liquidacionesBorrador.neto)"
                :key="i.moneda"
                class="mono"
              >{{ money(i.monto, i.moneda) }}</span>
              <span class="pie">a rendir a propietarios</span>
            </p>
            <!--
              El enlace lleva el período del borrador más viejo y el filtro.
              Sin eso caía en el mes corriente y mostraba "Sin liquidaciones",
              con los borradores en otro mes: el contador prometía dos y el
              destino mostraba cero.
            -->
            <RouterLink class="ver-todo" :to="linkLiquidaciones(d.liquidacionesBorrador)">
              Revisar y cerrar
            </RouterLink>
          </template>
        </section>

        <!-- ── Leads fríos ────────────────────────────────────── -->
        <!-- Sin el módulo no hay embudo, y una tarjeta que nunca tiene nada
             enseña a ignorar la pantalla entera. -->
        <section v-if="d.oportunidadesFrias" class="card bloque compacto">
          <header>
            <h2>Consultas sin mover</h2>
            <StatusChip
              v-if="d.oportunidadesFrias.total"
              :texto="String(d.oportunidadesFrias.total)"
              tono="warn"
            />
          </header>

          <p v-if="!d.oportunidadesFrias.total" class="nada">
            Ninguna quieta hace más de {{ d.oportunidadesFrias.dias }} días.
          </p>

          <ul v-else class="lista">
            <li v-for="o in d.oportunidadesFrias.items" :key="o.id">
              <RouterLink to="/leads">
                <span class="linea1"><span class="ref">{{ o.nombre }}</span></span>
                <span class="linea2 mono">
                  {{ ETIQUETA_ESTADO_OPORTUNIDAD[o.estado] ?? o.estado }} · entró por {{ o.origen }}
                </span>
              </RouterLink>
              <StatusChip :texto="`${o.desdeHace} d`" tono="warn" />
            </li>
          </ul>

          <RouterLink
            v-if="d.oportunidadesFrias.total > d.oportunidadesFrias.items.length"
            class="ver-todo"
            to="/leads"
          >
            Ver las {{ d.oportunidadesFrias.total }}
          </RouterLink>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Los números de arriba ─────────────────────────────────────────────── */
.cifras {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--s-md);
}
.cifra {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--s-lg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-1);
  text-decoration: none;
  color: inherit;
  transition: border-color var(--t-micro), background var(--t-micro);
}
a.cifra:hover { border-color: var(--line-strong); background: var(--surface-2); }
.cifra.sin-permiso { opacity: .75; }

.cifra .et {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--muted);
}
.cifra .n {
  /* `ARS 485.000` partido en dos renglones se lee como dos datos distintos. El
     importe y su moneda son una sola cosa, así que no se cortan: el tamaño cede
     antes que la línea. */
  font-size: clamp(17px, 4.6vw, 24px);
  line-height: 1.2;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cifra .n.vacio { color: var(--muted-2); }
.cifra .pie { margin-top: 2px; font-size: 12px; color: var(--muted); }

/* ── Bloques ───────────────────────────────────────────────────────────── */
.bloques {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: var(--s-lg);
  align-items: start;
}
.bloque { padding: 0; overflow: hidden; }
.bloque > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-md);
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.bloque h2 {
  margin: 0;
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 500;
  color: var(--ink);
}
.deuda { font-size: 13px; color: var(--danger); }

.nada {
  margin: 0;
  padding: var(--s-lg);
  font-size: 13px;
  color: var(--muted);
}

.lista li {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-sm) var(--s-lg);
  border-bottom: 1px solid var(--line);
}
.lista li > a {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-decoration: none;
  color: inherit;
  padding: var(--s-xs) 0;
}
.lista li:hover { background: var(--surface-2); }

.linea1 { display: flex; align-items: baseline; gap: var(--s-sm); min-width: 0; }
.cod { font-size: 11px; color: var(--muted); flex: none; }
.ref {
  color: var(--ink);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.linea2 { font-size: 12px; color: var(--muted); }
.linea2 b { color: var(--ink-2); font-weight: 600; }

.neto {
  margin: 0;
  padding: var(--s-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.neto .mono { font-size: 20px; color: var(--ink); }
.neto .pie { font-size: 12px; color: var(--muted); }

.ver-todo {
  display: block;
  padding: var(--s-md) var(--s-lg);
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
}
.ver-todo:hover { background: var(--surface-2); }

@media (max-width: 560px) {
  .bloques { grid-template-columns: 1fr; }
  .cifras { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }

  /* En pantalla angosta el chip baja: al lado, exprime el texto de la fila hasta
     que "Arístides Villanueva 345" queda en "Arístides Vil…". */
  .lista li { flex-direction: column; align-items: flex-start; gap: var(--s-xs); }
  .lista li > a { width: 100%; }
}
</style>
