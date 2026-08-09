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
 * `GET /contratos/:id/ficha` — lo que dice cada cabecera con su bloque cerrado.
 *
 * El endpoint existe porque los bloques de la ficha se pliegan, y un bloque
 * cerrado que para decir su número tiene que montar su contenido no ahorró
 * nada. Pero al mover el número a la cabecera, un conteo mal hecho deja de ser
 * una omisión y pasa a ser una **afirmación falsa**, que es peor — y el conteo
 * mal hecho ya estaba ahí:
 *
 * `ContratoDetallePage` pide las cuotas con `?porPagina=100`, `PaginacionDto`
 * topea en `@Max(100)` y la página **descarta el `total`** que le devuelve la
 * API. El comentario del propio archivo dice «un contrato de diez años son 120
 * cuotas»: hoy veinte desaparecen sin avisar. Ese es el último bloque de tests
 * de acá, y es el que justifica que el resumen salga de `count()` en SQL y no de
 * contar el array de una página.
 */
describe('Ficha del contrato · el resumen de las cabeceras', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('ficha', tk);
    otra = await crearInmobiliaria('fichavecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Una propiedad nueva por contrato: el EXCLUDE de la 007 no deja solaparlos. */
  async function crearPropiedad(quien: Inmobiliaria = inmo): Promise<string> {
    const r = await http().post('/v1/propiedades').set(...como(quien))
      .send({ calle: `Ficha ${Math.random().toString(36).slice(2, 10)}`, tipo: 'departamento' })
      .expect(201);
    return r.body.id;
  }

  async function crearContrato(
    extra: Record<string, unknown> = {},
    quien: Inmobiliaria = inmo,
  ): Promise<string> {
    const propiedadId = await crearPropiedad(quien);
    const r = await http().post('/v1/contratos').set(...como(quien))
      .send({
        propiedadId,
        fechaInicio: '2026-01-01',
        fechaFin: '2027-12-31',
        montoInicial: 500000,
        moneda: 'ARS',
        indice: 'ninguno',
        diaVencimiento: 10,
        honorariosPct: 10,
        ...extra,
      })
      .expect(201);
    return r.body.id;
  }

  const ficha = (id: string, quien: Inmobiliaria = inmo, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    http().get(`/v1/contratos/${id}/ficha`).set(...como(quien, rol));

  // ══ 1 · Camino feliz: los seis grupos con números que se pueden afirmar ════

  describe('camino feliz', () => {
    it('un contrato recién creado devuelve los seis grupos en cero, sin inventar nada', async () => {
      const id = await crearContrato();
      const r = await ficha(id).expect(200);

      expect(r.body.contratoId).toBe(id);
      // Cuotas: existe el grupo (es administrado) y está en cero. Un contrato
      // sin cuotas generadas no es lo mismo que uno de intermediación.
      expect(r.body.cuotas).toEqual({
        generadas: 0, impagas: 0, vencidas: 0,
        deuda: { monto: 0, moneda: 'ARS' },
        proximaVence: null,
      });
      expect(r.body.aumentos).toEqual({
        total: 0, proyectados: 0, proximo: null, atrasado: null,
      });
      expect(r.body.comision).toEqual({
        armada: false, repartida: false, sinCobrar: 0, total: null,
      });
      expect(r.body.documentos).toEqual({ total: 0, sinMandar: 0, ultimoEl: null });
      expect(r.body.notas).toEqual({ total: 0, pendientes: 0, ultimaEl: null });
    });

    it('sin garantes dice cuántos faltan y CUÁL es el primer pendiente, textual', async () => {
      const id = await crearContrato();
      const r = await ficha(id).expect(200);

      expect(r.body.garantes.total).toBe(0);
      expect(r.body.garantes.aptos).toBe(0);
      expect(r.body.garantes.minimo).toBe(2);
      expect(r.body.garantes.enRegla).toBe(false);
      // El texto, no un número: «falta consultar el BCRA» dice qué hacer,
      // «3 pendientes» manda a abrir el bloque para averiguarlo.
      expect(r.body.garantes.primerPendiente).toContain('Faltan garantes');
    });

    it('el resumen de garantes dice EXACTAMENTE lo mismo que /garantes/verificacion', async () => {
      const id = await crearContrato();

      const persona = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Rita', apellido: 'Garante', docNumero: '20111222' })
        .expect(201);
      await http().post(`/v1/contratos/${id}/garantes`).set(...como(inmo))
        .send({ personaId: persona.body.id }).expect(201);

      const v = await http().get(`/v1/contratos/${id}/garantes/verificacion`)
        .set(...como(inmo)).expect(200);
      const r = await ficha(id).expect(200);

      // La regla de «apto» vive en un solo lado. Si la cabecera tuviera su
      // propia versión en SQL, éste es el test que se rompe el día que las dos
      // se separan — y sin él la ficha diría «1 en regla» con el bloque abierto
      // diciendo «falta consultar el BCRA».
      expect(r.body.garantes.total).toBe(v.body.garantes);
      expect(r.body.garantes.aptos).toBe(v.body.aptos);
      expect(r.body.garantes.enRegla).toBe(v.body.enRegla);
      expect(r.body.garantes.pendientes).toBe(v.body.pendientes.length);
      expect(r.body.garantes.primerPendiente).toBe(v.body.pendientes[0]);
    });

    it('cuenta las cuotas impagas y suma la deuda CON su moneda', async () => {
      const id = await crearContrato({ fechaInicio: '2026-01-01', montoInicial: 100000 });
      await http().post(`/v1/contratos/${id}/periodos/generar`).set(...como(inmo))
        .send({ hasta: '2026-04-01' }).expect(201);

      const r = await ficha(id).expect(200);

      expect(r.body.cuotas.generadas).toBe(4); // ene, feb, mar, abr
      expect(r.body.cuotas.impagas).toBe(4);
      expect(r.body.cuotas.deuda).toEqual({ monto: 400000, moneda: 'ARS' });
      // Ningún monto sin moneda: es la regla del producto, y en la cabecera de
      // un bloque cerrado es donde más fácil se pierde.
      expect(typeof r.body.cuotas.deuda.moneda).toBe('string');
    });

    it('cobrar una cuota baja el número de la cabecera en el acto', async () => {
      const id = await crearContrato({ fechaInicio: '2026-01-01', montoInicial: 100000 });
      await http().post(`/v1/contratos/${id}/periodos/generar`).set(...como(inmo))
        .send({ hasta: '2026-03-01' }).expect(201);

      const per = await http().get(`/v1/contratos/${id}/periodos`).set(...como(inmo)).expect(200);
      const cuota = per.body.items[per.body.items.length - 1];

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: cuota.id, monto: cuota.total }).expect(201);

      const r = await ficha(id).expect(200);
      expect(r.body.cuotas.generadas).toBe(3);
      expect(r.body.cuotas.impagas).toBe(2);
      expect(r.body.cuotas.deuda.monto).toBe(200000);
    });

    it('una cuota cobrada a medias sigue impaga, y la deuda es el SALDO', async () => {
      const id = await crearContrato({ fechaInicio: '2026-01-01', montoInicial: 100000 });
      await http().post(`/v1/contratos/${id}/periodos/generar`).set(...como(inmo))
        .send({ hasta: '2026-02-01' }).expect(201);

      const per = await http().get(`/v1/contratos/${id}/periodos`).set(...como(inmo)).expect(200);
      const antes = await ficha(id).expect(200);
      expect(antes.body.cuotas.impagas).toBe(2);

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: per.body.items[0].id, monto: 1 }).expect(201);

      const r = await ficha(id).expect(200);
      // Sigue contando como impaga —queda saldo— pero la deuda baja lo cobrado.
      // Contar «cuotas impagas × monto» en vez del saldo real habría dicho
      // ARS 200.000 sobre una cuota que ya tiene un cobro imputado.
      expect(r.body.cuotas.impagas).toBe(2);
      expect(r.body.cuotas.deuda.monto).toBe(199999);

      // El predicado de «impaga» es el MISMO que el del tablero de vencimientos
      // (`estado IN ('pendiente','parcial','vencido')`), y por eso una condonada
      // —que tiene saldo y no se debe— nunca va a contarse acá. Con dos
      // definiciones, el inicio y esta cabecera contarían distinto sobre la
      // misma cartera. El estado 'condonado' no se puede alcanzar por la API
      // todavía; el día que exista, este comentario es el que dice qué probar.
    });

    it('un contrato de intermediación devuelve cuotas: null, no cuotas en cero', async () => {
      const id = await crearContrato({ administrado: false });
      const r = await ficha(id).expect(200);

      // Un contrato que no administra no tiene cuotas. No tiene CERO cuotas: la
      // ficha no dibuja el bloque, y un `{generadas: 0}` habría hecho que la
      // cabecera dijera «Al día» sobre algo que nunca va a tener una cuota.
      expect(r.body.cuotas).toBeNull();
    });

    it('separa el aumento que viene del que ya rige y nadie confirmó', async () => {
      const id = await crearContrato({
        fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
        indice: 'porcentaje_fijo', indicePorcentaje: 10, periodicidadMeses: 6,
      });
      await http().post(`/v1/contratos/${id}/ajustes/proyectar`).set(...como(inmo)).expect(201);

      const r = await ficha(id).expect(200);

      expect(r.body.aumentos.total).toBeGreaterThan(0);
      expect(r.body.aumentos.proyectados).toBe(r.body.aumentos.total);

      // El de julio de 2026 ya está rigiendo y sigue proyectado: es plata que se
      // deja de cobrar todos los meses, y en el listado se ve igual que los
      // demás. Por eso en la cabecera va aparte.
      expect(r.body.aumentos.atrasado).not.toBeNull();
      expect(r.body.aumentos.atrasado.estado).toBe('proyectado');
      expect(r.body.aumentos.atrasado.vigenteDesde <= new Date().toISOString().slice(0, 10))
        .toBe(true);

      // El próximo es el primero que TODAVÍA no rige.
      expect(r.body.aumentos.proximo).not.toBeNull();
      expect(r.body.aumentos.proximo.vigenteDesde > new Date().toISOString().slice(0, 10))
        .toBe(true);
      expect(r.body.aumentos.proximo.moneda).toBe('ARS');
      expect(r.body.aumentos.proximo.montoNuevo)
        .toBeGreaterThan(r.body.aumentos.proximo.montoAnterior);
    });

    it('las fechas salen en YYYY-MM-DD y no corridas un día', async () => {
      const id = await crearContrato({
        fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
        indice: 'porcentaje_fijo', indicePorcentaje: 10, periodicidadMeses: 6,
      });
      await http().post(`/v1/contratos/${id}/ajustes/proyectar`).set(...como(inmo)).expect(201);
      const r = await ficha(id).expect(200);

      // `date` no tiene zona: pasarla por `new Date()` le inventa medianoche UTC
      // y un ajuste vigente desde el 01 se muestra el 31 del mes anterior. Es la
      // trampa que este repo ya pagó una vez.
      expect(r.body.aumentos.proximo.vigenteDesde).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it('la comisión dice si está armada, cuánto es y cuánto queda por cobrar', async () => {
      const id = await crearContrato({ montoInicial: 400000 });

      const sinArmar = await ficha(id).expect(200);
      expect(sinArmar.body.comision).toEqual({
        armada: false, repartida: false, sinCobrar: 0, total: null,
      });

      await http().post(`/v1/contratos/${id}/comisiones`).set(...como(inmo))
        .send({ puntas: { locadora: 100 } })
        .expect(201);

      const r = await ficha(id).expect(200);
      expect(r.body.comision.armada).toBe(true);
      expect(r.body.comision.total.moneda).toBe('ARS');
      // Un mes de alquiler al 100 % de la punta locadora.
      expect(r.body.comision.total.monto).toBe(400000);
    });

    it('cuenta los documentos generados y los que todavía no salieron', async () => {
      const id = await crearContrato();
      await http().post('/v1/plantillas/sembrar').set(...como(inmo)).expect(201);

      const plantillas = await http().get('/v1/plantillas').set(...como(inmo)).expect(200);
      const pre = plantillas.body.find((p: { tipo: string }) => p.tipo === 'pre_contrato_alquiler');

      await http().post('/v1/documentos').set(...como(inmo))
        .send({ contratoId: id, plantillaId: pre.id }).expect(201);

      const r = await ficha(id).expect(200);
      expect(r.body.documentos.total).toBe(1);
      // «Sin mandar» es el dato que hace falta: un pre-contrato generado y
      // olvidado en el escritorio de alguien es el caso que se quiere ver.
      expect(r.body.documentos.sinMandar).toBe(1);
      expect(r.body.documentos.ultimoEl).not.toBeNull();
    });

    it('cuenta las notas y las que quedaron como pendiente con fecha', async () => {
      const id = await crearContrato();
      await http().post('/v1/notas').set(...como(inmo))
        .send({ entidadTipo: 'contrato_alquiler', entidadId: id, texto: 'Llamó el inquilino' })
        .expect(201);
      await http().post('/v1/notas').set(...como(inmo))
        .send({
          entidadTipo: 'contrato_alquiler', entidadId: id,
          texto: 'Pasa a firmar', recordarEl: '2026-12-01',
        })
        .expect(201);

      const r = await ficha(id).expect(200);
      expect(r.body.notas.total).toBe(2);
      expect(r.body.notas.pendientes).toBe(1);
      expect(r.body.notas.ultimaEl).not.toBeNull();
    });
  });

  // ══ 2 · Roles ═════════════════════════════════════════════════════════════

  describe('roles', () => {
    it('lo ve TODO el equipo, contable y agente incluidos: es la misma ficha', async () => {
      const id = await crearContrato();
      // El resumen no puede ser más restrictivo que la ficha: si el bloque
      // abierto se lo muestra a un contable, la cabecera cerrada también.
      for (const rol of ['owner', 'admin', 'agente', 'contable'] as const) {
        await ficha(id, inmo, rol).expect(200);
      }
    });

    it('sin token no se ve nada', async () => {
      const id = await crearContrato();
      await http().get(`/v1/contratos/${id}/ficha`).expect(401);
    });

    it('la cabecera no muestra ningún monto que el bloque abierto le esconda al agente', async () => {
      const id = await crearContrato({ montoInicial: 400000 });
      await http().post(`/v1/contratos/${id}/comisiones`).set(...como(inmo))
        .send({ puntas: { locadora: 100 } })
        .expect(201);

      const bloque = await http().get(`/v1/contratos/${id}/comisiones`)
        .set(...como(inmo, 'agente')).expect(200);
      const cabecera = await ficha(id, inmo, 'agente').expect(200);

      // Hoy `/contratos/:id/comisiones` NO enmascara por rol —a propósito: «el
      // asesor necesita saber cómo quedó»— así que el resumen tampoco. Este test
      // es el que avisa el día que uno de los dos cambie: un permiso que se
      // esquiva leyendo una cabecera no es un permiso.
      expect(cabecera.body.comision.total.monto).toBe(bloque.body.totales.operacion);
    });
  });

  // ══ 3 · Aislamiento entre inmobiliarias ═══════════════════════════════════

  describe('aislamiento', () => {
    it('el resumen de un contrato ajeno no se puede leer, ni siquiera como owner', async () => {
      const id = await crearContrato({}, inmo);
      // 404 y no 403: para la otra inmobiliaria ese contrato no existe. Un 403
      // confirmaría que el id es de alguien.
      await ficha(id, otra).expect(404);
    });

    it('cada inmobiliaria cuenta lo suyo, aunque los dos contratos existan a la vez', async () => {
      const mio = await crearContrato({ fechaInicio: '2026-01-01' }, inmo);
      const suyo = await crearContrato({ fechaInicio: '2026-01-01' }, otra);

      await http().post(`/v1/contratos/${mio}/periodos/generar`).set(...como(inmo))
        .send({ hasta: '2026-05-01' }).expect(201);
      await http().post(`/v1/contratos/${suyo}/periodos/generar`).set(...como(otra))
        .send({ hasta: '2026-02-01' }).expect(201);

      expect((await ficha(mio, inmo).expect(200)).body.cuotas.generadas).toBe(5);
      expect((await ficha(suyo, otra).expect(200)).body.cuotas.generadas).toBe(2);
    });

    it('un id que no existe da 404 y no un resumen en cero', async () => {
      // Un resumen en cero sobre un contrato inexistente es la peor respuesta:
      // la ficha diría «Al día · sin deuda» sobre nada.
      await ficha('00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  // ══ 4 · El bug que este endpoint existe para no cometer ═══════════════════

  describe('un contrato largo: el conteo real, no 100', () => {
    it('con más de 100 cuotas la cabecera dice el total y la página sigue topeada en 100', async () => {
      // Un contrato de doce años. El comentario de `ContratoDetallePage` dice
      // «un contrato de diez años son 120 cuotas» y la página pide 100: hoy
      // veinte se caen del listado en silencio.
      const id = await crearContrato({
        fechaInicio: '2014-01-01', fechaFin: '2026-01-01', montoInicial: 1000,
      });
      await http().post(`/v1/contratos/${id}/periodos/generar`).set(...como(inmo))
        .send({ hasta: '2026-01-01' }).expect(201);

      const pagina = await http().get(`/v1/contratos/${id}/periodos?porPagina=100`)
        .set(...como(inmo)).expect(200);
      const r = await ficha(id).expect(200);

      // La página trae 100 items y un total mayor: eso es correcto y es el
      // contrato de paginación.
      expect(pagina.body.items.length).toBe(100);
      expect(pagina.body.total).toBeGreaterThan(100);

      // Y la cabecera dice el número REAL. Si el resumen se hubiera calculado
      // contando `items`, acá diría 100 impagas de un contrato que tiene 145 —
      // que es la misma familia del bug de VencimientosPage, pero afirmando un
      // número en vez de omitirlo.
      expect(r.body.cuotas.generadas).toBe(pagina.body.total);
      expect(r.body.cuotas.impagas).toBe(pagina.body.total);
      expect(r.body.cuotas.impagas).toBeGreaterThan(100);
      expect(r.body.cuotas.deuda.monto).toBe(pagina.body.total * 1000);
    });

    it('con más de 100 ajustes tampoco se queda en 100', async () => {
      const id = await crearContrato({
        fechaInicio: '2014-01-01', fechaFin: '2026-01-01',
        indice: 'porcentaje_fijo', indicePorcentaje: 1, periodicidadMeses: 1,
      });
      await http().post(`/v1/contratos/${id}/ajustes/proyectar`).set(...como(inmo)).expect(201);

      const pagina = await http().get(`/v1/contratos/${id}/ajustes?porPagina=100`)
        .set(...como(inmo)).expect(200);
      const r = await ficha(id).expect(200);

      expect(pagina.body.items.length).toBe(100);
      expect(r.body.aumentos.total).toBe(pagina.body.total);
      expect(r.body.aumentos.total).toBeGreaterThan(100);
    });
  });
});
