<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

/**
 * Los canales conectados.
 *
 * ── La credencial entra y no sale ──
 *
 * El token se escribe una vez y no se puede volver a ver: en la base está
 * cifrado y no hay endpoint que lo devuelva, ni al titular. Un token que la
 * pantalla puede mostrar es un token que termina en una captura de pantalla, en
 * el historial del navegador o en un log del proxy — y con ese token cualquiera
 * le escribe a los clientes de la inmobiliaria haciéndose pasar por ella.
 *
 * Lo que sí se muestra es si el canal FUNCIONA, con el motivo cuando no. Es la
 * pregunta real de esta pantalla, y es la misma honestidad de
 * `GET /avisos/canales`: nada de un ✓ al lado de algo que no anda.
 */

interface Cuenta {
  id: string; canal: string; proveedor: string; nombre: string;
  identificador: string; activa: boolean;
  disponible: boolean; detalle: string; tieneSecreto: boolean;
  rutaWebhook: string; creadaEl: string;
}

const ETIQUETA_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', email: 'Correo',
  instagram: 'Instagram', facebook: 'Facebook', sms: 'SMS',
};

/** Qué hace falta para cada combinación, dicho antes de que lo pregunten. */
const AYUDA: Record<string, string> = {
  'telegram/telegram':
    'Se saca de @BotFather en Telegram: /newbot y te da el token. Gratis y sin trámite.',
  'whatsapp/twilio':
    'Account SID y Auth Token del panel de Twilio. El sandbox de WhatsApp funciona sin verificación de Meta.',
  'sms/twilio': 'Account SID y Auth Token del panel de Twilio.',
  'whatsapp/meta':
    'Requiere verificación de negocio en Meta y plantillas aprobadas. Suele llevar semanas.',
  'instagram/meta': 'Requiere una cuenta de Instagram Business vinculada y verificación en Meta.',
  'facebook/meta': 'Requiere una página de Facebook y verificación en Meta.',
  'email/smtp': 'Todavía no está implementado el envío. Se puede recibir, pero no responder.',
};

const cuentas = ref<Cuenta[]>([]);
const catalogo = ref<Array<{ proveedor: string; canales: string[] }>>([]);
const cargando = ref(true);
const error = ref('');
const guardando = ref(false);

const abrirAlta = ref(false);
const nueva = reactive({
  canal: 'telegram', proveedor: 'telegram', nombre: '', identificador: '', secreto: '',
});

/** Los pares (canal, proveedor) posibles, armados desde lo que dice el back. */
const combinaciones = computed(() =>
  catalogo.value.flatMap((p) => p.canales.map((c) => ({
    valor: `${c}/${p.proveedor}`,
    etiqueta: `${ETIQUETA_CANAL[c] ?? c} · ${p.proveedor}`,
  }))),
);

const ayudaActual = computed(() => AYUDA[`${nueva.canal}/${nueva.proveedor}`] ?? '');

function elegirCombinacion(valor: string) {
  const [canal, proveedor] = valor.split('/');
  nueva.canal = canal;
  nueva.proveedor = proveedor;
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [lista, cat] = await Promise.all([
      api<Cuenta[]>('/canales'),
      api<Array<{ proveedor: string; canales: string[] }>>('/canales/catalogo'),
    ]);
    cuentas.value = lista;
    catalogo.value = cat;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los canales.';
  } finally { cargando.value = false; }
}

async function crear() {
  guardando.value = true; error.value = '';
  try {
    await api('/canales', {
      method: 'POST',
      body: JSON.stringify({
        canal: nueva.canal, proveedor: nueva.proveedor,
        nombre: nueva.nombre, identificador: nueva.identificador,
        secreto: nueva.secreto || undefined,
      }),
    });
    abrirAlta.value = false;
    nueva.nombre = ''; nueva.identificador = ''; nueva.secreto = '';
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar el canal.';
  } finally { guardando.value = false; }
}

async function activar(c: Cuenta, activa: boolean) {
  try {
    await api(`/canales/${c.id}`, { method: 'PATCH', body: JSON.stringify({ activa }) });
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo actualizar.';
  }
}

async function borrar(c: Cuenta) {
  if (!confirm(
    `Se desconecta «${c.nombre}». Las conversaciones y sus mensajes se borran con el canal. `
    + 'No se puede deshacer.',
  )) return;
  try {
    await api(`/canales/${c.id}`, { method: 'DELETE' });
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo desconectar.';
  }
}

const urlWebhook = (c: Cuenta) => `${window.location.origin}${c.rutaWebhook}`;

/** El resultado de conectar o buscar, por cuenta. Se muestra tal cual. */
const resultado = ref<Record<string, string>>({});
const ocupado = ref<string | null>(null);

async function conectar(c: Cuenta) {
  ocupado.value = c.id;
  try {
    const r = await api<{ ok: boolean; detalle: string }>(`/canales/${c.id}/conectar`, {
      method: 'POST',
    });
    resultado.value = { ...resultado.value, [c.id]: r.detalle };
    await cargar();
  } catch (e) {
    resultado.value = {
      ...resultado.value,
      [c.id]: e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar.',
    };
  } finally { ocupado.value = null; }
}

/**
 * Traer mensajes sin webhook.
 *
 * Es el camino de desarrollo y la pantalla lo dice: en una laptop no hay URL
 * pública a la que Telegram pueda pegarle. En un servidor con TLS esto no hace
 * falta porque los mensajes entran solos.
 */
async function buscarMensajes(c: Cuenta) {
  ocupado.value = c.id;
  try {
    const r = await api<{ recibidos: number; detalle: string }>(`/canales/${c.id}/sondear`, {
      method: 'POST',
    });
    resultado.value = { ...resultado.value, [c.id]: r.detalle };
  } catch (e) {
    resultado.value = {
      ...resultado.value,
      [c.id]: e instanceof ApiError ? e.paraMostrar : 'No se pudo buscar.',
    };
  } finally { ocupado.value = null; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Canales"
      bajada="Por dónde entran y salen los mensajes de la bandeja.">
      <template #acciones>
        <RouterLink class="btn secondary sm" to="/inbox">Ir a la bandeja</RouterLink>
        <button class="btn" type="button" @click="abrirAlta = !abrirAlta">
          {{ abrirAlta ? 'Cancelar' : 'Conectar un canal' }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <section v-if="abrirAlta" class="card stack">
      <h2>Conectar un canal</h2>
      <form class="stack" @submit.prevent="crear">
        <label class="campo">
          <span>Canal y proveedor</span>
          <select :value="`${nueva.canal}/${nueva.proveedor}`"
            @change="elegirCombinacion(($event.target as HTMLSelectElement).value)">
            <option v-for="c in combinaciones" :key="c.valor" :value="c.valor">{{ c.etiqueta }}</option>
          </select>
        </label>

        <p v-if="ayudaActual" class="ayuda">{{ ayudaActual }}</p>

        <label class="campo">
          <span>Nombre interno</span>
          <input v-model="nueva.nombre" required minlength="2" maxlength="60"
            placeholder="Ventas" />
          <small>Lo ve tu equipo en la bandeja. No lo ve el cliente.</small>
        </label>

        <label class="campo">
          <span>Identificador</span>
          <input v-model="nueva.identificador" required maxlength="200"
            placeholder="@mi_bot / whatsapp:+5492610000000 / casilla@inmobiliaria.com" />
        </label>

        <label class="campo">
          <span>Credencial</span>
          <input v-model="nueva.secreto" type="password" maxlength="500"
            autocomplete="off" placeholder="Token del bot / Auth Token" />
          <!-- Se dice acá, donde se pega, y no en una página de ayuda. -->
          <small>
            Se guarda cifrada y <strong>no se puede volver a ver</strong>. Si la perdés,
            se carga una nueva.
          </small>
        </label>

        <div class="row">
          <button class="btn" type="submit" :disabled="guardando">
            {{ guardando ? 'Conectando…' : 'Conectar' }}
          </button>
        </div>
      </form>
    </section>

    <UiSkeleton v-if="cargando" :filas="2" :alto="90" />

    <UiEmpty
      v-else-if="!cuentas.length"
      titulo="No hay canales conectados"
      detalle="Telegram es el más rápido para empezar: un token de @BotFather y listo, sin trámite." />

    <section v-for="c in cuentas" v-else :key="c.id" class="card cuenta">
      <div class="datos">
        <div class="titulo">
          <strong>{{ c.nombre }}</strong>
          <span class="canal">{{ ETIQUETA_CANAL[c.canal] ?? c.canal }} · {{ c.proveedor }}</span>
        </div>
        <span class="ident mono">{{ c.identificador }}</span>

        <!-- El estado real, con el motivo. Nunca un ✓ al lado de algo que no anda. -->
        <div class="estado">
          <StatusChip
            :texto="c.disponible ? 'Funcionando' : 'No puede enviar'"
            :tono="c.disponible ? 'ok' : 'warn'" />
          <span class="detalle">{{ c.detalle }}</span>
        </div>

        <p v-if="resultado[c.id]" class="resultado">{{ resultado[c.id] }}</p>

        <details class="webhook">
          <summary>URL del webhook</summary>
          <p class="nota">
            Es donde el proveedor tiene que avisar los mensajes nuevos. Pegala en
            el panel de {{ c.proveedor }}.
          </p>
          <code class="mono">{{ urlWebhook(c) }}</code>
          <p class="nota">
            En desarrollo esta URL es local y no le llega desde afuera. Telegram
            además permite recibir sin webhook.
          </p>
        </details>
      </div>

      <div class="acciones">
        <button class="btn sm" type="button" :disabled="ocupado === c.id"
          @click="conectar(c)">
          {{ ocupado === c.id ? 'Probando…' : 'Probar y conectar' }}
        </button>
        <button v-if="c.proveedor === 'telegram'" class="btn secondary sm" type="button"
          :disabled="ocupado === c.id" @click="buscarMensajes(c)">
          Buscar mensajes
        </button>
        <button class="btn secondary sm" type="button" @click="activar(c, !c.activa)">
          {{ c.activa ? 'Desactivar' : 'Activar' }}
        </button>
        <button class="btn secondary sm" type="button" @click="borrar(c)">Desconectar</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
h2 { margin: 0; font-size: 15px; }
.campo { display: flex; flex-direction: column; gap: var(--s-2xs); }
.campo input, .campo select {
  font: inherit; padding: 8px var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.campo small, .nota { font-size: 12px; color: var(--muted); line-height: 1.5; }
.ayuda {
  margin: 0; font-size: 13px; padding: var(--s-sm) var(--s-md);
  background: var(--surface-2); border-radius: var(--r-md); line-height: 1.6;
}

.cuenta { display: flex; gap: var(--s-md); align-items: flex-start; }
.datos { display: flex; flex-direction: column; gap: var(--s-2xs); margin-right: auto; min-width: 0; }
.titulo { display: flex; align-items: baseline; gap: var(--s-sm); flex-wrap: wrap; }
.canal { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.ident { font-size: 13px; color: var(--muted); }
.estado { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; margin-top: var(--s-2xs); }
.detalle { font-size: 12px; color: var(--muted); }
.webhook { margin-top: var(--s-xs); }
.webhook summary { font-size: 12px; color: var(--muted); cursor: pointer; }
.webhook code {
  display: block; font-size: 11px; word-break: break-all; margin: var(--s-2xs) 0;
  background: var(--surface-2); padding: var(--s-xs) var(--s-sm); border-radius: var(--r-sm);
}
.acciones { display: flex; flex-direction: column; gap: var(--s-xs); }
.resultado {
  margin: var(--s-xs) 0 0; font-size: 12px; line-height: 1.5;
  padding: var(--s-xs) var(--s-sm); background: var(--surface-2);
  border-radius: var(--r-sm); max-width: 66ch;
}
</style>
