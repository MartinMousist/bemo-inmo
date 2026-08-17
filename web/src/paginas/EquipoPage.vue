<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { etiquetaRol, ROLES_INVITABLES } from '../dominio/roles';
import { pct } from '../dominio/comisiones';

/** Los estados de una membresía, escritos para leer. */
const ETIQUETA_ESTADO: Record<string, string> = {
  activa: 'Activa',
  suspendida: 'Suspendida',
  revocada: 'Dada de baja',
};

/**
 * El equipo, con el % de comisión de cada persona editable en la fila.
 *
 * `membresia.comision_captador_pct` y `comision_cerrador_pct` existen desde la
 * migración 017, con su COMMENT explicando que NULL hereda, y **ninguna
 * consulta las devolvía**: el número estaba en la base y no había forma de
 * verlo ni de cambiarlo.
 *
 * Tres cosas de esta pantalla que son decisiones:
 *
 * **Vacío significa heredar, y se ve.** Un campo vacío muestra en gris el
 * número de la inmobiliaria que efectivamente rige. Un `0` es distinto: es
 * alguien que no cobra por captar. Por eso borrar el número es una acción
 * válida y se guarda como `null`.
 *
 * **La equivalencia al lado.** El % está en la unidad del motor —% de lo que le
 * queda a la casa— y una inmobiliaria piensa en % de la venta. Con 6 % de
 * honorarios, «25 % de lo que queda» es «1,5 % de la venta». Es la misma
 * traducción que ya hace la pantalla de Comisiones, y la mitad de las
 * discusiones de fin de mes salen de mezclar las dos.
 *
 * **Se avisa si los dos suman más de 100.** Alguien que capta Y cierra la misma
 * operación se llevaría más de lo que hay, y a la casa no le quedaría nada.
 */

interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  estado: string;
  comisionCaptadorPct: number | null;
  comisionCerradorPct: number | null;
}

interface Equipo {
  miembros: Miembro[];
  heredado: { captador: number; cerrador: number };
  totalVenta: number;
}

const auth = useAuth();
const ui = useUi();
const miembros = ref<Miembro[]>([]);
const heredado = ref({ captador: 25, cerrador: 25 });
const totalVenta = ref(6);
const cargando = ref(true);
const error = ref('');

/**
 * Quién puede tocar el %.
 *
 * owner + admin, y no sólo owner. `docs/spec.md §5` pone «Usuarios y roles»
 * como exclusivo del titular, pero esto es configuración de comisiones —el PUT
 * de la política ya está en owner+admin— y no alta de usuarios. El desvío
 * respecto del spec está escrito también en el controlador.
 */
const puedeEditarPct = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

/** Lo que se está editando: `usuarioId` o `null`. */
const editando = ref<string | null>(null);
const borrador = ref<{ captador: string; cerrador: string }>({ captador: '', cerrador: '' });
const guardando = ref(false);

function abrir(m: Miembro) {
  editando.value = m.usuarioId;
  // A texto y no a número: el campo vacío tiene que poder existir, porque vacío
  // es «heredar» y no cero.
  borrador.value = {
    captador: m.comisionCaptadorPct === null ? '' : String(m.comisionCaptadorPct),
    cerrador: m.comisionCerradorPct === null ? '' : String(m.comisionCerradorPct),
  };
}

function aNumero(v: string): number | null {
  const t = v.trim();
  return t === '' ? null : Number(t);
}

const borradorExcede = computed(() => {
  const a = aNumero(borrador.value.captador);
  const b = aNumero(borrador.value.cerrador);
  return a !== null && b !== null && a + b > 100;
});

/** `25 % de lo que queda` con 6 % de honorarios ⇒ `1,5 % de la venta`. */
function sobreLaVenta(interno: number): number {
  return Math.round(((totalVenta.value * interno) / 100 + Number.EPSILON) * 100) / 100;
}

/**
 * Guarda LOS DOS campos siempre.
 *
 * El endpoint los pide los dos y los escribe los dos, sin coalesce: `null` es
 * un valor con significado —heredar— y con coalesce nunca se podría volver
 * atrás de un override. Está explicado en el servicio, al lado del SQL.
 */
async function guardarPct(m: Miembro) {
  guardando.value = true; error.value = '';
  try {
    const actualizado = await api<Miembro>(`/equipo/${m.usuarioId}/comisiones`, {
      method: 'PATCH',
      body: JSON.stringify({
        comisionCaptadorPct: aNumero(borrador.value.captador),
        comisionCerradorPct: aNumero(borrador.value.cerrador),
      }),
    });
    miembros.value = miembros.value.map((x) =>
      x.usuarioId === m.usuarioId ? actualizado : x);
    editando.value = null;
    ui.ok('Porcentaje guardado', `${m.nombre} · pre-llena las operaciones nuevas.`);
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
    error.value = detalle;
    ui.error('No se pudo guardar el porcentaje', detalle);
  } finally { guardando.value = false; }
}

// Sólo el titular invita. El botón se muestra deshabilitado para los demás con
// la razón escrita: un control apagado y explicado se lee como permiso ajeno;
// uno ausente se lee como que la app está incompleta.
const puedeInvitar = () => auth.rol === 'owner';

const invitando = ref(false);
const emailInvitado = ref('');
const rolInvitado = ref('agente');
const enlaceGenerado = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api<Equipo>('/equipo');
    miembros.value = r.miembros;
    heredado.value = r.heredado;
    totalVenta.value = r.totalVenta;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el equipo.';
  } finally {
    cargando.value = false;
  }
}

async function invitar() {
  error.value = '';
  enlaceGenerado.value = '';
  try {
    const r = await api<{ token: string }>('/equipo/invitaciones', {
      method: 'POST',
      body: JSON.stringify({ email: emailInvitado.value, rol: rolInvitado.value }),
    });
    enlaceGenerado.value = `${location.origin}/invitacion/${r.token}`;
    emailInvitado.value = '';
    invitando.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo invitar.';
  }
}

onMounted(cargar);
</script>

<template>
  <section class="stack">
    <div class="encabezado">
      <div>
        <h2>Equipo</h2>
        <p class="sub">{{ auth.tenant?.nombre }}</p>
      </div>
      <button
        class="btn"
        type="button"
        :disabled="!puedeInvitar()"
        :title="puedeInvitar() ? '' : 'Sólo el titular puede sumar gente'"
        @click="invitando = !invitando"
      >
        Invitar
      </button>
    </div>

    <form v-if="invitando" class="card stack invitar" @submit.prevent="invitar">
      <div class="row">
        <input v-model="emailInvitado" type="email" required placeholder="correo@ejemplo.com" />
        <select v-model="rolInvitado">
          <option v-for="r in ROLES_INVITABLES" :key="r" :value="r">
            {{ etiquetaRol(r, auth.tipoCuenta) }}
          </option>
        </select>
        <button class="btn" type="submit">Generar invitación</button>
      </div>
      <p class="nota">
        El envío por correo llega en la etapa 7. Por ahora copiá el enlace y mandalo vos.
      </p>
    </form>

    <div v-if="enlaceGenerado" class="card stack">
      <strong>Enlace de invitación</strong>
      <code class="mono enlace">{{ enlaceGenerado }}</code>
      <p class="nota">Se muestra una sola vez. Vence en 7 días.</p>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card">
      <div v-if="cargando" class="sk" />
      <table v-else>
        <thead>
          <tr>
            <th>Nombre</th>
            <th class="secundaria">Correo</th>
            <th>Rol</th>
            <th class="der">Capta</th>
            <th class="der">Cierra</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in miembros" :key="m.usuarioId">
            <td>
              <RouterLink :to="`/equipo/${m.usuarioId}`">{{ m.nombre }}</RouterLink>
              <!-- La etiqueta y no `m.estado`: el resto de la fila dice «Titular»
                   y «Administración», y acá salía «suspendida» en minúscula, que
                   es el valor de la columna y no una palabra escrita para nadie. -->
              <span v-if="m.estado !== 'activa'" class="baja">{{ ETIQUETA_ESTADO[m.estado] ?? m.estado }}</span>
            </td>
            <td class="mono secundaria">{{ m.email }}</td>
            <td><span class="chip">{{ etiquetaRol(m.rol, auth.tipoCuenta) }}</span></td>

            <template v-if="editando === m.usuarioId">
              <td class="der">
                <input
                  v-model="borrador.captador" class="pct" inputmode="decimal"
                  :placeholder="String(heredado.captador)"
                  aria-label="Porcentaje cuando capta"
                  @keydown.enter.prevent="guardarPct(m)"
                  @keydown.esc="editando = null" />
              </td>
              <td class="der">
                <input
                  v-model="borrador.cerrador" class="pct" inputmode="decimal"
                  :placeholder="String(heredado.cerrador)"
                  aria-label="Porcentaje cuando cierra"
                  @keydown.enter.prevent="guardarPct(m)"
                  @keydown.esc="editando = null" />
              </td>
              <td class="acc">
                <button class="btn sm" type="button" :disabled="guardando || borradorExcede"
                        @click="guardarPct(m)">
                  Guardar
                </button>
                <button class="btn secondary sm" type="button" @click="editando = null">
                  Cancelar
                </button>
              </td>
            </template>

            <template v-else>
              <td class="der">
                <span v-if="m.comisionCaptadorPct !== null" class="mono">
                  {{ pct(m.comisionCaptadorPct) }}
                </span>
                <!-- Heredado en gris y con el número que EFECTIVAMENTE rige: un
                     guión no dice cuánto cobra esta persona. -->
                <span v-else class="mono hered" :title="'Hereda el reparto de la inmobiliaria'">
                  {{ pct(heredado.captador) }}
                </span>
                <span class="equiv">
                  ≡ {{ pct(sobreLaVenta(m.comisionCaptadorPct ?? heredado.captador)) }} de la venta
                </span>
              </td>
              <td class="der">
                <span v-if="m.comisionCerradorPct !== null" class="mono">
                  {{ pct(m.comisionCerradorPct) }}
                </span>
                <span v-else class="mono hered" :title="'Hereda el reparto de la inmobiliaria'">
                  {{ pct(heredado.cerrador) }}
                </span>
                <span class="equiv">
                  ≡ {{ pct(sobreLaVenta(m.comisionCerradorPct ?? heredado.cerrador)) }} de la venta
                </span>
              </td>
              <td class="acc">
                <button
                  v-if="puedeEditarPct" class="btn secondary sm" type="button"
                  @click="abrir(m)">
                  Cambiar %
                </button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>

      <p v-if="editando && borradorExcede" class="alert" role="alert">
        Captar y cerrar la misma operación no puede dar más del 100 % de lo que le queda
        a la inmobiliaria: a la casa no le quedaría nada.
      </p>

      <p v-if="!cargando" class="pie">
        Los porcentajes están en <strong>% de lo que le queda a la inmobiliaria</strong>
        después de repartir con otra agencia — no % de la operación. Dejar el campo vacío
        no es cero: es <em>heredar</em> el {{ pct(heredado.captador) }} /
        {{ pct(heredado.cerrador) }} de la casa, que se cambia en
        <RouterLink to="/comisiones">Comisiones</RouterLink>.
      </p>
    </div>
  </section>
</template>

<style scoped>
.encabezado {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-lg);
}
.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}
.invitar input,
.invitar select {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.invitar input {
  flex: 1;
}
.enlace {
  display: block;
  padding: var(--s-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 12px;
  overflow-wrap: anywhere;
}
th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  padding-bottom: var(--s-sm);
  border-bottom: 1px solid var(--line);
}
td {
  padding: var(--s-md) 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
}
tr:last-child td {
  border-bottom: none;
}
.der { text-align: right; }
.pct {
  width: 7ch; font: inherit; font-size: 13px; text-align: right;
  padding: 2px var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-sm); background: var(--surface); color: var(--ink);
}
.hered { color: var(--muted-2); }
.equiv { display: block; font-size: 10px; color: var(--muted-2); }
.acc { text-align: right; white-space: nowrap; }
.acc .btn + .btn { margin-left: var(--s-xs); }
.baja { margin-left: var(--s-sm); font-size: 11px; color: var(--warning-ink); }
.pie { margin: var(--s-md) 0 0; font-size: 12px; color: var(--muted); line-height: 1.6; max-width: 78ch; }

/* El correo se va en pantalla angosta: con cinco columnas no entra, y lo que
   define a una persona acá es su nombre y su reparto, no su casilla. */
@media (max-width: 760px) {
  .secundaria { display: none; }
  .equiv { display: none; }
}

.sk {
  height: 120px;
  border-radius: var(--r-md);
  background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
  background-size: 200% 100%;
  animation: brillo 1.2s ease-in-out infinite;
}
@keyframes brillo {
  to {
    background-position: -200% 0;
  }
}
</style>
