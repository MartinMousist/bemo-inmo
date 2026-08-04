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
 * Punitorios, renovación, depósito y auditoría.
 *
 * Las cuatro cierran columnas que ya existían en el schema y que **nadie leía**.
 * Tres de ellas además tenían una promesa hecha: el punitorio se imprimía en el
 * contrato, la renovación tenía su columna de enlace, y el depósito su fecha de
 * devolución.
 */
describe('Ciclo del contrato: punitorios, renovación y depósito', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('ciclo', tk);
    otra = await crearInmobiliaria('ciclovecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const hoy = () => new Date().toISOString().slice(0, 10);
  const haceUnAnio = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  const enUnAnio = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  };

  async function crearContrato(calle: string, extra: Record<string, unknown> = {}, i = inmo) {
    const prop = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle, numero: '20', localidad: 'Ciudad', tipo: 'departamento' })
      .expect(201);
    const dueno = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Dueña', apellido: calle }).expect(201);
    const inquilino = await http().post('/v1/personas').set(...como(i))
      .send({ nombre: 'Inquilino', apellido: calle }).expect(201);

    const c = await http().post('/v1/contratos').set(...como(i))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: haceUnAnio(),
        fechaFin: enUnAnio(),
        montoInicial: 400000,
        moneda: 'ARS',
        indice: 'ninguno',
        mesBase: `${haceUnAnio().slice(0, 7)}-01`,
        honorariosPct: 10,
        punitorioDiarioPct: 0.1,
        deposito: 400000,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inquilino.body.id],
        ...extra,
      })
      .expect(201);

    return { contrato: c.body, propiedadId: prop.body.id, dueno: dueno.body };
  }

  async function cuotas(contratoId: string, i = inmo) {
    await http().post(`/v1/contratos/${contratoId}/periodos/generar`).set(...como(i))
      .send({ hasta: `${hoy().slice(0, 7)}-01` }).expect(201);
    const r = await http().get(`/v1/contratos/${contratoId}/periodos?porPagina=100`).set(...como(i)).expect(200);
    return r.body.items as Array<{
      id: string; periodo: string; venceEl: string; total: number; saldo: number;
      punitorio: {
        devengado: number; condonado: boolean; cobrado: number; saldo: number;
        diasDeMora: number; explicacion: string; montoCondonado: number;
      };
    }>;
  }

  // ── Punitorios ────────────────────────────────────────────────────────────

  describe('punitorios', () => {
    it('la cuota vencida devenga interés, con su memoria de cálculo', async () => {
      // La plantilla del contrato promete «un interés punitorio del X% diario».
      // Hasta ahora ningún código lo calculaba: el sistema imprimía una cláusula
      // legal que después no aplicaba.
      const { contrato } = await crearContrato('Punitorio Uno');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

      expect(vieja.punitorio.diasDeMora).toBeGreaterThan(0);
      expect(vieja.punitorio.devengado).toBeGreaterThan(0);
      expect(vieja.punitorio.explicacion).toMatch(/día\(s\) de mora/);
      expect(vieja.punitorio.explicacion).toMatch(/ARS/);
      // Días × tasa × saldo, interés simple.
      expect(vieja.punitorio.devengado).toBeCloseTo(
        (vieja.saldo * 0.1 * vieja.punitorio.diasDeMora) / 100,
        2,
      );
    });

    it('un contrato sin punitorio pactado no devenga nada', async () => {
      const { contrato } = await crearContrato('Sin Punitorio', { punitorioDiarioPct: 0 });
      const cs = await cuotas(contrato.id);
      expect(cs.every((c) => c.punitorio.devengado === 0)).toBe(true);
    });

    it('el interés baja cuando baja el saldo: corre sobre lo impago', async () => {
      const { contrato } = await crearContrato('Punitorio Parcial');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];
      const antes = vieja.punitorio.devengado;

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: vieja.id, monto: 200000 }).expect(201);

      const despues = (await cuotas(contrato.id)).find((c) => c.id === vieja.id)!;
      expect(despues.saldo).toBe(vieja.saldo - 200000);
      expect(despues.punitorio.devengado).toBeLessThan(antes);
    });

    it('cobrar el punitorio NO salda el alquiler', async () => {
      // Si el punitorio contara para el saldo, cobrar el interés dejaría la
      // cuota como pagada sin que el alquiler se hubiera terminado de pagar.
      const { contrato } = await crearContrato('Punitorio Imputado');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

      const r = await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: vieja.id, monto: 5000, imputacion: 'punitorio' })
        .expect(201);

      expect(r.body.imputacion).toBe('punitorio');
      expect(r.body.punitorioCobrado).toBe(5000);
      // El saldo del alquiler quedó igual.
      expect(r.body.saldo).toBe(vieja.saldo);
      expect(r.body.estadoPeriodo).not.toBe('pagado');

      const despues = (await cuotas(contrato.id)).find((c) => c.id === vieja.id)!;
      expect(despues.punitorio.cobrado).toBe(5000);
      expect(despues.saldo).toBe(vieja.saldo);
    });

    it('condonar deja el devengado en cero y guarda cuánto se perdonó', async () => {
      const { contrato } = await crearContrato('Punitorio Condonado');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

      const r = await http().post(`/v1/cuotas/${vieja.id}/condonar-punitorio`)
        .set(...como(inmo))
        .send({ motivo: 'Inquilino al día hace dos años, se atrasó por el feriado' })
        .expect(201);

      expect(r.body.montoCondonado).toBeGreaterThan(0);

      const despues = (await cuotas(contrato.id)).find((c) => c.id === vieja.id)!;
      expect(despues.punitorio.condonado).toBe(true);
      expect(despues.punitorio.devengado).toBe(0);
      expect(despues.punitorio.saldo).toBe(0);
      // Se sigue informando cuánto se perdonó: esconderlo haría que el
      // propietario no vea nunca esa decisión.
      expect(despues.punitorio.montoCondonado).toBeGreaterThan(0);
    });

    it('condonar dos veces es 409, y exige un motivo', async () => {
      const { contrato } = await crearContrato('Punitorio Doble');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

      await http().post(`/v1/cuotas/${vieja.id}/condonar-punitorio`).set(...como(inmo))
        .send({ motivo: 'Acuerdo con el propietario' }).expect(201);
      await http().post(`/v1/cuotas/${vieja.id}/condonar-punitorio`).set(...como(inmo))
        .send({ motivo: 'Acuerdo con el propietario' }).expect(409);

      // Sin motivo no se condona: es plata que alguien resigna en nombre del
      // propietario, y "porque sí" no es una respuesta que se le pueda dar.
      const otraCuota = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[1];
      await http().post(`/v1/cuotas/${otraCuota.id}/condonar-punitorio`)
        .set(...como(inmo)).send({}).expect(400);
    });

    it('el asesor no condona punitorios', async () => {
      const { contrato } = await crearContrato('Punitorio Rol');
      const cs = await cuotas(contrato.id);
      await http().post(`/v1/cuotas/${cs[0].id}/condonar-punitorio`)
        .set(...como(inmo, 'agente')).send({ motivo: 'porque sí' }).expect(403);
    });

    it('el punitorio va a la liquidación según lo que diga EL CONTRATO', async () => {
      const mes = `${hoy().slice(0, 7)}-01`;

      // Contrato que le da el punitorio al propietario.
      const alDueno = await crearContrato('Punitorio Al Dueno', {
        punitorioPara: 'propietario',
      });
      const csA = await cuotas(alDueno.contrato.id);
      const cuotaA = csA.find((c) => c.periodo.startsWith(hoy().slice(0, 7)))!;
      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: cuotaA.id, monto: 100000 }).expect(201);
      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: cuotaA.id, monto: 3000, imputacion: 'punitorio' }).expect(201);

      // Contrato que se lo queda la inmobiliaria.
      const aLaCasa = await crearContrato('Punitorio A La Casa', {
        punitorioPara: 'inmobiliaria',
      });
      const csB = await cuotas(aLaCasa.contrato.id);
      const cuotaB = csB.find((c) => c.periodo.startsWith(hoy().slice(0, 7)))!;
      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: cuotaB.id, monto: 100000 }).expect(201);
      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: cuotaB.id, monto: 3000, imputacion: 'punitorio' }).expect(201);

      await http().post('/v1/liquidaciones/generar').set(...como(inmo))
        .send({ periodo: mes }).expect(201);

      const liqs = await http().get(`/v1/liquidaciones?periodo=${mes}&porPagina=100`)
        .set(...como(inmo)).expect(200);

      const delDueno = liqs.body.items.find(
        (l: { propietario: { id: string } }) => l.propietario.id === alDueno.dueno.id,
      );
      const deLaCasa = liqs.body.items.find(
        (l: { propietario: { id: string } }) => l.propietario.id === aLaCasa.dueno.id,
      );

      const punitorios = (l: { lineas: Array<{ tipo: string; monto: number }> }) =>
        l.lineas.filter((x) => x.tipo === 'punitorio');

      expect(punitorios(delDueno)).toHaveLength(1);
      expect(punitorios(delDueno)[0].monto).toBe(3000);
      // Suma al bruto: es plata que se le rinde igual que el alquiler.
      expect(delDueno.totalBruto).toBe(103000);
      // Y NO se le cobran honorarios: son un % del alquiler, no de la mora.
      expect(delDueno.totalHonorarios).toBe(10000);

      expect(punitorios(deLaCasa)).toHaveLength(0);
      expect(deLaCasa.totalBruto).toBe(100000);
    });
  });

  // ── Renovación ────────────────────────────────────────────────────────────

  describe('renovación', () => {
    it('hereda partes, índice, honorarios y depósito, y deja el anterior renovado', async () => {
      const { contrato } = await crearContrato('Renovar Uno');

      const desde = new Date(enUnAnio());
      desde.setDate(desde.getDate() + 1);
      const hasta = new Date(desde);
      hasta.setFullYear(hasta.getFullYear() + 2);

      const nuevo = await http().post(`/v1/contratos/${contrato.id}/renovar`)
        .set(...como(inmo))
        .send({
          fechaInicio: desde.toISOString().slice(0, 10),
          fechaFin: hasta.toISOString().slice(0, 10),
          montoInicial: 700000,
        })
        .expect(201);

      expect(nuevo.body.id).not.toBe(contrato.id);
      expect(nuevo.body.montoInicial).toBe(700000);
      expect(nuevo.body.honorariosPct).toBe(10);
      // Las partes se heredan: volver a cargarlas a mano es donde se pierde un
      // garante.
      expect(nuevo.body.locadores).toHaveLength(1);
      expect(nuevo.body.locatarios).toHaveLength(1);

      // "Renovado" no es "vencido": uno es una propiedad que se desocupó, el
      // otro es el mismo inquilino que sigue.
      const anterior = await http().get(`/v1/contratos/${contrato.id}`)
        .set(...como(inmo)).expect(200);
      expect(anterior.body.estado).toBe('renovado');
    });

    it('la cadena se ve entera desde cualquier eslabón', async () => {
      const { contrato } = await crearContrato('Renovar Cadena');
      const desde = new Date(enUnAnio());
      desde.setDate(desde.getDate() + 1);
      const hasta = new Date(desde);
      hasta.setFullYear(hasta.getFullYear() + 2);

      const nuevo = await http().post(`/v1/contratos/${contrato.id}/renovar`)
        .set(...como(inmo))
        .send({
          fechaInicio: desde.toISOString().slice(0, 10),
          fechaFin: hasta.toISOString().slice(0, 10),
        })
        .expect(201);

      // Desde el nuevo se ve el viejo, y desde el viejo se ve el nuevo.
      for (const id of [contrato.id, nuevo.body.id]) {
        const cad = await http().get(`/v1/contratos/${id}/cadena`)
          .set(...como(inmo)).expect(200);
        expect(cad.body).toHaveLength(2);
        expect(cad.body[0].id).toBe(contrato.id);
        expect(cad.body[1].id).toBe(nuevo.body.id);
        expect(cad.body.filter((c: { esEste: boolean }) => c.esEste)).toHaveLength(1);
      }
    });

    it('sin monto nuevo arranca del alquiler VIGENTE, no del inicial viejo', async () => {
      // Es lo que las dos partes vienen pagando. Volver al inicial del contrato
      // anterior sería deshacer todos los aumentos de un saque.
      const { contrato } = await crearContrato('Renovar Vigente');
      const desde = new Date(enUnAnio());
      desde.setDate(desde.getDate() + 1);
      const hasta = new Date(desde);
      hasta.setFullYear(hasta.getFullYear() + 1);

      const nuevo = await http().post(`/v1/contratos/${contrato.id}/renovar`)
        .set(...como(inmo))
        .send({
          fechaInicio: desde.toISOString().slice(0, 10),
          fechaFin: hasta.toISOString().slice(0, 10),
        })
        .expect(201);

      expect(nuevo.body.montoInicial).toBe(400000);
    });

    it('no se renueva dos veces ni se solapa con el anterior', async () => {
      const { contrato } = await crearContrato('Renovar Doble');
      const desde = new Date(enUnAnio());
      desde.setDate(desde.getDate() + 1);
      const hasta = new Date(desde);
      hasta.setFullYear(hasta.getFullYear() + 1);

      const cuerpo = {
        fechaInicio: desde.toISOString().slice(0, 10),
        fechaFin: hasta.toISOString().slice(0, 10),
      };

      await http().post(`/v1/contratos/${contrato.id}/renovar`)
        .set(...como(inmo)).send(cuerpo).expect(201);
      await http().post(`/v1/contratos/${contrato.id}/renovar`)
        .set(...como(inmo)).send(cuerpo).expect(409);

      // Y una renovación que arranca antes de que termine el anterior se
      // rechaza con el motivo, no con un error de rangos de la base.
      const { contrato: otro } = await crearContrato('Renovar Solapado');
      const r = await http().post(`/v1/contratos/${otro.id}/renovar`)
        .set(...como(inmo))
        .send({ fechaInicio: hoy(), fechaFin: hasta.toISOString().slice(0, 10) })
        .expect(422);
      expect(r.body.code).toBe('CONTRATO_SOLAPADO');
    });
  });

  // ── Depósito ──────────────────────────────────────────────────────────────

  describe('depósito en garantía', () => {
    it('se devuelve con el detalle de cada descuento, no sólo el neto', async () => {
      const { contrato } = await crearContrato('Deposito Uno');

      const r = await http().post(`/v1/contratos/${contrato.id}/deposito/devolver`)
        .set(...como(inmo))
        .send({
          descuentos: [
            { concepto: 'Expensas de agosto impagas', monto: 62000 },
            { concepto: 'Pintura del living', monto: 38000 },
          ],
        })
        .expect(201);

      expect(r.body.deposito).toBe(400000);
      expect(r.body.totalDescuentos).toBe(100000);
      expect(r.body.devuelto).toBe(300000);
      expect(r.body.descuentos).toHaveLength(2);
      expect(r.body.moneda).toBe('ARS');
    });

    it('sin descuentos se devuelve entero', async () => {
      const { contrato } = await crearContrato('Deposito Entero');
      const r = await http().post(`/v1/contratos/${contrato.id}/deposito/devolver`)
        .set(...como(inmo)).send({}).expect(201);
      expect(r.body.devuelto).toBe(400000);
    });

    it('no se devuelve dos veces, ni más de lo recibido, ni sin depósito', async () => {
      const { contrato } = await crearContrato('Deposito Limites');

      await http().post(`/v1/contratos/${contrato.id}/deposito/devolver`)
        .set(...como(inmo)).send({}).expect(201);
      await http().post(`/v1/contratos/${contrato.id}/deposito/devolver`)
        .set(...como(inmo)).send({}).expect(409);

      const { contrato: excede } = await crearContrato('Deposito Excede');
      const r = await http().post(`/v1/contratos/${excede.id}/deposito/devolver`)
        .set(...como(inmo))
        .send({ descuentos: [{ concepto: 'Rotura del piso', monto: 500000 }] })
        .expect(422);
      expect(r.body.detail).toMatch(/negativo/);

      const { contrato: sinDeposito } = await crearContrato('Deposito Nulo', {
        deposito: undefined,
      });
      await http().post(`/v1/contratos/${sinDeposito.id}/deposito/devolver`)
        .set(...como(inmo)).send({}).expect(422);
    });
  });

  // ── Auditoría ─────────────────────────────────────────────────────────────

  describe('auditoría', () => {
    it('cada movimiento de plata deja su asiento, con monto y con autor', async () => {
      const { contrato } = await crearContrato('Auditada');
      const cs = await cuotas(contrato.id);
      const vieja = cs.sort((a, b) => a.periodo.localeCompare(b.periodo))[0];

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: vieja.id, monto: 123456 }).expect(201);

      const r = await http().get('/v1/auditoria?accion=cobro_registrado&porPagina=100')
        .set(...como(inmo)).expect(200);

      const asiento = r.body.items.find(
        (a: { monto: number }) => a.monto === 123456,
      );
      expect(asiento).toBeDefined();
      expect(asiento.moneda).toBe('ARS');
      expect(asiento.usuario.nombre).toBeTruthy();
      expect(asiento.entidadTipo).toBe('cobro');
      expect(asiento.detalle.imputacion).toBe('alquiler');
    });

    it('cerrar una liquidación queda firmada: era el único acto sin autor', async () => {
      const mes = `${hoy().slice(0, 7)}-01`;
      const { contrato, dueno } = await crearContrato('Auditada Liquidacion');
      const cs = await cuotas(contrato.id);
      const delMes = cs.find((c) => c.periodo.startsWith(hoy().slice(0, 7)))!;

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: delMes.id, monto: 400000 }).expect(201);
      await http().post('/v1/liquidaciones/generar').set(...como(inmo))
        .send({ periodo: mes }).expect(201);

      const liqs = await http().get(`/v1/liquidaciones?periodo=${mes}&porPagina=100`)
        .set(...como(inmo)).expect(200);
      const mia = liqs.body.items.find(
        (l: { propietario: { id: string } }) => l.propietario.id === dueno.id,
      );

      await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);

      const hist = await http().get(`/v1/auditoria/liquidacion/${mia.id}`)
        .set(...como(inmo)).expect(200);

      const cierre = hist.body.find(
        (a: { accion: string }) => a.accion === 'liquidacion_cerrada',
      );
      expect(cierre).toBeDefined();
      expect(cierre.usuario.nombre).toBeTruthy();
      expect(cierre.monto).toBe(mia.totalNeto);
    });

    it('marcar pagada exige que esté cerrada, y no se hace dos veces', async () => {
      const mes = `${hoy().slice(0, 7)}-01`;
      const { contrato, dueno } = await crearContrato('Auditada Pagada');
      const cs = await cuotas(contrato.id);
      const delMes = cs.find((c) => c.periodo.startsWith(hoy().slice(0, 7)))!;

      await http().post('/v1/cobros').set(...como(inmo))
        .send({ periodoId: delMes.id, monto: 400000 }).expect(201);
      await http().post('/v1/liquidaciones/generar').set(...como(inmo))
        .send({ periodo: mes }).expect(201);

      const liqs = await http().get(`/v1/liquidaciones?periodo=${mes}&porPagina=100`)
        .set(...como(inmo)).expect(200);
      const mia = liqs.body.items.find(
        (l: { propietario: { id: string } }) => l.propietario.id === dueno.id,
      );

      // En borrador todavía pueden cambiar los números.
      await http().post(`/v1/liquidaciones/${mia.id}/pagada`).set(...como(inmo)).expect(422);

      await http().post(`/v1/liquidaciones/${mia.id}/cerrar`).set(...como(inmo)).expect(201);
      const pagada = await http().post(`/v1/liquidaciones/${mia.id}/pagada`)
        .set(...como(inmo)).expect(201);
      expect(pagada.body.estado).toBe('pagada');

      // Es justo lo que evita que a alguien se le pague dos veces.
      await http().post(`/v1/liquidaciones/${mia.id}/pagada`).set(...como(inmo)).expect(409);
    });

    it('el asesor no ve la auditoría de la plata', async () => {
      // Mismo permiso que las liquidaciones: si la viera, sería la misma
      // información por otra puerta.
      await http().get('/v1/auditoria').set(...como(inmo, 'agente')).expect(403);
      await http().get('/v1/auditoria').set(...como(inmo, 'contable')).expect(200);
    });

    it('cero fuga: la vecina no ve movimientos ajenos', async () => {
      const r = await http().get('/v1/auditoria?porPagina=100').set(...como(otra)).expect(200);
      expect(r.body.items).toHaveLength(0);
      expect(r.body.total).toBe(0);
    });
  });
});
