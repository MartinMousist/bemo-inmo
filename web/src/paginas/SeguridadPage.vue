<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha } from '../dominio/formato';

/**
 * La seguridad de la propia cuenta: verificación en dos pasos.
 *
 * ── Por qué el QR se dibuja acá y no lo manda el servidor ──
 *
 * Porque el secreto no tiene por qué pasar dos veces por la red ni quedar en un
 * PNG cacheable. El servidor manda la URI `otpauth://` y el navegador la pinta.
 *
 * La librería entra por `import()` diferido: son ~20 KB que sólo se descargan
 * cuando alguien abre esta pantalla, que es una vez en la vida de una cuenta.
 *
 * ── El secreto en texto, siempre visible ──
 *
 * No como plan B escondido detrás de «no puedo escanear»: hay gente que usa el
 * gestor de contraseñas de la computadora y nunca va a apuntarle el teléfono a
 * la pantalla. Que las dos formas estén al mismo nivel es lo que evita que
 * alguien abandone el alta.
 */

interface Estado {
  activo: boolean;
  confirmadoEl: string | null;
  codigosSinUsar: number;
}

interface Retencion {
  aniosLegajos: number;
  mesesBcra: number;
  legajosVencidos: { documentos: number; garantes: number; contratoMasViejo: string | null };
  bcraVencidas: number;
}

const estado = ref<Estado | null>(null);
const cargando = ref(true);
const error = ref('');

/** El alta en curso. */
const alta = ref<{ secreto: string; uri: string } | null>(null);
const qr = ref('');
const codigo = ref('');
const enviando = ref(false);

/** Se muestran UNA vez: en la base están hasheados y no se pueden recuperar. */
const recuperacion = ref<string[]>([]);

const apagando = ref(false);
const codigoApagar = ref('');

/**
 * Retención de datos personales.
 *
 * Sólo para titular y administración: el back contesta 403 al resto, así que el
 * bloque no se muestra en vez de ofrecer un botón que va a fallar.
 */
const retencion = ref<Retencion | null>(null);
const purgando = ref(false);
const purgado = ref('');

async function cargarRetencion() {
  try {
    retencion.value = await api<Retencion>('/datos-personales/retencion');
  } catch {
    // 403 para asesor y contable: el bloque simplemente no va.
    retencion.value = null;
  }
}

async function purgar() {
  if (!confirm(
    'Se borran definitivamente los documentos de garantes de contratos '
    + 'terminados hace más de ' + retencion.value?.aniosLegajos + ' años, y el '
    + 'desglose de las consultas al BCRA más viejas. No se puede deshacer.',
  )) return;

  purgando.value = true;
  error.value = '';
  try {
    const r = await api<{
      documentosBorrados: number; archivosBorrados: number; consultasBcraPurgadas: number;
    }>('/datos-personales/retencion/purgar', { method: 'POST' });

    purgado.value = `Se borraron ${r.documentosBorrados} documentos `
      + `(${r.archivosBorrados} archivos) y se purgó el desglose de `
      + `${r.consultasBcraPurgadas} consultas al BCRA.`;
    await cargarRetencion();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo purgar.';
  } finally {
    purgando.value = false;
  }
}

async function cargar() {
  cargando.value = true;
  try {
    estado.value = await api<Estado>('/cuenta/seguridad');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar.';
  } finally {
    cargando.value = false;
  }
}

async function iniciar() {
  error.value = '';
  enviando.value = true;
  try {
    alta.value = await api<{ secreto: string; uri: string }>('/cuenta/seguridad/2fa', {
      method: 'POST',
    });
    // `qrcode` es CommonJS: Vite lo interopera exponiendo TODO bajo `default`,
    // así que un `const { toDataURL } = await import(...)` deja la función en
    // `undefined` y revienta recién al llamarla. Se toma del default.
    const qrcode = (await import('qrcode')).default;
    qr.value = await qrcode.toDataURL(alta.value.uri, { margin: 1, width: 220 });
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo empezar.';
  } finally {
    enviando.value = false;
  }
}

async function confirmar() {
  error.value = '';
  enviando.value = true;
  try {
    const r = await api<{ codigosRecuperacion: string[] }>(
      '/cuenta/seguridad/2fa/confirmar',
      { method: 'POST', body: JSON.stringify({ codigo: codigo.value }) },
    );
    recuperacion.value = r.codigosRecuperacion;
    alta.value = null;
    qr.value = '';
    codigo.value = '';
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo confirmar.';
    codigo.value = '';
  } finally {
    enviando.value = false;
  }
}

async function desactivar() {
  error.value = '';
  enviando.value = true;
  try {
    await api('/cuenta/seguridad/2fa/desactivar', {
      method: 'POST',
      body: JSON.stringify({ codigo: codigoApagar.value }),
    });
    apagando.value = false;
    codigoApagar.value = '';
    recuperacion.value = [];
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo desactivar.';
  } finally {
    enviando.value = false;
  }
}

/** Descargar los códigos: es lo que hay que hacer con ellos, no leerlos. */
function descargarCodigos() {
  const texto = [
    'Códigos de recuperación — Bemo INMO',
    'Cada uno sirve UNA sola vez. Guardalos donde no esté tu teléfono.',
    '',
    ...recuperacion.value,
  ].join('\n');

  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bemo-inmo-codigos-recuperacion.txt';
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(async () => {
  await cargar();
  await cargarRetencion();
});
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Seguridad"
      bajada="La protección de tu cuenta. Cada persona administra la suya." />

    <UiSkeleton v-if="cargando" :filas="2" :alto="90" />

    <template v-else>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <!-- Los códigos, apenas se confirma. Ocupan la pantalla entera a
           propósito: es la única vez que se pueden ver. -->
      <section v-if="recuperacion.length" class="card stack destacado">
        <h2>Guardá estos códigos ahora</h2>
        <p class="nota">
          Son tu forma de entrar si perdés el teléfono. Cada uno sirve una sola
          vez y <strong>no se pueden volver a ver</strong>: en nuestra base están
          guardados de forma que ni nosotros los conocemos.
        </p>
        <ul class="codigos mono">
          <li v-for="c in recuperacion" :key="c">{{ c }}</li>
        </ul>
        <div class="row">
          <button class="btn" type="button" @click="descargarCodigos">Descargar</button>
          <button class="btn secondary" type="button" @click="recuperacion = []">
            Ya los guardé
          </button>
        </div>
      </section>

      <section class="card stack">
        <header class="cab">
          <div>
            <h2>Verificación en dos pasos</h2>
            <p class="nota">
              Además de la contraseña, un código de seis dígitos que cambia cada
              treinta segundos.
            </p>
          </div>
          <StatusChip
            :texto="estado?.activo ? 'Activa' : 'Sin activar'"
            :tono="estado?.activo ? 'ok' : 'warn'" />
        </header>

        <!-- Activa -->
        <template v-if="estado?.activo && !apagando">
          <p class="dato">
            Activa desde el {{ fecha(estado.confirmadoEl!) }} ·
            {{ estado.codigosSinUsar }} códigos de recuperación sin usar
          </p>
          <!-- Se avisa antes de que se queden sin ninguno: sin códigos y sin
               teléfono, la cuenta no se recupera. -->
          <p v-if="estado.codigosSinUsar <= 2" class="alerta-suave">
            Te quedan pocos códigos de recuperación. Desactivá y volvé a activar
            la verificación para generar ocho nuevos.
          </p>
          <div>
            <button class="btn secondary" type="button" @click="apagando = true">
              Desactivar
            </button>
          </div>
        </template>

        <!-- Apagándola -->
        <form v-else-if="apagando" class="stack" @submit.prevent="desactivar">
          <p class="nota">
            Escribí un código de tu app para confirmar que sos vos. Pedirlo no es
            burocracia: sin esto, cualquiera que agarre tu sesión abierta apaga
            la verificación y se queda con la cuenta.
          </p>
          <label class="campo">
            <span>Código</span>
            <input
              v-model="codigoApagar" class="mono" inputmode="numeric"
              autocomplete="one-time-code" required maxlength="24" placeholder="123456" />
          </label>
          <div class="row">
            <button class="btn" type="submit" :disabled="enviando">
              {{ enviando ? 'Desactivando…' : 'Desactivar' }}
            </button>
            <button class="btn secondary" type="button" @click="apagando = false">
              Cancelar
            </button>
          </div>
        </form>

        <!-- El alta -->
        <template v-else-if="alta">
          <ol class="pasos">
            <li>Escaneá el código con Google Authenticator, Aegis, 1Password o la que uses.</li>
            <li>Escribí el código de seis dígitos que aparece.</li>
          </ol>

          <div class="alta">
            <img v-if="qr" :src="qr" alt="Código QR para la app de autenticación" />
            <div class="stack manual">
              <span class="et">O cargalo a mano</span>
              <code class="secreto mono">{{ alta.secreto }}</code>
              <span class="nota">
                Tipo: por tiempo (TOTP) · 6 dígitos · cada 30 segundos
              </span>
            </div>
          </div>

          <form class="stack" @submit.prevent="confirmar">
            <label class="campo">
              <span>Código de la app</span>
              <input
                v-model="codigo" class="mono" inputmode="numeric" autofocus
                autocomplete="one-time-code" required maxlength="6" placeholder="123456" />
            </label>
            <div class="row">
              <button class="btn" type="submit" :disabled="enviando">
                {{ enviando ? 'Verificando…' : 'Activar' }}
              </button>
              <button class="btn secondary" type="button" @click="alta = null">
                Cancelar
              </button>
            </div>
          </form>
        </template>

        <!-- Apagada -->
        <template v-else>
          <div>
            <button class="btn" type="button" :disabled="enviando" @click="iniciar">
              {{ enviando ? 'Preparando…' : 'Activar verificación en dos pasos' }}
            </button>
          </div>
        </template>
      </section>

      <!-- Retención. Sólo lo ven titular y administración: para el resto el
           back contesta 403 y el bloque no se arma. -->
      <section v-if="retencion" class="card stack">
        <header class="cab">
          <div>
            <h2>Datos personales que ya no hacen falta</h2>
            <p class="nota">
              El legajo de un garante existe para decidir si se lo acepta en un
              contrato. Terminado ese contrato, la foto de su DNI y sus recibos
              de sueldo no cumplen ninguna finalidad y siguen siendo un riesgo
              —para él—. La Ley 25.326 no fija un plazo: fija que el dato no se
              guarda más allá de para lo que se juntó.
            </p>
          </div>
        </header>

        <p v-if="purgado" class="ok-aviso">{{ purgado }}</p>

        <dl class="cifras">
          <div>
            <dt>Documentos de garantes vencidos</dt>
            <dd class="mono">{{ retencion.legajosVencidos.documentos }}</dd>
            <span class="pie-dato">
              de contratos terminados hace más de {{ retencion.aniosLegajos }} años
            </span>
          </div>
          <div>
            <dt>Consultas al BCRA con desglose</dt>
            <dd class="mono">{{ retencion.bcraVencidas }}</dd>
            <span class="pie-dato">
              con más de {{ retencion.mesesBcra }} meses. Se borra el detalle banco
              por banco; el veredicto se conserva
            </span>
          </div>
        </dl>

        <template v-if="retencion.legajosVencidos.documentos || retencion.bcraVencidas">
          <!-- Se dice por qué el sistema no lo hace solo. Un proceso que borra
               prueba a las tres de la mañana deja a la inmobiliaria sin nada que
               mostrar si eso se discute justo esa semana. -->
          <p class="nota">
            No se borra solo: un legajo es lo que respalda por qué se aceptó a ese
            garante. La purga la pide una persona y queda registrada con su nombre.
          </p>
          <div>
            <button class="btn secondary" type="button" :disabled="purgando" @click="purgar">
              {{ purgando ? 'Borrando…' : 'Borrar lo vencido' }}
            </button>
          </div>
        </template>

        <p v-else class="nota">
          No hay nada vencido. Cuando lo haya, aparece acá.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cab { display: flex; align-items: flex-start; gap: var(--s-md); }
.cab > div { margin-right: auto; }
h2 { margin: 0; font-size: 15px; }
.nota { margin: var(--s-2xs) 0 0; font-size: 13px; color: var(--muted); max-width: 66ch; line-height: 1.6; }
.dato { margin: 0; font-size: 13px; }

.destacado { border: 2px solid var(--accent); }
.codigos {
  list-style: none; margin: 0; padding: var(--s-md);
  background: var(--surface-2); border-radius: var(--r-md);
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-xs);
  font-size: 14px; letter-spacing: 0.06em;
}

.pasos { margin: 0; padding-left: 1.2em; font-size: 13px; color: var(--muted); line-height: 1.8; }
.alta { display: flex; gap: var(--s-xl); align-items: center; flex-wrap: wrap; }
.alta img { border-radius: var(--r-md); background: #fff; padding: var(--s-xs); }
.manual { gap: var(--s-2xs); }
.et { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.secreto {
  font-size: 15px; letter-spacing: 0.12em; word-break: break-all;
  background: var(--surface-2); padding: var(--s-xs) var(--s-sm);
  border-radius: var(--r-sm); max-width: 30ch;
}

.alerta-suave {
  margin: 0; font-size: 13px; padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint, var(--surface-2)); border-radius: var(--r-md);
}

.cifras {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--s-lg); margin: 0;
}
.cifras dt { font-size: 12px; color: var(--muted); }
.cifras dd { margin: var(--s-2xs) 0 0; font-size: 24px; }
.pie-dato { font-size: 11px; color: var(--muted-2); line-height: 1.5; display: block; }

.campo input {
  font: inherit; padding: 10px var(--s-md); letter-spacing: 0.18em;
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); max-width: 22ch;
}
</style>
