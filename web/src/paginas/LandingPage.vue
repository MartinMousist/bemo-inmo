<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
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
    titulo: 'Oportunidades',
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

const planes = [
  {
    nombre: 'Inicial',
    para: 'Hasta 3 usuarios · 100 propiedades',
    incluye: [
      'Cartera, personas y oportunidades',
      'Contratos y vencimientos',
      'Ajustes por índice',
      'Publicación a 1 portal',
    ],
    destacado: false,
  },
  {
    nombre: 'Medio',
    para: 'Hasta 10 usuarios · 500 propiedades',
    incluye: [
      'Todo lo de Inicial',
      'Cobranzas y liquidación a propietarios',
      'Pre-contratos y plantillas',
      'Comisiones por punta · 3 portales',
      'Recordatorios por WhatsApp',
    ],
    destacado: true,
  },
  {
    nombre: 'Pro',
    para: 'Usuarios y propiedades sin límite',
    incluye: [
      'Todo lo de Medio',
      'Multi-sucursal',
      'Campañas en Meta',
      'Todos los portales · API',
    ],
    destacado: false,
  },
];

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
    aca: 'Todo queda en la cuenta de la inmobiliaria, con quién hizo cada cosa.',
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
    a: 'Es exactamente para eso. Desde que los contratos son de forma libre, cada uno puede tener su índice (IPC, ICL, UVA, ICP, dólar o un porcentaje fijo) y su periodicidad. El sistema los maneja por contrato, no por regla general.',
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
onMounted(() => window.addEventListener('scroll', alScrollear, { passive: true }));
onBeforeUnmount(() => window.removeEventListener('scroll', alScrollear));
</script>

<template>
  <div class="landing">
    <header class="nav" :class="{ compacto }">
      <div class="contenedor nav-inner">
        <RouterLink to="/" class="marca"><BemoLogo :tam="32" con-nombre /></RouterLink>
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
        <div class="hero-texto">
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
        <div class="hero-muestra" aria-hidden="true">
          <div class="muestra-card">
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

          <div class="muestra-card chica">
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
    <section id="problema" class="seccion alterna">
      <div class="contenedor">
        <div class="seccion-cab">
          <h2>Hoy esto lo hace una planilla y la memoria de alguien</h2>
          <p>
            Funciona hasta que son cuarenta contratos, o hasta que esa persona
            se toma vacaciones.
          </p>
        </div>

        <ul class="contraste">
          <li v-for="c in contraste" :key="c.hoy">
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
        <div class="seccion-cab">
          <h2>Todo lo que hoy vive en una planilla</h2>
          <p>
            Lo que ya está disponible se puede usar hoy. Lo que dice “en desarrollo”
            todavía no existe, y preferimos decirlo.
          </p>
        </div>

        <div class="grid3">
          <article v-for="m in modulos" :key="m.titulo" class="modulo">
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
    <section id="como" class="seccion alterna">
      <div class="contenedor">
        <div class="seccion-cab">
          <h2>Cómo funciona</h2>
          <p>Cuatro pasos, y después el sistema trabaja sin que nadie lo empuje.</p>
        </div>
        <ol class="pasos">
          <li v-for="p in pasos" :key="p.n">
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
        <div class="seccion-cab">
          <h2>Estás manejando plata que no es tuya</h2>
          <p>
            Por eso las tres cosas que siguen no son opciones de configuración.
          </p>
        </div>

        <div class="grid3">
          <article v-for="g in garantias" :key="g.titulo" class="modulo">
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
    <section id="planes" class="seccion alterna">
      <div class="contenedor">
        <div class="seccion-cab">
          <h2>Planes</h2>
          <p>
            Los precios se definen con las primeras inmobiliarias. Escribinos y
            armamos el número juntos — preferimos eso antes que publicar una cifra
            que todavía no probamos.
          </p>
        </div>

        <div class="grid3 planes">
          <article
            v-for="p in planes"
            :key="p.nombre"
            class="plan"
            :class="{ destacado: p.destacado }"
          >
            <p v-if="p.destacado" class="etiqueta">El que eligen la mayoría</p>
            <h3>{{ p.nombre }}</h3>
            <p class="para">{{ p.para }}</p>
            <p class="precio">A convenir</p>
            <ul>
              <li v-for="i in p.incluye" :key="i">
                <UiIcon nombre="tilde" :tam="15" />
                <span>{{ i }}</span>
              </li>
            </ul>
            <RouterLink class="btn" :class="{ secondary: !p.destacado }" to="/registrar">
              Empezar
            </RouterLink>
          </article>
        </div>

        <div class="medida">
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
        <div class="seccion-cab">
          <h2>Preguntas</h2>
        </div>
        <div class="faq">
          <details v-for="p in preguntas" :key="p.q">
            <summary>{{ p.q }}<UiIcon nombre="chevron" :tam="16" /></summary>
            <p>{{ p.a }}</p>
          </details>
        </div>
      </div>
    </section>

    <!-- ── Cierre ── -->
    <section class="cierre">
      <div class="contenedor cierre-inner">
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
}
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
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid transparent;
  transition: border-color var(--t-short), background var(--t-short);
}
.nav.compacto {
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
  padding: clamp(48px, 8vw, 96px) 0;
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
  color: var(--marca);
}
.hero h1 {
  font-size: clamp(34px, 5vw, 56px);
  line-height: 1.08;
  max-width: 13ch;
}
.bajada {
  margin: var(--s-lg) 0 0;
  max-width: 46ch;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
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
  color: var(--muted-2);
}

.hero-muestra {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.muestra-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
  padding: var(--s-lg);
}
.muestra-cab {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cod {
  font-size: 12px;
  color: var(--muted);
}
.muestra-dir {
  margin: var(--s-sm) 0 var(--s-md);
  color: var(--ink);
  font-weight: 500;
}
.muestra-fila {
  display: flex;
  align-items: center;
  gap: var(--s-md);
}
.monto {
  font-size: 20px;
  color: var(--ink);
}
.muestra-calculo {
  margin-top: var(--s-lg);
  padding-top: var(--s-md);
  border-top: 1px solid var(--line);
}
.mini {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted-2);
}
.calculo {
  margin: var(--s-sm) 0 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--surface-2);
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-2);
}
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
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-2);
}
.venc li:last-child {
  border-bottom: none;
}

/* ── Secciones ── */
.seccion {
  padding: clamp(48px, 7vw, 88px) 0;
}
.seccion.alterna {
  background: var(--surface-2);
  border-block: 1px solid var(--line);
}
.seccion-cab {
  max-width: 56ch;
  margin-bottom: var(--s-2xl);
}
.seccion-cab h2 {
  font-size: clamp(24px, 3vw, 32px);
}
.seccion-cab p {
  margin: var(--s-md) 0 0;
  color: var(--muted);
  line-height: 1.6;
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
  color: var(--marca-fuerte);
}
.modulo-cab {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  margin: var(--s-md) 0 var(--s-sm);
  flex-wrap: wrap;
}
.modulo h3 {
  font-size: 16px;
}
.modulo p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
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
.pasos li {
  padding-top: var(--s-lg);
  border-top: 2px solid var(--marca-linea);
}
.pasos .n {
  font-size: 12px;
  color: var(--marca);
  font-weight: 500;
}
.pasos h3 {
  margin: var(--s-sm) 0 var(--s-xs);
  font-size: 16px;
}
.pasos p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

/* ── Planes ── */
.plan {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--s-xl);
}
.plan.destacado {
  border-color: var(--accent-line);
  box-shadow: var(--sh-2);
}
.etiqueta {
  margin: 0;
  align-self: flex-start;
  padding: 2px var(--s-sm);
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--r-sm);
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  color: var(--accent);
}
.plan h3 {
  font-size: 20px;
}
.para {
  margin: 0;
  font-size: 12px;
  color: var(--muted-2);
}
.precio {
  margin: 0;
  font-family: var(--font-title);
  font-size: 24px;
  color: var(--ink);
}
.plan ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  flex: 1;
}
.plan li {
  display: flex;
  gap: var(--s-sm);
  align-items: flex-start;
  font-size: 13px;
  color: var(--ink-2);
}
.plan li svg {
  flex: none;
  margin-top: 2px;
  color: var(--success);
}
.plan .btn {
  text-align: center;
  text-decoration: none;
}

.medida {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-xl);
  margin-top: var(--s-lg);
  padding: var(--s-xl);
  background: var(--surface);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-lg);
  flex-wrap: wrap;
}
.medida h3 {
  font-size: 17px;
}
.medida p {
  margin: var(--s-xs) 0 0;
  max-width: 56ch;
  color: var(--muted);
  font-size: 13px;
}
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
  padding: var(--s-lg);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
}
/* El "hoy" va apagado y el "acá" con el acento. Sin rojo en el lado del
   problema: la planilla del lector no es un error, es lo que había. */
.contraste .antes { background: transparent; border-style: dashed; }
.contraste .despues { border-color: var(--accent-line); }

.contraste .et {
  display: block;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: var(--s-xs);
}
.contraste .antes .et { color: var(--muted-2); }
.contraste .despues .et { color: var(--accent); }
.contraste p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
}
.contraste .antes p { color: var(--muted); }
.contraste .despues p { color: var(--ink-2); }

/* ── Cierre ── */
.cierre {
  padding: clamp(40px, 6vw, 72px) 0;
  background: var(--surface-2);
  border-top: 1px solid var(--line);
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
  color: var(--muted);
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
}

@media (prefers-reduced-motion: reduce) {
  .nav,
  .faq summary svg {
    transition: none;
  }
}
</style>
