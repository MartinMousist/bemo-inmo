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
 * Etapa 3 — la espina compartida. Reglas que sólo se pueden verificar contra
 * Postgres real porque viven en constraints, no en el código.
 */
describe('Espina: personas, propiedades y oportunidades', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('espina', tk);
    otra = await crearInmobiliaria('vecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);

  async function crearPersona(nombre: string, doc?: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/personas')
      .set(...como(inmo))
      .send({ nombre, docTipo: doc ? 'dni' : undefined, docNumero: doc })
      .expect(201);
    return res.body;
  }

  async function crearPropiedad(calle: string, extra: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/v1/propiedades')
      .set(...como(inmo))
      .send({ calle, numero: '100', tipo: 'departamento', ...extra })
      .expect(201);
    return res.body;
  }

  // ── Personas ───────────────────────────────────────────────────────────────

  it('el documento es único por inmobiliaria, no globalmente', async () => {
    await crearPersona('Ana Gomez', '30111222');

    await request(app.getHttpServer())
      .post('/v1/personas')
      .set(...como(inmo))
      .send({ nombre: 'Otra Ana', docTipo: 'dni', docNumero: '30111222' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('DOCUMENTO_DUPLICADO'));

    // La inmobiliaria vecina puede tener a la misma persona con el mismo DNI.
    await request(app.getHttpServer())
      .post('/v1/personas')
      .set(...como(otra))
      .send({ nombre: 'Ana Gomez', docTipo: 'dni', docNumero: '30111222' })
      .expect(201);
  });

  it('varias personas pueden no tener documento (índice parcial)', async () => {
    await crearPersona('Consulta telefónica 1');
    await crearPersona('Consulta telefónica 2');
  });

  it('la búsqueda por documento responde 200 con encontrada:false, no 404', async () => {
    // "No existe" es una respuesta esperada de esta búsqueda: el front abre el
    // alta inline con el documento ya cargado.
    const res = await request(app.getHttpServer())
      .get('/v1/personas/por-documento/99999999')
      .set(...como(inmo))
      .expect(200);

    expect(res.body).toEqual({ encontrada: false, persona: null });
  });

  it('los roles de una persona se derivan de sus relaciones', async () => {
    const p = await crearPersona('Dueña Perez', '27333444');
    const prop = await crearPropiedad('Belgrano');

    // Antes de la titularidad: sin roles.
    let res = await request(app.getHttpServer())
      .get(`/v1/personas/${p.id}`)
      .set(...como(inmo))
      .expect(200);
    expect(res.body.roles).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/v1/propiedades/${prop.id}`)
      .set(...como(inmo))
      .send({ titulares: [{ personaId: p.id, porcentaje: 100 }] })
      .expect(200);

    res = await request(app.getHttpServer())
      .get(`/v1/personas/${p.id}`)
      .set(...como(inmo))
      .expect(200);
    expect(res.body.roles).toContain('propietario');
  });

  // ── Propiedades ────────────────────────────────────────────────────────────

  it('el código correlativo es por inmobiliaria y no se repite', async () => {
    const a = await crearPropiedad('Mitre');
    const b = await crearPropiedad('Sarmiento');
    expect(b.codigo).toBe(a.codigo + 1);

    const res = await request(app.getHttpServer())
      .post('/v1/propiedades')
      .set(...como(otra))
      .send({ calle: 'Primera de la vecina', tipo: 'casa' })
      .expect(201);
    // La numeración de la vecina arranca de cero, no continúa la nuestra.
    expect(res.body.codigo).toBe(1);
  });

  it('la titularidad tiene que sumar 100%', async () => {
    const prop = await crearPropiedad('Condominio');
    const a = await crearPersona('Hermano A', '20111111');
    const b = await crearPersona('Hermana B', '20222222');

    await request(app.getHttpServer())
      .patch(`/v1/propiedades/${prop.id}`)
      .set(...como(inmo))
      .send({
        titulares: [
          { personaId: a.id, porcentaje: 50 },
          { personaId: b.id, porcentaje: 30 },
        ],
      })
      .expect(422)
      .expect((r) => {
        expect(r.body.code).toBe('TITULARIDAD_INVALIDA');
        expect(r.body.detail).toContain('80');
      });

    // 50/50 sí entra.
    const ok = await request(app.getHttpServer())
      .patch(`/v1/propiedades/${prop.id}`)
      .set(...como(inmo))
      .send({
        titulares: [
          { personaId: a.id, porcentaje: 50 },
          { personaId: b.id, porcentaje: 50 },
        ],
      })
      .expect(200);

    expect(ok.body.titulares).toHaveLength(2);
  });

  it('un PATCH parcial NO borra los campos que no vienen', async () => {
    // Bug real encontrado usando la app: cargar titulares dejaba la propiedad
    // sin número, sin piso, sin ambientes y sin metros. Los campos ausentes en
    // un PATCH se escribían como NULL.
    const prop = await crearPropiedad('Completa', {
      piso: '3',
      depto: 'B',
      localidad: 'Ciudad',
      ambientes: 3,
      supTotal: 78,
      descripcion: 'Con balcón',
    });
    const persona = await crearPersona('Titular Único', '28777888');

    await request(app.getHttpServer())
      .patch(`/v1/propiedades/${prop.id}`)
      .set(...como(inmo))
      .send({ titulares: [{ personaId: persona.id, porcentaje: 100 }] })
      .expect(200);

    const luego = await request(app.getHttpServer())
      .get(`/v1/propiedades/${prop.id}`)
      .set(...como(inmo))
      .expect(200);

    expect(luego.body).toMatchObject({
      numero: '100',
      piso: '3',
      depto: 'B',
      localidad: 'Ciudad',
      ambientes: 3,
      supTotal: 78,
      descripcion: 'Con balcón',
    });
    expect(luego.body.titulares).toHaveLength(1);
  });

  it('una propiedad puede estar en venta Y en alquiler a la vez', async () => {
    const prop = await crearPropiedad('Dos Puntas');

    await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio: 120000, moneda: 'USD', estado: 'disponible' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'alquiler', precio: 450000, moneda: 'ARS', estado: 'disponible' })
      .expect(201);

    expect(res.body.operaciones).toHaveLength(2);
    // Cada una con su moneda: el alquiler en pesos y la venta en dólares es lo
    // normal en Argentina, no un caso raro.
    const monedas = res.body.operaciones.map((o: { moneda: string }) => o.moneda).sort();
    expect(monedas).toEqual(['ARS', 'USD']);
  });

  it('no puede haber dos operaciones vivas del mismo tipo', async () => {
    const prop = await crearPropiedad('Una Sola');

    await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio: 100000, moneda: 'USD' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio: 90000, moneda: 'USD' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('OPERACION_DUPLICADA'));
  });

  it('sin API key no se inventan coordenadas', async () => {
    // El entorno de test no tiene GOOGLE_MAPS_API_KEY. La propiedad se crea
    // igual, sin ubicación, y lo dice. Una propiedad mal ubicada en el mapa es
    // peor que una sin mapa.
    const p = await crearPropiedad('Sin Mapa');
    expect(p.lat).toBeNull();
    expect(p.ubicacionConocida).toBe(false);

    const caps = await request(app.getHttpServer())
      .get('/v1/propiedades/capacidades')
      .set(...como(inmo))
      .expect(200);
    expect(caps.body.mapas).toBe(false);
  });

  it('las coordenadas manuales se respetan', async () => {
    const p = await crearPropiedad('Con Mapa Manual', {
      lat: -32.8908,
      lng: -68.8272,
    });
    expect(p.ubicacionConocida).toBe(true);
    expect(Number(p.lat)).toBeCloseTo(-32.8908, 4);
  });

  // ── Oportunidades y reservas ───────────────────────────────────────────────

  it('se puede crear la oportunidad y la persona en el mismo movimiento', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/oportunidades')
      .set(...como(inmo, 'agente'))
      .send({
        persona: { nombre: 'Interesado', telefono: '2615550000' },
        origen: 'whatsapp',
        interes: 'alquiler',
      })
      .expect(201);

    expect(res.body.persona.nombre).toBe('Interesado');
    expect(res.body.estado).toBe('nueva');
  });

  it('perder una oportunidad exige decir por qué', async () => {
    const o = await request(app.getHttpServer())
      .post('/v1/oportunidades')
      .set(...como(inmo))
      .send({ persona: { nombre: 'Se va a perder' } })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/v1/oportunidades/${o.body.id}`)
      .set(...como(inmo))
      .send({ estado: 'perdida' })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/v1/oportunidades/${o.body.id}`)
      .set(...como(inmo))
      .send({ estado: 'perdida', motivoPerdida: 'Consiguió por otro lado' })
      .expect(200);
  });

  it('agendar una visita mueve el embudo sola', async () => {
    const o = await request(app.getHttpServer())
      .post('/v1/oportunidades')
      .set(...como(inmo))
      .send({ persona: { nombre: 'Va a visitar' } })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/oportunidades/${o.body.id}/visitas`)
      .set(...como(inmo))
      .send({ fechaHora: '2026-09-01T15:00:00.000Z' })
      .expect(201);

    expect(res.body.estado).toBe('visita');
    expect(res.body.visitas).toHaveLength(1);
  });

  it('el asesor ve sólo sus oportunidades', async () => {
    // Una del owner, una del agente.
    await request(app.getHttpServer())
      .post('/v1/oportunidades')
      .set(...como(inmo, 'owner'))
      .send({ persona: { nombre: 'Del titular' } })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/oportunidades')
      .set(...como(inmo, 'agente'))
      .send({ persona: { nombre: 'Del asesor' } })
      .expect(201);

    const delAgente = await request(app.getHttpServer())
      .get('/v1/oportunidades')
      .set(...como(inmo, 'agente'))
      .expect(200);

    const nombres = delAgente.body.items.map(
      (o: { persona: { nombre: string } }) => o.persona.nombre,
    );
    expect(nombres).toContain('Del asesor');
    expect(nombres).not.toContain('Del titular');

    // El titular las ve todas.
    const delOwner = await request(app.getHttpServer())
      .get('/v1/oportunidades')
      .set(...como(inmo, 'owner'))
      .expect(200);
    const todos = delOwner.body.items.map(
      (o: { persona: { nombre: string } }) => o.persona.nombre,
    );
    expect(todos).toEqual(expect.arrayContaining(['Del asesor', 'Del titular']));
  });

  it('una operación no puede tener dos reservas activas', async () => {
    const prop = await crearPropiedad('Se Reserva');
    const op = await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'venta', precio: 80000, moneda: 'USD', estado: 'disponible' })
      .expect(201);

    const operacionId = op.body.operaciones[0].id;
    const a = await crearPersona('Comprador A', '25111111');
    const b = await crearPersona('Comprador B', '25222222');

    await request(app.getHttpServer())
      .post('/v1/reservas')
      .set(...como(inmo))
      .send({ operacionId, personaId: a.id, monto: 5000, moneda: 'USD' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/reservas')
      .set(...como(inmo))
      .send({ operacionId, personaId: b.id, monto: 6000, moneda: 'USD' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('RESERVA_ACTIVA'));
  });

  it('N reservas simultáneas: exactamente una entra, ninguna da 5xx', async () => {
    // El constraint es de base, no un SELECT previo. Ningún chequeo de
    // aplicación sobrevive a diez requests en paralelo.
    const prop = await crearPropiedad('Carrera');
    const op = await request(app.getHttpServer())
      .post(`/v1/propiedades/${prop.id}/operaciones`)
      .set(...como(inmo))
      .send({ tipo: 'alquiler', precio: 300000, moneda: 'ARS', estado: 'disponible' })
      .expect(201);

    const operacionId = op.body.operaciones[0].id;
    const persona = await crearPersona('Apurado', '26999999');

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/v1/reservas')
          .set(...como(inmo))
          .send({ operacionId, personaId: persona.id, monto: 1000, moneda: 'ARS' }),
      ),
    );

    const exitos = resultados.filter((r) => r.status === 201);
    const conflictos = resultados.filter((r) => r.status === 409);
    const errores = resultados.filter((r) => r.status >= 500);

    expect(exitos).toHaveLength(1);
    expect(conflictos).toHaveLength(9);
    expect(errores).toHaveLength(0);
  });

  // ── Aislamiento ────────────────────────────────────────────────────────────

  it('cero fuga en todo el dominio nuevo', async () => {
    for (const ruta of ['/v1/personas', '/v1/propiedades', '/v1/oportunidades']) {
      const mias = await request(app.getHttpServer())
        .get(ruta)
        .set(...como(inmo))
        .expect(200);
      const suyas = await request(app.getHttpServer())
        .get(ruta)
        .set(...como(otra))
        .expect(200);

      const idsMios = new Set(mias.body.items.map((x: { id: string }) => x.id));
      const cruzados = suyas.body.items.filter((x: { id: string }) => idsMios.has(x.id));
      expect({ ruta, cruzados: cruzados.length }).toEqual({ ruta, cruzados: 0 });
    }
  });

  it('leer una propiedad ajena por id da 404, no 403 ni 200 vacío', async () => {
    const mia = await crearPropiedad('Privada');

    await request(app.getHttpServer())
      .get(`/v1/propiedades/${mia.id}`)
      .set(...como(otra))
      .expect(404);
  });

  it('editar una propiedad ajena da 404 y no la toca', async () => {
    const mia = await crearPropiedad('Intocable');

    await request(app.getHttpServer())
      .patch(`/v1/propiedades/${mia.id}`)
      .set(...como(otra))
      .send({ calle: 'HACKEADA' })
      .expect(404);

    const sigue = await request(app.getHttpServer())
      .get(`/v1/propiedades/${mia.id}`)
      .set(...como(inmo))
      .expect(200);

    expect(sigue.body.calle).toBe('Intocable');
  });
});
