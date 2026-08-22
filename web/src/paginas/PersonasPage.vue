<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { filtrosEnUrl } from '../dominio/filtros';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

interface Persona {
  id: string; nombreCompleto: string; docTipo: string | null; docNumero: string | null;
  email: string | null; telefono: string | null; roles: string[];
  semaforo: { estado: string; motivo: string | null; por: string | null; el: string | null };
}

/**
 * El semáforo, como lo dibuja la lista.
 *
 * `sin_marcar` NO está: un chip gris que diga «sin marcar» en las cuatrocientas
 * personas de la cartera es ruido puro. Se muestra la excepción, que es para lo
 * que sirve.
 */
const SEMAFORO: Record<string, { texto: string; tono: 'ok' | 'warn' | 'err' }> = {
  recomendado: { texto: 'Recomendado', tono: 'ok' },
  con_reparos: { texto: 'Con reparos', tono: 'warn' },
  no_alquilar: { texto: 'No alquilar', tono: 'err' },
};

type ConteoRoles = Record<string, number>;

/**
 * Los roles derivados, en el orden en que se muestran.
 *
 * Los `ex_` van pegados al rol del que salen: quien lee la lista busca
 * «inquilinos» y ahí al lado encuentra «ex inquilinos», que es la pregunta
 * siguiente.
 */
const ROLES = [
  'propietario', 'inquilino', 'ex_inquilino', 'garante', 'ex_garante',
  'comprador', 'interesado', 'reservante',
] as const;
type Rol = (typeof ROLES)[number];

const ETIQUETA_ROL: Record<string, string> = {
  propietario: 'Propietario', inquilino: 'Inquilino', ex_inquilino: 'Ex inquilino',
  garante: 'Garante', ex_garante: 'Ex garante',
  comprador: 'Comprador', interesado: 'Interesado', reservante: 'Reservó',
};

/** El plural de la pestaña. «Reservó» no pluraliza como los demás. */
const PESTANA: Record<Rol, string> = {
  propietario: 'Propietarios', inquilino: 'Inquilinos', ex_inquilino: 'Ex inquilinos',
  garante: 'Garantes', ex_garante: 'Ex garantes',
  comprador: 'Compradores', interesado: 'Interesados', reservante: 'Reservaron',
};

/** Los roles que además tienen pantalla propia, y adónde va cada una. */
const PANTALLA_PROPIA: Partial<Record<Rol, { a: string; texto: string }>> = {
  propietario: { a: '/propietarios', texto: 'Ver la pantalla de Propietarios' },
  inquilino: { a: '/inquilinos', texto: 'Ver la pantalla de Inquilinos' },
  garante: { a: '/garantes', texto: 'Ver la pantalla de Garantes' },
  interesado: { a: '/leads', texto: 'Ver la pantalla de Leads' },
};

/**
 * El vacío de cada pestaña dice cómo se carga ESE rol.
 *
 * Un «no hay nada» genérico en una pestaña que el usuario acaba de abrir no le
 * dice nada: los roles se derivan, así que no hay ningún botón «nuevo garante»
 * que apretar y hay que explicar de dónde salen.
 */
const VACIO_ROL: Record<Rol, string> = {
  propietario: 'Una persona es propietaria cuando figura como titular de una propiedad. Se carga desde la ficha de la propiedad.',
  inquilino: 'Una persona es inquilina cuando figura como locataria de un contrato EN CURSO. Cuando el contrato termina, pasa a Ex inquilinos.',
  ex_inquilino: 'Acá van quienes alquilaron y ya no: su contrato terminó o se rescindió. Se les puede volver a alquilar — para eso está la marca.',
  garante: 'Los garantes se cargan desde el legajo de cada contrato de alquiler en curso.',
  ex_garante: 'Quienes garantizaron un contrato que ya terminó.',
  comprador: 'Una persona es compradora cuando figura como tal en una operación de venta que no se cayó.',
  interesado: 'Los interesados aparecen solos al cargar un lead.',
  reservante: 'Una persona reservó cuando tiene una reserva activa sobre una operación.',
};

const router = useRouter();
const route = useRoute();

/**
 * `rol`, `q` y `pagina` viajan en la URL; sólo `rol` se recuerda.
 *
 * El texto del buscador se puede compartir en un enlace y no se guarda: ver la
 * regla 4 de `dominio/filtros.ts`. Y el cambio de pestaña navega con `push`,
 * porque «atrás» tiene que volver a la pestaña anterior.
 */
const { valores: filtros } = filtrosEnUrl(
  'personas',
  { rol: '', q: '', pagina: '1' },
  {
    router,
    queryInicial: route.query as Record<string, string>,
    enUrl: ['rol', 'q', 'pagina'],
    noRecordar: ['q', 'pagina'],
    conHistorial: ['rol'],
  },
  { rol: ROLES },
);

const items = ref<Persona[]>([]);
const total = ref(0);
const cargando = ref(true);
const error = ref('');

/**
 * `null` mientras no llegó, NO cero.
 *
 * Es la lección de 11.1: Vencimientos mostraba «0» cuando en realidad no había
 * cargado, y un cero es una afirmación. Mientras esto es `null`, las pestañas
 * van sin número.
 */
const conteos = ref<ConteoRoles | null>(null);

const rolActivo = computed(() => (filtros.value.rol || null) as Rol | null);
const pantallaPropia = computed(() =>
  rolActivo.value ? PANTALLA_PROPIA[rolActivo.value] : undefined,
);

// Alta inline: si la búsqueda parece un documento y no hay resultados, se ofrece
// crear la persona ahí mismo con el número ya cargado.
const pareceDocumento = ref(false);
const creando = ref(false);
const nuevoNombre = ref('');

const bajada = computed(() => {
  if (cargando.value) return '';
  const q = filtros.value.q.trim();
  const rol = rolActivo.value;

  // «3 de 1.500 inquilinos»: la pestaña cuenta el alcance, esto cuenta lo
  // filtrado. Son dos números distintos a propósito y esta línea es donde se
  // explica la diferencia.
  if (rol) {
    const alcance = conteos.value?.[rol];
    const nombre = PESTANA[rol].toLowerCase();
    if (q && alcance !== undefined) return `${total.value} de ${alcance} ${nombre}`;
    return `${total.value} ${nombre}`;
  }
  return q ? `${total.value} de ${conteos.value?.todas ?? '…'} personas` : `${total.value} registradas`;
});

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const params = new URLSearchParams({ porPagina: '50' });
    if (filtros.value.q.trim()) params.set('q', filtros.value.q.trim());
    if (filtros.value.rol) params.set('rol', filtros.value.rol);
    const r = await api<{ items: Persona[]; total: number }>(`/personas?${params}`);
    items.value = r.items; total.value = r.total;
    pareceDocumento.value = /^\d{7,9}$/.test(filtros.value.q.trim()) && r.items.length === 0;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las personas.';
  } finally { cargando.value = false; }
}

/**
 * Los conteos se piden al montar y después de un alta. **Nunca por tecla**: no
 * dependen del buscador (ver el comentario de `conteoPorRol()` en la API).
 *
 * Y si fallan, la pantalla sigue: las pestañas quedan sin número y el filtro
 * anda igual. El listado no depende del conteo.
 */
async function cargarConteos() {
  try { conteos.value = await api<ConteoRoles>('/personas/conteo-roles'); }
  catch { conteos.value = null; }
}

let deb: ReturnType<typeof setTimeout> | undefined;
watch(() => filtros.value.q, () => { clearTimeout(deb); deb = setTimeout(cargar, 220); });
watch(() => filtros.value.rol, cargar);

function irA(rol: Rol | '') {
  filtros.value = { ...filtros.value, rol, pagina: '1' };
}

async function crearInline() {
  try {
    await api('/personas', {
      method: 'POST',
      body: JSON.stringify({
        nombre: nuevoNombre.value, docTipo: 'dni', docNumero: filtros.value.q.trim(),
      }),
    });
    creando.value = false; nuevoNombre.value = '';
    filtros.value = { ...filtros.value, q: '' };
    await Promise.all([cargar(), cargarConteos()]);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo crear.';
  }
}

async function exportar() {
  error.value = '';
  try {
    // El filtro visible viaja con la descarga: «Exportar» desde la pestaña
    // Propietarios baja propietarios. Un botón que ignora el filtro que se ve
    // es peor que no tenerlo, porque el archivo parece correcto.
    const p = filtros.value.rol ? `?rol=${filtros.value.rol}` : '';
    await descargar(`/exportar/personas.csv${p}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.';
  }
}

onMounted(() => { void cargar(); void cargarConteos(); });

/**
 * Marcar a una persona.
 *
 * ── Por qué acá y no en una ficha ──
 *
 * No hay ficha de persona: la lista ES la pantalla. Y el momento en que uno
 * quiere marcar a alguien es justo cuando lo está mirando en la lista después
 * de que pasó algo, no navegando a un detalle.
 */
const auth = useAuth();
const ui = useUi();
const esJefe = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

const marcando = ref<Persona | null>(null);
const nuevoEstado = ref('sin_marcar');
const nuevoMotivo = ref('');
const guardandoSemaforo = ref(false);

const OPCIONES_SEMAFORO = [
  { v: 'recomendado', t: 'Recomendado', d: 'Pagó en fecha y cuidó la propiedad. Le volveríamos a alquilar.' },
  { v: 'con_reparos', t: 'Con reparos', d: 'Se puede, pero hay algo que la próxima hay que mirar.' },
  { v: 'no_alquilar', t: 'No alquilar', d: 'No le volveríamos a alquilar. Queda escrito por qué.' },
  { v: 'sin_marcar', t: 'Sacar la marca', d: 'Vuelve a quedar sin nota.' },
];

function abrirSemaforo(f: Persona) {
  marcando.value = f;
  nuevoEstado.value = f.semaforo?.estado ?? 'sin_marcar';
  nuevoMotivo.value = f.semaforo?.motivo ?? '';
}

async function guardarSemaforo() {
  if (!marcando.value) return;
  guardandoSemaforo.value = true;
  try {
    await api(`/personas/${marcando.value.id}/semaforo`, {
      method: 'PATCH',
      body: JSON.stringify({
        estado: nuevoEstado.value,
        motivo: nuevoMotivo.value.trim() || undefined,
      }),
    });
    marcando.value = null;
    await cargar();
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { guardandoSemaforo.value = false; }
}
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Personas" :bajada="bajada">
      <template #acciones>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/personas/nueva">Nueva persona</RouterLink>
      </template>
    </PageHeader>

    <!--
      La fila de pestañas, con la anatomía de la fila de portales de
      PublicacionesPage: `.segmented.scroll` para que en pantalla angosta
      scrollee en vez de empujar el ancho de la página.

      Tres diferencias con aquella fila:
      · `aria-pressed` en vez de `:class="activo"`. familia.css estiliza las dos
        formas y `aria-pressed` es la que ANUNCIA el estado: el lector dice
        «Inquilinos 17, botón, presionado».
      · El conteo va DENTRO del botón y SIN `aria-hidden`, por lo mismo.
      · Mientras el conteo no llegó, la pestaña va sin número. Nunca un 0.
      · Una pestaña en 0 NO se oculta ni se deshabilita: esconderla hace saltar
        la fila y deshabilitarla la saca del recorrido de teclado, que es
        sacarle la información a quien más la necesita. Queda clicable, con su
        0 y su vacío explicando de dónde sale ese rol.
    -->
    <div class="segmented scroll" role="group" aria-label="Filtrar por rol">
      <button type="button" :aria-pressed="!filtros.rol" @click="irA('')">
        Todas
        <span v-if="conteos" class="conteo">{{ conteos.todas }}</span>
      </button>
      <button
        v-for="r in ROLES"
        :key="r"
        type="button"
        :aria-pressed="filtros.rol === r"
        @click="irA(r)"
      >
        {{ PESTANA[r] }}
        <span v-if="conteos" class="conteo">{{ conteos[r] }}</span>
      </button>
    </div>

    <div class="filtros">
      <SearchInput v-model="filtros.q" placeholder="Nombre, documento, correo o teléfono…" />
      <RouterLink v-if="pantallaPropia" class="btn secondary" :to="pantallaPropia.a">
        {{ pantallaPropia.texto }} →
      </RouterLink>
    </div>

    <div v-if="pareceDocumento" class="card inline">
      <p class="nota">
        No hay nadie con el documento <strong class="mono">{{ filtros.q }}</strong>. Podés darlo de alta acá mismo.
      </p>
      <form v-if="creando" class="row" @submit.prevent="crearInline">
        <input v-model="nuevoNombre" required placeholder="Nombre y apellido" autofocus />
        <button class="btn" type="submit">Crear</button>
        <button class="btn secondary" type="button" @click="creando = false">Cancelar</button>
      </form>
      <button v-else class="btn" type="button" @click="creando = true">
        Dar de alta con ese documento
      </button>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="5" />
      <UiEmpty
        v-else-if="!items.length && !pareceDocumento"
        :titulo="
          filtros.q
            ? `Nadie coincide con «${filtros.q}»`
            : rolActivo
              ? `No hay ningún ${ETIQUETA_ROL[rolActivo].toLowerCase()} cargado todavía`
              : 'Todavía no hay personas'
        "
        :detalle="
          rolActivo && !filtros.q
            ? VACIO_ROL[rolActivo]
            : 'Propietarios, inquilinos, compradores y garantes viven todos acá. Una persona, todos sus roles.'
        "
      >
        <button v-if="filtros.q" class="btn secondary" type="button" @click="filtros.q = ''">
          Limpiar la búsqueda
        </button>
        <RouterLink v-else-if="!rolActivo" class="btn" to="/personas/nueva">Cargar la primera</RouterLink>
      </UiEmpty>
      <div v-else-if="items.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th><th>Documento</th><th>Contacto</th><th>Roles</th>
              <th class="der"><span class="visually-hidden">Cuenta corriente</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in items" :key="p.id">
              <td class="fuerte">
                {{ p.nombreCompleto }}
                <!-- El semáforo va PEGADO al nombre y no en una columna al
                     final: es una advertencia sobre esta persona, no un
                     atributo suyo, y en una columna del extremo derecho se
                     lee después de haber decidido. -->
                <StatusChip
                  v-if="SEMAFORO[p.semaforo?.estado]"
                  :texto="SEMAFORO[p.semaforo.estado].texto"
                  :tono="SEMAFORO[p.semaforo.estado].tono"
                  :title="p.semaforo.motivo ?? ''"
                />
              </td>
              <td class="mono">{{ p.docNumero ? `${(p.docTipo ?? '').toUpperCase()} ${p.docNumero}` : '—' }}</td>
              <td>
                <div class="contacto">
                  <span v-if="p.telefono" class="mono">{{ p.telefono }}</span>
                  <span v-if="p.email" class="mono chico">{{ p.email }}</span>
                  <span v-if="!p.telefono && !p.email" class="muted">—</span>
                </div>
              </td>
              <td>
                <div class="roles">
                  <StatusChip v-for="r in p.roles" :key="r" :texto="ETIQUETA_ROL[r] ?? r" tono="acento" />
                  <span v-if="!p.roles.length" class="muted">—</span>
                </div>
              </td>
              <!-- Sólo a quien tiene una cuenta que mirar. Un enlace que lleva
                   a «esta persona no tiene cuenta corriente» es un viaje en
                   vano, y la lista ya sabe los roles. -->
              <td class="der">
                <button
                  v-if="esJefe"
                  class="btn enlace sm"
                  type="button"
                  @click="abrirSemaforo(p)"
                >Marcar</button>
                <RouterLink
                  v-if="p.roles.includes('inquilino') || p.roles.includes('propietario')"
                  class="btn enlace sm"
                  :to="`/personas/${p.id}/cuenta`"
                >Cuenta</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!--
      Marcar a alguien.

      El texto de abajo no es decorativo: quien pone «no alquilar» tiene que
      saber que eso NO impide nada y que queda con su nombre. Las dos cosas
      cambian cómo se usa.
    -->
    <div v-if="marcando" class="card stack semaforo-caja">
      <h2>{{ marcando.nombreCompleto }}</h2>

      <div class="opciones-semaforo">
        <label v-for="o in OPCIONES_SEMAFORO" :key="o.v" class="op-semaforo"
          :class="{ elegida: nuevoEstado === o.v }">
          <input v-model="nuevoEstado" type="radio" :value="o.v" name="semaforo" />
          <span>
            <b>{{ o.t }}</b>
            <span class="det">{{ o.d }}</span>
          </span>
        </label>
      </div>

      <label v-if="nuevoEstado !== 'sin_marcar'" class="campo">
        <span>Por qué</span>
        <textarea v-model="nuevoMotivo" rows="2" maxlength="500"
          placeholder="Se fue debiendo cuatro meses y no atendió el teléfono."></textarea>
        <small>Obligatorio. Dentro de seis meses, esto es lo único que va a explicar la marca.</small>
      </label>

      <p class="nota">
        <b>No bloquea nada.</b> Le vas a poder armar un contrato igual: esto avisa,
        no decide. Queda con tu nombre y la fecha, y no sale de la inmobiliaria —
        ni al portal, ni a la Red, ni a un envío.
      </p>

      <div class="acciones">
        <button class="btn" type="button" :disabled="guardandoSemaforo" @click="guardarSemaforo">
          {{ guardandoSemaforo ? 'Guardando…' : 'Guardar' }}
        </button>
        <button class="btn secondary" type="button" @click="marcando = null">Cancelar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contacto { display: flex; flex-direction: column; gap: 2px; }
.chico { font-size: 12px; color: var(--muted); }
.roles { display: flex; gap: var(--s-xs); flex-wrap: wrap; }
.muted { color: var(--muted-2); }
.inline { display: flex; flex-direction: column; gap: var(--s-md); }
.inline input {
  flex: 1; font: inherit; padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.nota { margin: 0; font-size: 13px; color: var(--muted); }
.filtros { display: flex; gap: var(--s-md); align-items: center; flex-wrap: wrap; }
.filtros > :first-child { flex: 1; min-width: 220px; }

/*
  El conteo dentro de la pastilla.

  `--ink-2` y NO `--muted-2`: el número va sobre DOS fondos —el riel
  (`--surface-2`) y la pastilla activa (`--surface`)— y en dos temas, o sea
  CUATRO ratios, no uno. `--muted-2` ya dio 3,01 sobre `--surface-2` una vez y
  se coló porque «a ojo se veía bien», así que se calcula, no se mira.

  Medidos sobre los valores reales de `tokens.css`:

    claro  (#33403f): sobre surface-2 #f5f3ee → 9,73 · sobre surface #ffffff → 10,79
    oscuro (#cbd6d4): sobre surface-2 #1c2a28 → 10,00 · sobre surface #141f1e → 11,34

  `--muted-2` habría pasado igual acá (4,83 / 5,36 / 5,18 / 5,88), pero el
  número de una pestaña no es texto secundario: es la mitad de la información
  del control.

  `font-variant-numeric: tabular-nums` para que la fila no se mueva cuando un
  conteo pasa de 9 a 10.
*/
.conteo {
  margin-left: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}

.semaforo-caja { max-width: 36rem; margin-top: var(--s-lg); }
.opciones-semaforo { display: grid; gap: var(--s-sm); }
.op-semaforo {
  display: flex; gap: var(--s-sm); align-items: flex-start;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line); border-radius: var(--r-md); cursor: pointer;
}
.op-semaforo.elegida { border-color: var(--accent); background: var(--accent-tint); }
.op-semaforo > span { display: grid; gap: 1px; }
.op-semaforo .det { font-size: 12.5px; color: var(--muted); line-height: 1.4; }
.semaforo-caja .acciones { display: flex; gap: var(--s-sm); }
</style>
