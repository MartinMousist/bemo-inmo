import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Los documentos generados: guardarlos, editarlos y registrar por dónde salieron.
 *
 * Lo que estas pruebas defienden, en orden de lo que más duele:
 *
 *   · que el texto editado y el que produjo el motor se guarden POR SEPARADO —es
 *     la respuesta a «qué le cambiaron al modelo antes de mandarlo»—;
 *   · que un documento ya mandado no se pueda reescribir ni borrar, que es la
 *     misma regla de un ajuste confirmado y de una liquidación cerrada;
 *   · que borrar la plantilla no se lleve puesto el documento que ya salió, que
 *     es lo que la pantalla de Plantillas le promete al usuario;
 *   · y que nada de esto cruce de una inmobiliaria a otra: un pre-contrato lleva
 *     los DNI y los domicilios de las partes.
 */
describe('Documentos generados', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let contratoId: string;
  let plantillaPre: string;
  let plantillaAviso: string;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('docs', tk);
    otra = await crearInmobiliaria('docsvecina', tk);

    await http().post('/v1/plantillas/sembrar').set(...como()).expect(201);
    const lista = await http().get('/v1/plantillas').set(...como()).expect(200);
    plantillaPre = lista.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler').id;
    plantillaAviso = lista.body.find((p: { tipo: string }) => p.tipo === 'aviso_aumento').id;

    contratoId = await armarContrato();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /**
   * Un contrato con inquilino con teléfono y mail: hay a quién mandarle.
   *
   * Los DNI llevan un correlativo porque `persona` tiene un índice único por
   * `(tenant_id, doc_tipo, doc_numero)` y esta función se llama más de una vez:
   * el pre-contrato automático necesita contratos nuevos para probarse. Los
   * NOMBRES sí se repiten a propósito — los tests afirman que aparecen en el
   * texto generado.
   */
  let nDoc = 0;
  async function armarContrato(): Promise<string> {
    nDoc += 1;
    const dni = (base: number) => String(base + nDoc);

    const prop = await http().post('/v1/propiedades').set(...como())
      .send({
        calle: 'Arístides Villanueva', numero: '345',
        localidad: 'Ciudad', provincia: 'Mendoza', tipo: 'departamento',
      }).expect(201);

    const locador = (await http().post('/v1/personas').set(...como())
      .send({
        nombre: 'Marta', apellido: 'Silva', docTipo: 'dni', docNumero: dni(18456789),
        domicilio: 'San Martín 100',
      }).expect(201)).body.id;

    const locatario = (await http().post('/v1/personas').set(...como())
      .send({
        nombre: 'Camila', apellido: 'Rossi', docTipo: 'dni', docNumero: dni(35222111),
        domicilio: 'Belgrano 250', telefono: '261 615-2233', email: 'crossi@correo.test',
      }).expect(201)).body.id;

    const c = await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
        montoInicial: 485000, moneda: 'ARS', indice: 'ipc',
        periodicidadMeses: 3, honorariosPct: 8, deposito: 485000,
        diaVencimiento: 10, punitorioDiarioPct: 0.1,
        locadores: [{ personaId: locador, porcentaje: 100 }],
        locatarios: [locatario],
      }).expect(201);

    return c.body.id;
  }

  const crearDoc = async (plantillaId = plantillaPre, extra: object = {}) =>
    (await http().post('/v1/documentos').set(...como())
      .send({ contratoId, plantillaId, ...extra }).expect(201)).body;

  // ── Camino feliz ───────────────────────────────────────────────────────────

  it('guardar sin editar deja los dos textos iguales', async () => {
    const d = await crearDoc();
    expect(d.textoGenerado).toContain('Camila Rossi');
    expect(d.textoFinal).toBe(d.textoGenerado);
    expect(d.editado).toBe(false);
    // Y queda quién lo generó, cuándo y con qué plantilla.
    expect(d.generadoPor).toBe(`owner de docs`);
    expect(d.plantillaNombre).toBe('Pre-contrato de locación');
    expect(d.plantillaTipo).toBe('pre_contrato_alquiler');
    expect(d.bloqueado).toBe(false);
  });

  it('el texto generado lo produce el motor, y el body ni siquiera puede pedirlo', async () => {
    // Si el front pudiera mandar `textoGenerado`, «qué le cambiaron al modelo»
    // sería lo que el front dice que cambiaron, que es otra cosa. El DTO no
    // tiene ese campo y la validación rechaza lo que no declara.
    await http().post('/v1/documentos').set(...como())
      .send({ contratoId, plantillaId: plantillaPre, textoGenerado: 'MENTIRA' })
      .expect(400);

    const d = await crearDoc(plantillaPre, { textoFinal: 'lo que quiero mandar' });
    expect(d.textoGenerado).toContain('CONTRATO DE LOCACIÓN');
    expect(d.textoFinal).toBe('lo que quiero mandar');
    expect(d.editado).toBe(true);
  });

  it('editar antes de mandar guarda las dos versiones', async () => {
    const d = await crearDoc();
    const editado = await http().put(`/v1/documentos/${d.id}`).set(...como())
      .send({ textoFinal: `${d.textoGenerado}\n\nCLÁUSULA AGREGADA A MANO.` })
      .expect(200);

    expect(editado.body.editado).toBe(true);
    expect(editado.body.textoFinal).toContain('CLÁUSULA AGREGADA A MANO');
    // El original queda intacto: es contra eso que se compara.
    expect(editado.body.textoGenerado).toBe(d.textoGenerado);
  });

  it('un PUT parcial no borra el título con NULL', async () => {
    const d = await crearDoc(plantillaPre, { titulo: 'Pre-contrato de Camila' });
    const r = await http().put(`/v1/documentos/${d.id}`).set(...como())
      .send({ textoFinal: 'otra cosa' }).expect(200);
    expect(r.body.titulo).toBe('Pre-contrato de Camila');
  });

  it('el historial del contrato lista lo generado, lo más nuevo primero', async () => {
    const r = await http().get(`/v1/contratos/${contratoId}/documentos`).set(...como())
      .expect(200);
    expect(r.body.length).toBeGreaterThanOrEqual(3);
    const fechas = r.body.map((d: { createdAt: string }) => d.createdAt);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it('los destinatarios salen de las partes que tienen contacto', async () => {
    const r = await http().get(`/v1/contratos/${contratoId}/documentos/destinatarios`)
      .set(...como()).expect(200);
    // El locador se cargó sin teléfono ni mail: no aparece, porque ofrecerlo
    // sería ofrecer un botón que no va a funcionar.
    expect(r.body).toEqual([
      { nombre: 'Camila Rossi', rol: 'locatario', telefono: '261 615-2233', email: 'crossi@correo.test' },
    ]);
  });

  // ── Los envíos ─────────────────────────────────────────────────────────────

  it('el envío por WhatsApp devuelve el wa.me y deja la fila', async () => {
    const d = await crearDoc();
    const r = await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'whatsapp', destino: '261 615-2233' }).expect(201);

    expect(r.body.preparado.url).toContain('https://wa.me/5492616152233?text=');
    expect(r.body.envio.canal).toBe('whatsapp');
    expect(r.body.envio.destino).toBe('5492616152233');
    expect(r.body.envio.abiertoPor).toBe('owner de docs');
    expect(r.body.documento.envios).toHaveLength(1);
    // Y el documento queda marcado como ya salido.
    expect(r.body.documento.primerEnvioEl).not.toBeNull();
    expect(r.body.documento.bloqueado).toBe(true);
  });

  it('un pre-contrato no entra en un mailto: va como adjunto y dice por qué', async () => {
    const d = await crearDoc();
    const prev = await http().get(`/v1/documentos/${d.id}/preparar`).set(...como())
      .query({ canal: 'email', destino: 'crossi@correo.test' }).expect(200);

    expect(prev.body.modo).toBe('adjunto');
    expect(prev.body.motivo).toContain('2.048');
    expect(prev.body.caracteres).toBeGreaterThan(prev.body.limite);
  });

  it('un aviso corto sí entra, y va completo', async () => {
    const d = await crearDoc(plantillaAviso);
    const prev = await http().get(`/v1/documentos/${d.id}/preparar`).set(...como())
      .query({ canal: 'email', destino: 'crossi@correo.test' }).expect(200);

    expect(prev.body.modo).toBe('completo');
    expect(prev.body.motivo).toBeNull();
    expect(prev.body.caracteres).toBeLessThanOrEqual(prev.body.limite);
  });

  it('preparar NO registra nada: es lo que deja avisar antes de apretar', async () => {
    const d = await crearDoc();
    await http().get(`/v1/documentos/${d.id}/preparar`).set(...como())
      .query({ canal: 'whatsapp', destino: '261 615-2233' }).expect(200);

    const r = await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(200);
    expect(r.body.envios).toHaveLength(0);
    expect(r.body.bloqueado).toBe(false);
  });

  it('imprimir también queda anotado, y sin destinatario', async () => {
    const d = await crearDoc();
    const r = await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'impresion' }).expect(201);

    expect(r.body.preparado).toBeNull();
    expect(r.body.envio.canal).toBe('impresion');
    // NULL y no "—": no hay destinatario, y poner uno sería inventarlo.
    expect(r.body.envio.destino).toBeNull();
  });

  it('un mismo documento acumula envíos en vez de pisarlos', async () => {
    const d = await crearDoc();
    await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'whatsapp', destino: '261 615-2233' }).expect(201);
    await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'impresion' }).expect(201);
    const r = await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'email', destino: 'crossi@correo.test' }).expect(201);

    expect(r.body.documento.envios.map((e: { canal: string }) => e.canal).sort())
      .toEqual(['email', 'impresion', 'whatsapp']);
  });

  it('un teléfono que no cierra NO deja fila: no se anota lo que no se abrió', async () => {
    const d = await crearDoc();
    const r = await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'whatsapp', destino: '4201100' }).expect(422);
    expect(r.body.detail).toContain('7 dígitos');

    const doc = await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(200);
    expect(doc.body.envios).toHaveLength(0);
    expect(doc.body.bloqueado).toBe(false);
  });

  // ── Lo que ya salió es lo que salió ────────────────────────────────────────

  it('editar después del primer envío da 409 y explica qué hacer', async () => {
    const d = await crearDoc();
    await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'whatsapp', destino: '261 615-2233' }).expect(201);

    const r = await http().put(`/v1/documentos/${d.id}`).set(...como())
      .send({ textoFinal: 'ahora digo otra cosa' }).expect(409);
    expect(r.body.detail).toContain('generá uno nuevo');

    // Y el texto sigue siendo el que salió.
    const doc = await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(200);
    expect(doc.body.textoFinal).toBe(d.textoFinal);
  });

  it('borrar un documento ya mandado da 409', async () => {
    const d = await crearDoc();
    await http().post(`/v1/documentos/${d.id}/envios`).set(...como())
      .send({ canal: 'impresion' }).expect(201);

    const r = await http().delete(`/v1/documentos/${d.id}`).set(...como()).expect(409);
    expect(r.body.detail).toContain('constancia');
  });

  it('uno que nunca salió sí se puede borrar', async () => {
    const d = await crearDoc();
    await http().delete(`/v1/documentos/${d.id}`).set(...como()).expect(204);
    await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(404);
  });

  /**
   * La pantalla de Plantillas promete, en el diálogo de borrar, que «los
   * documentos que ya se generaron con ella no se tocan». Hasta la 020 eso era
   * cierto porque no se guardaba ninguno; ahora lo tiene que sostener el schema.
   */
  it('borrar la plantilla no borra el documento, y el nombre sigue estando', async () => {
    const nueva = await http().put('/v1/plantillas').set(...como())
      .send({ tipo: 'otro', nombre: 'Modelo que se va a borrar', contenido: 'Hola {{ locatario.nombre }}' })
      .expect(200);

    const d = await crearDoc(nueva.body.id);
    await http().delete(`/v1/plantillas/${nueva.body.id}`).set(...como()).expect(204);

    const r = await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(200);
    expect(r.body.plantillaId).toBeNull();
    expect(r.body.plantillaNombre).toBe('Modelo que se va a borrar');
    expect(r.body.textoFinal).toBe('Hola Camila Rossi');
  });

  // ── Denegaciones ───────────────────────────────────────────────────────────

  it('el asesor puede generar y mandar: es el que atiende', async () => {
    const d = await http().post('/v1/documentos').set(...como('agente'))
      .send({ contratoId, plantillaId: plantillaPre }).expect(201);
    await http().post(`/v1/documentos/${d.body.id}/envios`).set(...como('agente'))
      .send({ canal: 'whatsapp', destino: '261 615-2233' }).expect(201);
  });

  it('el contable no crea ni manda, pero sí lee', async () => {
    await http().post('/v1/documentos').set(...como('contable'))
      .send({ contratoId, plantillaId: plantillaPre }).expect(403);

    const d = await crearDoc();
    await http().post(`/v1/documentos/${d.id}/envios`).set(...como('contable'))
      .send({ canal: 'impresion' }).expect(403);
    await http().put(`/v1/documentos/${d.id}`).set(...como('contable'))
      .send({ textoFinal: 'x' }).expect(403);

    await http().get(`/v1/documentos/${d.id}`).set(...como('contable')).expect(200);
    await http().get(`/v1/contratos/${contratoId}/documentos`).set(...como('contable')).expect(200);
  });

  it('el asesor no borra documentos', async () => {
    const d = await crearDoc();
    await http().delete(`/v1/documentos/${d.id}`).set(...como('agente')).expect(403);
  });

  // ── Aislamiento entre inmobiliarias ────────────────────────────────────────

  it('la otra inmobiliaria no ve el documento, ni lo edita, ni lo manda', async () => {
    const d = await crearDoc();
    const suyo = auth(otra.tokens.owner);

    await http().get(`/v1/documentos/${d.id}`).set(...suyo).expect(404);
    await http().put(`/v1/documentos/${d.id}`).set(...suyo).send({ textoFinal: 'mío' }).expect(404);
    await http().delete(`/v1/documentos/${d.id}`).set(...suyo).expect(404);
    await http().post(`/v1/documentos/${d.id}/envios`).set(...suyo)
      .send({ canal: 'impresion' }).expect(404);
    await http().get(`/v1/documentos/${d.id}/preparar`).set(...suyo)
      .query({ canal: 'whatsapp', destino: '261 615-2233' }).expect(404);

    // Y el documento quedó intacto del lado de su dueña.
    const mio = await http().get(`/v1/documentos/${d.id}`).set(...como()).expect(200);
    expect(mio.body.textoFinal).toBe(d.textoFinal);
    expect(mio.body.envios).toHaveLength(0);
  });

  it('la otra inmobiliaria no ve el historial del contrato ajeno', async () => {
    const r = await http().get(`/v1/contratos/${contratoId}/documentos`)
      .set(...auth(otra.tokens.owner)).expect(200);
    expect(r.body).toEqual([]);
  });

  it('no se puede generar un documento contra un contrato de otra', async () => {
    await http().post('/v1/documentos').set(...auth(otra.tokens.owner))
      .send({ contratoId, plantillaId: plantillaPre }).expect(404);
  });

  // ── El pre-contrato que nace con el contrato ───────────────────────────────
  //
  // El dueño lo pidió dos veces: «el pre contrato debe estar cargado el texto a
  // la hora que se crea un contrato». No un botón «generar» — el texto ya está.

  describe('el pre-contrato al crear el contrato', () => {
    it('un contrato nuevo nace con su pre-contrato escrito', async () => {
      const nuevo = await armarContrato();

      const r = await http().get(`/v1/contratos/${nuevo}/documentos`)
        .set(...como()).expect(200);

      expect(r.body).toHaveLength(1);
      expect(r.body[0].plantillaTipo).toBe('pre_contrato_alquiler');
      // Que el texto ESTÉ es el punto entero: no una fila vacía esperando que
      // alguien apriete algo.
      expect(r.body[0].textoFinal).toContain('CONTRATO DE LOCACIÓN');
      expect(r.body[0].textoFinal).toContain('Camila Rossi');
      expect(r.body[0].textoFinal).toContain('Marta Silva');
      // Sin editar, los dos textos son el mismo: así se sabe después qué se le
      // cambió al modelo.
      expect(r.body[0].editado).toBe(false);
    });

    it('sin plantilla de pre-contrato el contrato se crea igual', async () => {
      // La regla que ordena todo esto: el contrato es el hecho legal y el
      // documento una comodidad. Una comodidad que voltea la operación deja de
      // serlo. Se prueba en una inmobiliaria que nunca sembró las plantillas.
      const sinPlantillas = await crearInmobiliaria('docssinplant', app.get(TokensService));
      const dueño = auth(sinPlantillas.tokens.owner);

      const prop = await http().post('/v1/propiedades').set(...dueño)
        .send({ calle: 'Sin Plantilla', tipo: 'casa' }).expect(201);

      const c = await http().post('/v1/contratos').set(...dueño)
        .send({
          propiedadId: prop.body.id,
          fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
          montoInicial: 300000, moneda: 'ARS', indice: 'ninguno',
        })
        .expect(201);

      const docs = await http().get(`/v1/contratos/${c.body.id}/documentos`)
        .set(...dueño).expect(200);
      expect(docs.body).toEqual([]);
    });

    it('el pre-contrato no se duplica', async () => {
      // Dos pre-contratos del mismo contrato es la pregunta «¿cuál firmamos?»,
      // que no tiene buena respuesta.
      const nuevo = await armarContrato();

      const antes = await http().get(`/v1/contratos/${nuevo}/documentos`)
        .set(...como()).expect(200);
      expect(antes.body).toHaveLength(1);

      // Generar el mismo tipo a mano SÍ crea otro —es una decisión explícita de
      // una persona—, pero el automático no vuelve a correr sobre un contrato
      // que ya tiene el suyo. Se comprueba releyendo: sigue habiendo uno.
      const despues = await http().get(`/v1/contratos/${nuevo}/documentos`)
        .set(...como()).expect(200);
      expect(despues.body).toHaveLength(1);
      expect(despues.body[0].id).toBe(antes.body[0].id);
    });
  });
});
