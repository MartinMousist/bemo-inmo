import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { deflateSync, crc32 } from 'node:zlib';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El acta de entrega y la de devolución, contra Postgres real.
 *
 * Lo que se prueba acá y no en el motor: que **firmada sea de verdad
 * inmutable** —lo hace un trigger, así que hay que tocarlo desde afuera para
 * saber que existe—, que la devolución no se pueda armar suelta, y que las
 * fotos sobrevivan a editar los ambientes.
 */

/** Un PNG real: el almacenamiento valida por firma de bytes, no por extensión. */
function png(): Buffer {
  const chunk = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([len, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const filas = Buffer.concat(
    Array.from({ length: 2 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(6, 120)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(filas)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Actas de entrega y devolución', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;
  let nContrato = 0;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('actas', tk);
    otra = await crearInmobiliaria('actasvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  /** Un contrato nuevo por test: las actas son únicas por contrato y tipo. */
  async function nuevoContrato(): Promise<string> {
    nContrato += 1;
    const prop = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle: `Acta ${nContrato}`, tipo: 'departamento' }).expect(201);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId: prop.body.id,
        fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
      }).expect(201);
    return c.body.id;
  }

  const AMBIENTES = [
    { ambiente: 'Cocina', estado: 'bueno' },
    { ambiente: 'Baño', estado: 'excelente' },
  ];

  it('se crea con sus ambientes y dice qué le falta para firmarse', async () => {
    const contrato = await nuevoContrato();
    const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);

    expect(r.body.entrega.items).toHaveLength(2);
    expect(r.body.devolucion).toBeNull();
    expect(r.body.comparacion).toBeNull();
    // Sin fotos, un acta no prueba nada: se dice antes de firmar, no después.
    expect(r.body.entrega.pendientes.join(' ')).toContain('no tienen foto');
  });

  it('no puede haber dos actas del mismo tipo', async () => {
    const contrato = await nuevoContrato();
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(409);
  });

  it('la devolución no se puede armar sin la entrega', async () => {
    // Sin acta de entrega no hay con qué comparar, y un acta de devolución
    // suelta da la sensación de que está documentado cuando no lo está.
    const contrato = await nuevoContrato();
    const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'devolucion' }).expect(422);
    expect(r.body.detail).toContain('primero tiene que existir la de entrega');
  });

  it('la devolución COPIA los ambientes de la entrega', async () => {
    // Es lo único que hace comparables a las dos actas. Y arrancan en «bueno»,
    // no con el estado de la entrega: copiarlo haría que quien recorre confirme
    // sin mirar.
    const contrato = await nuevoContrato();
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);

    const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'devolucion' }).expect(201);

    expect(r.body.devolucion.items.map((i: { ambiente: string }) => i.ambiente))
      .toEqual(['Cocina', 'Baño']);
    expect(r.body.devolucion.items.every((i: { estado: string }) => i.estado === 'bueno'))
      .toBe(true);
  });

  it('con las dos actas aparece la comparación', async () => {
    const contrato = await nuevoContrato();
    const e = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'devolucion' }).expect(201);

    const dev = (await http().get(`/v1/contratos/${contrato}/actas`)
      .set(...como(inmo)).expect(200)).body.devolucion;

    const r = await http().put(`/v1/actas/${dev.id}/items`).set(...como(inmo))
      .send({ items: [
        { ambiente: 'Cocina', estado: 'malo', detalle: 'Mesada rota' },
        { ambiente: 'Baño', estado: 'excelente' },
      ] }).expect(200);

    expect(r.body.comparacion.empeoraron).toBe(1);
    expect(r.body.comparacion.titular).toBe('1 ambiente volvió peor de como se entregó.');
    expect(e.body.entrega.id).toBeDefined();
  });

  describe('firmada es inmutable', () => {
    async function actaConFoto(): Promise<{ contrato: string; acta: string }> {
      const contrato = await nuevoContrato();
      const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
        .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);
      return { contrato, acta: r.body.entrega.id };
    }

    it('no se puede firmar un acta sin ambientes', async () => {
      const contrato = await nuevoContrato();
      const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
        .send({ tipo: 'entrega' }).expect(201);

      const f = await http().post(`/v1/actas/${r.body.entrega.id}/firmar`).set(...como(inmo))
        .send({ firmadaInquilino: 'Camila Rossi' }).expect(422);
      expect(f.body.detail).toContain('no probaría nada');
    });

    it('firmada, el acta ya no se edita — lo corta la base', async () => {
      const { acta } = await actaConFoto();
      await http().post(`/v1/actas/${acta}/firmar`).set(...como(inmo))
        .send({ firmadaInquilino: 'Camila Rossi' }).expect(201);

      const r = await http().patch(`/v1/actas/${acta}`).set(...como(inmo))
        .send({ observaciones: 'Algo que se me ocurrió después' }).expect(409);
      expect(r.body.detail).toContain('ya está firmada');
      expect(r.body.code).toBe('YA_RENDIDO');
    });

    it('firmada, tampoco se le tocan los ambientes ni se le suben fotos', async () => {
      // Si los hijos se pudieran cambiar, el acta sería inmutable sólo en su
      // carátula, que no sirve de nada.
      const { acta } = await actaConFoto();
      const item = (await http().post(`/v1/actas/${acta}/firmar`).set(...como(inmo))
        .send({ firmadaInquilino: 'Camila Rossi' }).expect(201)).body.entrega.items[0];

      await http().put(`/v1/actas/${acta}/items`).set(...como(inmo))
        .send({ items: [{ ambiente: 'Cocina', estado: 'malo' }] }).expect(409);

      await http().post(`/v1/actas/items/${item.id}/fotos`).set(...como(inmo))
        .send({ datos: png().toString('base64'), nombre: 'tarde.png' }).expect(409);
    });

    it('firmar dos veces no se puede', async () => {
      const { acta } = await actaConFoto();
      await http().post(`/v1/actas/${acta}/firmar`).set(...como(inmo))
        .send({ firmadaInquilino: 'Camila Rossi' }).expect(201);
      await http().post(`/v1/actas/${acta}/firmar`).set(...como(inmo))
        .send({ firmadaInquilino: 'Otro' }).expect(409);
    });
  });

  it('editar los ambientes no se lleva las fotos de los que siguen', async () => {
    // Un DELETE de todo y volver a insertar se llevaría las fotos por CASCADE,
    // que es exactamente lo que no se puede perder.
    const contrato = await nuevoContrato();
    const r = await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);
    const cocina = r.body.entrega.items.find((i: { ambiente: string }) => i.ambiente === 'Cocina');

    await http().post(`/v1/actas/items/${cocina.id}/fotos`).set(...como(inmo))
      .send({ datos: png().toString('base64'), nombre: 'cocina.png' }).expect(201);

    const luego = await http().put(`/v1/actas/${r.body.entrega.id}/items`).set(...como(inmo))
      .send({ items: [
        { ambiente: 'Cocina', estado: 'regular' },
        { ambiente: 'Lavadero', estado: 'bueno' },
      ] }).expect(200);

    const conFoto = luego.body.entrega.items.find((i: { ambiente: string }) => i.ambiente === 'Cocina');
    expect(conFoto.fotos).toBe(1);
    expect(conFoto.estado).toBe('regular');
    // El baño se fue, el lavadero entró.
    expect(luego.body.entrega.items.map((i: { ambiente: string }) => i.ambiente))
      .toEqual(['Cocina', 'Lavadero']);
  });

  it('el asesor carga y firma; el contable sólo mira', async () => {
    // La firma la hace quien está parado con el inquilino y las llaves en la
    // mano: pasarla por el titular frenaría la entrega media tarde.
    const contrato = await nuevoContrato();
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo, 'agente'))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);

    await http().get(`/v1/contratos/${contrato}/actas`).set(...como(inmo, 'contable')).expect(200);
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo, 'contable'))
      .send({ tipo: 'devolucion' }).expect(403);
  });

  it('cero fuga: la vecina no ve las actas de un contrato ajeno', async () => {
    const contrato = await nuevoContrato();
    await http().post(`/v1/contratos/${contrato}/actas`).set(...como(inmo))
      .send({ tipo: 'entrega', items: AMBIENTES }).expect(201);

    const r = await http().get(`/v1/contratos/${contrato}/actas`)
      .set(...como(otra)).expect(200);
    expect(r.body.entrega).toBeNull();
  });
});
