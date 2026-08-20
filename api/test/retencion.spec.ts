import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * Retención de datos personales (etapa 17.2, Ley 25.326).
 *
 * La ley no fija plazos: fija que el dato no se guarda más allá de la finalidad
 * que lo justificó. El legajo de un garante existe para decidir si se lo acepta
 * en UN contrato; años después de que ese contrato terminó, la foto de su DNI y
 * sus recibos de sueldo no cumplen ninguna finalidad y siguen siendo un riesgo
 * —para él—.
 */
describe('Retención de datos personales', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let owner: Client;

  let contratoViejo = '';
  let contratoVigente = '';
  let docViejo = '';
  let docVigente = '';
  let garanteViejo = '';

  const como = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  // Un PNG de 1×1: lo que importa es que haya un objeto en el bucket.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Crea un contrato con su garante y un documento; devuelve los ids. */
  async function armarLegajo(sufijo: string) {
    const prop = (await http().post('/v1/propiedades').set(...como())
      .send({ calle: `Retencion ${sufijo}`, tipo: 'departamento' }).expect(201)).body.id;

    const garante = (await http().post('/v1/personas').set(...como())
      .send({ nombre: 'Garante', apellido: sufijo, docTipo: 'dni', docNumero: `31${sufijo}` })
      .expect(201)).body.id;

    const inquilino = (await http().post('/v1/personas').set(...como())
      .send({ nombre: 'Inqui', apellido: sufijo, docTipo: 'dni', docNumero: `32${sufijo}` })
      .expect(201)).body.id;

    const contrato = (await http().post('/v1/contratos').set(...como())
      .send({
        propiedadId: prop, fechaInicio: '2026-01-01', fechaFin: '2027-12-31',
        montoInicial: 300000, moneda: 'ARS', indice: 'ninguno',
        diaVencimiento: 10, locatarios: [inquilino],
      }).expect(201)).body.id;

    const g = (await http().post(`/v1/contratos/${contrato}/garantes`)
      .set(...como()).send({ personaId: garante }).expect(201)).body.id;

    const conDoc = (await http().post(`/v1/garantes/${g}/documentos`).set(...como())
      .send({ tipo: 'dni_frente', datos: PNG.toString('base64'), nombre: 'dni.png' })
      .expect(201)).body;

    const doc = conDoc.documentos.find((d: { tipo: string }) => d.tipo === 'dni_frente');
    return { contrato, garante: g, documento: doc.id };
  }

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('retencion', app.get(TokensService));

    owner = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await owner.connect();

    const viejo = await armarLegajo('777');
    const vigente = await armarLegajo('888');
    contratoViejo = viejo.contrato;
    garanteViejo = viejo.garante;
    docViejo = viejo.documento;
    contratoVigente = vigente.contrato;
    docVigente = vigente.documento;

    // Se envejece uno con el rol OWNER de la base: es SETUP, no es lo que se
    // está probando, y la API no deja cargar un contrato terminado hace años
    // —con razón—.
    await owner.query(
      // Las DOS fechas: hay un CHECK `fecha_fin > fecha_inicio` y mover sólo
      // el fin lo viola.
      `UPDATE contrato_alquiler
          SET estado = 'vencido',
              fecha_inicio = current_date - interval '9 years',
              fecha_fin = current_date - interval '7 years'
        WHERE id = $1`,
      [contratoViejo],
    );

    // Y se le mete una consulta al BCRA vieja, con su desglose.
    await owner.query(
      `UPDATE garantia
          SET bcra_consultado_el = now() - interval '20 months',
              bcra_detalle = $2::jsonb,
              bcra_cheques = '[{"nroCheque": 123}]'::jsonb
        WHERE id = $1`,
      [
        garanteViejo,
        JSON.stringify({
          apto: false,
          motivo: 'Situación 4 en una entidad.',
          entidades: [{ entidad: 'Banco Test', situacion: 4, monto: 500000 }],
          probados: ['20311111114'],
          revisionMemoria: 'Se revisa en 6 meses.',
        }),
      ],
    );
  }, 90_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await limpiarFixtures();
  });

  const estado = (rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    http().get('/v1/datos-personales/retencion').set(...como(rol));

  it('cuenta lo vencido y dice con qué plazos', async () => {
    const r = await estado().expect(200);

    expect(r.body.aniosLegajos).toBeGreaterThan(0);
    expect(r.body.mesesBcra).toBeGreaterThan(0);
    expect(r.body.legajosVencidos.documentos).toBe(1);
    expect(r.body.legajosVencidos.garantes).toBe(1);
    expect(r.body.bcraVencidas).toBe(1);
  });

  it('un contrato que sigue vivo NO cuenta, por viejo que sea el legajo', async () => {
    // Es la mitad del criterio: lo que vence no es el documento, es la
    // finalidad. Mientras el contrato exista, el legajo lo respalda.
    const r = await estado().expect(200);
    expect(r.body.legajosVencidos.documentos).toBe(1); // sólo el del vencido
  });

  it('el asesor no purga datos personales', async () => {
    await estado('agente').expect(403);
    await http().post('/v1/datos-personales/retencion/purgar')
      .set(...como('agente')).expect(403);
  });

  describe('al purgar', () => {
    let resultado: { documentosBorrados: number; consultasBcraPurgadas: number };

    beforeAll(async () => {
      resultado = (await http().post('/v1/datos-personales/retencion/purgar')
        .set(...como()).expect(201)).body;
    });

    it('borra el documento vencido y deja el del contrato vivo', async () => {
      expect(resultado.documentosBorrados).toBe(1);

      const vivos = await http().get(`/v1/contratos/${contratoVigente}/garantes`)
        .set(...como()).expect(200);
      expect(vivos.body[0].documentos).toHaveLength(1);

      // El vencido ya no se puede abrir: no existe.
      await http().get(`/v1/garantes/documentos/${docViejo}`).set(...como()).expect(404);
      // El vigente sí.
      await http().get(`/v1/garantes/documentos/${docVigente}`).set(...como()).expect(200);
    });

    it('saca el desglose del BCRA y CONSERVA el veredicto', async () => {
      expect(resultado.consultasBcraPurgadas).toBe(1);

      const { rows } = await owner.query<{ detalle: Record<string, unknown>; cheques: unknown }>(
        'SELECT bcra_detalle AS detalle, bcra_cheques AS cheques FROM garantia WHERE id = $1',
        [garanteViejo],
      );

      // Se va el dato bancario de un tercero…
      expect(rows[0].detalle.entidades).toBeUndefined();
      expect(rows[0].detalle.probados).toBeUndefined();
      expect(rows[0].cheques).toBeNull();

      // …y queda la memoria de cálculo, que es lo que explica la decisión.
      expect(rows[0].detalle.apto).toBe(false);
      expect(rows[0].detalle.motivo).toContain('Situación 4');
      expect(rows[0].detalle.revisionMemoria).toBeTruthy();
    });

    it('deja dicho que se purgó, en vez de esconder el bloque y callarlo', async () => {
      // Sin la marca, `entidades: []` es ambiguo entre «ninguna entidad le
      // informa deuda» y «el detalle se borró»: cosas opuestas para quien lee
      // el legajo dos años después.
      const r = await http().get(`/v1/contratos/${contratoViejo}/garantes`)
        .set(...como()).expect(200);

      expect(r.body[0].bcra.desglosePurgadoEl).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.body[0].bcra.motivo).toContain('Situación 4');
    });

    it('queda auditado quién lo pidió', async () => {
      const a = await http().get('/v1/auditoria?accion=dato_personal.purgado')
        .set(...como()).expect(200);

      expect(a.body.items.length).toBeGreaterThan(0);
      expect(a.body.items[0].detalle.documentos).toBe(1);
      expect(a.body.items[0].usuario.nombre).toBeTruthy();
    });

    it('correrla de nuevo no borra nada: ya no queda nada vencido', async () => {
      const otra = (await http().post('/v1/datos-personales/retencion/purgar')
        .set(...como()).expect(201)).body;

      expect(otra.documentosBorrados).toBe(0);
      expect(otra.consultasBcraPurgadas).toBe(0);
    });
  });
});
