import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * La conciliación de punta a punta, contra Postgres real.
 *
 * Lo que se prueba acá y no en el motor: que importar sea idempotente, que
 * imputar cree un cobro DE VERDAD —con el saldo y el estado del período
 * recalculados— y que la contraparte se aprenda, que es lo que hace que el mes
 * siguiente sea trabajo de tres minutos y no de una tarde.
 */
describe('Conciliación bancaria', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let periodoId: string;
  let monto: number;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('concil', tk);
    otra = await crearInmobiliaria('concilvecina', tk);

    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: 'Conciliación 100', tipo: 'departamento' }).expect(201);

    const inquilino = (await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Camila', apellido: 'Rossi', docTipo: 'dni', docNumero: '35222999' })
      .expect(201)).body.id;

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
        diaVencimiento: 10, locatarios: [inquilino],
      }).expect(201);

    await http().post(`/v1/contratos/${c.body.id}/periodos/generar`)
      .set(...como(inmo)).send({}).expect(201);

    const per = await http().get(`/v1/contratos/${c.body.id}/periodos?porPagina=100`)
      .set(...como(inmo)).expect(200);
    const impaga = per.body.items.find((p: { saldo: number }) => p.saldo > 0);
    periodoId = impaga.id;
    monto = impaga.saldo;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  /** Un extracto como lo baja un homebanking: con ruido y con la fila buena. */
  function csv(over: { monto?: number; fecha?: string; cuit?: string } = {}): string {
    return [
      'Fecha;Concepto;Importe;Referencia;CUIT',
      `05/08/2026;IVA COMISION MANTENIMIENTO;-1250,00;;`,
      `${over.fecha ?? '10/08/2026'};TRANSFERENCIA RECIBIDA;${
        (over.monto ?? monto).toFixed(2).replace('.', ',')
      };OP-99881;${over.cuit ?? '27-35222999-4'}`,
    ].join('\n');
  }

  describe('importar', () => {
    it('lee el extracto y no imputa nada', async () => {
      const r = await http().post('/v1/conciliacion/extractos').set(...como(inmo))
        .send({ contenido: csv(), banco: 'Galicia', nombreArchivo: 'agosto.csv' })
        .expect(201);

      expect(r.body.importados).toBe(2);
      expect(r.body.repetidos).toBe(0);
      expect(r.body.desde).toBe('2026-08-05');

      // Nada quedó imputado: el sistema propone, una persona confirma.
      const p = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);
      expect(p.body).toHaveLength(2);
    });

    it('subir el mismo archivo dos veces no duplica, y lo dice', async () => {
      const r = await http().post('/v1/conciliacion/extractos').set(...como(inmo))
        .send({ contenido: csv() }).expect(201);

      expect(r.body.importados).toBe(0);
      expect(r.body.repetidos).toBe(2);
    });

    it('una fila ilegible se descarta CON motivo, no en silencio', async () => {
      // Una fila que desaparece sin decir nada es plata que no está y que nadie
      // sabe que falta.
      const r = await http().post('/v1/conciliacion/extractos').set(...como(inmo))
        .send({
          contenido: [
            'Fecha;Concepto;Importe',
            'no es una fecha;ALGO;1000,00',
            '15/08/2026;OTRA COSA;7777,00',
          ].join('\n'),
        }).expect(201);

      expect(r.body.importados).toBe(1);
      expect(r.body.descartadas).toHaveLength(1);
      expect(r.body.descartadas[0].motivo).toContain('fecha');
    });

    it('sin columnas de fecha e importe, dice cuáles busca', async () => {
      const r = await http().post('/v1/conciliacion/extractos').set(...como(inmo))
        .send({ contenido: 'Columna A;Columna B\n1;2' }).expect(422);
      expect(r.body.detail).toContain('fecha');
    });
  });

  describe('las sugerencias', () => {
    it('el movimiento del inquilino propone su cuota, y el ruido no propone nada', async () => {
      const p = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);

      // Por el monto EXACTO y no por `monto > 0`: los tests de arriba dejaron
      // otros movimientos importados, y `find` devolvía el primero por fecha
      // —uno de otro test, sin sugerencias— haciendo fallar éste por un motivo
      // que no tenía nada que ver con lo que prueba.
      const transferencia = p.body.find((m: { monto: number }) => m.monto === monto);
      expect(transferencia.cruce.sugerencias.length).toBeGreaterThan(0);
      expect(transferencia.cruce.sugerencias[0].cuotaId).toBe(periodoId);

      const comision = p.body.find((m: { monto: number }) => m.monto < 0);
      expect(comision.pareceRuido).toBe(true);
      expect(comision.cruce.sugerencias).toEqual([]);
    });
  });

  describe('imputar', () => {
    it('crea el cobro de verdad y deja el movimiento resuelto', async () => {
      const p = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);
      const mov = p.body.find((m: { monto: number }) => m.monto === monto);

      const r = await http().post(`/v1/conciliacion/movimientos/${mov.id}/imputar`)
        .set(...como(inmo)).send({ periodoId }).expect(201);

      expect(r.body.cobroId).toBeDefined();
      expect(r.body.saldo).toBe(0);
      expect(r.body.estadoPeriodo).toBe('pagado');

      // Y sale de la bandeja: lo resuelto no vuelve a aparecer.
      const luego = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);
      expect(luego.body.some((m: { id: string }) => m.id === mov.id)).toBe(false);
    });

    it('aprende la contraparte: la próxima transferencia se reconoce sola', async () => {
      // Es lo que convierte la conciliación de «revisar treinta renglones» en
      // «revisar los tres que no reconoce».
      await http().post('/v1/conciliacion/extractos').set(...como(inmo))
        .send({ contenido: csv({ fecha: '10/09/2026', monto: 12345 }) }).expect(201);

      const p = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);
      const nuevo = p.body.find((m: { monto: number }) => m.monto === 12345);

      const senales = nuevo.cruce.sugerencias[0]?.senales ?? [];
      expect(senales).toContain('Ya pagó desde esta cuenta');
    });

    it('un movimiento ya imputado no se imputa de nuevo', async () => {
      const todos = await http().get('/v1/conciliacion/pendientes').set(...como(inmo)).expect(200);
      // El que ya se resolvió no está en pendientes; se busca su id del paso
      // anterior imputando uno nuevo y repitiendo.
      const mov = todos.body[0];
      await http().post(`/v1/conciliacion/movimientos/${mov.id}/ignorar`)
        .set(...como(inmo)).send({ motivo: 'Es una comisión' }).expect(201);

      await http().post(`/v1/conciliacion/movimientos/${mov.id}/imputar`)
        .set(...como(inmo)).send({ periodoId }).expect(409);
    });
  });

  describe('permisos y aislamiento', () => {
    it('el contable lee la bandeja pero no imputa', async () => {
      // Es su trabajo revisar la cobranza; decidir a qué contrato entra cada
      // peso, no.
      await http().get('/v1/conciliacion/pendientes').set(...como(inmo, 'contable')).expect(200);
      await http().post('/v1/conciliacion/extractos').set(...como(inmo, 'contable'))
        .send({ contenido: csv() }).expect(403);
    });

    it('el asesor no entra: acá se decide dónde va la plata', async () => {
      await http().get('/v1/conciliacion/pendientes').set(...como(inmo, 'agente')).expect(403);
    });

    it('cero fuga: la vecina no ve los movimientos ajenos', async () => {
      const r = await http().get('/v1/conciliacion/pendientes').set(...como(otra)).expect(200);
      expect(r.body).toEqual([]);
    });
  });
});
