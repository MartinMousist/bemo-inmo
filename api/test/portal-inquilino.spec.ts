import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El portal del inquilino (migración 032).
 *
 * El test que justifica el archivo entero es el del CRUCE DE ROLES: los dos
 * portales comparten tabla, token y resolución, así que sin comprobar el rol un
 * inquilino cambia `/inquilino` por `/propietario` en su propia URL y le ve las
 * liquidaciones al dueño. Se encontró probando exactamente eso, con el código
 * ya escrito y «funcionando».
 */
describe('Portal del inquilino', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  let inquilinoId = '';
  let propietarioId = '';
  let tokenInquilino = '';
  let tokenPropietario = '';

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('portalinq', tk);
    otra = await crearInmobiliaria('portalinqvecina', tk);

    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Portal 100', tipo: 'departamento' }).expect(201);

    propietarioId = (await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Dueña', apellido: 'Portal', docTipo: 'dni', docNumero: '32100100' })
      .expect(201)).body.id;

    inquilinoId = (await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Inqui', apellido: 'Portal', docTipo: 'dni', docNumero: '32100200' })
      .expect(201)).body.id;

    await http().patch(`/v1/propiedades/${prop.body.id}`).set(...como(inmo))
      .send({ titulares: [{ personaId: propietarioId, porcentaje: 100 }] }).expect(200);

    const inicio = new Date(); inicio.setFullYear(inicio.getFullYear() - 1);
    const fin = new Date(); fin.setFullYear(fin.getFullYear() + 1);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: inicio.toISOString().slice(0, 10),
        fechaFin: fin.toISOString().slice(0, 10),
        montoInicial: 250000, moneda: 'ARS', indice: 'ninguno',
        diaVencimiento: 10, locatarios: [inquilinoId],
      }).expect(201);

    await http().post(`/v1/contratos/${c.body.id}/periodos/generar`)
      .set(...como(inmo)).send({}).expect(201);

    tokenInquilino = (await http().post(`/v1/inquilinos/${inquilinoId}/accesos`)
      .set(...como(inmo)).send({}).expect(201)).body.token;
    tokenPropietario = (await http().post(`/v1/propietarios/${propietarioId}/accesos`)
      .set(...como(inmo)).send({}).expect(201)).body.token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('la vista', () => {
    it('abre sin sesión y muestra su contrato, su saldo y sus cuotas', async () => {
      const r = await http().get(`/v1/inquilino/${tokenInquilino}`).expect(200);

      expect(r.body.contratos).toHaveLength(1);
      expect(r.body.cuotas.length).toBeGreaterThan(0);
      expect(Array.isArray(r.body.saldo)).toBe(true);
      // Cada cuota con su moneda: es una pantalla de plata.
      for (const q of r.body.cuotas) expect(q.moneda).toBeTruthy();
    });

    it('NO muestra nada del propietario', async () => {
      // Lo que la inmobiliaria le cobra al dueño no es asunto del inquilino.
      const r = await http().get(`/v1/inquilino/${tokenInquilino}`).expect(200);
      const crudo = JSON.stringify(r.body).toLowerCase();
      expect(crudo).not.toContain('honorario');
      expect(crudo).not.toContain('liquidac');
    });

    it('un token inventado da 404, igual que uno vencido', async () => {
      await http().get('/v1/inquilino/estonoexiste').expect(404);
    });
  });

  describe('el cruce de roles', () => {
    it('el token del INQUILINO no abre la vista del propietario', async () => {
      // Sin este chequeo, cambiar una palabra en la URL propia muestra las
      // liquidaciones del dueño. Es el agujero que justifica todo el archivo.
      await http().get(`/v1/propietario/${tokenInquilino}`).expect(404);
    });

    it('el token del PROPIETARIO no abre la vista del inquilino', async () => {
      await http().get(`/v1/inquilino/${tokenPropietario}`).expect(404);
    });

    it('y el error es el MISMO que el de un token inventado', async () => {
      // Distinguirlos le diría a quien prueba enlaces cuáles existen.
      const cruzado = await http().get(`/v1/propietario/${tokenInquilino}`).expect(404);
      const inventado = await http().get('/v1/propietario/nada').expect(404);
      expect(cruzado.body.detail).toBe(inventado.body.detail);
    });
  });

  describe('reportar un desperfecto', () => {
    it('entra como reclamo con la propiedad ya identificada', async () => {
      const r = await http().post(`/v1/inquilino/${tokenInquilino}/reclamos`)
        .send({ categoria: 'plomeria', descripcion: 'Pierde la canilla de la cocina.' })
        .expect(201);
      expect(r.body.id).toBeDefined();

      // Y aparece en la bandeja de la inmobiliaria, con quién avisó.
      const bandeja = await http().get('/v1/reclamos?porPagina=50')
        .set(...como(inmo)).expect(200);
      const nuestro = bandeja.body.items.find((x: { id: string }) => x.id === r.body.id);
      expect(nuestro).toBeDefined();
      expect(nuestro.categoria).toBe('plomeria');
    });

    it('una categoría fuera del catálogo es 400', async () => {
      // El mismo catálogo que usa la inmobiliaria: un reclamo con categoría
      // propia sería uno que los filtros de la bandeja no encuentran.
      await http().post(`/v1/inquilino/${tokenInquilino}/reclamos`)
        .send({ categoria: 'ovnis', descripcion: 'algo raro pasa acá' })
        .expect(400);
    });

    it('el token del propietario no puede reportar', async () => {
      await http().post(`/v1/inquilino/${tokenPropietario}/reclamos`)
        .send({ categoria: 'plomeria', descripcion: 'Pierde una canilla.' })
        .expect(404);
    });
  });

  describe('crear el acceso', () => {
    it('a alguien que no es inquilino, 422 y con el motivo', async () => {
      const suelta = (await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Suelta', apellido: 'Portal', docTipo: 'dni', docNumero: '32100300' })
        .expect(201)).body.id;

      const r = await http().post(`/v1/inquilinos/${suelta}/accesos`)
        .set(...como(inmo)).send({}).expect(422);
      expect(r.body.detail).toContain('inquilina');
    });

    it('generar el de inquilino NO revoca el de propietario', async () => {
      // Alguien puede alquilar una unidad y ser dueño de otra. Revocarle uno al
      // generar el otro le rompería el enlace que ya estaba usando.
      await http().post(`/v1/inquilinos/${inquilinoId}/accesos`)
        .set(...como(inmo)).send({}).expect(201);
      await http().get(`/v1/propietario/${tokenPropietario}`).expect(200);
    });

    it('el asesor no genera accesos', async () => {
      await http().post(`/v1/inquilinos/${inquilinoId}/accesos`)
        .set(...como(inmo, 'agente')).send({}).expect(403);
    });

    it('cero fuga: la vecina no genera un acceso para una persona ajena', async () => {
      await http().post(`/v1/inquilinos/${inquilinoId}/accesos`)
        .set(...como(otra)).send({}).expect(404);
    });
  });
});
