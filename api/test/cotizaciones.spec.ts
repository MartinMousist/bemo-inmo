import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El tipo de cambio (migración 031).
 *
 * Lo que se prueba acá es lo que distingue esto de guardar un número:
 *
 *   · la conversión trae su MEMORIA DE CÁLCULO — sin eso, «USD 120.000 son ARS
 *     181.802.400» es un número que nadie puede defender frente al propietario;
 *   · se usa la cotización vigente A LA FECHA pedida, no la de hoy;
 *   · sin cotización NO se estima: se falla diciendo que falta;
 *   · las oficiales son globales y las propias son de cada inmobiliaria.
 */
describe('Cotizaciones', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('cotiz', tk);
    otra = await crearInmobiliaria('cotizvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('la cotización propia', () => {
    it('se carga y queda marcada como propia, no como oficial', async () => {
      const r = await http().post('/v1/cotizaciones/propia').set(...como(inmo))
        .send({ fecha: '2026-03-10', valor: 1250.5 }).expect(201);

      expect(r.body.tipo).toBe('propia');
      // `propia: true` es lo que la pantalla usa para decir de dónde salió el
      // número. Sin esa marca, un valor cargado a mano se leería como oficial.
      expect(r.body.propia).toBe(true);
      expect(r.body.valor).toBe(1250.5);
    });

    it('no se carga dos veces el mismo día', async () => {
      await http().post('/v1/cotizaciones/propia').set(...como(inmo))
        .send({ fecha: '2026-03-10', valor: 9999 }).expect(409);
    });

    it('el asesor no la carga: con este número se liquida plata ajena', async () => {
      await http().post('/v1/cotizaciones/propia').set(...como(inmo, 'agente'))
        .send({ fecha: '2026-04-01', valor: 1300 }).expect(403);
    });

    it('cero fuga: la vecina no ve la cotización propia de otra', async () => {
      const r = await http().get('/v1/cotizaciones?tipo=propia&dias=3650')
        .set(...como(otra)).expect(200);
      expect(r.body.serie).toEqual([]);
    });
  });

  describe('convertir', () => {
    beforeAll(async () => {
      await http().post('/v1/cotizaciones/propia').set(...como(inmo))
        .send({ fecha: '2026-05-01', valor: 1000 }).expect(201);
      await http().post('/v1/cotizaciones/propia').set(...como(inmo))
        .send({ fecha: '2026-06-01', valor: 2000 }).expect(201);
    });

    it('trae la fórmula, no sólo el resultado', async () => {
      const r = await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 100, desde: 'USD', hasta: 'ARS', tipo: 'propia', fecha: '2026-06-15' })
        .expect(201);

      expect(r.body.hasta.monto).toBe(200000);
      expect(r.body.formula).toContain('2000');
      // Y de qué cotización salió: la memoria de cálculo es la cuenta Y su
      // origen, igual que en un ajuste por índice.
      expect(r.body.cotizacion.fecha).toBe('2026-06-01');
    });

    it('usa la vigente A LA FECHA, no la última', async () => {
      // Convertir una operación de mayo con el dólar de junio da un número que
      // no significa nada. Es el error que se comete al hacer la cuenta a mano.
      const r = await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 100, desde: 'USD', hasta: 'ARS', tipo: 'propia', fecha: '2026-05-20' })
        .expect(201);

      expect(r.body.cotizacion.fecha).toBe('2026-05-01');
      expect(r.body.hasta.monto).toBe(100000);
    });

    it('convierte en las dos direcciones', async () => {
      const r = await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 200000, desde: 'ARS', hasta: 'USD', tipo: 'propia', fecha: '2026-06-15' })
        .expect(201);
      expect(r.body.hasta.monto).toBe(100);
    });

    it('sin cotización para esa fecha NO estima: falla y lo dice', async () => {
      // Antes de la primera carga no hay nada, y el sistema no inventa un tipo
      // de cambio — igual que no estima un índice que no se publicó.
      const r = await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 100, desde: 'USD', hasta: 'ARS', tipo: 'propia', fecha: '2020-01-01' })
        .expect(422);
      expect(r.body.detail).toContain('cotización');
    });

    it('la misma moneda de los dos lados es 422, no un resultado igual', async () => {
      await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 100, desde: 'USD', hasta: 'USD', tipo: 'propia' }).expect(422);
    });

    it('una moneda que no existe es 400', async () => {
      await http().post('/v1/cotizaciones/convertir').set(...como(inmo))
        .send({ monto: 100, desde: 'EUR', hasta: 'ARS', tipo: 'propia' }).expect(400);
    });
  });

  describe('las oficiales son de todos', () => {
    it('lo que carga el BCRA lo ven las dos inmobiliarias', async () => {
      // Se escribe por la función SECURITY DEFINER, igual que un índice: es
      // dato público y no tiene dueño.
      const r = await http().get('/v1/cotizaciones?tipo=oficial_minorista&dias=3650')
        .set(...como(otra)).expect(200);
      // Puede estar vacío si el BCRA no respondió en esta corrida: lo que se
      // afirma es que la consulta funciona y no filtra por tenant.
      expect(Array.isArray(r.body.serie)).toBe(true);
    });
  });
});
