import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { PLANTILLAS_POR_DEFECTO } from '../src/plantillas/plantillas.defecto';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

describe('Plantillas y pre-contratos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let contratoId: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('plant', tk);
    otra = await crearInmobiliaria('plantvecina', tk);
    contratoId = await armarContrato();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Un contrato completo: propiedad, locador con documento, locatario y garante. */
  async function armarContrato(): Promise<string> {
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({
        calle: 'Arístides Villanueva', numero: '345', piso: '3', depto: 'B',
        localidad: 'Ciudad', provincia: 'Mendoza', tipo: 'departamento',
      }).expect(201);

    const persona = async (nombre: string, apellido: string, doc: string, dom: string) =>
      (await http().post('/v1/personas').set(...como())
        .send({ nombre, apellido, docTipo: 'dni', docNumero: doc, domicilio: dom })
        .expect(201)).body.id;

    const locador = await persona('Marta', 'Silva', '18456789', 'San Martín 100');
    const locatario = await persona('Camila', 'Rossi', '35222111', 'Belgrano 250');
    const garante = await persona('Jorge', 'Ferreyra', '22987654', 'Rivadavia 80');

    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
        montoInicial: 485000, moneda: 'ARS', indice: 'ipc',
        periodicidadMeses: 3, honorariosPct: 8, deposito: 485000,
        diaVencimiento: 10, punitorioDiarioPct: 0.1,
        locadores: [{ personaId: locador, porcentaje: 100 }],
        locatarios: [locatario],
        garantes: [garante],
      }).expect(201);

    return c.body.id;
  }

  it('sembrar copia las plantillas base y es idempotente', async () => {
    const a = await http().post('/v1/plantillas/sembrar').set(...como()).expect(201);
    expect(a.body.creadas).toBe(PLANTILLAS_POR_DEFECTO.length);

    const b = await http().post('/v1/plantillas/sembrar').set(...como()).expect(201);
    expect(b.body.creadas).toBe(0);
    expect(b.body.yaEstaban).toBe(PLANTILLAS_POR_DEFECTO.length);
  });

  it('cada plantilla informa qué variables usa', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    expect(pre.variables).toEqual(
      expect.arrayContaining(['contrato.monto', 'locador.nombre', 'propiedad.direccion']),
    );
  });

  it('genera el pre-contrato con los datos reales del contrato', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    const t = doc.body.texto;
    expect(t).toContain('Marta Silva');
    expect(t).toContain('Camila Rossi');
    expect(t).toContain('Arístides Villanueva 345');
    // El monto va en número Y en letras, que es lo que exige un contrato.
    expect(t).toContain('ARS 485.000,00');
    expect(t).toContain('cuatrocientos ochenta y cinco mil');
    // Las fechas en texto largo, no en ISO.
    expect(t).toContain('1 de enero de 2026');
    expect(t).not.toContain('2026-01-01');
  });

  it('el bloque de garantes aparece porque hay uno', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    expect(doc.body.texto).toContain('GARANTÍA');
    expect(doc.body.texto).toContain('Jorge Ferreyra');
  });

  it('sin garantes, el bloque no aparece y no deja un hueco', async () => {
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({ calle: 'Sin Garantes', tipo: 'casa', localidad: 'Ciudad' }).expect(201);
    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 300000, moneda: 'ARS', indice: 'ninguno',
      }).expect(201);

    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId: c.body.id }).expect(201);

    expect(doc.body.texto).not.toContain('GARANTÍA');
    expect(doc.body.texto).not.toContain('{% si');
  });

  it('los datos que faltan se listan y quedan visibles en el texto', async () => {
    // Contrato sin depósito ni documento del locador: el pre-contrato se genera
    // igual —hay datos que se completan a mano— pero tiene que verse cuáles.
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({ calle: 'Incompleta', tipo: 'ph', localidad: 'Ciudad' }).expect(201);
    const p = await http().post('/v1/personas').set(...como())
      .send({ nombre: 'Sin', apellido: 'Documento' }).expect(201);
    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 200000, moneda: 'ARS', indice: 'ninguno',
        locadores: [{ personaId: p.body.id, porcentaje: 100 }],
      }).expect(201);

    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body.find((p2: { tipo: string }) => p2.tipo === 'pre_contrato_alquiler');

    const doc = await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como())
      .send({ contratoId: c.body.id }).expect(201);

    expect(doc.body.faltantes).toEqual(expect.arrayContaining(['locador.documento']));
    // Hueco visible, no un vacío silencioso.
    expect(doc.body.texto).toContain('«locador.documento»');
  });

  it('un recibo generado desde el CONTRATO no tiene monto, y lo dice', async () => {
    // Un recibo es por un cobro concreto, no por un contrato: el monto es lo que
    // se pagó, no el alquiler pactado. Generarlo por la vía genérica deja los
    // huecos a la vista en vez de imprimir el nominal, que con un pago parcial
    // sería un comprobante por plata que nadie entregó.
    //
    // El camino correcto es `POST /v1/plantillas/recibo/:cobroId`, con su suite
    // en `portal.spec.ts`.
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const recibo = lista.body.find((p: { tipo: string }) => p.tipo === 'recibo');

    const doc = await http().post(`/v1/plantillas/${recibo.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);

    expect(doc.body.faltantes).toEqual(expect.arrayContaining(['cobro.monto']));
    expect(doc.body.texto).toContain('«cobro.monto»');
    // Y NO inventa el monto del contrato en su lugar.
    expect(doc.body.texto).not.toContain('ARS 485.000,00');
  });

  it('la previsualización usa datos de ejemplo y no toca ningún contrato', async () => {
    const r = await http().post('/v1/plantillas/previsualizar').set(...como())
      .send({ contenido: 'Hola {{ locatario.nombre }}, debe {{ contrato.monto | moneda }}.' })
      .expect(201);

    expect(r.body.texto).toBe('Hola Camila Rossi, debe ARS 485.000,00.');
    expect(r.body.faltantes).toEqual([]);
  });

  it('se puede editar una plantilla y se refleja al generar', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const recibo = lista.body.find((p: { tipo: string }) => p.tipo === 'recibo');

    await http().put('/v1/plantillas').set(...como())
      .send({
        id: recibo.id, tipo: 'recibo', nombre: 'Recibo propio',
        contenido: 'RECIBO PROPIO — {{ locatario.nombre }} — {{ contrato.monto | moneda }}',
      }).expect(200);

    const doc = await http().post(`/v1/plantillas/${recibo.id}/generar`).set(...como())
      .send({ contratoId }).expect(201);
    expect(doc.body.texto).toBe('RECIBO PROPIO — Camila Rossi — ARS 485.000,00');
  });

  it('las plantillas son de cada inmobiliaria, no compartidas', async () => {
    // Si fueran globales, que una edite su redacción cambiaría el contrato de
    // todas las demás.
    const suyas = await http().get('/v1/plantillas').set(...auth(otra.tokens.owner)).expect(200);
    expect(suyas.body).toHaveLength(0);
  });

  it('el asesor puede generar pero no editar plantillas', async () => {
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    const pre = lista.body[0];

    await http().post(`/v1/plantillas/${pre.id}/generar`).set(...como('agente'))
      .send({ contratoId }).expect(201);

    await http().put('/v1/plantillas').set(...como('agente'))
      .send({ tipo: 'otro', nombre: 'X', contenido: 'y' }).expect(403);
  });

  // ── El editor con formato (migración 023) ──────────────────────────────────

  describe('editor con formato', () => {
    it('las plantillas base nacen en HTML, con sus chips y sus bloques', async () => {
      const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
      const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

      expect(pre.formato).toBe('html');
      expect(pre.contenido).toContain('<p>');
      expect(pre.contenido).toContain('data-var="contrato.monto"');
      expect(pre.contenido).toContain('data-bloque="si" data-expr="garantes"');
      // Y ni un token roto: si lo hubiera, saldría impreso adentro del contrato.
      expect(pre.tokensRotos).toEqual([]);
    });

    it('el catálogo de variables se acota por tipo de plantilla', async () => {
      const enContrato = await http().get('/v1/plantillas/variables?tipo=pre_contrato_alquiler')
        .set(...como()).expect(200);
      const rutas = enContrato.body.variables.map((v: { ruta: string }) => v.ruta);
      expect(rutas).toContain('contrato.monto');
      // `cobro.*` sólo existe en el contexto del recibo: ofrecerlo acá sería
      // ofrecer un hueco garantizado.
      expect(rutas).not.toContain('cobro.monto');

      const enRecibo = await http().get('/v1/plantillas/variables?tipo=recibo')
        .set(...como()).expect(200);
      expect(enRecibo.body.variables.map((v: { ruta: string }) => v.ruta)).toContain('cobro.monto');
    });

    it('el catálogo lo puede leer el asesor: edita documentos y necesita los nombres', async () => {
      const r = await http().get('/v1/plantillas/variables').set(...como('agente')).expect(200);
      expect(r.body.variables.length).toBeGreaterThan(0);
      expect(r.body.formatos.map((f: { nombre: string }) => f.nombre)).toContain('moneda');
    });

    /**
     * El escenario del enunciado: un PUT hecho **por fuera de la pantalla**.
     * El editor no es una frontera de seguridad; esto es la frontera.
     */
    it('un PUT crudo con <script> no deja nada ejecutable guardado', async () => {
      const guardada = await http().put('/v1/plantillas').set(...como())
        .send({
          tipo: 'otro',
          nombre: 'Con script',
          contenido:
            '<p onclick="robar()">Hola <b>{{ locatario.nombre }}</b></p>' +
            '<script>fetch("/v1/personas").then(r=>r.json())</script>' +
            '<img src=x onerror="alert(1)">' +
            '<a href="javascript:alert(2)">tocá</a>' +
            '<p style="font-family:Calibri">Chau</p>',
        }).expect(200);

      const c: string = guardada.body.contenido;
      expect(c.toLowerCase()).not.toContain('script');
      expect(c).not.toContain('fetch(');
      expect(c).not.toContain('onerror');
      expect(c).not.toContain('onclick');
      expect(c).not.toContain('javascript:');
      expect(c).not.toContain('style=');
      expect(c).not.toContain('<img');
      // Y lo que sí es contenido sobrevive: el sanitizador limpia, no vacía.
      expect(c).toContain('Hola');
      expect(c).toContain('Chau');
      expect(c).toContain('tocá');
      expect(c).toContain('data-var="locatario.nombre"');

      // Lo mismo, releído de la base: no es una limpieza de la respuesta.
      const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
      const rel = lista.body.find((p: { id: string }) => p.id === guardada.body.id);
      expect(rel.contenido.toLowerCase()).not.toContain('script');
    });

    it('la previsualización tampoco deja pasar un <script>: también va a un v-html', async () => {
      const r = await http().post('/v1/plantillas/previsualizar').set(...como())
        .send({ contenido: '<p>Hola</p><script>alert(1)</script>' }).expect(201);
      expect(r.body.texto.toLowerCase()).not.toContain('script');
      expect(r.body.texto).toContain('Hola');
    });

    /**
     * ⚠️ El agujero que el sanitizador NO ve: el valor entra DESPUÉS.
     *
     * El apellido lo carga un usuario del sistema en la ficha de la persona, el
     * motor lo sustituye en el documento y el documento termina en un `v-html`.
     */
    it('el apellido de una persona con <img onerror> no sobrevive al render', async () => {
      const prop = await http().post('/v1/propiedades').set(...como())
        .send({ calle: 'XSS', tipo: 'casa', localidad: 'Ciudad' }).expect(201);
      const pers = await http().post('/v1/personas').set(...como())
        .send({ nombre: 'Ana', apellido: '<img src=x onerror="alert(1)">' }).expect(201);
      const c = await http().post('/v1/contratos').set(...como())
        .send({
          propiedadId: prop.body.id, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
          montoInicial: 100000, moneda: 'ARS', indice: 'ninguno',
          locatarios: [pers.body.id],
        }).expect(201);

      const guardada = await http().put('/v1/plantillas').set(...como())
        .send({ tipo: 'otro', nombre: 'Saludo', contenido: '<p>Hola {{ locatario.nombre }}</p>' })
        .expect(200);

      const doc = await http().post(`/v1/plantillas/${guardada.body.id}/generar`).set(...como())
        .send({ contratoId: c.body.id }).expect(201);

      // La etiqueta no existe: el `<` está escapado, así que el navegador lee
      // «<img src=x onerror="alert(1)">» como TEXTO y no como una imagen rota
      // que dispara su `onerror`. Ésa es exactamente la diferencia.
      expect(doc.body.texto).not.toContain('<img');
      expect(doc.body.texto).toContain('&lt;img src=x onerror=');
      // Las únicas etiquetas que quedan son las de la plantilla.
      expect(doc.body.texto.match(/<[a-z]/gi)).toEqual(['<p']);
    });

    it('convertir() es idempotente y guarda el original para poder auditarlo', async () => {
      const creada = await http().put('/v1/plantillas').set(...como())
        .send({
          tipo: 'otro', nombre: 'En texto plano', formato: 'texto',
          contenido: 'PRIMERA\n\nPaga {{ contrato.monto | moneda }}.\n  · Con recibo\n',
        }).expect(200);
      expect(creada.body.formato).toBe('texto');

      const uno = await http().post(`/v1/plantillas/${creada.body.id}/convertir`)
        .set(...como()).expect(201);
      expect(uno.body.formato).toBe('html');
      expect(uno.body.contenido).toContain('<p>PRIMERA</p>');
      expect(uno.body.contenido).toContain('<li>Con recibo</li>');
      expect(uno.body.contenido).toContain('data-formato="moneda"');
      expect(uno.body.textoOriginal).toContain('PRIMERA\n');
      expect(uno.body.convertidaEl).toBeTruthy();

      // Dos veces no convierte dos veces: escaparía las etiquetas de la primera
      // pasada y el contrato saldría con &lt;p&gt; impreso adentro.
      const dos = await http().post(`/v1/plantillas/${creada.body.id}/convertir`)
        .set(...como()).expect(201);
      expect(dos.body.contenido).toBe(uno.body.contenido);
      expect(dos.body.contenido).not.toContain('&lt;p&gt;');
    });

    it('el asesor no puede convertir una plantilla', async () => {
      const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
      await http().post(`/v1/plantillas/${lista.body[0].id}/convertir`)
        .set(...como('agente')).expect(403);
    });

    it('una plantilla HTML de una inmobiliaria no se ve desde la otra', async () => {
      const mia = await http().put('/v1/plantillas').set(...como())
        .send({ tipo: 'otro', nombre: 'Aislada', contenido: '<p>Secreto de Andes</p>' })
        .expect(200);

      const suyas = await http().get('/v1/plantillas').set(...auth(otra.tokens.owner)).expect(200);
      expect(suyas.body.map((p: { id: string }) => p.id)).not.toContain(mia.body.id);

      // Y tampoco se puede pisar por id desde la vecina: el UPDATE no ve la
      // fila, así que no hay a qué apuntarle.
      await http().put('/v1/plantillas').set(...auth(otra.tokens.owner))
        .send({ id: mia.body.id, tipo: 'otro', nombre: 'Robada', contenido: '<p>x</p>' })
        .expect(404);
      await http().post(`/v1/plantillas/${mia.body.id}/convertir`)
        .set(...auth(otra.tokens.owner)).expect(404);

      const sigue = await http().get('/v1/plantillas').set(...como()).expect(200);
      expect(sigue.body.find((p: { id: string }) => p.id === mia.body.id).nombre).toBe('Aislada');
    });

    it('los tokens rotos se denuncian en la lista, con su motivo', async () => {
      const r = await http().put('/v1/plantillas').set(...como())
        .send({
          tipo: 'otro', nombre: 'Rota',
          contenido: '<p>Paga {{ contrato monto }} el {{ contrato.inicio | cuando }}.</p>',
        }).expect(200);

      const motivos = r.body.tokensRotos.map((t: { motivo: string }) => t.motivo).join(' ');
      expect(r.body.tokensRotos.length).toBeGreaterThan(0);
      expect(motivos).toContain('impreso tal cual');
      // El formato inventado se saca al guardar y se avisa.
      expect(r.body.avisos.join(' ')).toContain('cuando');
    });
  });

  // ── El documento generado ──────────────────────────────────────────────────

  describe('el documento en HTML', () => {
    async function documentoDelPreContrato() {
      const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
      const pre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');
      const d = await http().post('/v1/documentos').set(...como())
        .send({ contratoId, plantillaId: pre.id }).expect(201);
      return d.body;
    }

    it('congela su formato y ofrece la proyección a texto plano', async () => {
      const doc = await documentoDelPreContrato();
      expect(doc.formato).toBe('html');
      expect(doc.textoFinal).toContain('<p>');
      expect(doc.textoPlano).not.toContain('<p>');
      expect(doc.textoPlano).toContain('Marta Silva');

      const t = await http().get(`/v1/documentos/${doc.id}/texto`).set(...como()).expect(200);
      expect(t.body.texto).toBe(doc.textoPlano);
      expect(t.body.caracteres).toBe(doc.textoPlano.length);
    });

    it('el andamio del editor no queda en el documento generado', async () => {
      const doc = await documentoDelPreContrato();
      // Un documento ya renderizado no tiene estructura que resolver.
      expect(doc.textoFinal).not.toContain('data-bloque');
      expect(doc.textoFinal).not.toContain('data-var');
      expect(doc.textoFinal).not.toContain('{%');
      expect(doc.textoFinal).not.toContain('{{');
    });

    /**
     * El regreso silencioso que este cambio podía dejar: `envio.motor.ts`
     * decide `completo` vs `adjunto` midiendo `texto.length`. Con el HTML sin
     * proyectar, un pre-contrato de 2.000 caracteres mide 6.000 y TODO
     * documento pasaría a «adjunto» con un motivo que cita un número que no es.
     */
    it('el largo del envío se mide sobre el TEXTO, no sobre las etiquetas', async () => {
      const doc = await documentoDelPreContrato();

      const prep = await http()
        .get(`/v1/documentos/${doc.id}/preparar?canal=whatsapp&destino=2616152233`)
        .set(...como()).expect(200);

      expect(prep.body.caracteres).toBe(doc.textoPlano.length);
      expect(prep.body.caracteres).toBeLessThan(doc.textoFinal.length);
      // Un pre-contrato entra en WhatsApp: el modo tiene que seguir siendo el
      // mismo que antes de que el texto viajara marcado.
      expect(prep.body.modo).toBe('completo');
      // Y el mensaje lleva el texto sin etiquetas: del otro lado se lee.
      expect(decodeURIComponent(prep.body.url)).not.toContain('<p>');

      // El mail, en cambio, no entra: sigue midiendo la URL codificada.
      const mail = await http()
        .get(`/v1/documentos/${doc.id}/preparar?canal=email&destino=a@b.com`)
        .set(...como()).expect(200);
      expect(mail.body.modo).toBe('adjunto');
      expect(mail.body.motivo).toContain('2.048');
    });

    it('editar el documento también sanitiza: el PUT viene de afuera', async () => {
      const doc = await documentoDelPreContrato();
      const r = await http().put(`/v1/documentos/${doc.id}`).set(...como())
        .send({ textoFinal: '<p>Acordado</p><script>alert(1)</script>' }).expect(200);

      expect(r.body.textoFinal.toLowerCase()).not.toContain('script');
      expect(r.body.textoFinal).toBe('<p>Acordado</p>');
      expect(r.body.textoPlano).toBe('Acordado\n');
      expect(r.body.editado).toBe(true);
    });
  });
});
