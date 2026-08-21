<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api/cliente';
import BemoLogo from '../componentes/BemoLogo.vue';
import UiIcon from '../componentes/UiIcon.vue';
import StatusChip from '../componentes/StatusChip.vue';

/**
 * Portada pública. Sin sesión.
 *
 * Regla del playbook §9 — no se simulan datos, se simula el FUTURO: cada
 * capacidad lleva su estado y las que no existen dicen "En desarrollo". Nada de
 * testimonios inventados, logos de clientes que no son clientes, ni números de
 * uso falsos. Cuando existan, se cambian acá.
 */
type Estado = 'listo' | 'pronto';

const modulos: Array<{
  icono: string;
  titulo: string;
  detalle: string;
  estado: Estado;
}> = [
  {
    icono: 'moneda',
    titulo: 'Alquileres con índice',
    detalle:
      'Cada contrato con su índice y su periodicidad. El aumento se calcula solo y llega con la memoria de cálculo para mostrarle al inquilino.',
    estado: 'pronto',
  },
  {
    icono: 'calendario',
    titulo: 'Vencimientos avisados',
    detalle:
      'Contratos por vencer, aumentos que entran y reservas que caducan, con aviso escalonado a los 90, 60 y 30 días.',
    estado: 'pronto',
  },
  {
    icono: 'documento',
    titulo: 'Liquidación al propietario',
    detalle:
      'Honorarios y gastos descontados, reparto de condominio por porcentaje y el neto listo para transferir.',
    estado: 'pronto',
  },
  {
    icono: 'edificio',
    titulo: 'Cartera y ubicación',
    detalle:
      'Una ficha por propiedad, en venta y alquiler a la vez si hace falta, con la ubicación en el mapa y los titulares.',
    estado: 'listo',
  },
  {
    icono: 'embudo',
    titulo: 'Leads',
    detalle:
      'Cada consulta que entra por portal, WhatsApp o teléfono queda registrada, asignada y con su visita agendada.',
    estado: 'listo',
  },
  {
    icono: 'grafico',
    titulo: 'Comisiones por punta',
    detalle:
      'Cuánto cobra la operación, cómo se reparte entre inmobiliarias y cómo se reparte puertas adentro.',
    estado: 'pronto',
  },
];

const pasos = [
  {
    n: '01',
    titulo: 'Cargás la cartera',
    detalle: 'Propiedades, propietarios y contratos vigentes. Con importador o a mano.',
  },
  {
    n: '02',
    titulo: 'El sistema toma los índices',
    detalle: 'IPC de INDEC, ICL y UVA del BCRA, todos los meses, sin que nadie los copie.',
  },
  {
    n: '03',
    titulo: 'Los aumentos salen solos',
    detalle: 'Con su cálculo explicado y el aviso listo para las dos partes.',
  },
  {
    n: '04',
    titulo: 'Liquidás y cobrás',
    detalle: 'La liquidación del mes cuadra con lo cobrado, sin planilla intermedia.',
  },
];

/**
 * Planes.
 *
 * ── Vienen de la API, no de acá ──
 *
 * Estaban escritos a mano en este archivo: «Inicial», «Medio» y «Pro», con su
 * lista de funciones y un estado por función. Dejaron de existir en la
 * migración 046 y esta página siguió ofreciéndolos meses.
 *
 * Era la tercera copia de la misma verdad —la base, la pantalla de «Tu plan» y
 * ésta—, y las tres decían cosas distintas. `GET /planes` es público
 * justamente porque ESTA es la página de precios: ahora el nombre, el precio,
 * los topes, lo que incluye cada plan y si eso existe salen de un solo lugar.
 *
 * El estado por función se conserva, que era lo bueno de la versión a mano: un
 * tilde es una promesa, y lo que no está construido dice «En desarrollo».
 */
interface ModuloDePlan {
  clave: string; nombre: string; detalle: string;
  estado: 'listo' | 'parcial' | 'pronto';
  nota: string | null;
}
interface PlanPublico {
  codigo: string; familia: 'gestion' | 'inmobiliaria'; nombre: string;
  resumen: string | null; paraQuien: string | null; precio: number | null;
  maxUsuarios: number | null; maxPropiedades: number | null;
  maxContratos: number | null; maxCanales: number | null;
  maxEnviosMes: number | null; maxRedCompartidas: number | null;
  modulos: ModuloDePlan[];
}

const FAMILIA: Record<string, { titulo: string; bajada: string; contra: string }> = {
  gestion: {
    titulo: 'Gestión de alquileres',
    bajada: 'Administrás alquileres —propios o de terceros— y no trabajás con ventas.',
    contra: 'Compite con la planilla que tenés hoy.',
  },
  inmobiliaria: {
    titulo: 'Inmobiliaria',
    bajada: 'Además de administrar, captás, vendés y tenés equipo.',
    contra: 'Hace lo que hacen los otros sistemas, y además administra lo que ya vendiste.',
  },
};

const planes = ref<PlanPublico[]>([]);

const familias = computed(() =>
  (['gestion', 'inmobiliaria'] as const)
    .map((f) => ({ clave: f, ...FAMILIA[f], planes: planes.value.filter((p) => p.familia === f) }))
    .filter((f) => f.planes.length > 0));

/**
 * Lo que ESTE plan suma sobre el anterior de su familia.
 *
 * Repetir la lista entera hacía que el plan de arriba tuviera diecisiete
 * renglones y que comparar —lo único para lo que alguien mira cinco planes
 * juntos— fuera trabajo del lector.
 */
function nuevosEn(planesDeLaFamilia: PlanPublico[], i: number): ModuloDePlan[] {
  const propios = planesDeLaFamilia[i]?.modulos ?? [];
  if (i === 0) return propios;
  const previos = new Set(planesDeLaFamilia[i - 1].modulos.map((m) => m.clave));
  return propios.filter((m) => !previos.has(m.clave));
}

/** Los topes en frases cortas, sin los que no aplican. */
function topesDe(p: PlanPublico): string[] {
  const t: string[] = [];
  t.push(p.maxUsuarios ? `${p.maxUsuarios} ${p.maxUsuarios === 1 ? 'usuario' : 'usuarios'}` : 'Usuarios sin límite');
  t.push(p.maxPropiedades ? `${p.maxPropiedades} propiedades` : 'Propiedades sin límite');
  if (p.maxContratos) t.push(`${p.maxContratos} contratos vigentes`);
  if (p.maxCanales) t.push(`${p.maxCanales} ${p.maxCanales === 1 ? 'canal' : 'canales'} de WhatsApp`);
  if (p.maxEnviosMes) t.push(`${p.maxEnviosMes} envíos a clientes por mes`);
  if (p.maxRedCompartidas) t.push(`${p.maxRedCompartidas} propiedades en la Red`);
  return t;
}



/**
 * El bloque "antes / después".
 *
 * Es el que más falta hacía: en esta categoría el competidor no es otro
 * software, es una planilla más WhatsApp más la memoria de alguien. Nombrar eso
 * con precisión —"el aumento se calcula a mano el día que alguien se acuerda"—
 * hace más que cualquier lista de features, porque el lector reconoce su martes.
 */
const contraste = [
  {
    hoy: 'El aumento se calcula a mano el día que alguien se acuerda.',
    aca: 'Se calcula solo con el índice del contrato y llega con la cuenta escrita.',
  },
  {
    hoy: 'Un contrato vence y te enterás cuando llama el propietario.',
    aca: 'Aparece en el inicio a los 90, 60 y 30 días.',
  },
  {
    hoy: 'La liquidación se arma en una planilla que sólo entiende quien la hizo.',
    aca: 'Sale de lo cobrado, con honorarios y gastos descontados, y cuadra sola.',
  },
  {
    hoy: 'Si alguien se va, la información se va con él.',
    // "con quién hizo cada cosa" a secas sería más de lo que hoy se guarda:
    // cobros y aumentos sí llevan autor; cerrar una liquidación todavía no.
    aca: 'Todo queda en la cuenta de la inmobiliaria, y cada cobro y cada aumento con quién lo hizo.',
  },
];

/**
 * Objeciones reales de alguien que maneja plata de terceros. No son features:
 * son las razones por las que un administrador NO cambia de sistema.
 */
const garantias = [
  {
    icono: 'documento',
    titulo: 'Cada número se puede explicar',
    detalle:
      'Todo importe calculado abre su memoria: qué índice, qué período, qué coeficiente y sobre qué base. Es lo que le mostrás al inquilino cuando pregunta.',
  },
  {
    icono: 'equipo',
    titulo: 'Tu cartera no se mezcla con la de nadie',
    detalle:
      'El aislamiento entre inmobiliarias está en el motor de la base, no sólo en la aplicación, y hay tests que verifican que no haya fugas.',
  },
  {
    icono: 'mas',
    titulo: 'Tus datos se van con vos',
    detalle:
      'Propiedades, contratos y liquidaciones se exportan a CSV cuando quieras, sin pedirle permiso a nadie. Un sistema del que no se puede salir es una trampa.',
  },
];

const preguntas = [
  {
    q: '¿Cuánto sale?',
    a: 'Todavía no hay una lista de precios publicada, y no la vamos a inventar. El número se está definiendo con las primeras inmobiliarias que lo usen de verdad; escribinos y lo armamos sobre tu cartera.',
  },
  {
    q: '¿Sirve si los contratos tienen índices distintos?',
    // Decía "…IPC, ICL, UVA, ICP, dólar o un porcentaje fijo…" y el dólar NO es
    // uno de los índices que el sistema maneja (ver INDICES en alquileres.dto).
    // Prometer un índice que no existe es el mismo error que un precio inventado.
    a: 'Es exactamente para eso. Desde que los contratos son de forma libre, cada uno puede tener su índice —IPC, ICL, UVA, Casa Propia o un porcentaje fijo— y su periodicidad. El sistema los maneja por contrato, no por regla general. Un contrato en dólares se carga en dólares y sin índice, que es como se firman.',
  },
  {
    q: '¿Puedo migrar lo que tengo hoy?',
    a: 'Sí. La cartera entra por importación y los contratos vigentes se cargan con su índice y su fecha de corte para que sigan actualizando desde donde estaban.',
  },
  {
    q: '¿Los datos de una inmobiliaria pueden verse desde otra cuenta?',
    a: 'No. El aislamiento está en la base de datos, no sólo en la aplicación: cada consulta se filtra por inmobiliaria a nivel de motor, y hay una suite de tests que verifica que no haya fugas.',
  },
  {
    q: '¿Publica en Zonaprop y Argenprop?',
    a: 'La publicación directa depende de convenios comerciales con cada portal, que están en trámite. Mientras tanto el sistema arma el aviso completo —texto, atributos y fotos ordenadas— listo para pegar, y expone un feed XML de la cartera que le podés pasar a un portal o a tu desarrollador sin depender de nosotros.',
  },
  {
    q: '¿Y si dejo de usarlo?',
    a: 'Te llevás todo. Propiedades, personas, contratos, cobros y liquidaciones se exportan a CSV desde la misma pantalla donde los mirás, sin trámite y sin pedir nada.',
  },
  {
    q: '¿Quién puede ver la plata?',
    a: 'Se define por rol. Un asesor ve la cartera y sus consultas, pero no las liquidaciones ni la cobranza de la inmobiliaria; el contable ve las liquidaciones y no puede cargar contratos. No es una preferencia de pantalla: el permiso se aplica en el servidor.',
  },
];

const compacto = ref(false);
function alScrollear() {
  compacto.value = window.scrollY > 8;
}

/**
 * El fondo del documento mientras se mira la portada.
 *
 * `.landing` pinta el papel, pero el rebote de scroll de macOS e iOS pasa POR
 * ARRIBA del elemento y muestra el fondo del `<html>`, que sigue siendo el
 * `--bg` de la app. Arriba de todo eso es una franja crema pegada al hero
 * oscuro, en cada gesto. Se pinta el documento en tinta mientras la portada
 * está montada y se devuelve al salir.
 */
onMounted(() => {
  window.addEventListener('scroll', alScrollear, { passive: true });
  document.documentElement.classList.add('en-portada');

  // Sin `await` ni pantalla de carga: la portada tiene que pintarse entera de
  // una, y si `/planes` tarda o falla, lo único que pasa es que la sección de
  // precios aparece un instante después. Un esqueleto gris arriba de la
  // portada sería peor que el hueco.
  api<PlanPublico[]>('/planes')
    .then((r) => { planes.value = r; })
    .catch(() => { /* la sección no se dibuja; el resto de la portada sí */ });
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', alScrollear);
  document.documentElement.classList.remove('en-portada');
});
</script>

<template>
  <div class="landing">
    <!-- La barra arranca sobre el hero oscuro (texto claro, sin fondo) y al
         scrollear cae sobre papel: cambia a fondo sólido y tinta oscura. Sin
         eso, el mismo color de texto no se lee en los dos. -->
    <header class="nav" :class="compacto ? 'compacto' : 'sobre-hero'">
      <div class="contenedor nav-inner">
        <RouterLink to="/" class="marca">
          <BemoLogo :tam="32" con-nombre :invertido="!compacto" />
        </RouterLink>
        <nav class="enlaces">
          <a href="#problema">El problema</a>
          <a href="#modulos">Qué hace</a>
          <a href="#como">Cómo funciona</a>
          <a href="#datos">Tus datos</a>
          <a href="#planes">Planes</a>
          <a href="#preguntas">Preguntas</a>
        </nav>
        <div class="acciones">
          <RouterLink class="btn secondary sm" to="/login">Entrar</RouterLink>
          <RouterLink class="btn sm" to="/registrar">Probar</RouterLink>
        </div>
      </div>
    </header>

    <!-- ── Portada ── -->
    <section class="hero">
      <div class="contenedor hero-inner">
        <div class="hero-texto" v-revelar>
          <p class="kicker">Para inmobiliarias argentinas</p>
          <h1>El alquiler se administra solo.</h1>
          <p class="bajada">
            Cada contrato con su índice y su fecha de corte. Los aumentos se calculan,
            los vencimientos se avisan y la liquidación al propietario cuadra sola.
          </p>
          <div class="cta">
            <RouterLink class="btn" to="/registrar">Crear cuenta</RouterLink>
            <RouterLink class="btn secondary" to="/login">Ya tengo cuenta</RouterLink>
          </div>
          <p class="letra-chica">
            Sin tarjeta. La cuenta queda a tu nombre y la cartera es tuya.
          </p>
        </div>

        <!-- Muestra de producto: componentes reales del sistema de diseño, no
             una captura de pantalla ni un mockup de stock. -->
        <div class="hero-muestra" aria-hidden="true" v-revelar="1">
          <div class="muestra-card elevar">
            <div class="muestra-cab">
              <span class="mono cod">PROP-0001</span>
              <StatusChip texto="Disponible" tono="ok" />
            </div>
            <p class="muestra-dir">Arístides Villanueva 345, Piso 3 B</p>
            <div class="muestra-fila">
              <span class="mono monto">ARS 485.000,00</span>
              <StatusChip texto="Alquiler" tono="acento" />
            </div>
            <div class="muestra-calculo">
              <p class="mini">Próximo ajuste · trimestral por IPC</p>
              <p class="mono calculo">
                IPC ago/25 → nov/25 · coef. 1,0847<br />
                485.000,00 × 1,0847 = <strong>526.079,50</strong>
              </p>
            </div>
          </div>

          <div class="muestra-card chica elevar">
            <p class="mini">Vencimientos</p>
            <ul class="venc">
              <li><span>Contrato · Godoy Cruz</span><StatusChip texto="En 12 d" tono="err" /></li>
              <li><span>Aumento · Ciudad</span><StatusChip texto="En 24 d" tono="warn" /></li>
              <li><span>Reserva · Chacras</span><StatusChip texto="En 41 d" /></li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- ── El problema ── -->
    <section id="problema" class="seccion hundida">
      <div class="contenedor">
        <div class="seccion-cab" v-revelar>
          <h2>Hoy esto lo hace una planilla y la memoria de alguien</h2>
          <p>
            Funciona hasta que son cuarenta contratos, o hasta que esa persona
            se toma vacaciones.
          </p>
        </div>

        <ul class="contraste">
          <li v-for="(c, i) in contraste" :key="c.hoy" v-revelar="i % 3">
            <div class="antes">
              <span class="et">Hoy</span>
              <p>{{ c.hoy }}</p>
            </div>
            <div class="despues">
              <span class="et">Con Bemo INMO</span>
              <p>{{ c.aca }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Módulos ── -->
    <section id="modulos" class="seccion">
      <div class="contenedor">
        <div class="seccion-cab" v-revelar>
          <h2>Todo lo que hoy vive en una planilla</h2>
          <p>
            Lo que ya está disponible se puede usar hoy. Lo que dice “en desarrollo”
            todavía no existe, y preferimos decirlo.
          </p>
        </div>

        <div class="grid3">
          <article v-for="(m, i) in modulos" :key="m.titulo" class="modulo elevar" v-revelar="i % 3">
            <span class="icono"><UiIcon :nombre="m.icono" :tam="20" /></span>
            <div class="modulo-cab">
              <h3>{{ m.titulo }}</h3>
              <StatusChip
                :texto="m.estado === 'listo' ? 'Disponible' : 'En desarrollo'"
                :tono="m.estado === 'listo' ? 'ok' : 'neutro'"
              />
            </div>
            <p>{{ m.detalle }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- ── Cómo funciona ── -->
    <section id="como" class="seccion hundida">
      <div class="contenedor">
        <div class="seccion-cab" v-revelar>
          <h2>Cómo funciona</h2>
          <p>Cuatro pasos, y después el sistema trabaja sin que nadie lo empuje.</p>
        </div>
        <ol class="pasos">
          <li v-for="(p, i) in pasos" :key="p.n" v-revelar="i % 3">
            <span class="mono n">{{ p.n }}</span>
            <h3>{{ p.titulo }}</h3>
            <p>{{ p.detalle }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- ── Garantías ── -->
    <section id="datos" class="seccion">
      <div class="contenedor">
        <div class="seccion-cab" v-revelar>
          <h2>Estás manejando plata que no es tuya</h2>
          <p>
            Por eso las tres cosas que siguen no son opciones de configuración.
          </p>
        </div>

        <div class="grid3">
          <article v-for="(g, i) in garantias" :key="g.titulo" class="modulo elevar" v-revelar="i % 3">
            <span class="icono"><UiIcon :nombre="g.icono" :tam="20" /></span>
            <div class="modulo-cab">
              <h3>{{ g.titulo }}</h3>
            </div>
            <p>{{ g.detalle }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- ── Planes ── -->
    <section id="planes" class="seccion tinta">
      <div class="contenedor">
        <div class="seccion-cab" v-revelar>
          <h2>Planes</h2>
          <p>
            Los precios se definen con las primeras inmobiliarias. Escribinos y
            armamos el número juntos — preferimos eso antes que publicar una cifra
            que todavía no probamos.
          </p>
        </div>

        <!--
          Dos familias, no una escalera de cinco.

          Quien administra veinte departamentos no es una inmobiliaria chica: no
          capta, no vende y no va a hacerlo. Ponerlo como el escalón de abajo de
          una escalera de inmobiliarias le dice, cada vez que abre esta página,
          que está en el peldaño más bajo de algo que no quiere subir.
        -->
        <div v-for="fam in familias" :key="fam.clave" class="familia" v-revelar>
          <div class="familia-cab">
            <h3>{{ fam.titulo }}</h3>
            <p>{{ fam.bajada }}</p>
            <p class="contra">{{ fam.contra }}</p>
          </div>

          <div class="planes" :class="`de-${fam.planes.length}`">
            <article
              v-for="(p, i) in fam.planes"
              :key="p.codigo"
              class="plan elevar"
              :class="{ destacado: fam.clave === 'inmobiliaria' && i === 1 }"
            >
              <!-- «El que recomendamos» y no «el que elige la mayoría»: la
                   etapa 0 sigue abierta y no hay una mayoría que haya elegido
                   nada. Inventar prueba social es el mismo error que inventar
                   un precio. -->
              <p v-if="fam.clave === 'inmobiliaria' && i === 1" class="etiqueta">
                El que recomendamos
              </p>

              <h4>{{ p.nombre }}</h4>
              <p class="para">{{ p.resumen }}</p>

              <!-- El precio sale de la BASE y hoy está vacío. Mientras no haya
                   un número decidido dice «A convenir»: no se publica un precio
                   que nadie decidió. -->
              <p class="precio">
                <template v-if="p.precio !== null">
                  USD {{ p.precio }}<small>/mes</small>
                </template>
                <template v-else>A convenir</template>
              </p>

              <p v-if="p.paraQuien" class="para-quien">{{ p.paraQuien }}</p>

              <ul class="topes">
                <li v-for="t in topesDe(p)" :key="t">{{ t }}</li>
              </ul>

              <p class="delta-cab">
                <template v-if="i === 0">Incluye</template>
                <template v-else>Todo lo de {{ fam.planes[i - 1].nombre }}, más</template>
              </p>

              <ul class="incluye">
                <li
                  v-for="m in nuevosEn(fam.planes, i)"
                  :key="m.clave"
                  :class="{ pendiente: m.estado === 'pronto', parcial: m.estado === 'parcial' }"
                >
                  <UiIcon :nombre="m.estado === 'listo' ? 'tilde' : 'reloj'" :tam="15" />
                  <span class="que">
                    <b>{{ m.nombre }}</b>
                    <!-- Lo que se pierde sin él, no lo que es. Es la única
                         pregunta que alguien se hace mirando planes. -->
                    <span class="detalle">{{ m.detalle }}</span>
                    <!-- Y si no está entero, qué le falta — con esas palabras.
                         «Parcial» sin decir qué no informa nada. -->
                    <span v-if="m.nota" class="nota">{{ m.nota }}</span>
                  </span>
                  <span v-if="m.estado === 'pronto'" class="pronto">En desarrollo</span>
                </li>
              </ul>

              <RouterLink
                class="btn"
                :class="{ secondary: !(fam.clave === 'inmobiliaria' && i === 1) }"
                to="/registrar"
              >Empezar</RouterLink>
            </article>
          </div>
        </div>

        <div class="medida" v-revelar>
          <div>
            <h3>¿Red o franquicia?</h3>
            <p>
              Multi-sucursal, migración asistida desde tu sistema actual, integraciones
              a medida y marca blanca. Lo armamos con vos.
            </p>
          </div>
          <a class="btn secondary" href="mailto:bemotech.ok@gmail.com">Hablemos</a>
        </div>
      </div>
    </section>

    <!-- ── Preguntas ── -->
    <section id="preguntas" class="seccion">
      <div class="contenedor angosto">
        <div class="seccion-cab" v-revelar>
          <h2>Preguntas</h2>
        </div>
        <div class="faq" v-revelar>
          <details v-for="p in preguntas" :key="p.q">
            <summary>{{ p.q }}<UiIcon nombre="chevron" :tam="16" /></summary>
            <p>{{ p.a }}</p>
          </details>
        </div>
      </div>
    </section>

    <!-- ── Cierre ── -->
    <section class="cierre">
      <div class="contenedor cierre-inner" v-revelar>
        <div>
          <h2>Traé tres contratos y probá los números</h2>
          <p>
            Cargá tres de los que ya tenés y compará el aumento y la liquidación
            contra lo que te dio tu planilla. Si no da exactamente lo mismo,
            queremos saberlo.
          </p>
        </div>
        <div class="cierre-cta">
          <RouterLink class="btn" to="/registrar">Crear cuenta</RouterLink>
          <a class="btn secondary" href="mailto:bemotech.ok@gmail.com">Escribirnos</a>
        </div>
      </div>
    </section>

    <footer class="pie-pagina">
      <div class="contenedor pie-inner">
        <div>
          <BemoLogo :tam="30" con-nombre />
          <p class="pie-texto">
            Gestión inmobiliaria. Parte del grupo BEMO, junto a Bemo MED.
          </p>
        </div>
        <div class="pie-links">
          <RouterLink to="/login">Entrar</RouterLink>
          <RouterLink to="/registrar">Crear cuenta</RouterLink>
          <a href="mailto:bemotech.ok@gmail.com">Contacto</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  background: var(--bg);
  color: var(--ink);

  /* El escalón de superficie de la portada es más hondo que el de la app, y es
     UN token redefinido en este scope — la app no se entera.
     Por qué hace falta: la app se mira de cerca y con datos densos, y ahí el
     `--surface-3` de #efece5 alcanza (1,18:1 contra una tarjeta blanca). La
     portada se mira de lejos y de un saque, y a esa distancia 1,18 se lee como
     un solo campo plano. Con #e8e4db la tarjeta pasa a 1,27:1 y el borde entre
     una sección y la siguiente a 1,24:1 (era 1,07).
     El matiz importa tanto como la profundidad: la primera versión era un beige
     cálido (#e8e4db), derivado cuando los neutros del producto eran papel
     cálido. Con el acento teal quedaba una sección beige entre un hero verde y
     un acento verde-azulado — tres familias de color en una pantalla. Éste
     tiene la misma luminancia con el hue rotado al acento.
     El límite lo puso el contraste, no el gusto: un escalón más hondo dejaba
     `--muted` por debajo de AA. */
  --surface-3: #e2e7e3;
}
/* En oscuro el escalón de la app ya separa bien (1,33:1): se devuelve el valor
   del sistema en vez de inventar otro. */
[data-theme='dark'] .landing {
  --surface-3: #253634;
}

/* La portada usa su propia rampa de superficies. La de la app está calibrada
   para tablas densas: --bg con tarjetas --surface encima da 1,04:1, que a
   distancia de lectura alcanza y de lejos es invisible. Medido, no supuesto. */
.contenedor {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 var(--s-xl);
}
.contenedor.angosto {
  max-width: 760px;
}

/* ── Nav ── */
.nav {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  transition: background var(--t-short), border-color var(--t-short),
    backdrop-filter var(--t-short);
}
/* Arriba de todo la barra flota sobre el hero oscuro: sin fondo y con texto
   claro. Al scrollear cae sobre papel y tiene que invertirse entera — mismo
   color de texto en los dos fondos no se lee en ninguno. */
.nav.sobre-hero .enlaces a { color: rgba(255, 255, 255, .72); }
.nav.sobre-hero .enlaces a:hover { color: #fff; }
.nav.sobre-hero .btn.secondary {
  background: rgba(255, 255, 255, .07);
  color: #fff;
  border-color: rgba(255, 255, 255, .26);
}
.nav.sobre-hero .btn.secondary:hover { background: rgba(255, 255, 255, .14); }
.nav.sobre-hero .btn:not(.secondary) {
  background: var(--sobre-tinta-accent);
  border-color: var(--sobre-tinta-accent);
  color: #24140a;
}
.nav.compacto {
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(10px);
  border-bottom-color: var(--line);
}
.nav-inner {
  display: flex;
  align-items: center;
  gap: var(--s-xl);
  height: 64px;
}
.marca {
  text-decoration: none;
}
.enlaces {
  display: flex;
  gap: var(--s-xl);
  margin-left: var(--s-xl);
}
.enlaces a {
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
}
.enlaces a:hover {
  color: var(--ink);
}
.acciones {
  display: flex;
  gap: var(--s-sm);
  margin-left: auto;
}
.btn.sm {
  padding: 6px var(--s-md);
  font-size: 13px;
}

/* ── Hero ── */
.hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  /* Sube por debajo de la barra para que la barra quede ENCIMA del oscuro; el
     padding devuelve el alto que el margen negativo se comió. */
  margin-top: -64px;
  padding: calc(clamp(56px, 9vw, 108px) + 64px) 0 clamp(56px, 9vw, 108px);
  background: var(--tinta);
  color: var(--sobre-tinta);
}
/* Dos halos muy tenues, uno del naranja de marca y otro del azul. Es
   iluminación, no decoración: no hay blobs ni formas. */
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(64% 52% at 6% 0%, rgba(79, 169, 177, .20), transparent 68%),
    radial-gradient(52% 46% at 94% 100%, rgba(14, 124, 134, .16), transparent 72%);
}
/* Corte suave contra la sección de papel que sigue. */
.hero::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 96px;
  z-index: -1;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, .16));
}
.hero-inner {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: var(--s-3xl);
  align-items: center;
}
.kicker {
  margin: 0 0 var(--s-md);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sobre-tinta-accent);
}
.hero h1 {
  font-size: clamp(36px, 5.4vw, 60px);
  line-height: 1.06;
  max-width: 13ch;
  color: #fff;
  letter-spacing: -0.02em;
}
.bajada {
  margin: var(--s-lg) 0 0;
  max-width: 46ch;
  color: var(--sobre-tinta-2);
  font-size: 17px;
  line-height: 1.62;
}
.cta {
  display: flex;
  gap: var(--s-md);
  margin-top: var(--s-xl);
  flex-wrap: wrap;
}
.letra-chica {
  margin: var(--s-md) 0 0;
  font-size: 12px;
  color: var(--sobre-tinta-2);
}

/* Sobre tinta el acento azul del producto no contrasta (2,1:1). El principal
   pasa a ser el naranja de marca — que acá deja de ser sólo firma— y el
   secundario, un contorno claro. */
.cta .btn:not(.secondary) {
  background: var(--sobre-tinta-accent);
  border-color: var(--sobre-tinta-accent);
  color: #24140a;
  box-shadow: 0 6px 20px rgba(79, 169, 177, .26);
}
.cta .btn:not(.secondary):hover {
  filter: brightness(1.06);
  box-shadow: 0 10px 26px rgba(79, 169, 177, .34);
}
.cta .btn.secondary {
  background: rgba(255, 255, 255, .06);
  color: #fff;
  border-color: rgba(255, 255, 255, .26);
}
.cta .btn.secondary:hover { background: rgba(255, 255, 255, .13); }
.cta .btn { transition: filter var(--t-micro), box-shadow var(--t-short), background var(--t-micro); }

.hero-muestra {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
/* Van en tinta-2 y no en `--surface`: sobre el hero oscuro una tarjeta blanca
   pega un salto de brillo, y en tema oscuro `--surface` es un marrón cálido que
   choca con el azul del fondo. */
.muestra-card {
  background: var(--tinta-2);
  border: 1px solid var(--tinta-linea);
  border-radius: var(--r-lg);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .34);
  padding: var(--s-lg);
  color: var(--sobre-tinta);
}
.muestra-card.elevar:hover {
  border-color: rgba(255, 255, 255, .2);
  box-shadow: 0 26px 60px rgba(0, 0, 0, .42);
}
.muestra-cab {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cod {
  font-size: 12px;
  color: var(--sobre-tinta-2);
}
.muestra-dir {
  margin: var(--s-sm) 0 var(--s-md);
  color: #fff;
  font-weight: 500;
}
.muestra-fila {
  display: flex;
  align-items: center;
  gap: var(--s-md);
}
.monto {
  font-size: 21px;
  color: #fff;
}
.muestra-calculo {
  margin-top: var(--s-lg);
  padding-top: var(--s-md);
  border-top: 1px solid var(--tinta-linea);
}
.mini {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sobre-tinta-2);
}
.calculo {
  margin: var(--s-sm) 0 0;
  padding: var(--s-sm) var(--s-md);
  background: rgba(0, 0, 0, .26);
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--sobre-tinta);
}
.calculo strong { color: #fff; }
.muestra-card.chica {
  padding: var(--s-md) var(--s-lg);
}
.venc {
  list-style: none;
  margin: var(--s-sm) 0 0;
  padding: 0;
}
.venc li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-md);
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--tinta-linea);
  font-size: 13px;
  color: var(--sobre-tinta);
}
.venc li:last-child {
  border-bottom: none;
}

/* ── Secciones ── */
/* Cuerpo de portada, no de app. 13-14px es la densidad que DESIGN.md §1 pide
   para ver 30 contratos; una página que vende se lee de lejos.
   NO va en `.landing`: el hero hereda los 14px del body y queda intacto. */
.seccion,
.cierre,
.pie-pagina {
  font-size: 16px;
  line-height: 1.6;
}
/* familia.css tiene `.btn { font: inherit }`. Sin esto, subir el cuerpo a 16px
   empuja los seis botones de la mitad de abajo de 14 a 16px sin tocarles el
   padding, y quedan desproporcionados. */
.seccion .btn,
.cierre .btn,
.pie-pagina .btn { font-size: 14px; }
.seccion .btn.sm { font-size: 13px; }

.seccion {
  padding: clamp(48px, 7vw, 88px) 0;
}
/* Se hunde en vez de aclararse: contra la tarjeta blanca pasa de 1,12:1 a
   1,35:1, seis veces el salto anterior. */
.seccion.hundida {
  background: var(--surface-3);
  border-block: 1px solid var(--line);
}

/* La segunda ancla oscura de la página, espejo del hero. Sin halo: el hero ya
   tiene la firma de iluminación, y repetirla acá —con el badge naranja y el
   botón naranja al lado— convierte el bloque en el elemento más cálido de una
   marca cuyo acento es azul. */
.seccion.tinta {
  background: var(--tinta);
  border-block: 1px solid var(--tinta);
  color: var(--sobre-tinta);
}
.seccion.tinta .seccion-cab h2 { color: #fff; }
.seccion.tinta .seccion-cab p { color: var(--sobre-tinta); }
.seccion-cab {
  max-width: 62ch;
  margin-bottom: clamp(28px, 4vw, 48px);
}
/* General Sans a 600, que es el peso de título de la capa familia. La escala
   grande es de portada: la de la app llega hasta 24px (h1) y acá el titular de
   sección tiene que sostener una página que se mira de lejos. */
.seccion-cab h2 {
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.022em;
  max-width: 20ch;
}
/* Es contenido, no una nota al pie: sube de 14px --muted a 18px --ink-2. */
.seccion-cab p {
  margin: var(--s-lg) 0 0;
  max-width: 54ch;
  font-size: 18px;
  line-height: 1.6;
  color: var(--ink-2);
}

.grid3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-lg);
}

.modulo {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--s-xl);
}
.icono {
  display: inline-flex;
  padding: var(--s-sm);
  border-radius: var(--r-md);
  background: var(--marca-suave);
  border: 1px solid var(--marca-linea);
  color: var(--accent);
}
.modulo-cab {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  margin: var(--s-md) 0 var(--s-sm);
  flex-wrap: wrap;
}
.modulo h3 {
  font-size: 18px;
}
.modulo p {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.62;
}

.pasos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--s-lg);
  counter-reset: paso;
}
/* Dos fallos de contraste que ya existían y nadie vio a ojo: el numeral en
   --marca sobre --surface-2 daba 3,06:1 (mínimo 4,5) y la regla de 2px en
   --marca-linea daba 1,38:1 (mínimo 3 para un objeto gráfico). */
.pasos li {
  padding-top: var(--s-lg);
  border-top: 2px solid var(--accent);
}
.pasos .n {
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.02em;
  /* `--accent` sobre `--surface-2` da 4,46 — a cuatro centésimas de AA. Ésta es
     justo la variante de texto que existe para eso: 5,83. */
  color: var(--accent-ink);
}
.pasos h3 {
  margin: var(--s-sm) 0 var(--s-xs);
  font-size: 18px;
}
.pasos p {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.62;
}

/* ── Planes ──────────────────────────────────────────────────────────────
   Dos familias, una debajo de la otra. Gestión trae dos planes e Inmobiliaria
   tres, así que la grilla se ajusta a cuántos hay: dos tarjetas estiradas a
   tres columnas quedan enormes y vacías. */
.familia + .familia { margin-top: var(--s-3xl); }
.familia-cab { margin-bottom: var(--s-xl); }
.familia-cab h3 { font-family: var(--font-title); font-size: 26px; margin: 0; }
.familia-cab p { margin: var(--s-xs) 0 0; opacity: .75; }
.familia-cab .contra { font-size: 14px; opacity: .55; }

.planes { display: grid; gap: var(--s-lg); align-items: stretch; }
.planes.de-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); max-width: 42rem; }
.planes.de-3 { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }

.plan { display: flex; flex-direction: column; gap: var(--s-sm); padding: var(--s-xl); }
/* `color: inherit` porque `familia.css` le pone `--ink` a todo `h4`, que es
   tinta oscura — sobre una tarjeta oscura queda invisible. La sección
   `.tinta` ya define el color claro; el título tiene que tomarlo de ahí.
   El `h3` de la versión anterior no lo pedía porque el estilo de la portada lo
   cubría; al bajar un nivel de encabezado, dejó de cubrirlo. */
.plan h4 { font-family: var(--font-title); font-size: 22px; margin: 0; color: inherit; }
.plan .para { margin: 0; font-size: 14px; opacity: .8; }
.plan .para-quien { margin: 0; font-size: 13px; opacity: .6; }

/* El lugar del precio lo ocupa «A convenir» hasta que haya un número decidido.
   En serif y del tamaño de un precio, para que el hueco no se lea como un
   olvido. */
.precio { margin: var(--s-sm) 0; font-family: var(--font-title); font-size: 28px; }
.precio small { font-size: 14px; font-family: var(--font-body); opacity: .6; }

.topes {
  list-style: none; margin: 0; padding: var(--s-sm) 0 0;
  border-top: 1px solid currentColor; border-color: color-mix(in srgb, currentColor 14%, transparent);
  display: flex; flex-direction: column; gap: 2px;
}
.topes li { font-size: 13px; opacity: .65; }

.delta-cab {
  margin: var(--s-md) 0 var(--s-2xs); font-size: 11px;
  letter-spacing: .06em; text-transform: uppercase; opacity: .5;
}

/* `flex: 1` para que el hueco entre un plan de 3 ítems y uno de 7 quede ABAJO
   y los botones «Empezar» terminen todos a la misma altura. */
.incluye { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-sm); flex: 1; }
.incluye li { display: flex; gap: var(--s-sm); font-size: 13px; }
.incluye li svg { flex: none; margin-top: 3px; opacity: .7; }
.incluye .que { display: grid; gap: 1px; }
.incluye b { font-weight: 600; }
.incluye .detalle { opacity: .6; line-height: 1.4; }
.incluye .nota { font-size: 12px; opacity: .5; line-height: 1.4; font-style: italic; }

/* Lo que no está construido se ve distinto, no se esconde. Un tilde es una
   promesa; esto es un reloj. */
.incluye li.pendiente { opacity: .6; }
.pronto {
  margin-left: auto; align-self: flex-start; white-space: nowrap;
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7;
}

.plan .btn { margin-top: var(--s-lg); text-align: center; }

.etiqueta {
  margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  opacity: .8;
}

/* ── Planes ──────────────────────────────────────────────────────────────
   Cuatro defectos con una sola raíz: la tarjeta está construida como si
   tuviera un precio, y no lo tiene.
     1. `.etiqueta` era un <p> en el flujo, así que sólo existía en la del
        medio y empujaba todo ~24px: las tres nunca alineaban.
     2. "A convenir" en serif 24px tinta, en el lugar de un precio, tres
        veces: no dice una mentira, la dibuja.
     3. Tildes en --success. El verde es un semántico de ESTADO (§5) y acá no
        informaba ningún estado: decoración con color de sistema.
     4. `flex: 1` en la lista: el hueco entre planes de 4 y 5 ítems quedaba
        ADENTRO de la lista.                                                */
.planes { padding-top: 13px; align-items: stretch; }

.plan {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  background: var(--tinta-3);
  border: 1px solid var(--tinta-linea-2);
  border-radius: var(--r-lg);
  padding: var(--s-xl);
  color: var(--sobre-tinta);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .28);
}
.plan.destacado {
  border-color: var(--sobre-tinta-accent);
  box-shadow: 0 22px 56px rgba(0, 0, 0, .38);
}
/* `.elevar` de la familia levanta con --sh-3 y --accent-line: sobre oscuro la
   sombra no se ve y el azul claro desentona. */
.plan.elevar:hover {
  border-color: var(--sobre-tinta-accent);
  box-shadow: 0 28px 64px rgba(0, 0, 0, .44);
}

/* Sale del flujo y monta el borde superior: deja de empujar. */
.etiqueta {
  position: absolute;
  top: 0;
  left: var(--s-xl);
  transform: translateY(-50%);
  margin: 0;
  padding: 3px var(--s-sm);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--sobre-tinta-accent);
  color: var(--sobre-tinta-on-accent);
  white-space: nowrap;
}

.plan h3 {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: #fff;
}

/* El lugar del precio lo ocupa el número que SÍ existe. En mono porque
   DESIGN.md §1 reserva la mono para cifras, y es lo único que diferencia
   un plan de otro. */
.para {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 15px;
  line-height: 1.5;
  color: var(--sobre-tinta);
}

.plan ul {
  list-style: none;
  margin: var(--s-sm) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  flex: 0 0 auto;
}
.plan li {
  display: flex;
  gap: var(--s-sm);
  align-items: flex-start;
  font-size: 15px;
  line-height: 1.5;
  color: var(--sobre-tinta);
}
.plan li svg {
  flex: none;
  margin-top: 3px;
  color: var(--sobre-tinta-2);
}
/* Lo que todavía no existe se apaga y se dice. No se oculta: que el plan liste
   hacia dónde va es información útil — mentir sobre cuándo, no. */
/* Sobre la tarjeta oscura, --muted daba 2,14:1 y --muted-2 2,41:1 — y son 11
   de los 13 ítems de los tres planes. Van al gris de tinta. */
.plan li.pendiente { color: var(--sobre-tinta-2); }
.plan li.pendiente svg { color: var(--sobre-tinta-2); }
.plan .pronto {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sobre-tinta-2);
  white-space: nowrap;
}
.plan::after {
  content: '';
  order: 1;
  margin-top: auto;
  height: 1px;
  background: var(--tinta-linea-2);
}
/* "A convenir" baja al pie y cambia de registro: deja de parecer un precio
   porque deja de estar donde va un precio. */
.precio {
  order: 2;
  margin: 0;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sobre-tinta-2);
}
.plan .btn {
  order: 3;
  text-align: center;
  text-decoration: none;
  background: transparent;
  border-color: var(--tinta-linea-2);
  color: #fff;
}
.plan .btn:hover { background: rgba(255, 255, 255, .08); border-color: #fff; }
.plan.destacado .btn {
  background: var(--sobre-tinta-accent);
  border-color: var(--sobre-tinta-accent);
  color: var(--sobre-tinta-on-accent);
}
.plan.destacado .btn:hover { filter: brightness(1.06); }

.medida {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-xl);
  margin-top: var(--s-2xl);
  padding: var(--s-xl);
  background: transparent;
  border: 1px dashed var(--tinta-linea-2);
  border-radius: var(--r-lg);
  color: var(--sobre-tinta);
  flex-wrap: wrap;
}
.medida h3 {
  font-size: 20px;
  font-weight: 600;
  color: #fff;
}
.medida p {
  margin: var(--s-xs) 0 0;
  max-width: 56ch;
  color: var(--sobre-tinta-2);
  font-size: 15px;
}
.medida .btn.secondary {
  background: rgba(255, 255, 255, .06);
  border-color: var(--tinta-linea-2);
  color: #fff;
}
.medida .btn.secondary:hover { background: rgba(255, 255, 255, .13); border-color: #fff; }
.medida .btn {
  text-decoration: none;
  white-space: nowrap;
}

/* ── FAQ ── */
.faq {
  border-top: 1px solid var(--line);
}
.faq details {
  border-bottom: 1px solid var(--line);
}
.faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-md);
  padding: var(--s-lg) 0;
  cursor: pointer;
  color: var(--ink);
  font-weight: 500;
  list-style: none;
}
.faq summary::-webkit-details-marker {
  display: none;
}
.faq summary svg {
  flex: none;
  color: var(--muted);
  transition: transform var(--t-short);
}
.faq details[open] summary svg {
  transform: rotate(180deg);
}
.faq p {
  margin: 0 0 var(--s-lg);
  padding-right: var(--s-2xl);
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}

/* ── Antes / después ── */
.contraste {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.contraste li {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-md);
  align-items: stretch;
}
.contraste .antes,
.contraste .despues {
  padding: var(--s-lg) var(--s-xl);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
}
/* El "hoy" va apagado y el "acá" con el acento. Sin rojo en el lado del
   problema: la planilla del lector no es un error, es lo que había.
   El acento deja de ser un borde de 1px a 1,42:1 —que nadie veía— y pasa a ser
   una espina de 3px que corre por toda la columna: 11,5:1 sobre blanco, y es
   la única cosa azul de la mitad clara de la página. */
.contraste .antes {
  background: transparent;
  border-style: dashed;
  border-color: var(--line-strong);
}
.contraste .despues {
  border-color: var(--line);
  border-left: 3px solid var(--accent);
}

.contraste .et {
  display: block;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: var(--s-xs);
}
/* `--muted-2` a 10px sobre la superficie honda da 4,22:1. Este rótulo es lo
   único que identifica la columna, así que sube a `--muted`: 4,63. */
.contraste .antes .et { color: var(--muted); }
.contraste .despues .et { color: var(--accent); }
.contraste p {
  margin: 0;
  line-height: 1.55;
}
.contraste .antes p { color: var(--muted); font-size: 16px; }
.contraste .despues p { color: var(--ink-2); font-size: 17px; }

/* ── Cierre ── */
.cierre {
  padding: clamp(40px, 6vw, 72px) 0;
  background: var(--surface-3);
  border-top: 3px solid var(--accent);
}
.cierre-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2xl);
  flex-wrap: wrap;
}
.cierre h2 {
  font-size: clamp(22px, 2.6vw, 28px);
  max-width: 20ch;
}
.cierre p {
  margin: var(--s-md) 0 0;
  max-width: 52ch;
  color: var(--ink-2);
  font-size: 17px;
  line-height: 1.6;
}
.cierre-cta { display: flex; gap: var(--s-md); flex-wrap: wrap; }

/* ── Pie ── */
.pie-pagina {
  padding: var(--s-2xl) 0;
  border-top: 1px solid var(--line);
}
.pie-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-xl);
  flex-wrap: wrap;
}
.pie-texto {
  margin: var(--s-sm) 0 0;
  font-size: 12px;
  color: var(--muted-2);
  max-width: 40ch;
}
.pie-links {
  display: flex;
  gap: var(--s-lg);
  font-size: 13px;
}
.pie-links a {
  color: var(--muted);
  text-decoration: none;
}
.pie-links a:hover {
  color: var(--ink);
}

/* ── Responsive ── */
@media (max-width: 960px) {
  .hero-inner {
    grid-template-columns: 1fr;
  }
  .grid3 {
    grid-template-columns: repeat(2, 1fr);
  }
  .pasos {
    grid-template-columns: repeat(2, 1fr);
  }
  .enlaces {
    display: none;
  }
}

@media (max-width: 620px) {
  .grid3,
  .pasos {
    grid-template-columns: 1fr;
  }
  /* Apilado, el par sigue leyéndose como "esto" → "esto otro" porque cada
     mitad conserva su etiqueta. */
  .contraste li {
    grid-template-columns: 1fr;
    gap: var(--s-xs);
  }
  /* Apiladas, el badge ya no empuja a nadie, pero cae entre dos tarjetas y
     necesita su propio aire. */
  .planes { row-gap: var(--s-xl); }
}

/* Los bloques oscuros llevan `#fff` literal, que ningún token puede
   neutralizar: sin esto, Planes se imprime blanco sobre blanco. */
@media print {
  .seccion.tinta,
  .plan,
  .medida {
    background: #fff;
    color: #000;
    box-shadow: none;
    border-color: #999;
  }
  .seccion.tinta .seccion-cab h2,
  .seccion.tinta .seccion-cab p,
  .plan h3,
  .para,
  .plan li,
  .medida h3,
  .medida p,
  .precio { color: #000; }
  .etiqueta { background: #fff; color: #000; border: 1px solid #999; }
  .hero { background: #fff; color: #000; }
  .hero h1, .muestra-dir, .monto { color: #000; }
}

@media (prefers-reduced-motion: reduce) {
  .nav,
  .faq summary svg {
    transition: none;
  }
}
</style>
