<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, plural } from '../dominio/formato';
import type { Catalogo } from '../componentes/editor/catalogo';
import { registrarEtiquetas } from '../componentes/editor/nodos';

/**
 * El editor entra perezoso a propósito.
 *
 * `@tiptap/starter-kit` arrastra unos veinticuatro subpaquetes de `@tiptap/*`
 * más ProseMirror. Con un import normal, ese peso lo bajaría también quien
 * entra a ver una liquidación y nunca abre una plantilla. Así queda en su
 * propio chunk y sólo lo piden esta pantalla y la ficha del contrato.
 */
const EditorDocumento = defineAsyncComponent(
  () => import('../componentes/EditorDocumento.vue'),
);

/**
 * Pre-contratos y plantillas.
 *
 * **El motor estaba construido y no tenía ni una pantalla.** `GET/PUT/DELETE
 * /v1/plantillas`, previsualizar, sembrar las cuatro plantillas base y generar
 * el documento con los datos reales de un contrato: todo con su test suite,
 * invisible para el usuario. Y la portada anunciaba «Pre-contratos y
 * plantillas» como listo. Es el error #3 del playbook al revés — hecho en el
 * back, que para quien usa el sistema es lo mismo que no existir.
 *
 * Dos decisiones de esta pantalla:
 *
 * **La previsualización va al lado del editor y se actualiza al pedirla, no en
 * cada tecla.** Un pre-contrato son tres carillas de texto legal: refrescar
 * mientras alguien escribe es un salto de scroll cada dos letras. El botón lo
 * hace explícito.
 *
 * **Las variables que la plantilla usa se muestran siempre.** Es lo único que
 * convierte un textarea en algo editable por alguien que no escribió el motor:
 * sin la lista, la única forma de saber que existe `{{ locatario.nombre }}` es
 * leer el código.
 */

interface TokenRoto { token: string; motivo: string }

interface Plantilla {
  id: string;
  tipo: string;
  nombre: string;
  contenido: string;
  /** `html` = el editor con formato. `texto` = las que todavía no se convirtieron. */
  formato: 'texto' | 'html';
  activa: boolean;
  variables: string[];
  /** Los `{{ }}` que el motor NO entiende: se imprimen literales en el contrato. */
  tokensRotos: TokenRoto[];
  /** Sólo en las convertidas. La pantalla lo muestra: convertir reescribe texto legal. */
  textoOriginal: string | null;
  convertidaEl: string | null;
}

interface Documento {
  texto: string;
  formato: 'texto' | 'html';
  faltantes: string[];
  plantilla: { id: string; nombre: string };
  advertencia?: string;
  avisos?: string[];
  tokensRotos?: TokenRoto[];
}

const TIPO: Record<string, string> = {
  pre_contrato_alquiler: 'Pre-contrato de alquiler',
  pre_contrato_venta: 'Pre-contrato de venta',
  reserva: 'Reserva',
  aviso_aumento: 'Aviso de aumento',
  aviso_vencimiento: 'Aviso de vencimiento',
  recibo: 'Recibo',
  liquidacion: 'Liquidación',
  otro: 'Otro',
};

const ui = useUi();

const items = ref<Plantilla[]>([]);
const cargando = ref(true);
const error = ref('');
const guardando = ref(false);

/** La que se está editando. `null` = ninguna; `'nueva'` = alta. */
const editando = ref<string | null>(null);
const form = ref({
  id: '', tipo: 'pre_contrato_alquiler', nombre: '', contenido: '',
  formato: 'html' as 'texto' | 'html',
});
const vista = ref<Documento | null>(null);

/** El catálogo del menú de variables. Viene del backend, no de una lista de acá. */
const catalogo = ref<Catalogo>({ variables: [], bloques: [], formatos: [] });
/** Lo que dejó el último pegado desde Word. Se muestra hasta que se cierra. */
const avisosPegado = ref<string[]>([]);
/** La plantilla convertida cuyo texto original se está mirando. */
const viendoOriginal = ref(false);

/** La que se está editando, tal como está en la lista. */
const enLista = computed(() => items.value.find((p) => p.id === form.value.id) ?? null);

/** El catálogo se acota al tipo elegido: `cobro.*` sólo existe en el recibo. */
async function cargarCatalogo() {
  try {
    catalogo.value = await api<Catalogo>(
      `/plantillas/variables?tipo=${encodeURIComponent(form.value.tipo)}`,
    );
  } catch {
    // Sin catálogo el editor sigue sirviendo para escribir: lo único que se
    // pierde es el menú. Se dice, no se finge que está vacío.
    catalogo.value = { variables: [], bloques: [], formatos: [] };
  }
}

const esNueva = computed(() => editando.value === 'nueva');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    items.value = await api<Plantilla[]>('/plantillas');
  } catch (e) {
    items.value = [];
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las plantillas.';
  } finally {
    cargando.value = false;
  }
}
/**
 * El diccionario ruta → etiqueta legible, para la lista.
 *
 * La lista mostraba `contrato.monto`, que es cómo se llama una columna. Quien
 * redacta un contrato no tiene por qué saberlo: acá dice «Precio mensual».
 */
const etiquetas = ref<Record<string, string>>({});

function etiquetaDe(ruta: string): string {
  return etiquetas.value[ruta] ?? ruta;
}

onMounted(async () => {
  await cargar();
  try {
    const todo = await api<Catalogo>('/plantillas/variables');
    const m: Record<string, string> = {};
    for (const v of todo.variables) m[v.ruta] = v.etiqueta;
    for (const b of todo.bloques) for (const v of b.adentro ?? []) m[v.ruta] = v.etiqueta;
    etiquetas.value = m;
    // El mismo diccionario lo usa el chip del editor para mostrar «Precio
    // mensual» en vez de `contrato.monto`. Ver `editor/nodos.ts`.
    registrarEtiquetas(m);
  } catch {
    // Sin catálogo la lista sigue mostrando la ruta: es menos legible, pero es
    // verdad. No se inventa una etiqueta.
  }
});

function abrirNueva() {
  editando.value = 'nueva';
  vista.value = null;
  avisosPegado.value = [];
  viendoOriginal.value = false;
  form.value = {
    id: '',
    tipo: 'pre_contrato_alquiler',
    nombre: '',
    formato: 'html',
    // El esqueleto ya NO enseña sintaxis, y ése es el cambio.
    //
    // Antes acá había un modelo con `{{ }}` y `{% si %}` escritos a mano para
    // que alguien los copiara. Enseñar sintaxis en un textarea es lo que hizo
    // que este esqueleto arrastrara durante meses `{{#if}}` y `{{#each}}` de
    // Handlebars —que el motor NO entiende— y que toda plantilla nacida de acá
    // imprimiera esas etiquetas literales adentro del contrato que se firma
    // (está en la tabla de trampas de `docs/CONTINUAR.md`).
    //
    // Ahora las variables se insertan desde el menú, que las saca del catálogo
    // del backend: no hay sintaxis que recordar ni que escribir mal. El
    // esqueleto es sólo el andamio de un contrato, en texto común.
    contenido:
      '<h1>CONTRATO DE LOCACIÓN</h1>' +
      '<p>Entre , en adelante EL LOCADOR, y , en adelante EL LOCATARIO, ' +
      'se conviene la locación del inmueble de .</p>' +
      '<h2>PRIMERA — PLAZO</h2><p></p>' +
      '<h2>SEGUNDA — PRECIO</h2><p></p>',
  };
  void cargarCatalogo();
}

function abrirEdicion(p: Plantilla) {
  editando.value = p.id;
  vista.value = null;
  avisosPegado.value = [];
  viendoOriginal.value = false;
  form.value = {
    id: p.id, tipo: p.tipo, nombre: p.nombre, contenido: p.contenido, formato: p.formato,
  };
  void cargarCatalogo();
}

function cerrar() {
  editando.value = null;
  vista.value = null;
  avisosPegado.value = [];
  viendoOriginal.value = false;
}

async function previsualizar() {
  try {
    vista.value = await api<Documento>('/plantillas/previsualizar', {
      method: 'POST',
      body: JSON.stringify({ contenido: form.value.contenido, formato: form.value.formato }),
    });
  } catch (e) {
    ui.error('No se pudo previsualizar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

/**
 * Pasa una plantilla vieja al editor con formato.
 *
 * El botón existe además de la conversión automática del `migrate` porque una
 * inmobiliaria puede traer su plantilla después, o dejarla en texto a propósito.
 * El original queda guardado y se puede mirar desde acá mismo: convertir es
 * reescribir un texto legal.
 */
async function convertir(p: Plantilla) {
  const ok = await ui.confirmar({
    titulo: '¿Pasar al editor con formato?',
    detalle:
      `«${p.nombre}» está en texto plano. Al convertirla, los saltos de línea ` +
      'pasan a párrafos, las viñetas a lista y las variables a fichas. El texto ' +
      'original queda guardado y se puede mirar desde acá. Los documentos que ya ' +
      'se generaron con ella no se tocan: salieron como salieron.',
    confirmar: 'Convertir',
  });
  if (!ok) return;

  try {
    await api(`/plantillas/${p.id}/convertir`, { method: 'POST' });
    ui.ok('Convertida', `«${p.nombre}» ya se edita con formato.`);
    await cargar();
    const nueva = items.value.find((x) => x.id === p.id);
    if (nueva) abrirEdicion(nueva);
  } catch (e) {
    ui.error('No se pudo convertir', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

async function guardar() {
  if (!form.value.nombre.trim() || !form.value.contenido.trim()) {
    ui.error('Faltan datos', 'El nombre y el contenido son obligatorios.');
    return;
  }
  guardando.value = true;
  try {
    const r = await api<Plantilla & { avisos: string[] }>('/plantillas', {
      method: 'PUT',
      body: JSON.stringify({
        ...(form.value.id ? { id: form.value.id } : {}),
        tipo: form.value.tipo,
        nombre: form.value.nombre.trim(),
        contenido: form.value.contenido,
        formato: form.value.formato,
      }),
    });
    ui.ok(esNueva.value ? 'Plantilla creada' : 'Plantilla guardada', form.value.nombre.trim());
    // Lo que el sanitizador tuvo que arreglar se dice. Arreglarlo en silencio
    // deja guardada una plantilla distinta de la que la persona escribió.
    for (const a of r.avisos ?? []) ui.error('Se corrigió algo al guardar', a);
    for (const t of r.tokensRotos ?? []) ui.error(`Quedó «${t.token}» sin resolver`, t.motivo);
    cerrar();
    await cargar();
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    guardando.value = false;
  }
}

async function borrar(p: Plantilla) {
  const ok = await ui.confirmar({
    titulo: '¿Eliminar la plantilla?',
    detalle:
      `«${p.nombre}». Los documentos que ya se generaron con ella no se tocan: ` +
      'salieron impresos y no dependen de esto. Lo que se pierde es el modelo.',
    confirmar: 'Eliminar',
    peligroso: true,
  });
  if (!ok) return;

  try {
    await api(`/plantillas/${p.id}`, { method: 'DELETE' });
    ui.ok('Plantilla eliminada', p.nombre);
    if (editando.value === p.id) cerrar();
    await cargar();
  } catch (e) {
    ui.error('No se pudo eliminar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

async function sembrar() {
  try {
    const r = await api<{ creadas: number; yaEstaban: number }>('/plantillas/sembrar', {
      method: 'POST',
    });
    ui.ok(
      plural(r.creadas, 'plantilla creada', 'plantillas creadas'),
      r.yaEstaban ? `${r.yaEstaban} ya estaban y no se tocaron` : 'Listas para usar y editar',
    );
    await cargar();
  } catch (e) {
    ui.error('No se pudieron sembrar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

/**
 * Un texto para la ayuda que NO se puede escribir en el template.
 *
 * Vue interpola `{{ }}`: escribir esa sintaxis literal adentro de una
 * interpolación hace que el compilador la lea como código y falle. Queda una
 * sola constante porque la ayuda ya casi no habla de sintaxis — las variables
 * se insertan desde el menú, no se teclean.
 */
const ATAJO_VARIABLE = ['{', '{'].join('');

// El catálogo se acota al tipo: `cobro.*` sólo existe en el recibo, y ofrecerlo
// en un pre-contrato sería ofrecer un hueco garantizado.
watch(() => form.value.tipo, () => { if (editando.value) void cargarCatalogo(); });

/** Agrupadas por tipo: es como se buscan, no por nombre. */
const porTipo = computed(() => {
  const m = new Map<string, Plantilla[]>();
  for (const p of items.value) {
    if (!m.has(p.tipo)) m.set(p.tipo, []);
    m.get(p.tipo)!.push(p);
  }
  return [...m.entries()].map(([tipo, lista]) => ({ tipo, lista }));
});
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Pre-contratos y plantillas"
      :bajada="cargando || error ? '' : plural(items.length, 'plantilla', 'plantillas')"
    >
      <template #acciones>
        <button class="btn secondary" type="button" @click="sembrar">Traer las base</button>
        <button class="btn" type="button" @click="abrirNueva">Nueva plantilla</button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <UiSkeleton v-if="cargando" :filas="4" :alto="64" />

    <UiEmpty
      v-else-if="!error && !items.length"
      titulo="Todavía no hay plantillas"
      detalle="Vienen cuatro listas para usar: pre-contrato de locación, aviso de aumento, aviso de vencimiento y recibo. Se traen una vez y después se editan como cualquier texto."
    >
      <button class="btn" type="button" @click="sembrar">Traer las cuatro base</button>
    </UiEmpty>

    <template v-else>
      <section v-for="g in porTipo" :key="g.tipo" class="grupo">
        <h2>{{ TIPO[g.tipo] ?? g.tipo }}</h2>

        <div class="card sin-padding">
          <ul class="lista">
            <li v-for="p in g.lista" :key="p.id">
              <div class="que">
                <span class="nombre">{{ p.nombre }}</span>
                <span class="vars">
                  <template v-if="p.variables.length">
                    {{ plural(p.variables.length, 'variable', 'variables') }}:
                    <span v-for="v in p.variables.slice(0, 5)" :key="v" class="etq">
                      {{ etiquetaDe(v) }}
                    </span>
                    <span v-if="p.variables.length > 5" class="mas">
                      y {{ p.variables.length - 5 }} más
                    </span>
                  </template>
                  <!-- Una plantilla sin variables es texto fijo: sale igual para
                       todos los contratos. Casi siempre es un error de carga. -->
                  <span v-else class="sin-vars">
                    Sin variables — sale el mismo texto para todos los contratos
                  </span>
                </span>

                <!-- Un token que el motor no entiende sale IMPRESO tal cual
                     adentro del contrato. Es el peor error posible acá, así que
                     se dice en la lista y no sólo al abrir la plantilla. -->
                <span v-if="p.tokensRotos.length" class="roto">
                  ⚠ {{ plural(p.tokensRotos.length, 'variable rota', 'variables rotas') }}:
                  se imprimen tal cual adentro del documento. Abrí la plantilla para verlas.
                </span>

                <span v-if="p.convertidaEl" class="convertida">
                  Convertida desde texto plano el {{ fecha(p.convertidaEl.slice(0, 10)) }}
                </span>
              </div>

              <div class="acciones">
                <StatusChip v-if="!p.activa" texto="Inactiva" tono="neutro" />
                <StatusChip v-if="p.formato === 'texto'" texto="Texto plano" tono="warn" />
                <button
                  v-if="p.formato === 'texto'" class="btn enlace sm" type="button"
                  @click="convertir(p)"
                >Pasar al editor</button>
                <button class="btn enlace sm" type="button" @click="abrirEdicion(p)">
                  {{ editando === p.id ? 'Cerrar' : 'Editar' }}
                </button>
                <button class="btn enlace sm peligro" type="button" @click="borrar(p)">
                  Eliminar
                </button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <!-- ── Editor ────────────────────────────────────────────────────────── -->
    <section v-if="editando" class="card pad-sm editor">
      <h2 class="text-lg">{{ esNueva ? 'Nueva plantilla' : 'Editar plantilla' }}</h2>

      <div class="cabecera">
        <label class="campo">
          <span>Tipo</span>
          <select v-model="form.tipo">
            <option v-for="(t, k) in TIPO" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo crece">
          <span>Nombre</span>
          <input v-model="form.nombre" placeholder="Pre-contrato de locación" required />
        </label>
      </div>

      <div class="dos">
        <div class="campo">
          <span class="rotulo">Contenido</span>

          <!-- Los avisos del último pegado. No es cortesía: si alguien pega un
               cuadro de vencimientos y nadie le dice que se aplanó, firma un
               contrato al que le falta la grilla. -->
          <p v-for="a in avisosPegado" :key="a" class="alert aviso chico">{{ a }}</p>

          <EditorDocumento
            v-model="form.contenido"
            :con-variables="true"
            :variables="catalogo.variables"
            :bloques="catalogo.bloques"
            etiqueta="Contenido de la plantilla"
            :alto="440"
            @avisos="avisosPegado = $event"
          />

          <!-- `<p>` y no `<span>`: `.campo > span` es la etiqueta del campo y
               `familia.css` la pone en versalitas. -->
          <p class="ayuda">
            Se escribe como en un procesador de texto: negrita, títulos, viñetas.
            Lo que cambia según el contrato —el nombre, el monto, las fechas— se
            pone con <strong>«Insertar variable»</strong>, o tecleando
            <code class="mono">{{ ATAJO_VARIABLE }}</code> donde va.
            Cada variable es una ficha entera: se borra de una con Backspace y no
            se puede partir al medio, que es lo que hacía que saliera impresa
            tal cual adentro del contrato.
          </p>

          <!-- La conversión guarda el original y ACÁ se lee. Una columna que
               nadie lee es el error #3 del playbook. -->
          <p v-if="enLista?.convertidaEl" class="ayuda">
            Convertida desde texto plano el {{ fecha(enLista.convertidaEl.slice(0, 10)) }}.
            <button class="btn enlace sm" type="button" @click="viendoOriginal = !viendoOriginal">
              {{ viendoOriginal ? 'Ocultar el original' : 'Ver el original' }}
            </button>
          </p>
          <pre v-if="viendoOriginal && enLista?.textoOriginal" class="mono salida">{{ enLista.textoOriginal }}</pre>

          <!-- Los tokens rotos de lo que YA está guardado. -->
          <p v-if="enLista?.tokensRotos.length" class="alert" role="alert">
            <strong>Hay {{ enLista.tokensRotos.length }} que el motor no entiende.</strong>
            Se imprimen tal cual adentro del documento:
            <template v-for="(t, i) in enLista.tokensRotos" :key="t.token">
              <template v-if="i">· </template><code class="mono">{{ t.token }}</code> — {{ t.motivo }}
            </template>
          </p>
        </div>

        <div class="vista">
          <div class="vista-cab">
            <h3>Previsualización</h3>
            <button class="btn secondary sm" type="button" @click="previsualizar">
              Actualizar
            </button>
          </div>

          <!-- Con datos de ejemplo y dicho: nunca se toca un contrato real
               desde acá. Se actualiza a pedido y no en cada tecla: un
               pre-contrato son tres carillas y refrescar mientras alguien
               escribe es un salto de scroll cada dos letras. -->
          <p v-if="!vista" class="ayuda">
            Se arma con datos de ejemplo, sin tocar ningún contrato. Sale con la
            misma letra y los mismos márgenes con los que se va a imprimir.
          </p>

          <template v-else>
            <p v-if="vista.advertencia" class="alert aviso">{{ vista.advertencia }}</p>
            <p v-for="a in vista.avisos ?? []" :key="a" class="alert aviso chico">{{ a }}</p>
            <p v-if="vista.faltantes.length" class="alert aviso">
              {{ plural(vista.faltantes.length, 'variable sin dato', 'variables sin dato') }}:
              <span v-for="f in vista.faltantes" :key="f" class="etq">{{ etiquetaDe(f) }}</span>.
              En un pre-contrato puede ser normal —hay huecos que se completan a mano—
              pero conviene mirarlo antes de imprimir.
            </p>

            <!-- `v-html` sobre contenido que YA pasó por el sanitizador del
                 backend: `previsualizar()` sanitiza el body antes de renderizar,
                 y el motor escapa los valores del contexto. Los dos pasos son
                 necesarios: el segundo tapa el apellido con `<img onerror>`. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="vista.formato === 'html'" class="salida documento" lang="es-AR" v-html="vista.texto" />
            <pre v-else class="mono salida">{{ vista.texto }}</pre>
          </template>
        </div>
      </div>

      <div class="pie">
        <button class="btn secondary" type="button" @click="cerrar">Cancelar</button>
        <button class="btn" type="button" :disabled="guardando" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.grupo { display: flex; flex-direction: column; gap: var(--s-sm); }
.grupo > h2 { margin: 0; }

.lista li {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--s-lg); padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
}
.lista li:last-child { border-bottom: none; }
.que { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.nombre { color: var(--ink); font-size: 14px; }
.vars { font-size: 11px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
.etq {
  padding: 1px 6px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--ink-2);
}
.sin-vars { color: var(--warning-ink); }
.roto { font-size: 11.5px; color: var(--danger-ink); line-height: 1.5; }
.convertida { font-size: 11px; color: var(--muted); }
.rotulo { font-size: 12px; color: var(--ink-2); }
.mas { color: var(--muted-2); }
.acciones { display: flex; align-items: center; gap: var(--s-sm); flex: none; }

.editor { display: flex; flex-direction: column; gap: var(--s-md); }
.editor h2 { margin: 0; }
.cabecera { display: flex; gap: var(--s-md); flex-wrap: wrap; }
.cabecera .crece { flex: 1 1 240px; }

.dos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: var(--s-lg);
  align-items: start;
}
.campo { display: flex; flex-direction: column; gap: var(--s-xs); min-width: 0; }
.ayuda { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.alert.chico { font-size: 11.5px; line-height: 1.55; }
.ayuda code { font-size: 11px; }

.vista { display: flex; flex-direction: column; gap: var(--s-sm); min-width: 0; }
.vista-cab { display: flex; align-items: center; justify-content: space-between; gap: var(--s-md); }
.vista-cab h3 { margin: 0; }
.salida {
  margin: 0;
  padding: var(--s-lg);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-x: auto;
  max-height: 460px;
  overflow-y: auto;
  color: var(--ink-2);
}
.pie { display: flex; justify-content: flex-end; gap: var(--s-sm); }
</style>
