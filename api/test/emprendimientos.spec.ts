import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * Emprendimientos y venta en pozo (etapa 19).
 */
describe('Emprendimientos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let vecina: Inmobiliaria;
  let empId = '';
  let planId = '';

  type Rol = 'owner' | 'admin' | 'agente' | 'contable';
  const como = (i: Inmobiliaria, rol: Rol = 'owner') => auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const PLANILLA = [
    'piso;depto;tipologia;ambientes;m2;coeficiente;precio',
    '1;A;2 amb frente;2;48,50;2,45;89000',
    '1;B;1 amb contrafrente;1;33,00;1,70;62000',
    '2;A;2 amb frente;2;48,50;2,45;91000',
  ].join('\n');

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('pozo', tk);
    vecina = await crearInmobiliaria('pozovecina', tk);

    const e = await http().post('/v1/emprendimientos').set(...como(inmo))
      .send({
        nombre: 'Torre Aconcagua', calle: 'San Martín', numero: '1500',
        localidad: 'Ciudad', etapa: 'pozo', entregaEstimada: '2028-06-30',
      })
      .expect(201);
    empId = e.body.id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('el alta', () => {
    it('arranca sin unidades y en pozo', async () => {
      const r = await http().get(`/v1/emprendimientos/${empId}`).set(...como(inmo)).expect(200);
      expect(r.body.etapa).toBe('pozo');
      expect(r.body.unidades.total).toBe(0);
      expect(r.body.avancePct).toBe(0);
    });

    it('congela la entrega ORIGINAL para poder medir el atraso', async () => {
      const r = await http().get(`/v1/emprendimientos/${empId}`).set(...como(inmo)).expect(200);
      expect(r.body.entregaOriginal).toBe('2028-06-30');
      expect(r.body.atrasoMeses).toBe(0);
    });

    it('cuando la obra se atrasa, la diferencia queda a la vista', async () => {
      await http().patch(`/v1/emprendimientos/${empId}`).set(...como(inmo))
        .send({ entregaEstimada: '2028-12-30' }).expect(200);

      const r = await http().get(`/v1/emprendimientos/${empId}`).set(...como(inmo)).expect(200);
      expect(r.body.entregaOriginal).toBe('2028-06-30');
      expect(r.body.atrasoMeses).toBe(6);
    });

    it('el asesor puede mirarlo pero no crearlo', async () => {
      await http().get('/v1/emprendimientos').set(...como(inmo, 'agente')).expect(200);
      await http().post('/v1/emprendimientos').set(...como(inmo, 'agente'))
        .send({ nombre: 'Otro', calle: 'X' }).expect(403);
    });

    it('dos con el mismo nombre no se pueden', async () => {
      await http().post('/v1/emprendimientos').set(...como(inmo))
        .send({ nombre: 'Torre Aconcagua', calle: 'Otra' }).expect(409);
    });
  });

  describe('el avance de obra', () => {
    it('se registra con su fecha', async () => {
      const r = await http().patch(`/v1/emprendimientos/${empId}/avance`)
        .set(...como(inmo)).send({ pct: 35 }).expect(200);
      expect(r.body.avancePct).toBe(35);
      // Un «35%» sin decir de cuándo no le sirve a quien puso plata.
      expect(r.body.avanceEl).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('no acepta más de 100', async () => {
      await http().patch(`/v1/emprendimientos/${empId}/avance`)
        .set(...como(inmo)).send({ pct: 140 }).expect(400);
    });
  });

  describe('importar unidades', () => {
    it('SIMULA por defecto y no escribe nada', async () => {
      // Una planilla de 40 unidades con la columna corrida crea 40 propiedades
      // mal cargadas, y deshacer eso es peor que cargarlas a mano.
      const r = await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: PLANILLA }).expect(201);

      expect(r.body.simulado).toBe(true);
      expect(r.body.aceptadas).toBe(3);

      const e = await http().get(`/v1/emprendimientos/${empId}`).set(...como(inmo)).expect(200);
      expect(e.body.unidades.total).toBe(0);
    });

    it('suma los coeficientes para que se note si falta una unidad', async () => {
      const r = await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: PLANILLA }).expect(201);
      expect(r.body.sumaCoeficientes).toBeCloseTo(6.6, 2);
    });

    it('con confirmar, las crea con su operación de venta', async () => {
      const r = await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: PLANILLA, confirmar: true, moneda: 'USD' })
        .expect(201);
      expect(r.body.simulado).toBe(false);

      const e = await http().get(`/v1/emprendimientos/${empId}`).set(...como(inmo)).expect(200);
      expect(e.body.unidades.total).toBe(3);
      // Con precio nace disponible: sin operación, el plano la pintaría como
      // «sin operación» aunque la planilla traía el precio.
      expect(e.body.unidades.disponibles).toBe(3);
    });

    it('marca las filas con problema en vez de tragárselas', async () => {
      const rota = [
        'piso;depto;m2;precio',
        '3;;45;80000',        // sin depto ni tipología
        '3;B;45;-5',          // precio negativo
        '3;C;45;70000',       // buena
      ].join('\n');

      const r = await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: rota }).expect(201);

      expect(r.body.aceptadas).toBe(1);
      expect(r.body.rechazadas).toBe(2);
      expect(r.body.filas[0].problema).toContain('no se sabe qué unidad');
      expect(r.body.filas[1].problema).toContain('mayor a cero');
      // La línea que ve la persona en Excel, no el índice del array.
      expect(r.body.filas[0].linea).toBe(2);
    });

    it('una planilla sin columna de unidad se rechaza entera', async () => {
      await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: 'piso;m2\n1;50' }).expect(422);
    });

    it('acepta separador y decimales en formato argentino', async () => {
      // «48,50» con punto y coma es lo que exporta un Excel en español.
      const r = await http().post(`/v1/emprendimientos/${empId}/unidades/importar`)
        .set(...como(inmo)).send({ csv: PLANILLA }).expect(201);
      expect(r.body.filas[0].supTotal).toBeCloseTo(48.5, 2);
    });
  });

  describe('el plano', () => {
    it('agrupa por piso y trae el estado de cada unidad', async () => {
      const r = await http().get(`/v1/emprendimientos/${empId}/plano`)
        .set(...como(inmo)).expect(200);

      const pisos = r.body.map((p: { piso: string }) => p.piso);
      expect(pisos).toContain('1');
      expect(pisos).toContain('2');

      const piso1 = r.body.find((p: { piso: string }) => p.piso === '1');
      expect(piso1.unidades).toHaveLength(2);
      expect(piso1.unidades[0].estado).toBe('disponible');
      expect(piso1.unidades[0].codigo).toMatch(/^PROP-\d{4}$/);
    });

    it('el asesor lo ve: es su herramienta de venta', async () => {
      await http().get(`/v1/emprendimientos/${empId}/plano`)
        .set(...como(inmo, 'agente')).expect(200);
    });
  });

  describe('los planes de pago', () => {
    it('rechaza uno cuyos porcentajes no cierran', async () => {
      // Guardarlo «para arreglarlo después» es dejarlo listo para que se use
      // por error.
      await http().post('/v1/planes-pago').set(...como(inmo))
        .send({
          nombre: 'Roto', anticipoPct: 60, cuotas: 0,
          contraEntregaPct: 30, emprendimientoId: empId,
        })
        .expect(422);
    });

    it('se crea uno válido', async () => {
      const r = await http().post('/v1/planes-pago').set(...como(inmo))
        .send({
          nombre: '30 + 36 CAC', emprendimientoId: empId,
          anticipoPct: 30, cuotas: 36,
          refuerzos: [{ cuota: 12, pct: 5 }, { cuota: 24, pct: 5 }],
          contraEntregaPct: 10, indice: 'cac', moneda: 'USD',
        })
        .expect(201);
      planId = r.body.id;
      expect(r.body.problemas).toEqual([]);
    });

    it('el presupuesto toma el precio de la UNIDAD, no del cuerpo', async () => {
      // Así lo que se le imprime a un cliente es el precio publicado y no uno
      // escrito a mano en la URL.
      const plano = await http().get(`/v1/emprendimientos/${empId}/plano`)
        .set(...como(inmo)).expect(200);
      const unidad = plano.body[0].unidades[0];

      const r = await http().post(`/v1/planes-pago/${planId}/presupuesto`)
        .set(...como(inmo))
        .send({ propiedadId: unidad.id, precio: 1, desde: '2026-03-10' })
        .expect(201);

      expect(r.body.presupuesto.total).toBeCloseTo(unidad.precio, 0);
      expect(r.body.presupuesto.anticipo).toBeCloseTo(unidad.precio * 0.3, 0);
    });

    it('trae la memoria de cálculo y la advertencia del ajuste', async () => {
      const r = await http().post(`/v1/planes-pago/${planId}/presupuesto`)
        .set(...como(inmo)).send({ precio: 100000, desde: '2026-03-10' }).expect(201);

      expect(r.body.presupuesto.formula).toContain('30% de anticipo');
      expect(r.body.presupuesto.advertenciaAjuste).toContain('CAC');
      expect(r.body.inversion.expuestoAntesDeEntregaPct).toBeCloseTo(90, 0);
    });

    it('sin unidad y sin precio, lo dice en vez de devolver cero', async () => {
      await http().post(`/v1/planes-pago/${planId}/presupuesto`)
        .set(...como(inmo)).send({ desde: '2026-03-10' }).expect(422);
    });

    it('el asesor puede presupuestar: es su herramienta de venta', async () => {
      await http().post(`/v1/planes-pago/${planId}/presupuesto`)
        .set(...como(inmo, 'agente')).send({ precio: 90000 }).expect(201);
    });

    it('pero no puede crear planes', async () => {
      await http().post('/v1/planes-pago').set(...como(inmo, 'agente'))
        .send({ nombre: 'X', anticipoPct: 100, cuotas: 0 }).expect(403);
    });
  });

  it('cero fuga: la vecina no ve nada', async () => {
    const r = await http().get('/v1/emprendimientos').set(...como(vecina)).expect(200);
    expect(r.body).toEqual([]);
    await http().get(`/v1/emprendimientos/${empId}`).set(...como(vecina)).expect(404);
  });
});
