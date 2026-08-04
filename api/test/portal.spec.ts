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
 * Portal del propietario, notas y recibo.
 *
 * El portal es **el único endpoint sin sesión que devuelve datos de una
 * inmobiliaria**, así que la mitad de esta suite es sobre lo que NO tiene que
 * dejar ver: ni la cartera de otro propietario de la misma inmobiliaria, ni
 * nada de otra inmobiliaria, ni si un token existió alguna vez.
 */
describe('Portal del propietario, notas y recibo', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('portal', tk);
    otra = await crearInmobiliaria('portalvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const hoy = () => new Date().toISOString().slice(0, 10);
  const desplazar = (anios: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + anios);
    return d.toISOString().slice(0, 10);
  };

  /** Una propiedad con su dueño, su inquilino y un contrato con cuotas. */
  async function armar(calle: string, i = inmo) {
    const dueno = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Dueña', apellido: calle }).expect(201);
    const inquilino = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Inquilino', apellido: calle }).expect(201);

    const prop = await http().post('/v1/propiedades').set(...como(i))
      .send({
        calle, numero: '30', localidad: 'Ciudad', tipo: 'departamento',
        titulares: [{ personaId: dueno.body.id, porcentaje: 100 }],
      })
      .expect(201);

    const contrato = await http().post('/v1/contratos').set(...como(i))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: desplazar(-1),
        fechaFin: desplazar(1),
        montoInicial: 500000,
        moneda: 'ARS',
        indice: 'ninguno',
        mesBase: `${desplazar(-1).slice(0, 7)}-01`,
        honorariosPct: 10,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inquilino.body.id],
      })
      .expect(201);

    await http().post(`/v1/contratos/${contrato.body.id}/periodos/generar`)
      .set(...como(i)).send({ hasta: `${hoy().slice(0, 7)}-01` }).expect(201);

    const per = await http().get(`/v1/contratos/${contrato.body.id}/periodos?porPagina=100`)
      .set(...como(i)).expect(200);

    return { dueno: dueno.body, prop: prop.body, contrato: contrato.body, periodos: per.body.items };
  }

  async function enlaceDe(personaId: string, i = inmo) {
    const r = await http().post(`/v1/propietarios/${personaId}/accesos`)
      .set(...como(i)).expect(201);
    return r.body as { id: string; token: string; ruta: string; expiraEl: string };
  }

  // ── El enlace ─────────────────────────────────────────────────────────────

  it('el token se devuelve UNA sola vez: en la base queda el hash', async () => {
    const { dueno } = await armar('Portal Uno');
    const enlace = await enlaceDe(dueno.id);

    expect(enlace.token).toHaveLength(43); // 32 bytes en base64url
    expect(enlace.ruta).toBe(`/propietario/${enlace.token}`);

    // Al listar los accesos, el token NO vuelve a aparecer. Si se perdió, se
    // genera otro: es la misma regla que las claves de API.
    const lista = await http().get(`/v1/propietarios/${dueno.id}/accesos`)
      .set(...como(inmo)).expect(200);

    expect(lista.body[0].vigente).toBe(true);
    expect(JSON.stringify(lista.body)).not.toContain(enlace.token);
  });

  it('generar uno nuevo da de baja el anterior', async () => {
    // Dos enlaces vivos para la misma persona son dos cosas que después hay que
    // acordarse de dar de baja.
    const { dueno } = await armar('Portal Renueva');
    const viejo = await enlaceDe(dueno.id);
    const nuevo = await enlaceDe(dueno.id);

    await http().get(`/v1/propietario/${viejo.token}`).expect(404);
    await http().get(`/v1/propietario/${nuevo.token}`).expect(200);
  });

  it('no se genera para alguien que no es propietario de nada', async () => {
    // El enlace mostraría una pantalla vacía y no se entendería por qué.
    const suelta = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Persona', apellido: 'Sin Propiedades' }).expect(201);

    const r = await http().post(`/v1/propietarios/${suelta.body.id}/accesos`)
      .set(...como(inmo)).expect(422);
    expect(r.body.detail).toMatch(/no figura como propietaria/i);
  });

  it('revocar corta el acceso al instante', async () => {
    const { dueno } = await armar('Portal Revoca');
    const enlace = await enlaceDe(dueno.id);

    await http().get(`/v1/propietario/${enlace.token}`).expect(200);
    await http().delete(`/v1/propietarios/accesos/${enlace.id}`).set(...como(inmo)).expect(204);
    await http().get(`/v1/propietario/${enlace.token}`).expect(404);
  });

  it('sólo titular y administración manejan los enlaces', async () => {
    const { dueno } = await armar('Portal Roles');
    for (const rol of ['agente', 'contable'] as const) {
      await http().post(`/v1/propietarios/${dueno.id}/accesos`)
        .set(...como(inmo, rol)).expect(403);
      await http().get(`/v1/propietarios/${dueno.id}/accesos`)
        .set(...como(inmo, rol)).expect(403);
    }
  });

  // ── Lo que el propietario ve ──────────────────────────────────────────────

  it('ve su propiedad, su contrato y sus cuotas, sin sesión', async () => {
    const { dueno, periodos } = await armar('Portal Vista');
    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: periodos[0].id, monto: 500000 }).expect(201);

    const enlace = await enlaceDe(dueno.id);
    // Sin ningún header de autenticación.
    const r = await http().get(`/v1/propietario/${enlace.token}`).expect(200);

    expect(r.body.propietario).toContain('Portal Vista');
    expect(r.body.propiedades).toHaveLength(1);
    expect(r.body.propiedades[0].contrato.montoVigente).toBe(500000);
    expect(r.body.propiedades[0].contrato.inquilino).toContain('Portal Vista');
    expect(r.body.propiedades[0].cuotas.length).toBeGreaterThan(0);

    const conCobro = r.body.propiedades[0].cuotas.find(
      (c: { cobrado: number }) => c.cobrado > 0,
    );
    expect(conCobro.saldo).toBe(0);
  });

  it('NO ve la cartera de otro propietario de la misma inmobiliaria', async () => {
    // Que estén bajo el mismo tenant no alcanza: RLS los deja pasar a los dos.
    // El filtro por `persona_id` es lo único que los separa.
    const a = await armar('Portal Mio');
    const b = await armar('Portal Ajeno');

    const enlace = await enlaceDe(a.dueno.id);
    const r = await http().get(`/v1/propietario/${enlace.token}`).expect(200);

    const direcciones = r.body.propiedades.map((p: { direccion: string }) => p.direccion);
    expect(direcciones.join(' ')).toContain('Portal Mio');
    expect(direcciones.join(' ')).not.toContain('Portal Ajeno');
    expect(JSON.stringify(r.body)).not.toContain(b.prop.id);
  });

  it('sólo muestra liquidaciones CERRADAS: una en borrador todavía cambia', async () => {
    const mes = `${hoy().slice(0, 7)}-01`;
    const { dueno, periodos } = await armar('Portal Liquida');
    const delMes = periodos.find((p: { periodo: string }) =>
      p.periodo.startsWith(hoy().slice(0, 7)),
    );

    await http().post('/v1/cobros').set(...como(inmo))
      .send({ periodoId: delMes.id, monto: 500000 }).expect(201);
    await http().post('/v1/liquidaciones/generar').set(...como(inmo))
      .send({ periodo: mes }).expect(201);

    const enlace = await enlaceDe(dueno.id);

    // En borrador no aparece: mostrarle un número que después se mueve es peor
    // que no mostrarle nada.
    const antes = await http().get(`/v1/propietario/${enlace.token}`).expect(200);
    expect(antes.body.liquidaciones).toHaveLength(0);

    const liqs = await http().get(`/v1/liquidaciones?periodo=${mes}&porPagina=100`)
      .set(...como(inmo)).expect(200);
    const mia = liqs.body.items.find(
      (l: { propietario: { id: string } }) => l.propietario.id === dueno.id,
    );
    await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);

    const despues = await http().get(`/v1/propietario/${enlace.token}`).expect(200);
    expect(despues.body.liquidaciones).toHaveLength(1);
    expect(despues.body.liquidaciones[0].totalNeto).toBe(450000);
    expect(despues.body.liquidaciones[0].lineas.length).toBeGreaterThan(0);
  });

  it('un token inválido y uno vencido dan LO MISMO', async () => {
    // Distinguirlos le diría a quien prueba enlaces al voleo cuáles existieron.
    const inventado = await http().get('/v1/propietario/estonoexisteperoesvalido').expect(404);
    const { dueno } = await armar('Portal Vencido');
    const enlace = await enlaceDe(dueno.id);
    await http().delete(`/v1/propietarios/accesos/${enlace.id}`).set(...como(inmo)).expect(204);
    const revocado = await http().get(`/v1/propietario/${enlace.token}`).expect(404);

    expect(revocado.body.detail).toBe(inventado.body.detail);
    expect(revocado.body.code).toBe(inventado.body.code);
  });

  it('cero fuga entre inmobiliarias', async () => {
    const ajeno = await armar('Portal De Otra', otra);
    const enlace = await enlaceDe(ajeno.dueno.id, otra);

    const r = await http().get(`/v1/propietario/${enlace.token}`).expect(200);
    expect(r.body.propiedades).toHaveLength(1);
    expect(r.body.propiedades[0].direccion).toContain('Portal De Otra');

    // Y desde esta inmobiliaria no se puede tocar el acceso de la vecina.
    await http().delete(`/v1/propietarios/accesos/${enlace.id}`)
      .set(...como(inmo)).expect(404);
  });

  it('cuenta los usos: sirve para saber si el enlace llegó', async () => {
    const { dueno } = await armar('Portal Usos');
    const enlace = await enlaceDe(dueno.id);

    await http().get(`/v1/propietario/${enlace.token}`).expect(200);
    await http().get(`/v1/propietario/${enlace.token}`).expect(200);

    const lista = await http().get(`/v1/propietarios/${dueno.id}/accesos`)
      .set(...como(inmo)).expect(200);
    expect(lista.body[0].usos).toBe(2);
    expect(lista.body[0].ultimoUso).toBeTruthy();
  });

  // ── Notas ─────────────────────────────────────────────────────────────────

  describe('notas de seguimiento', () => {
    it('se dejan sobre un contrato y las puede escribir un asesor', async () => {
      // Es justamente el caso de uso: quien habló con el inquilino anota.
      const { contrato } = await armar('Nota Uno');

      const r = await http().post('/v1/notas').set(...como(inmo, 'agente'))
        .send({
          entidadTipo: 'contrato_alquiler',
          entidadId: contrato.id,
          texto: 'Llamó por la humedad del baño. Va el plomero el jueves.',
          tipo: 'llamado',
          recordarEl: hoy(),
        })
        .expect(201);

      expect(r.body.autor).toBeTruthy();
      expect(r.body.tipo).toBe('llamado');
      expect(r.body.recordarEl).toBe(hoy());
      expect(r.body.resueltaEl).toBeNull();
    });

    it('no se puede colgar una nota de un id que no existe', async () => {
      // La tabla es polimórfica y no tiene FK: sin este chequeo, una nota
      // quedaría flotando sobre un id inventado.
      await http().post('/v1/notas').set(...como(inmo))
        .send({
          entidadTipo: 'contrato_alquiler',
          entidadId: '00000000-0000-4000-8000-000000000000',
          texto: 'Nota huérfana',
        })
        .expect(404);
    });

    it('ni de una entidad de OTRA inmobiliaria', async () => {
      const ajeno = await armar('Nota Ajena', otra);
      await http().post('/v1/notas').set(...como(inmo))
        .send({
          entidadTipo: 'contrato_alquiler',
          entidadId: ajeno.contrato.id,
          texto: 'Espiando',
        })
        .expect(404);
    });

    it('las pendientes se filtran y se resuelven', async () => {
      const { contrato } = await armar('Nota Pendiente');

      const pendiente = await http().post('/v1/notas').set(...como(inmo))
        .send({
          entidadTipo: 'contrato_alquiler', entidadId: contrato.id,
          texto: 'Llamar el lunes por la renovación', recordarEl: hoy(),
        }).expect(201);

      await http().post('/v1/notas').set(...como(inmo))
        .send({
          entidadTipo: 'contrato_alquiler', entidadId: contrato.id,
          texto: 'Sin pendiente, sólo para el registro',
        }).expect(201);

      const soloPend = await http()
        .get(`/v1/notas?entidadTipo=contrato_alquiler&entidadId=${contrato.id}&soloPendientes=true`)
        .set(...como(inmo)).expect(200);
      expect(soloPend.body.items).toHaveLength(1);
      expect(soloPend.body.items[0].id).toBe(pendiente.body.id);

      await http().post(`/v1/notas/${pendiente.body.id}/resolver`)
        .set(...como(inmo)).expect(201);

      const despues = await http()
        .get(`/v1/notas?entidadTipo=contrato_alquiler&entidadId=${contrato.id}&soloPendientes=true`)
        .set(...como(inmo)).expect(200);
      expect(despues.body.items).toHaveLength(0);

      // `soloPendientes=false` es un filtro con significado, no "sin filtro":
      // tiene que traer las dos.
      const todas = await http()
        .get(`/v1/notas?entidadTipo=contrato_alquiler&entidadId=${contrato.id}&soloPendientes=false`)
        .set(...como(inmo)).expect(200);
      expect(todas.body.items).toHaveLength(2);
    });

    it('borrar es de titular y administración', async () => {
      // Una nota es el registro de algo que pasó; que cualquiera la haga
      // desaparecer vacía el sentido de tenerlas.
      const { contrato } = await armar('Nota Borrar');
      const n = await http().post('/v1/notas').set(...como(inmo))
        .send({ entidadTipo: 'contrato_alquiler', entidadId: contrato.id, texto: 'Algo' })
        .expect(201);

      await http().delete(`/v1/notas/${n.body.id}`).set(...como(inmo, 'agente')).expect(403);
      await http().delete(`/v1/notas/${n.body.id}`).set(...como(inmo)).expect(204);
    });

    it('cero fuga: la vecina no ve notas ajenas', async () => {
      const r = await http().get('/v1/notas?porPagina=100').set(...como(otra)).expect(200);
      expect(r.body.items).toHaveLength(0);
      expect(r.body.total).toBe(0);
    });
  });

  // ── Recibo ────────────────────────────────────────────────────────────────

  describe('recibo de cobro', () => {
    it('dice lo que REALMENTE se cobró, no el alquiler del contrato', async () => {
      // Con un pago parcial, el alquiler nominal sería un comprobante por un
      // monto que nadie entregó.
      await http().post('/v1/plantillas/sembrar').set(...como(inmo)).expect(201);

      const { periodos } = await armar('Recibo Parcial');
      const cobro = await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: periodos[0].id, monto: 200000, medio: 'efectivo' })
        .expect(201);

      const r = await http().post(`/v1/plantillas/recibo/${cobro.body.id}`)
        .set(...como(inmo)).expect(201);

      // Lo RECIBIDO son 200.000, no el alquiler del contrato.
      expect(r.body.texto).toMatch(/la suma de ARS 200\.000,00/);
      expect(r.body.texto).toContain('efectivo');

      // Y avisa que es parcial, con el saldo y la cuota completa: si no, el
      // inquilino guarda un papel que parece cancelar el mes entero. Los
      // 500.000 aparecen SÓLO acá, como referencia de lo que falta.
      expect(r.body.texto).toMatch(/PARCIAL/);
      expect(r.body.texto).toMatch(/saldo de ARS 300\.000,00/);
      expect(r.body.texto).toMatch(/cuota de ARS 500\.000,00/);
      expect(r.body.advertencia).toBeUndefined();
    });

    it('un pago total no dice que sea parcial', async () => {
      const { periodos } = await armar('Recibo Total');
      const cobro = await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: periodos[0].id, monto: 500000 }).expect(201);

      const r = await http().post(`/v1/plantillas/recibo/${cobro.body.id}`)
        .set(...como(inmo)).expect(201);

      expect(r.body.texto).toContain('500.000,00');
      expect(r.body.texto).not.toMatch(/PARCIAL/);
      // En número Y en letras: en un comprobante el número solo se puede
      // adulterar con un trazo.
      expect(r.body.texto).toMatch(/quinientos mil/i);
    });

    it('avisa si la plantilla no usa el monto cobrado', async () => {
      // Una plantilla vieja que dice `contrato.montoVigente` imprime el alquiler
      // nominal. Con un pago parcial eso es un recibo por un monto que no se pagó.
      const plantillas = await http().get('/v1/plantillas').set(...como(inmo)).expect(200);
      const recibo = plantillas.body.find((p: { tipo: string }) => p.tipo === 'recibo');

      await http().put('/v1/plantillas').set(...como(inmo))
        .send({
          id: recibo.id, tipo: 'recibo', nombre: recibo.nombre,
          contenido: 'Recibí {{ contrato.montoVigente | moneda }} de alquiler.',
        })
        .expect(200);

      const { periodos } = await armar('Recibo Viejo');
      const cobro = await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: periodos[0].id, monto: 1000 }).expect(201);

      const r = await http().post(`/v1/plantillas/recibo/${cobro.body.id}`)
        .set(...como(inmo)).expect(201);

      expect(r.body.advertencia).toMatch(/no usa el monto realmente cobrado/i);
    });

    it('sin plantilla de recibo lo dice, en vez de un 500', async () => {
      // `otra` nunca sembró plantillas.
      const ajeno = await armar('Recibo Sin Plantilla', otra);
      const cobro = await http().post('/v1/cobros').set(...como(otra))
        .send({ periodoId: ajeno.periodos[0].id, monto: 1000 }).expect(201);

      const r = await http().post(`/v1/plantillas/recibo/${cobro.body.id}`)
        .set(...como(otra)).expect(422);
      expect(r.body.detail).toMatch(/plantilla de recibo/i);
    });
  });
});
