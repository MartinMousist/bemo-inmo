<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import StatusChip from '../componentes/StatusChip.vue';
import { fecha, money } from '../dominio/formato';

/**
 * Los garantes de un contrato: quiénes son, qué presentaron y qué dice el BCRA.
 *
 * Una inmobiliaria no alquila contra un nombre. Alquila contra dos o tres
 * personas con recibo de sueldo, sus documentos sobre la mesa y la certeza de
 * que no arrastran una deuda — y eso era una carpeta de papel y un WhatsApp con
 * fotos.
 *
 * Tres cosas que esta pantalla no hace y son a propósito:
 *
 * **No dice «apto» hasta que alguien consulte.** Sin consulta el chip dice «sin
 * verificar», que es distinto de «rechazado». Un legajo que nadie miró y uno
 * que dio mal no se pueden ver igual.
 *
 * **No esconde por qué.** Cuando el BCRA lo rechaza se muestra la entidad, la
 * situación y el monto: quien atiende tiene que poder explicárselo al inquilino
 * que trajo a ese garante.
 *
 * **No bloquea el contrato.** Informa lo que falta. Los contratos que ya
 * estaban cargados se hicieron sin esto, y un sistema que se niega a
 * representar la realidad que tiene enfrente no sirve.
 */

const props = defineProps<{ contratoId: string }>();
const ui = useUi();

interface Documento {
  id: string; tipo: string; etiqueta: string; url: string;
  nombreOriginal: string | null; subidoEl: string;
}

interface EntidadBcra {
  entidad: string; situacion: number; monto: number; diasAtrasoPago: number;
}

interface Garante {
  id: string;
  nombre: string;
  documento: string | null;
  detalle: string | null;
  firmoEl: string | null;
  bcra: {
    consultado: boolean;
    cuit: string | null;
    denominacion: string | null;
    situacion: number | null;
    situacionTexto: string | null;
    periodo: string | null;
    consultadoEl: string | null;
    apto: boolean | null;
    motivo: string | null;
    entidades: EntidadBcra[];
    advertencias: string[];
  };
  documentos: Documento[];
  faltan: string[];
  legajoCompleto: boolean;
}

interface Verificacion {
  garantes: number; aptos: number; minimo: number;
  enRegla: boolean; pendientes: string[];
}

/** El orden en que se piden sobre el mostrador. */
const CASILLEROS = [
  { tipo: 'dni_frente', etiqueta: 'DNI · frente' },
  { tipo: 'dni_dorso', etiqueta: 'DNI · dorso' },
  { tipo: 'recibo_1', etiqueta: 'Recibo 1' },
  { tipo: 'recibo_2', etiqueta: 'Recibo 2' },
  { tipo: 'recibo_3', etiqueta: 'Recibo 3' },
] as const;

const garantes = ref<Garante[]>([]);
const verificacion = ref<Verificacion | null>(null);
const personas = ref<Array<{ id: string; nombreCompleto: string }>>([]);
const nuevaPersona = ref('');
const cargando = ref(true);
const error = ref('');
const consultando = ref<string | null>(null);
const subiendo = ref<string | null>(null);
const abierto = ref<string | null>(null);

const disponibles = computed(() => {
  const yaEstan = new Set(garantes.value.map((g) => g.nombre));
  return personas.value.filter((p) => !yaEstan.has(p.nombreCompleto));
});

function docDe(g: Garante, tipo: string): Documento | undefined {
  return g.documentos.find((d) => d.tipo === tipo);
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [gs, v, ps] = await Promise.all([
      api<Garante[]>(`/contratos/${props.contratoId}/garantes`),
      api<Verificacion>(`/contratos/${props.contratoId}/garantes/verificacion`),
      api<{ items: Array<{ id: string; nombreCompleto: string }> }>('/personas?porPagina=100'),
    ]);
    garantes.value = gs; verificacion.value = v; personas.value = ps.items;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los garantes.';
  } finally { cargando.value = false; }
}

async function agregar() {
  if (!nuevaPersona.value) return;
  try {
    await api(`/contratos/${props.contratoId}/garantes`, {
      method: 'POST',
      body: JSON.stringify({ personaId: nuevaPersona.value }),
    });
    nuevaPersona.value = '';
    await cargar();
  } catch (e) {
    ui.error('No se pudo agregar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

async function consultarBcra(g: Garante) {
  consultando.value = g.id;
  try {
    const r = await api<Garante>(`/garantes/${g.id}/bcra`, { method: 'POST' });
    abierto.value = g.id;
    await cargar();
    if (r.bcra.apto) ui.ok(`${g.nombre}: apto`, r.bcra.motivo ?? undefined);
    else ui.error(`${g.nombre}: no apto`, r.bcra.motivo ?? undefined);
  } catch (e) {
    ui.error('No se pudo consultar el BCRA', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { consultando.value = null; }
}

/**
 * El archivo va en base64, igual que las fotos de una propiedad. La foto de un
 * DNI sacada con el teléfono pasa los 3 MB sin esfuerzo, y por eso esa ruta
 * tiene su propio límite de body.
 */
async function subir(g: Garante, tipo: string, ev: Event) {
  const input = ev.target as HTMLInputElement;
  const archivo = input.files?.[0];
  if (!archivo) return;

  subiendo.value = `${g.id}:${tipo}`;
  try {
    const datos = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });

    await api(`/garantes/${g.id}/documentos`, {
      method: 'POST',
      body: JSON.stringify({ tipo, datos, nombre: archivo.name }),
    });
    await cargar();
  } catch (e) {
    ui.error('No se pudo subir', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    subiendo.value = null;
    input.value = '';
  }
}

async function firmo(g: Garante) {
  try {
    await api(`/garantes/${g.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ firmoEl: new Date().toISOString().slice(0, 10) }),
    });
    await cargar();
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

async function quitar(g: Garante) {
  if (!(await ui.confirmar({
    titulo: `¿Quitar a ${g.nombre} como garante?`,
    detalle: 'Se borran también sus documentos. No se puede deshacer.',
    confirmar: 'Quitar',
    peligroso: true,
  }))) return;

  try {
    await api(`/garantes/${g.id}`, { method: 'DELETE' });
    await cargar();
  } catch (e) {
    ui.error('No se pudo quitar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

onMounted(cargar);
</script>

<template>
  <section class="card stack">
    <header class="cabecera">
      <h2>Garantes</h2>
      <StatusChip
        v-if="verificacion"
        :texto="verificacion.enRegla
          ? `${verificacion.aptos} en regla`
          : `${verificacion.aptos} de ${verificacion.minimo} en regla`"
        :tono="verificacion.enRegla ? 'ok' : 'warn'" />
    </header>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <ul v-if="verificacion && verificacion.pendientes.length" class="pendientes">
      <li v-for="p in verificacion.pendientes" :key="p">{{ p }}</li>
    </ul>

    <p v-if="!cargando && !garantes.length" class="vacio">
      Este contrato no tiene garantes cargados. Se piden {{ verificacion?.minimo ?? 2 }}
      con recibo de sueldo.
    </p>

    <article v-for="g in garantes" :key="g.id" class="garante">
      <header class="fila">
        <div class="quien">
          <strong>{{ g.nombre }}</strong>
          <span v-if="g.documento" class="mono doc">DNI {{ g.documento }}</span>
        </div>

        <StatusChip
          v-if="!g.bcra.consultado"
          texto="Sin verificar" tono="warn" />
        <StatusChip
          v-else-if="g.bcra.apto"
          :texto="`BCRA situación ${g.bcra.situacion}`" tono="ok" />
        <StatusChip
          v-else
          :texto="`BCRA situación ${g.bcra.situacion}`" tono="err" />

        <StatusChip
          :texto="g.legajoCompleto ? 'Legajo completo' : `Faltan ${g.faltan.length}`"
          :tono="g.legajoCompleto ? 'ok' : 'warn'" />

        <StatusChip
          :texto="g.firmoEl ? `Firmó ${fecha(g.firmoEl)}` : 'Sin firmar'"
          :tono="g.firmoEl ? 'ok' : 'warn'" />

        <div class="acciones">
          <button class="btn secondary sm" type="button"
            :disabled="consultando === g.id" @click="consultarBcra(g)">
            {{ consultando === g.id ? 'Consultando…' : 'Consultar BCRA' }}
          </button>
          <button v-if="!g.firmoEl" class="btn secondary sm" type="button" @click="firmo(g)">
            Firmó
          </button>
          <button class="btn secondary sm" type="button" @click="quitar(g)">Quitar</button>
        </div>
      </header>

      <p v-if="g.bcra.consultado" class="veredicto" :class="{ mal: g.bcra.apto === false }">
        {{ g.bcra.motivo }}
        <span class="cuando">
          · {{ g.bcra.denominacion }} · CUIL {{ g.bcra.cuit }}
          · consultado el {{ fecha(g.bcra.consultadoEl) }}
        </span>
      </p>

      <ul v-if="g.bcra.advertencias.length" class="advertencias">
        <li v-for="a in g.bcra.advertencias" :key="a">{{ a }}</li>
      </ul>

      <details v-if="g.bcra.entidades.length" @toggle="abierto = null">
        <summary>Detalle del BCRA · {{ g.bcra.entidades.length }} entidad(es)</summary>
        <table class="entidades">
          <thead>
            <tr><th>Entidad</th><th>Situación</th><th>Deuda informada</th><th>Atraso</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in g.bcra.entidades" :key="e.entidad">
              <td>{{ e.entidad }}</td>
              <td>{{ e.situacion }}</td>
              <td class="num">{{ money(e.monto, 'ARS') }}</td>
              <td class="num">{{ e.diasAtrasoPago }} días</td>
            </tr>
          </tbody>
        </table>
      </details>

      <div class="casilleros">
        <div v-for="c in CASILLEROS" :key="c.tipo" class="casillero"
          :class="{ cargado: !!docDe(g, c.tipo) }">
          <a v-if="docDe(g, c.tipo)" :href="docDe(g, c.tipo)!.url" target="_blank"
            rel="noopener" class="miniatura">
            <img :src="docDe(g, c.tipo)!.url" :alt="c.etiqueta" loading="lazy" />
          </a>
          <span v-else class="hueco" aria-hidden="true">+</span>

          <label class="pie">
            <span>{{ c.etiqueta }}</span>
            <input type="file" accept="image/*" :disabled="subiendo === `${g.id}:${c.tipo}`"
              @change="subir(g, c.tipo, $event)" />
          </label>
        </div>
      </div>
    </article>

    <form class="agregar" @submit.prevent="agregar">
      <label class="campo"><span>Agregar garante</span>
        <select v-model="nuevaPersona">
          <option value="">Elegí una persona…</option>
          <option v-for="p in disponibles" :key="p.id" :value="p.id">{{ p.nombreCompleto }}</option>
        </select>
      </label>
      <button class="btn secondary" type="submit" :disabled="!nuevaPersona">Agregar</button>
    </form>
  </section>
</template>

<style scoped>
.cabecera { display: flex; align-items: center; gap: var(--s-md); }
.cabecera h2 { margin: 0; }
.pendientes { margin: 0; padding-left: 1.2em; font-size: 13px; color: var(--warning); line-height: 1.7; }
.vacio { margin: 0; font-size: 13px; color: var(--muted); }
.garante { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s-md); display: flex; flex-direction: column; gap: var(--s-md); }
.fila { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.quien { display: flex; flex-direction: column; margin-right: auto; }
.doc { font-size: 12px; color: var(--muted); }
.acciones { display: flex; gap: var(--s-xs); flex-wrap: wrap; }
.veredicto { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.veredicto.mal { color: var(--danger); }
.cuando { color: var(--muted); font-size: 12px; }
.advertencias { margin: 0; padding-left: 1.2em; font-size: 12px; color: var(--warning); }
.entidades { width: 100%; border-collapse: collapse; margin-top: var(--s-sm); font-size: 13px; }
.entidades th, .entidades td { padding: var(--s-xs) var(--s-sm); text-align: left; border-bottom: 1px solid var(--line); }
.entidades thead th { font-size: 12px; color: var(--muted); font-weight: 500; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.casilleros { display: flex; gap: var(--s-sm); flex-wrap: wrap; }
.casillero { width: 116px; border: 1px dashed var(--line); border-radius: var(--r-sm); overflow: hidden; display: flex; flex-direction: column; }
.casillero.cargado { border-style: solid; }
.miniatura, .hueco { display: flex; align-items: center; justify-content: center; height: 78px; background: var(--surface-2); }
.miniatura img { width: 100%; height: 100%; object-fit: cover; }
.hueco { color: var(--muted); font-size: 20px; }
.pie { display: block; padding: var(--s-xs) var(--s-sm); font-size: 11px; color: var(--ink-2); cursor: pointer; }
.pie input { display: block; width: 100%; font-size: 10px; margin-top: 2px; }
.agregar { display: flex; align-items: flex-end; gap: var(--s-sm); }
.agregar .campo { flex: 1; max-width: 340px; }
</style>
