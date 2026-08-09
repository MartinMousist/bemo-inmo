<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { BloqueEstructura, VariableChip, paraEditor, tokenDe } from './editor/nodos';
import MenuVariables from './editor/MenuVariables.vue';
import type { BloqueDelCatalogo, VariableDelCatalogo } from './editor/catalogo';
import { limpiarPegado } from '../dominio/limpiarPegado';

/**
 * El editor con formato. Se usa en los DOS lugares donde hay texto que va a
 * salir impreso: la plantilla (el modelo de la inmobiliaria) y el documento
 * generado antes de mandarlo.
 *
 * Se carga con `defineAsyncComponent` desde las pantallas: `starter-kit` arrastra
 * unos veinticuatro subpaquetes de `@tiptap/*` más ProseMirror, y si el import
 * no fuera perezoso lo pagaría también quien entra a ver una liquidación.
 *
 * ── Tres cosas que este componente garantiza ────────────────────────────────
 *
 * 1. **El chip es un átomo.** Lo garantiza el schema de ProseMirror, no una
 *    convención: ninguna transacción puede dejar un `{{ }}` partido al medio.
 * 2. **Todo se usa con el teclado.** La barra es un `role="toolbar"` con roving
 *    tabindex —una sola parada de Tab, flechas adentro—, los atajos de siempre
 *    (Cmd/Ctrl+B, I, U) y el menú de variables se abre tecleando `{{`, que
 *    además rescata a quien lo escribe de memoria.
 * 3. **Lo pegado de Word se limpia y se DICE qué pasó.** Si venía una tabla, se
 *    avisa que se pegó como párrafos: sin ese aviso alguien pega un cuadro de
 *    vencimientos y firma un contrato al que le falta la grilla.
 */

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** Sin el menú en un documento generado: ahí ya no quedan `{{ }}`. */
    conVariables?: boolean;
    variables?: VariableDelCatalogo[];
    bloques?: BloqueDelCatalogo[];
    soloLectura?: boolean;
    /** Lo que lee un lector de pantalla al entrar al área de edición. */
    etiqueta?: string;
    alto?: number;
  }>(),
  {
    conVariables: false,
    variables: () => [],
    bloques: () => [],
    soloLectura: false,
    etiqueta: 'Texto del documento',
    alto: 420,
  },
);

const emit = defineEmits<{
  'update:modelValue': [html: string];
  /** Lo que hay que contarle a la persona sobre el último pegado. */
  avisos: [mensajes: string[]];
}>();

const menuAbierto = ref(false);
const caja = ref<HTMLElement | null>(null);
/** El botón de la barra que tiene el tabindex 0 (roving). */
const foco = ref(0);

/**
 * El contador que hace reactivo al editor.
 *
 * `new Editor()` es un objeto de ProseMirror y su estado NO es reactivo para
 * Vue: sin esto, «N» no se pinta al entrar en una negrita y el menú no sabe
 * dentro de qué bloque está el cursor. Se toca en cada transacción y los
 * `computed` que dependen del estado del editor lo leen. Es explícito a
 * propósito: envolver el editor en un `ref` profundo haría que Vue recorra un
 * árbol de ProseMirror entero en cada tecla.
 */
const version = ref(0);

/**
 * El HTML que entra al editor.
 *
 * Los `{% si %}` / `{% fin %}` se sacan: ProseMirror los leería como texto
 * suelto adentro de un nodo `block+` y los envolvería en un párrafo, dejando un
 * renglón con «{% si garantes %}» a la vista. Los vuelve a poner el backend al
 * guardar, que es el único lugar donde el par se puede garantizar balanceado.
 */
const editor = new Editor({
  content: paraEditor(props.modelValue || '<p></p>'),
  editable: !props.soloLectura,
  extensions: [
    StarterKit.configure({
      // Sin enlaces y sin código en v1: un contrato no los usa, y `<a>` es
      // superficie de ataque (`javascript:`) que el backend ni siquiera
      // permite. Prometer un botón que el sanitizador va a tirar sería peor.
      link: false,
      code: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
    }),
    VariableChip,
    BloqueEstructura,
  ],
  editorProps: {
    attributes: {
      class: 'documento editable',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': props.etiqueta,
      lang: 'es-AR',
      spellcheck: 'true',
    },
    /**
     * La limpieza corre ANTES de que el schema valide.
     *
     * Es el único enganche donde todavía se ve el `text/html` que Word puso en
     * el portapapeles: después, ProseMirror ya descartó lo que su schema no
     * conoce y los `mso-list` —el único lugar donde vive el nivel de anidado de
     * una viñeta— ya no existen.
     */
    transformPastedHTML(html) {
      const r = limpiarPegado(html);
      if (r.avisos.length) emit('avisos', r.avisos);
      return r.html;
    },
  },
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getHTML());
  },
});

/**
 * Tipear `{{` abre el menú.
 *
 * Rescata a quien se acuerda de la sintaxis de memoria: en vez de dejarle
 * escribir un token a mano —que es como se rompen— se le ofrece la lista.
 */
editor.on('transaction', () => {
  version.value++;
  if (!props.conVariables || menuAbierto.value) return;
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parentOffset < 2) return;
  const antes = $from.parent.textBetween(
    $from.parentOffset - 2, $from.parentOffset,
  );
  if (antes === '{{') {
    editor.commands.deleteRange({ from: $from.pos - 2, to: $from.pos });
    menuAbierto.value = true;
  }
});

// El padre puede reemplazar el contenido (abrir otro documento del historial).
// Se compara contra lo que el editor ya tiene para no pisar el cursor en cada
// tecla: `setContent` reconstruye el documento entero.
watch(
  () => props.modelValue,
  (v) => {
    if (v === editor.getHTML()) return;
    editor.commands.setContent(paraEditor(v || '<p></p>'), { emitUpdate: false });
  },
);
watch(() => props.soloLectura, (v) => editor.setEditable(!v));

onBeforeUnmount(() => editor.destroy());

/**
 * Las variables que existen SÓLO adentro del bloque donde está el cursor.
 *
 * Parado dentro de un `{% para g en garantes %}`, lo que se quiere escribir es
 * `{{ g.nombre }}`, que afuera de ese bloque no existe. Ofrecerlas siempre
 * sería ofrecer un hueco garantizado; no ofrecerlas nunca deja la lista de
 * garantes imposible de escribir desde el menú.
 */
const contextuales = computed<VariableDelCatalogo[]>(() => {
  void version.value;
  const { $from } = editor.state.selection;
  const items: VariableDelCatalogo[] = [];
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name !== 'bloqueEstructura' || n.attrs.bloque !== 'para') continue;
    const b = props.bloques.find(
      (x) => x.clase === 'para' && x.item === n.attrs.item && x.expr === n.attrs.lista,
    );
    if (b?.adentro) items.push(...b.adentro);
  }
  return items;
});

// ── Comandos de la barra ─────────────────────────────────────────────────────

interface Boton {
  clave: string;
  texto: string;
  titulo: string;
  activo: () => boolean;
  correr: () => void;
}

const botones = computed<Boton[]>(() => {
  // Se lee `version` para que Vue recalcule el estado «apretado» de cada botón
  // en cada transacción del editor: si no, «N» no se pinta al entrar en una
  // negrita y la barra miente sobre lo que está pasando en el texto.
  void version.value;
  return [
  { clave: 'b', texto: 'N', titulo: 'Negrita (Ctrl+B)', activo: () => editor.isActive('bold'), correr: () => editor.chain().focus().toggleBold().run() },
  { clave: 'i', texto: 'C', titulo: 'Cursiva (Ctrl+I)', activo: () => editor.isActive('italic'), correr: () => editor.chain().focus().toggleItalic().run() },
  { clave: 'u', texto: 'S', titulo: 'Subrayado (Ctrl+U)', activo: () => editor.isActive('underline'), correr: () => editor.chain().focus().toggleUnderline().run() },
  { clave: 'h1', texto: 'T1', titulo: 'Título principal', activo: () => editor.isActive('heading', { level: 1 }), correr: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { clave: 'h2', texto: 'T2', titulo: 'Título de cláusula', activo: () => editor.isActive('heading', { level: 2 }), correr: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { clave: 'h3', texto: 'T3', titulo: 'Subtítulo', activo: () => editor.isActive('heading', { level: 3 }), correr: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { clave: 'ul', texto: '•', titulo: 'Lista con viñetas', activo: () => editor.isActive('bulletList'), correr: () => editor.chain().focus().toggleBulletList().run() },
  { clave: 'ol', texto: '1.', titulo: 'Lista numerada', activo: () => editor.isActive('orderedList'), correr: () => editor.chain().focus().toggleOrderedList().run() },
  { clave: 'cita', texto: '❝', titulo: 'Cita', activo: () => editor.isActive('blockquote'), correr: () => editor.chain().focus().toggleBlockquote().run() },
  { clave: 'hr', texto: '—', titulo: 'Línea separadora', activo: () => false, correr: () => editor.chain().focus().setHorizontalRule().run() },
  ];
});

/**
 * Roving tabindex: la barra entera es UNA parada de Tab.
 *
 * Con diez botones tabulables, llegar al texto desde el campo de nombre son
 * once Tab. Con roving son dos, y adentro se navega con las flechas — que es
 * lo que espera un lector de pantalla de un `role="toolbar"`.
 */
function alTecladoBarra(ev: KeyboardEvent, i: number) {
  const n = botones.value.length + 1; // +1: «Insertar variable»
  let destino: number | null = null;
  if (ev.key === 'ArrowRight') destino = (i + 1) % n;
  else if (ev.key === 'ArrowLeft') destino = (i - 1 + n) % n;
  else if (ev.key === 'Home') destino = 0;
  else if (ev.key === 'End') destino = n - 1;
  if (destino === null) return;
  ev.preventDefault();
  foco.value = destino;
  const barra = caja.value?.querySelector('[role="toolbar"]');
  (barra?.querySelectorAll('button')[destino] as HTMLElement | undefined)?.focus();
}

function insertarVariable(v: VariableDelCatalogo, formato: string | null) {
  editor.chain().focus().insertContent([
    {
      type: 'variableChip',
      attrs: { ruta: v.ruta, formato, etiqueta: v.etiqueta },
    },
    // Un espacio detrás: sin él, seguir escribiendo pega la palabra al chip y
    // hay que acordarse de la barra espaciadora antes de cada palabra.
    { type: 'text', text: ' ' },
  ]).run();
  menuAbierto.value = false;
}

function insertarBloque(b: BloqueDelCatalogo) {
  editor.chain().focus().insertContent({
    type: 'bloqueEstructura',
    attrs: b.clase === 'si'
      ? { bloque: 'si', expr: b.expr, etiqueta: b.etiqueta }
      : { bloque: 'para', item: b.item, lista: b.expr, etiqueta: b.etiqueta },
    content: [{ type: 'paragraph' }],
  }).run();
  menuAbierto.value = false;
}

/** El token que se ve al pie, para quien quiere saber qué va a salir. */
const tokenDelCursor = computed(() => {
  void version.value;
  const n = editor.state.selection.$from.nodeAfter ?? editor.state.selection.$from.nodeBefore;
  if (n?.type.name !== 'variableChip') return null;
  return tokenDe(n.attrs.ruta as string, n.attrs.formato as string | null);
});

function cerrarMenu() {
  menuAbierto.value = false;
  editor.commands.focus();
}

defineExpose({ enfocar: () => editor.commands.focus() });
</script>

<template>
  <div ref="caja" class="editor-doc" :class="{ leyendo: soloLectura }">
    <div v-if="!soloLectura" class="barra-editor" role="toolbar" aria-label="Formato del texto">
      <button
        v-for="(b, i) in botones"
        :key="b.clave"
        type="button"
        class="tb"
        :class="{ on: b.activo() }"
        :title="b.titulo"
        :aria-label="b.titulo"
        :aria-pressed="b.activo()"
        :tabindex="foco === i ? 0 : -1"
        @click="b.correr()"
        @focus="foco = i"
        @keydown="alTecladoBarra($event, i)"
      >{{ b.texto }}</button>

      <span class="separador" role="separator" aria-orientation="vertical" />

      <div v-if="conVariables" class="con-menu">
        <button
          type="button"
          class="tb ancho"
          :tabindex="foco === botones.length ? 0 : -1"
          :aria-expanded="menuAbierto"
          aria-haspopup="dialog"
          @click="menuAbierto = !menuAbierto"
          @focus="foco = botones.length"
          @keydown="alTecladoBarra($event, botones.length)"
        >Insertar variable</button>

        <MenuVariables
          :abierto="menuAbierto"
          :variables="variables"
          :bloques="bloques"
          :contextuales="contextuales"
          @variable="insertarVariable"
          @bloque="insertarBloque"
          @cerrar="cerrarMenu"
        />
      </div>
    </div>

    <EditorContent :editor="editor" class="area" :style="{ minHeight: `${alto}px` }" />

    <p v-if="tokenDelCursor" class="pie-editor" aria-live="polite">
      La variable seleccionada imprime <code class="mono">{{ tokenDelCursor }}</code>.
      Se borra entera con Backspace: es una sola pieza, no un texto.
    </p>
  </div>
</template>

<style scoped>
.editor-doc {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}

.barra-editor {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: var(--s-xs);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md) var(--r-md) 0 0;
}

.tb {
  min-width: 30px;
  height: 28px;
  padding: 0 var(--s-xs);
  font: inherit;
  font-size: 12.5px;
  /* Medido: `--ink-2` sobre `--surface-2` da 9,73 en claro y 10,00 en oscuro. */
  color: var(--ink-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.tb.ancho { min-width: auto; padding: 0 var(--s-sm); }
.tb:hover { background: var(--surface-3); }
.tb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tb.on {
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

.separador {
  width: 1px;
  height: 18px;
  margin: 0 var(--s-xs);
  background: var(--line-strong);
}

.con-menu { position: relative; }

.area {
  border: 1px solid var(--line);
  border-top: none;
  border-radius: 0 0 var(--r-md) var(--r-md);
  background: var(--surface);
  overflow-y: auto;
  max-height: 70vh;
}
.leyendo .area { border-radius: var(--r-md); border-top: 1px solid var(--line); }

.pie-editor {
  margin: 0;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.55;
}
</style>
