<script setup lang="ts">
import { computed } from 'vue';
import FiltroDesplegable from './FiltroDesplegable.vue';
import {
  AMENITIES_AGRUPADOS, CALEFACCIONES, DISPOSICIONES, ORIENTACIONES, URBANIZACIONES,
} from '../dominio/catalogos-propiedad';

/**
 * Las pastillas de filtro de una cartera de propiedades.
 *
 * ── Por qué es un componente y no está escrito en cada pantalla ──
 *
 * Son tres pantallas —Todas, En venta, En alquiler— y hasta ahora sólo la
 * primera tenía filtros avanzados: las otras dos ofrecían tipo, situación y
 * captador, y nada más. Quien entraba por «En venta» no podía buscar por
 * precio, que es lo primero que se busca en una cartera de venta.
 *
 * Copiadas tres veces, divergen en el primer arreglo que se haga en una sola.
 *
 * ── El modelo es un mapa plano de strings ──
 *
 * Es la forma en que las tres pantallas ya guardan sus filtros
 * (`filtrosRecordados`) y la que viaja a la URL. Un objeto tipado por campo
 * sería más lindo acá adentro y obligaría a traducir en los tres llamadores.
 */
const filtros = defineModel<Record<string, string>>('filtros', { required: true });

/**
 * La operación elegida, si la pantalla la tiene.
 *
 * Sólo se usa para UNA advertencia: filtrar por precio sin haber elegido venta
 * o alquiler busca en las dos puntas. Las carteras ya vienen con la operación
 * fija, así que ahí nunca aplica — y por eso es opcional en vez de obligatoria.
 */
const props = defineProps<{ operacion?: string }>();

/** ¿Está buscando por cercanía? Los tres campos o ninguno. */
const buscaPorRadio = computed(
  () => !!filtros.value.lat && !!filtros.value.lng && !!filtros.value.radioKm,
);

/**
 * Toggle de un valor dentro de un CSV.
 *
 * Los checkboxes no tienen `v-model` a un array porque el filtro guardado es un
 * string —así viaja a la URL y así se recuerda— y arman el CSV a mano.
 */
function tieneEnCsv(csv: string | undefined, clave: string): boolean {
  return (csv ?? '').split(',').includes(clave);
}

function alternarEnCsv(campo: string, clave: string): void {
  const actual = filtros.value[campo] ? filtros.value[campo].split(',') : [];
  const sin = actual.filter((c) => c !== clave);
  filtros.value = {
    ...filtros.value,
    [campo]: (sin.length === actual.length ? [...actual, clave] : sin).join(','),
  };
}

/**
 * Lo que dice cada pastilla cuando tiene algo elegido.
 *
 * ── Por qué el valor y no una marca ──
 *
 * Un puntito que avisa «hay un filtro acá» obliga a abrir el panel para saber
 * cuál. «Desde 2 amb.» se lee sin abrir nada, que es de lo que se trata tener
 * los filtros a la vista.
 *
 * `null` significa «sin filtrar» y la pastilla muestra su nombre.
 */
function rango(min: string, max: string, unidad: string): string | null {
  if (min && max) return `${min}–${max} ${unidad}`;
  if (min) return `Desde ${min} ${unidad}`;
  if (max) return `Hasta ${max} ${unidad}`;
  return null;
}

/** Los miles como «120k»: en una pastilla no entra «120.000». */
function corto(n: string): string {
  const v = Number(n.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(v)) return n;
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
}

const resumenAmbientes = computed(() => {
  const f = filtros.value;
  // El primero que tenga algo manda. Poner los tres juntos —«2–4 amb. · 1–2
  // dorm. · 2 baños»— no entra en la pastilla y termina cortado con puntos
  // suspensivos, que es peor que decir uno solo.
  const partes = [
    rango(f.ambientesMin, f.ambientesMax, 'amb.'),
    rango(f.dormitoriosMin, f.dormitoriosMax, 'dorm.'),
    rango(f.banosMin, f.banosMax, 'baños'),
    rango(f.toilettesMin, f.toilettesMax, 'toil.'),
  ].filter(Boolean) as string[];
  if (!partes.length) return null;
  return partes.length === 1 ? partes[0] : `${partes[0]} +${partes.length - 1}`;
});

const resumenPrecio = computed(() => {
  const f = filtros.value;
  const p = rango(f.precioMin ? corto(f.precioMin) : '', f.precioMax ? corto(f.precioMax) : '', '');
  if (p) return `${f.precioMoneda} ${p.trim()}`;
  const e = rango(f.expensasMin ? corto(f.expensasMin) : '', f.expensasMax ? corto(f.expensasMax) : '', '');
  return e ? `Expensas ${e.trim()}` : null;
});

const resumenSuperficie = computed(() => {
  const f = filtros.value;
  const partes = [
    rango(f.supTotalMin, f.supTotalMax, 'm²'),
    rango(f.supCubiertaMin, f.supCubiertaMax, 'm² cub.'),
    f.antiguedadMax ? `Hasta ${f.antiguedadMax} años` : null,
    rango(f.cocherasMin, f.cocherasMax, 'coch.'),
    rango(f.plantasMin, f.plantasMax, 'plantas'),
  ].filter(Boolean) as string[];
  if (!partes.length) return null;
  return partes.length === 1 ? partes[0] : `${partes[0]} +${partes.length - 1}`;
});

const resumenCaracteristicas = computed(() => {
  const f = filtros.value;
  const n = (['orientacion', 'disposicion', 'calefaccion', 'tipoUrbanizacion', 'amenities'] as const)
    .reduce((a, k) => a + (f[k] ? f[k].split(',').filter(Boolean).length : 0), 0);
  return n ? `${n} ${n === 1 ? 'característica' : 'características'}` : null;
});

const resumenZona = computed(() =>
  buscaPorRadio.value ? `A ${filtros.value.radioKm} km` : null);

/**
 * Limpia los campos de UNA pastilla.
 *
 * Reasigna el objeto entero en vez de mutar sus claves: con `defineModel`, una
 * mutación in-place no emite `update:` y el filtro se veía limpio en el panel
 * pero seguía aplicado en la lista.
 */
function limpiarCampos(...campos: string[]) {
  const copia = { ...filtros.value };
  for (const c of campos) copia[c] = '';
  filtros.value = copia;
}
</script>

<template>
  <div class="pastillas">
      <FiltroDesplegable
        etiqueta="Ambientes" :valor="resumenAmbientes" :ancho="300"
        @limpiar="limpiarCampos('ambientesMin','ambientesMax','dormitoriosMin','dormitoriosMax','banosMin','banosMax','toilettesMin','toilettesMax')"
      >
        <label class="rango"><span>Ambientes</span>
          <input v-model="filtros.ambientesMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.ambientesMax" inputmode="numeric" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Dormitorios</span>
          <input v-model="filtros.dormitoriosMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.dormitoriosMax" inputmode="numeric" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Baños</span>
          <input v-model="filtros.banosMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.banosMax" inputmode="numeric" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Toilettes</span>
          <input v-model="filtros.toilettesMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.toilettesMax" inputmode="numeric" placeholder="Hasta" />
        </label>
      </FiltroDesplegable>

      <FiltroDesplegable
        etiqueta="Precio" :valor="resumenPrecio" :ancho="320"
        @limpiar="limpiarCampos('precioMin','precioMax','expensasMin','expensasMax')"
      >
        <!-- La moneda va PRIMERO y adentro del panel del precio: un rango sin
             moneda mezcla un alquiler de ARS 380.000 con una venta de
             USD 118.000. -->
        <div class="rango con-moneda">
          <span>Precio</span>
          <select v-model="filtros.precioMoneda" aria-label="Moneda del precio">
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
          <input v-model="filtros.precioMin" inputmode="decimal" placeholder="Desde" />
          <input v-model="filtros.precioMax" inputmode="decimal" placeholder="Hasta" />
        </div>
        <div class="rango con-moneda">
          <span>Expensas</span>
          <select v-model="filtros.expensasMoneda" aria-label="Moneda de las expensas">
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <input v-model="filtros.expensasMin" inputmode="decimal" placeholder="Desde" />
          <input v-model="filtros.expensasMax" inputmode="decimal" placeholder="Hasta" />
        </div>

        <!-- Se dice, en vez de adivinar: el precio vive en la operación, y una
             propiedad puede estar en venta Y en alquiler a la vez. -->
        <p v-if="(filtros.precioMin || filtros.precioMax) && !props.operacion" class="nota-panel">
          Sin elegir Venta o Alquiler se busca en las dos puntas, así que una casa
          puede entrar por el precio de su alquiler.
        </p>
      </FiltroDesplegable>

      <FiltroDesplegable
        etiqueta="Superficie" :valor="resumenSuperficie" :ancho="320"
        @limpiar="limpiarCampos('supTotalMin','supTotalMax','supCubiertaMin','supCubiertaMax','antiguedadMax','cocherasMin','cocherasMax','plantasMin','plantasMax')"
      >
        <label class="rango"><span>Sup. total (m²)</span>
          <input v-model="filtros.supTotalMin" inputmode="decimal" placeholder="Desde" />
          <input v-model="filtros.supTotalMax" inputmode="decimal" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Sup. cubierta (m²)</span>
          <input v-model="filtros.supCubiertaMin" inputmode="decimal" placeholder="Desde" />
          <input v-model="filtros.supCubiertaMax" inputmode="decimal" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Cocheras</span>
          <input v-model="filtros.cocherasMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.cocherasMax" inputmode="numeric" placeholder="Hasta" />
        </label>
        <label class="rango"><span>Plantas</span>
          <input v-model="filtros.plantasMin" inputmode="numeric" placeholder="Desde" />
          <input v-model="filtros.plantasMax" inputmode="numeric" placeholder="Hasta" />
        </label>
        <!-- Sólo el máximo: acá se busca «hasta X años», no un rango exacto. -->
        <label class="rango rango-simple"><span>Antigüedad (hasta, años)</span>
          <input v-model="filtros.antiguedadMax" inputmode="numeric" placeholder="Años" />
        </label>
      </FiltroDesplegable>

      <FiltroDesplegable
        etiqueta="Características" :valor="resumenCaracteristicas" :ancho="420"
        @limpiar="limpiarCampos('orientacion','disposicion','calefaccion','tipoUrbanizacion','amenities')"
      >
        <div class="grupo-multi">
          <h3>Orientación</h3>
          <div class="chips-check">
            <label v-for="o in ORIENTACIONES" :key="o.clave" class="chip-check">
              <input type="checkbox" :checked="tieneEnCsv(filtros.orientacion, o.clave)"
                @change="alternarEnCsv('orientacion', o.clave)" />
              <span>{{ o.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Disposición</h3>
          <div class="chips-check">
            <label v-for="d in DISPOSICIONES" :key="d.clave" class="chip-check">
              <input type="checkbox" :checked="tieneEnCsv(filtros.disposicion, d.clave)"
                @change="alternarEnCsv('disposicion', d.clave)" />
              <span>{{ d.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Calefacción</h3>
          <div class="chips-check">
            <label v-for="c in CALEFACCIONES" :key="c.clave" class="chip-check">
              <input type="checkbox" :checked="tieneEnCsv(filtros.calefaccion, c.clave)"
                @change="alternarEnCsv('calefaccion', c.clave)" />
              <span>{{ c.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Urbanización</h3>
          <div class="chips-check">
            <label v-for="u in URBANIZACIONES" :key="u.clave" class="chip-check">
              <input type="checkbox" :checked="tieneEnCsv(filtros.tipoUrbanizacion, u.clave)"
                @change="alternarEnCsv('tipoUrbanizacion', u.clave)" />
              <span>{{ u.etiqueta }}</span>
            </label>
          </div>
        </div>

        <!-- Amenities: «tiene TODOS los que se marquen», no «tiene alguno» —
             la misma regla `@>` del back. Marcar Pileta y Seguridad pide una
             propiedad con las dos, no cualquiera de las dos. -->
        <div class="grupo-multi">
          <h3>Amenities</h3>
          <div v-for="grupo in AMENITIES_AGRUPADOS" :key="grupo.categoria" class="subgrupo-amenities">
            <p class="subtitulo">{{ grupo.categoria }}</p>
            <div class="chips-check">
              <label v-for="op in grupo.items" :key="op.clave" class="chip-check">
                <input type="checkbox" :checked="tieneEnCsv(filtros.amenities, op.clave)"
                  @change="alternarEnCsv('amenities', op.clave)" />
                <span>{{ op.etiqueta }}</span>
              </label>
            </div>
          </div>
        </div>
      </FiltroDesplegable>

      <FiltroDesplegable
        etiqueta="Zona" :valor="resumenZona" :ancho="300"
        @limpiar="limpiarCampos('lat','lng','radioKm')"
      >
        <!-- Sin la API key de Google no hay mapa donde hacer clic, así que se
             cargan las coordenadas. NO es un placeholder de algo mejor: es la
             misma salida manual que ya usa la ficha, y desde la ficha hay un
             botón que las trae puestas. -->
        <label class="rango rango-simple"><span>Latitud</span>
          <input v-model="filtros.lat" inputmode="decimal" placeholder="-32.9812" />
        </label>
        <label class="rango rango-simple"><span>Longitud</span>
          <input v-model="filtros.lng" inputmode="decimal" placeholder="-68.8794" />
        </label>
        <label class="rango rango-simple"><span>Radio (km)</span>
          <input v-model="filtros.radioKm" inputmode="decimal" placeholder="3" />
        </label>
        <p v-if="buscaPorRadio" class="nota-panel">
          Las propiedades <strong>sin coordenadas quedan afuera</strong>: no se puede
          afirmar que estén dentro del radio.
        </p>
        <p v-else class="nota-panel">
          Van los tres juntos. Desde una ficha, «Buscar cerca» los completa solo.
        </p>
      </FiltroDesplegable>

  </div>
</template>

<style scoped>
.pastillas { display: contents; }
</style>
