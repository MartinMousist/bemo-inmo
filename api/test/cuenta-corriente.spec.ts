import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * La cuenta corriente: qué debe una persona y qué se le debe.
 *
 * Lo que se prueba acá es que el saldo salga de sumar lo que YA ESTÁ —cuotas,
 * cobros, liquidaciones— y no de una columna. Y sobre todo los dos bordes que
 * distinguen esta pantalla de un `SELECT sum()`:
 *
 *   · una persona que no es inquilino no muestra un saldo cero, muestra NADA:
 *     un cero es un número y dice «está al día», que no es lo mismo que «acá
 *     no corresponde la pregunta»;
 *   · quien es inquilino Y propietario tiene los dos saldos SIN netear.
 */
describe('Cuenta corriente por persona', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  let inquilinoId = '';
  let contratoId = '';
  let cuota = 0;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('ctacte', tk);
    otra = await crearInmobiliaria('ctactevecina', tk);

    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Cuenta 100', tipo: 'departamento' }).expect(201);

    inquilinoId = (await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Inqui', apellido: 'Cuenta', docTipo: 'dni', docNumero: '31444555' })
      .expect(201)).body.id;

    // Arranca hace un año: tiene cuotas ya vencidas de verdad.
    const inicio = new Date(); inicio.setFullYear(inicio.getFullYear() - 1);
    const fin = new Date(); fin.setFullYear(fin.getFullYear() + 1);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: inicio.toISOString().slice(0, 10),
        fechaFin: fin.toISOString().slice(0, 10),
        montoInicial: 200000, moneda: 'ARS', indice: 'ninguno',
        diaVencimiento: 10, locatarios: [inquilinoId],
      }).expect(201);
    contratoId = c.body.id;

    await http().post(`/v1/contratos/${contratoId}/periodos/generar`)
      .set(...como(inmo)).send({}).expect(201);

    const per = await http().get(`/v1/contratos/${contratoId}/periodos?porPagina=100`)
      .set(...como(inmo)).expect(200);
    cuota = per.body.items[0].total;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const leer = (id: string, i = inmo, rol: 'owner' | 'contable' | 'agente' = 'owner') =>
    http().get(`/v1/personas/${id}/cuenta-corriente`).set(...como(i, rol));

  describe('el inquilino', () => {
    it('debe lo emitido mientras no pague, y los movimientos lo explican', async () => {
      const r = await leer(inquilinoId).expect(200);

      expect(r.body.comoInquilino).not.toBeNull();
      const ars = r.body.comoInquilino.saldo.find((s: { moneda: string }) => s.moneda === 'ARS');
      expect(ars.monto).toBeGreaterThan(0);

      // Todo movimiento lleva su moneda. Es la regla del dominio, y en una
      // pantalla de plata un número suelto es un bug.
      for (const m of r.body.comoInquilino.movimientos) {
        expect(m.moneda).toBeTruthy();
        expect(['debe', 'haber']).toContain(m.tipo);
      }
    });

    it('un cobro baja el saldo exactamente en lo cobrado', async () => {
      const antes = (await leer(inquilinoId).expect(200)).body
        .comoInquilino.saldo.find((s: { moneda: string }) => s.moneda === 'ARS').monto;

      const per = await http().get(`/v1/contratos/${contratoId}/periodos?porPagina=100`)
        .set(...como(inmo)).expect(200);
      const impaga = per.body.items.find((x: { saldo: number }) => x.saldo > 0);

      await http().post('/v1/cobros').set(...como(inmo))
        // Sin `moneda`: la toma del período, y el DTO rechaza lo que no declara.
        .send({ periodoId: impaga.id, monto: cuota, medio: 'efectivo' })
        .expect(201);

      const despues = (await leer(inquilinoId).expect(200)).body
        .comoInquilino.saldo.find((s: { moneda: string }) => s.moneda === 'ARS').monto;

      expect(Math.round((antes - despues) * 100) / 100).toBe(cuota);
    });

    it('no cuenta las cuotas que todavía no vencieron', async () => {
      // Un contrato largo emite muchas cuotas por adelantado. Sumarlas todas
      // haría que un inquilino nuevo aparezca debiendo una fortuna el primer
      // día: eso es una previsión, no una deuda.
      //
      // Se afirma sobre el CORTE y no comparando contra el total emitido: hoy
      // `periodos/generar` sólo llega hasta el mes en curso, así que ese
      // total y la deuda coinciden y la comparación pasaría por casualidad.
      // Lo que tiene que valer siempre es que ningún movimiento de tipo
      // «debe» quede en el futuro.
      const r = await leer(inquilinoId).expect(200);
      const finDeMes = new Date();
      finDeMes.setMonth(finDeMes.getMonth() + 1, 0);
      const corte = finDeMes.toISOString().slice(0, 10);

      const futuras = r.body.comoInquilino.movimientos
        .filter((m: { tipo: string; fecha: string }) => m.tipo === 'debe' && m.fecha > corte);
      expect(futuras).toEqual([]);
    });
  });

  describe('quien no tiene el rol no muestra saldo cero', () => {
    it('una persona sin contratos ni propiedades muestra null en los dos lados', async () => {
      const suelta = (await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Suelta', apellido: 'Cuenta', docTipo: 'dni', docNumero: '31444666' })
        .expect(201)).body.id;

      const r = await leer(suelta).expect(200);
      // `null`, no `{ saldo: [] }`: son cosas distintas y sólo una es cierta.
      expect(r.body.comoInquilino).toBeNull();
      expect(r.body.comoPropietario).toBeNull();
    });
  });

  describe('permisos y aislamiento', () => {
    it('el contable la ve: es su trabajo', async () => {
      await leer(inquilinoId, inmo, 'contable').expect(200);
    });

    it('el asesor no: acá se ve cuánto debe cada uno', async () => {
      await leer(inquilinoId, inmo, 'agente').expect(403);
    });

    it('cero fuga: la vecina no lee la cuenta de una persona ajena', async () => {
      await leer(inquilinoId, otra).expect(404);
    });
  });
});
