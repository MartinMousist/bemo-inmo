<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import { useAuth } from '../stores/auth';
import PageHeader from '../componentes/PageHeader.vue';
import { laCasa } from '../dominio/vocabulario';

/**
 * Alta de un contrato de alquiler — y, con él, su pre-contrato ya escrito.
 *
 * ── El pedido, textual y repetido dos veces ──
 * *«el pre contrato debe estar cargado EL TEXTO a la hora que se crea un
 * contrato»*. O sea: **no** hay botón «generar pre-contrato», ni checkbox, ni
 * ningún clic intermedio. Se aprieta «Crear contrato» y el documento queda
 * generado, con su texto renderizado y guardado en `documento_generado` contra
 * la plantilla `pre_contrato_alquiler` de esa inmobiliaria. Al aterrizar en la
 * ficha el texto ESTÁ, listo para editar, imprimir o mandar.
 *
 * ── Dónde vive el disparador, y por qué ──
 * En el **backend**, adentro de `contratos.crear()`, y no acá. Un `POST` extra
 * desde el front dejaría el pre-contrato atado a que la pestaña siga viva —la
 * misma razón por la que `POST /documentos/:id/envios` guarda y devuelve la URL
 * en una sola llamada—, y un contrato creado desde la API, desde el importador o
 * desde cualquier otro lado nacería sin papel. Lo que sí es del front es
 * **decirlo antes** y **verificarlo después**.
 *
 * Y va fuera de la transacción del contrato: si la plantilla está rota, el
 * contrato —que es el hecho legal— igual se guarda. Ver el comentario de
 * `crear()` en `contratos.service.ts` y el de `generarPreContrato()`.
 *
 * ── Las tres honestidades, dichas ANTES de apretar ──
 * 1. **Sin inquilino elegido** el pre-contrato sale sin parte locataria. El
 *    campo es opcional a propósito (se firma primero, se define después), así
 *    que no se bloquea nada: se avisa.
 * 2. **Los garantes no están en este formulario**, así que la cláusula
 *    `{% si garantes %}` no se va a imprimir — y eso **no** figura en
 *    `faltantes`, porque es un condicional del motor y no una variable.
 * 3. **El documento es una FOTO.** `texto_generado` es inmutable por diseño de
 *    la migración 020: cargar los garantes o el inquilino después NO lo
 *    actualiza. Si esto no se dice, alguien imprime en marzo el pre-contrato
 *    armado en enero creyendo que se puso al día.
 *
 * ── Y el resultado se AFIRMA, no se supone ──
 * Después del `POST` se lee `GET /contratos/:id/documentos` para saber si el
 * papel existe de verdad. Deducirlo de «había plantilla al montar» sería
 * afirmar un hecho que nadie verificó, que es exactamente lo que este repo
 * decidió no hacer cuando llamó `abierto_el` a la columna en vez de
 * `enviado_el`. Pase lo que pase con el documento se navega igual: el contrato
 * ya está creado y esconderlo sería el peor final posible.
 */

const router = useRouter();
const ui = useUi();
const auth = useAuth();

const propiedades = ref<Array<{ id: string; etiqueta: string; direccion: string }>>([]);
const personas = ref<Array<{
  id: string;
  nombreCompleto: string;
  semaforo?: { estado: string; motivo: string | null; por: string | null };
}>>([]);

/**
 * El aviso sobre el inquilino elegido.
 *
 * ── Éste es el momento para el que existe la marca ──
 *
 * De nada sirve tenerla en la lista de personas si no aparece justo cuando
 * alguien está por firmarle un contrato a esa persona. Acá es donde se lee.
 *
 * ── Y por eso NO deshabilita el botón ──
 *
 * Avisa y nada más. Que el sistema se niegue a dejar armar el contrato sería
 * tomar por la inmobiliaria una decisión que es suya, y una marca vieja o
 * puesta con bronca dejaría a alguien afuera sin que nadie lo revise.
 */
const avisoInquilino = computed(() => {
  const p = personas.value.find((x) => x.id === f.locatarioId);
  const e = p?.semaforo?.estado;
  if (!e || e === 'sin_marcar') return null;
  if (e === 'recomendado') {
    return { tono: 'ok' as const, titulo: 'Recomendado', motivo: p!.semaforo!.motivo, por: p!.semaforo!.por };
  }
  return {
    tono: e === 'no_alquilar' ? ('err' as const) : ('warn' as const),
    titulo: e === 'no_alquilar' ? 'Marcado «no alquilar»' : 'Marcado «con reparos»',
    motivo: p!.semaforo!.motivo,
    por: p!.semaforo!.por,
  };
});
const error = ref('');
const guardando = ref(false);

interface Plantilla { id: string; tipo: string; nombre: string; activa: boolean }

/** Las de pre-contrato de esta inmobiliaria. `null` = todavía no se sabe. */
const plantillasPre = ref<Plantilla[] | null>(null);
const sembrando = ref(false);

/**
 * Cuál se va a usar: la misma que elige el backend —la primera por nombre entre
 * las activas—. Se muestra el nombre para que nadie se entere después de cuál
 * salió el papel que firmó.
 */
const plantillaElegida = computed(() => plantillasPre.value?.[0] ?? null);

/** `sembrar` es owner/admin. A un asesor no se le dibuja un botón que da 403. */
const puedeSembrar = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

const f = reactive({
  propiedadId: '', fechaInicio: '', fechaFin: '',
  montoInicial: '', moneda: 'ARS', diaVencimiento: '10',
  indice: 'ipc', indicePorcentaje: '', periodicidadMeses: '3', mesBase: '',
  honorariosPct: '10', administrado: true,
  locatarioId: '', deposito: '',
});

/**
 * `GET /plantillas` lo lee cualquier rol. Va en su propio `catch`: que no se
 * sepa qué plantillas hay no puede impedir cargar un contrato, así que el aviso
 * queda en `null` —«no se sabe»— y el formulario sigue andando.
 */
async function cargarPlantillas() {
  try {
    const ps = await api<Plantilla[]>('/plantillas');
    plantillasPre.value = ps
      .filter((p) => p.tipo === 'pre_contrato_alquiler' && p.activa)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch {
    plantillasPre.value = null;
  }
}

onMounted(async () => {
  try {
    const [p, pe] = await Promise.all([
      api<{ items: typeof propiedades.value }>('/propiedades?porPagina=100'),
      api<{ items: typeof personas.value }>('/personas?porPagina=100'),
      cargarPlantillas(),
    ]);
    propiedades.value = p.items; personas.value = pe.items;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los datos.';
  }
});

/** «Traer las plantillas base» sin salir del formulario: es idempotente. */
async function sembrarPlantillas() {
  sembrando.value = true;
  try {
    await api('/plantillas/sembrar', { method: 'POST', body: '{}' });
    await cargarPlantillas();
    if (plantillaElegida.value) {
      ui.ok('Plantillas base cargadas', `El pre-contrato va a salir de «${plantillaElegida.value.nombre}».`);
    }
  } catch (e) {
    ui.error(
      'No se pudieron traer las plantillas base',
      e instanceof ApiError ? e.paraMostrar : 'Probá desde Plantillas.',
    );
  } finally { sembrando.value = false; }
}

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

/**
 * ¿Quedó el papel? Se pregunta, no se supone.
 *
 * Devuelve el nombre del pre-contrato que existe, o `null`. Si la consulta falla
 * también devuelve `null`: no saber y no haber son distintos, y el toast lo
 * distingue con el texto — pero ninguno de los dos puede frenar la navegación.
 */
async function preContratoDe(contratoId: string): Promise<string | null> {
  const docs = await api<Array<{ plantillaTipo: string; plantillaNombre: string }>>(
    `/contratos/${contratoId}/documentos`,
  );
  return docs.find((d) => d.plantillaTipo === 'pre_contrato_alquiler')?.plantillaNombre ?? null;
}

async function guardar() {
  error.value = ''; guardando.value = true;
  try {
    const r = await api<{ id: string }>('/contratos', {
      method: 'POST',
      body: JSON.stringify({
        propiedadId: f.propiedadId,
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        diaVencimiento: num(f.diaVencimiento),
        montoInicial: num(f.montoInicial),
        moneda: f.moneda,
        indice: f.indice,
        indicePorcentaje: f.indice === 'porcentaje_fijo' ? num(f.indicePorcentaje) : undefined,
        periodicidadMeses: f.indice === 'ninguno' ? undefined : num(f.periodicidadMeses),
        mesBase: f.mesBase ? `${f.mesBase}-01` : undefined,
        honorariosPct: num(f.honorariosPct),
        administrado: f.administrado,
        deposito: num(f.deposito),
        locatarios: f.locatarioId ? [f.locatarioId] : undefined,
      }),
    });

    // Desde acá el contrato YA EXISTE. Nada de lo que siga puede tirar hacia
    // afuera: se navega igual y el resultado del papel se dice por toast, nunca
    // como un error rojo al lado de un éxito (la lección de Vencimientos).
    let nombre: string | null = null;
    let falloLaConsulta = false;
    try {
      nombre = await preContratoDe(r.id);
    } catch {
      falloLaConsulta = true;
    }

    if (nombre) {
      ui.ok('Contrato creado', `El pre-contrato quedó armado con «${nombre}» y sin mandar.`);
    } else if (falloLaConsulta) {
      // No se afirma ni que está ni que no está: se dice dónde mirar.
      ui.ok('Contrato creado', 'Mirá el bloque «Pre-contrato y avisos» de la ficha.');
    } else {
      ui.error(
        'El contrato se creó, pero sin pre-contrato',
        'Esta inmobiliaria no tiene una plantilla de pre-contrato de locación activa. '
          + 'Traé las base desde Plantillas y generalo desde la ficha.',
      );
    }

    // `?nuevo=1`: la ficha abre garantes, comisión y pre-contrato **sólo para
    // esta visita**, sin escribir la preferencia, y el panel de documentos
    // aterriza con el texto ya abierto en el textarea.
    router.replace(`/contratos/${r.id}?nuevo=1`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Nuevo contrato"
      bajada="Cada contrato lleva su índice y su periodicidad: desde el DNU 70/2023 son de forma libre." />

    <form class="stack" @submit.prevent="guardar">
      <section class="card stack">
        <h2>Propiedad y plazo</h2>
        <div class="grid">
          <label class="campo ancho2"><span>Propiedad *</span>
            <select v-model="f.propiedadId" required>
              <option value="" disabled>Elegí una…</option>
              <option v-for="p in propiedades" :key="p.id" :value="p.id">
                {{ p.etiqueta }} — {{ p.direccion }}
              </option>
            </select>
          </label>
          <label class="campo"><span>Inicio *</span><input v-model="f.fechaInicio" type="date" required /></label>
          <label class="campo"><span>Fin *</span><input v-model="f.fechaFin" type="date" required /></label>
          <label class="campo"><span>Inquilino</span>
            <select v-model="f.locatarioId">
              <option value="">—</option>
              <option v-for="p in personas" :key="p.id" :value="p.id">{{ p.nombreCompleto }}</option>
            </select>
          </label>
        </div>

        <!-- El aviso, si esta persona está marcada. Avisa: no impide nada, y el
             botón de guardar sigue habilitado. -->
        <p v-if="avisoInquilino" class="aviso-semaforo" :class="avisoInquilino.tono">
          <strong>{{ avisoInquilino.titulo }}</strong>
          <template v-if="avisoInquilino.motivo"> — {{ avisoInquilino.motivo }}</template>
          <span v-if="avisoInquilino.por" class="quien">Lo marcó {{ avisoInquilino.por }}.</span>
        </p>
      </section>

      <section class="card stack">
        <h2>Dinero</h2>
        <div class="grid">
          <label class="campo"><span>Moneda</span>
            <select v-model="f.moneda"><option value="ARS">ARS</option><option value="USD">USD</option></select>
          </label>
          <label class="campo"><span>Alquiler inicial *</span><input v-model="f.montoInicial" inputmode="decimal" required /></label>
          <label class="campo"><span>Vence el día</span><input v-model="f.diaVencimiento" inputmode="numeric" /></label>
          <label class="campo"><span>Honorarios %</span><input v-model="f.honorariosPct" inputmode="decimal" /></label>
          <label class="campo"><span>Depósito</span><input v-model="f.deposito" inputmode="decimal" /></label>
        </div>
        <label class="check">
          <input v-model="f.administrado" type="checkbox" />
          <span>
            <strong>Administrado</strong> — {{ laCasa(auth.tipoCuenta) }} cobra y liquida al propietario.
            Sin tildar, es sólo intermediación y no genera cuotas.
          </span>
        </label>
      </section>

      <section class="card stack">
        <h2>Actualización</h2>
        <div class="grid">
          <label class="campo"><span>Índice</span>
            <select v-model="f.indice">
              <option value="ipc">IPC — INDEC</option>
              <option value="icl">ICL — BCRA</option>
              <option value="uva">UVA — BCRA</option>
              <option value="icp">Casa Propia</option>
              <option value="porcentaje_fijo">Porcentaje fijo</option>
              <option value="ninguno">Sin actualización</option>
            </select>
          </label>
          <label v-if="f.indice === 'porcentaje_fijo'" class="campo">
            <span>Porcentaje</span><input v-model="f.indicePorcentaje" inputmode="decimal" />
          </label>
          <label v-if="f.indice !== 'ninguno'" class="campo">
            <span>Cada (meses)</span><input v-model="f.periodicidadMeses" inputmode="numeric" />
          </label>
          <label v-if="!['ninguno', 'porcentaje_fijo'].includes(f.indice)" class="campo">
            <span>Mes base</span><input v-model="f.mesBase" type="month" />
          </label>
        </div>
        <p class="nota">
          El mes base es contra el que se mide el primer aumento. Si se deja vacío, se toma
          el mes de inicio del contrato.
        </p>
      </section>

      <!-- ── El pre-contrato ──────────────────────────────────────────────────
           No es un control: es un aviso. El documento se arma solo al guardar,
           así que lo único que se puede hacer acá es decir de qué plantilla va a
           salir y qué NO va a traer. Un papel que parece completo y no lo es, en
           algo con efecto legal, es lo más caro que puede pasar en esta
           pantalla. -->
      <section class="card stack">
        <h2>Pre-contrato de locación</h2>

        <template v-if="plantillasPre === null">
          <p class="nota">
            No se pudo leer el listado de plantillas. El contrato se crea igual; el
            pre-contrato lo vas a ver —o no— en la ficha, en «Pre-contrato y avisos».
          </p>
        </template>

        <template v-else-if="plantillaElegida">
          <p class="nota">
            Al crear el contrato, el pre-contrato <strong>se arma solo</strong> con la
            plantilla «{{ plantillaElegida.nombre }}» y queda guardado en la ficha, con
            el texto listo para editar, imprimir o mandar. No hay que apretar nada más.
            <span v-if="plantillasPre.length > 1" class="apagado">
              Hay {{ plantillasPre.length }} plantillas de este tipo: se usa la primera por
              nombre. Para otra, generala desde la ficha o desactivá las que no correspondan
              en Plantillas.
            </span>
          </p>

          <ul class="ojo">
            <li v-if="!f.locatarioId">
              <strong>Sin inquilino elegido</strong>, el pre-contrato sale sin la parte
              locataria: los espacios del inquilino quedan marcados como faltantes y se
              completan a mano.
            </li>
            <li>
              Los <strong>garantes</strong> se cargan después, en la ficha del contrato: la
              cláusula de garantía no se va a imprimir en este documento, y eso no aparece
              como dato faltante porque el modelo la omite entera.
            </li>
            <li>
              El documento es una <strong>foto del momento</strong>. Cargar el inquilino o
              los garantes más tarde no lo actualiza: para que salgan, hay que generar uno
              nuevo desde la ficha.
            </li>
          </ul>
        </template>

        <template v-else>
          <p class="nota aviso">
            Esta inmobiliaria <strong>no tiene ninguna plantilla de pre-contrato de
            locación</strong> activa. El contrato se va a crear igual, pero sin
            pre-contrato.
          </p>
          <div v-if="puedeSembrar" class="row">
            <button class="btn secondary sm" type="button" :disabled="sembrando"
              @click="sembrarPlantillas">
              {{ sembrando ? 'Trayendo…' : 'Traer las plantillas base' }}
            </button>
            <span class="apagado">Se cargan las cuatro plantillas base y quedan editables.</span>
          </div>
          <p v-else class="nota">
            Las puede traer el titular o Administración, desde
            <RouterLink to="/plantillas">Plantillas</RouterLink>.
          </p>
        </template>
      </section>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn" type="submit" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Crear contrato' }}</button>
        <button class="btn secondary" type="button" @click="router.back()">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--s-md); }
.ancho2 { grid-column: span 2; }
.campo input, .campo select { font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.check { display: flex; gap: var(--s-sm); align-items: flex-start; font-size: 13px; color: var(--muted); }
.check input { margin-top: 3px; }
.check strong { color: var(--ink); }

/* Contraste medido calculando el ratio, no mirando —la trampa de `--muted-2` a
   3,01 sobre `--surface-2` está en la tabla de `docs/CONTINUAR.md`, y a ojo
   parecía correcto—. Los cuatro colores nuevos de esta pantalla, en los dos
   temas (claro / oscuro):

   | Qué | Color | Sobre | Claro | Oscuro |
   |---|---|---|---|---|
   | `.apagado`      | `--muted`       | `--surface`      | 5,87 | 6,42 |
   | `.ojo`          | `--ink-2`       | `--surface-2`    | 9,73 | 10,00 |
   | viñeta de `.ojo`| `--muted`       | `--surface-2`    | 5,29 | 5,66 |
   | `.aviso`        | `--warning-ink` | `--warning-tint` | 5,01 | 6,36 |

   El más justo es el `.aviso` en claro con 5,01: pasa AA (4,5) y no AAA (7).
   Es texto de aviso, no cuerpo largo, así que se deja — pero si alguien aclara
   `--warning-tint`, ése es el que se cae primero. */
.apagado { color: var(--muted); }

/* Lo que el pre-contrato NO va a traer. Va como lista y no como párrafo porque
   son tres cosas independientes y una de ellas aparece y desaparece según el
   inquilino: mezcladas en una frase, el que lee se pierde justo la suya. */
.ojo {
  margin: 0;
  padding: var(--s-md);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  background: var(--surface-2);
  border-radius: var(--r-md);
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
}
.ojo li { position: relative; padding-left: var(--s-lg); }
.ojo li::before { content: '·'; position: absolute; left: var(--s-sm); color: var(--muted); }

.aviso {
  padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint);
  border: 1px solid var(--warning-line);
  border-radius: var(--r-md);
  color: var(--warning-ink);
}

/* El aviso del semáforo. Ocupa el ancho entero y va debajo del selector: al
   costado, en una grilla de tres columnas, quedaría del tamaño de una etiqueta
   y se saltearía. */
.aviso-semaforo {
  margin: var(--s-sm) 0 0; padding: var(--s-sm) var(--s-md);
  border-radius: var(--r-md); font-size: 13px; line-height: 1.5;
}
.aviso-semaforo.ok { background: var(--success-tint); color: var(--success-ink); }
.aviso-semaforo.warn { background: var(--warning-tint); color: var(--warning-ink); }
.aviso-semaforo.err { background: var(--danger-tint); color: var(--danger); }
.aviso-semaforo .quien { display: block; opacity: .8; font-size: 12px; margin-top: 2px; }
</style>
