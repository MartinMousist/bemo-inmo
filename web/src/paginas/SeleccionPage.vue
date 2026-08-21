<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { ETIQUETA_TIPO, money } from '../dominio/formato';

/**
 * Lo que ve el cliente al abrir el enlace.
 *
 * ── Esta pantalla no es «la app en modo invitado» ──
 *
 * Quien la abre no es usuario de nada: es alguien que recibió un WhatsApp de su
 * asesora y lo tocó desde el teléfono, probablemente en la calle. Por eso no
 * hay menú, ni filtros, ni tablas: fotos grandes, precio claro y nada más.
 *
 * Tampoco hay botones que pidan hacer algo. Lo que sigue después de mirar es
 * responderle a la persona que se lo mandó, y esa conversación ya está abierta
 * en WhatsApp. Meter un formulario acá sería inventar un paso que nadie pidió.
 */

interface Ficha {
  id: string; codigo: string; tipo: string; zona: string;
  descripcion: string | null;
  ambientes: number | null; dormitorios: number | null; banos: number | null;
  cocheras: number | null;
  supCubierta: number | null; supTotal: number | null; antiguedad: number | null;
  operacion: string | null; precio: number | null; moneda: string;
  expensas: number | null; fotos: string[];
}

interface Seleccion {
  titulo: string; mensaje: string | null; inmobiliaria: string; propiedades: Ficha[];
}

const ruta = useRoute();
const datos = ref<Seleccion | null>(null);
const cargando = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    datos.value = await api<Seleccion>(`/seleccion/${ruta.params.token}`);
  } catch (e) {
    error.value = e instanceof ApiError
      ? e.paraMostrar
      : 'No pudimos abrir este enlace.';
  } finally { cargando.value = false; }
});

const precio = (f: Ficha) => (f.precio === null ? 'Consultar' : money(f.precio, f.moneda));

/**
 * Los datos de la ficha, sin los vacíos.
 *
 * Una propiedad sin cocheras no tiene que mostrar «Cocheras: —»: el guión no
 * informa, sólo ocupa. Se arma la lista con lo que hay.
 */
function detalles(f: Ficha): Array<[string, string]> {
  const d: Array<[string, string]> = [];
  if (f.ambientes) d.push(['Ambientes', String(f.ambientes)]);
  if (f.dormitorios) d.push(['Dormitorios', String(f.dormitorios)]);
  if (f.banos) d.push(['Baños', String(f.banos)]);
  if (f.cocheras) d.push(['Cocheras', String(f.cocheras)]);
  if (f.supCubierta) d.push(['Cubierta', `${f.supCubierta} m²`]);
  if (f.supTotal) d.push(['Total', `${f.supTotal} m²`]);
  if (f.antiguedad) d.push(['Antigüedad', `${f.antiguedad} años`]);
  return d;
}
</script>

<template>
  <main class="seleccion">
    <p v-if="cargando" class="centro">Cargando…</p>

    <div v-else-if="error" class="centro caido">
      <h1>Este enlace no está disponible</h1>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="datos">
      <header class="cabecera">
        <p class="de">{{ datos.inmobiliaria }}</p>
        <h1>{{ datos.titulo }}</h1>
        <p v-if="datos.mensaje" class="mensaje">{{ datos.mensaje }}</p>
      </header>

      <article v-for="f in datos.propiedades" :key="f.id" class="prop">
        <div v-if="f.fotos.length" class="fotos" :data-n="Math.min(f.fotos.length, 4)">
          <img v-for="(url, i) in f.fotos.slice(0, 4)" :key="url" :src="url"
            :alt="`${f.zona} — foto ${i + 1}`" loading="lazy" />
        </div>

        <div class="cuerpo">
          <p class="tipo">{{ ETIQUETA_TIPO[f.tipo] ?? f.tipo }}</p>
          <h2>{{ f.zona }}</h2>

          <p class="precio">
            {{ precio(f) }}
            <!-- Las expensas van pegadas al precio y no en la lista de datos:
                 es plata que se paga todos los meses y verla después de decidir
                 es la peor sorpresa que puede dar una ficha. -->
            <small v-if="f.expensas">+ {{ money(f.expensas, f.moneda) }} de expensas</small>
          </p>

          <ul v-if="detalles(f).length" class="datos">
            <li v-for="[k, v] in detalles(f)" :key="k">
              <span>{{ k }}</span><strong>{{ v }}</strong>
            </li>
          </ul>

          <p v-if="f.descripcion" class="desc">{{ f.descripcion }}</p>
        </div>
      </article>

      <footer class="pie">
        <p>Te las envía <strong>{{ datos.inmobiliaria }}</strong>.
          Cualquier duda, respondele por donde te llegó este enlace.</p>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.seleccion {
  max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 4rem;
  display: grid; gap: 1.5rem;
}
.centro { text-align: center; padding: 4rem 1rem; color: var(--texto-tenue, #667); }
.caido h1 { font-size: 1.25rem; }

.cabecera { text-align: center; }
.de { text-transform: uppercase; letter-spacing: .08em; font-size: .75rem;
      color: var(--texto-tenue, #778); margin: 0 0 .35rem; }
.cabecera h1 { font-size: 1.5rem; margin: 0; }
.mensaje { margin: .75rem 0 0; color: var(--texto-tenue, #556); }

.prop {
  border: 1px solid var(--borde, #e3e5ea); border-radius: 14px; overflow: hidden;
  background: var(--fondo-card, #fff);
}
.fotos { display: grid; gap: 2px; max-height: 20rem; }
.fotos img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* La grilla depende de CUÁNTAS fotos hay. Con `2fr 1fr` fijo, dos fotos
   quedaban una ancha y otra aplastada contra el borde; se vio en pantalla. */
.fotos[data-n="1"] { grid-template-columns: 1fr; }
.fotos[data-n="2"] { grid-template-columns: 1fr 1fr; }
.fotos[data-n="3"], .fotos[data-n="4"] { grid-template-columns: 2fr 1fr; }

.cuerpo { padding: 1rem 1.15rem 1.25rem; }
.tipo { text-transform: uppercase; letter-spacing: .06em; font-size: .7rem;
        color: var(--texto-tenue, #778); margin: 0; }
.cuerpo h2 { font-size: 1.15rem; margin: .15rem 0 .5rem; }
.precio { font-size: 1.4rem; font-weight: 600; margin: 0 0 .75rem; }
.precio small { display: block; font-size: .8rem; font-weight: 400;
                color: var(--texto-tenue, #667); }

.datos { list-style: none; padding: 0; margin: 0 0 .75rem;
         display: grid; grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr)); gap: .5rem; }
.datos li { display: grid; }
.datos span { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em;
              color: var(--texto-tenue, #889); }

.desc { margin: 0; color: var(--texto-tenue, #556); white-space: pre-line; }

.pie { text-align: center; color: var(--texto-tenue, #778); font-size: .9rem; }

@media (max-width: 30rem) {
  .fotos { grid-template-columns: 1fr; max-height: 14rem; }
  .fotos img:nth-child(n+3) { display: none; }
}
</style>
