import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { deflateSync, crc32 } from 'node:zlib';
import { Client } from 'pg';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';
import {
  candidatos,
  cuilesPosibles,
  digitoVerificador,
  evaluar,
  evaluarCheques,
  proximaRevision,
} from '../src/garantes/situacion.motor';
import { normalizarAr } from '../src/garantes/telefono.motor';
import {
  DeudoresService,
  type ConsultaBcra,
  type ConsultaCheques,
} from '../src/garantes/deudores.service';

/**
 * Garantes: el legajo, los documentos y el veredicto del BCRA.
 *
 * **Ningún test de acá sale a internet.** La regla que decide si a alguien se
 * le alquila vive en `situacion.motor.ts`, que es puro, y se prueba con las
 * respuestas que la API real devuelve —el contrato quedó verificado a mano el
 * 2026-08-06—. Un test que consultara la Central de Deudores de verdad
 * dependería de que el BCRA esté arriba y, peor, tendría que usar el documento
 * de una persona real para dar algo distinto de "sin deudas".
 *
 * Lo que SÍ se prueba de punta a punta es lo que pasa DESPUÉS de la respuesta
 * —el historial que no se pisa, la fecha de revisión, el cache de cheques—, y
 * para eso se reemplaza `DeudoresService` con `jest.spyOn` sobre la instancia
 * que ya tiene la app. Es el único punto que habla con internet, y sustituirlo
 * deja probado todo el resto contra Postgres de verdad.
 */

/** La respuesta de la Central de Deudores, con la forma real ya verificada. */
function veredictoFalso(over: Partial<ConsultaBcra> = {}): ConsultaBcra {
  return {
    cuit: '27178899003',
    denominacion: 'GARANTE DE PRUEBA',
    periodo: '202607',
    consultadoEl: new Date().toISOString(),
    probados: ['27178899003'],
    apto: true,
    peorSituacion: 1,
    motivo: 'Situación 1 (normal) en la entidad que lo informa.',
    entidades: [],
    advertencias: [],
    ...over,
  };
}

function chequesFalsos(over: Partial<ConsultaCheques> = {}): ConsultaCheques {
  return {
    cuit: '27178899003',
    denominacion: 'GARANTE DE PRUEBA',
    consultadoEl: new Date().toISOString(),
    ...evaluarCheques([]),
    ...over,
  };
}

/** `AAAA-MM-DD` a N meses de hoy, sin pasar por husos horarios. */
function aMeses(meses: number): string {
  const hoy = new Date();
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + meses, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * `AAAA-MM-DD` a N días de hoy.
 *
 * El aviso de garantía por vencer sale 30 días antes, así que para que caiga
 * dentro de la ventana del generador el vencimiento tiene que estar a MÁS de 30
 * días: con 30 justos el `dispara_el` cae hoy y con menos ya pasó.
 */
function aDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Un PNG real: el almacenamiento valida por firma de bytes, no por extensión. */
function png(w = 2, h = 2): Buffer {
  const chunk = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([len, cuerpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const filas = Buffer.concat(
    Array.from({ length: h }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]),
    ),
  );

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filas)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Garantes', () => {
  // ── El motor: la regla, sin red ────────────────────────────────────────────

  describe('lectura de la Central de Deudores', () => {
    it('sin deudas informadas es apto, y lo dice con todas las letras', () => {
      const v = evaluar([]);
      expect(v.apto).toBe(true);
      expect(v.peorSituacion).toBeNull();
      expect(v.motivo).toContain('no tiene deuda bancaria registrada');
    });

    it('situación 1 en todas las entidades es apto', () => {
      const v = evaluar([
        { entidad: 'BANCO A', situacion: 1, monto: 249, diasAtrasoPago: 0 },
        { entidad: 'BANCO B', situacion: 1, monto: 12, diasAtrasoPago: 0 },
      ]);
      expect(v.apto).toBe(true);
      expect(v.peorSituacion).toBe(1);
    });

    it('una sola entidad en situación 2 ya lo deja afuera, y se dice cuál', () => {
      // La regla es del dueño y es dura: sólo nivel 1. Lo que no puede pasar es
      // que el rechazo sea un «no apto» a secas — alguien tiene que poder
      // explicárselo al inquilino que trajo a ese garante.
      const v = evaluar([
        { entidad: 'BANCO BUENO', situacion: 1, monto: 100 },
        { entidad: 'BANCO FEO', situacion: 2, monto: 5000 },
      ]);
      expect(v.apto).toBe(false);
      expect(v.peorSituacion).toBe(2);
      expect(v.motivo).toContain('BANCO FEO');
      expect(v.motivo).toContain('Sólo se aceptan garantes en situación 1');
    });

    it('los montos vienen en miles de pesos y se pasan a pesos', () => {
      // El BCRA informa la Central de Deudores en miles. Mostrar el número
      // crudo convierte una deuda de $1.842.869 en «$1.843», que es justo el
      // error que hace que alguien apruebe a quien no debía.
      const v = evaluar([{ entidad: 'BANCO', situacion: 1, monto: 1842.869 }]);
      expect(v.entidades[0].monto).toBe(1842869);
    });

    it('las banderas no cambian el veredicto pero se ven', () => {
      const v = evaluar([
        { entidad: 'BANCO', situacion: 1, monto: 10, procesoJud: true, diasAtrasoPago: 45 },
      ]);
      expect(v.apto).toBe(true);
      expect(v.advertencias).toEqual([
        'BANCO: proceso judicial en curso.',
        'BANCO: 45 días de atraso informados.',
      ]);
    });
  });

  describe('del DNI al CUIL', () => {
    it('calcula el dígito verificador módulo 11', () => {
      // 27-16234998-3 es un CUIL válido: el mismo que devolvió la API real al
      // verificar el contrato.
      expect(digitoVerificador('2716234998')).toBe(3);
    });

    it('descarta la combinación que no existe', () => {
      // Resto 1 ⇒ el verificador daría 10, que no es un dígito. Ese prefijo no
      // le corresponde a ese documento y hay que probar el siguiente.
      const cuiles = cuilesPosibles('16234998');
      expect(cuiles).toContain('27162349983');
      for (const c of cuiles) expect(c).toHaveLength(11);
    });

    it('un CUIL completo se usa tal cual', () => {
      expect(candidatos('27-16234998-3')).toEqual(['27162349983']);
    });

    it('un documento que no es ni DNI ni CUIL no genera candidatos', () => {
      expect(candidatos('123')).toEqual([]);
      expect(candidatos('')).toEqual([]);
    });
  });

  // ── El teléfono: el motor que evita abrirle el chat a otra persona ─────────

  describe('del teléfono de la ficha al WhatsApp', () => {
    it('los cinco formatos del mismo número llegan al mismo wa.me', () => {
      // Este es el punto entero del motor. `0261 15 555-1234` y
      // `+54 9 261 555 1234` son la misma persona: el 0 de larga distancia y el
      // 15 de celular son de la telefonía fija argentina y no van en el
      // formato internacional.
      const esperado = '5492615551234';
      for (const escrito of [
        '261 555-1234',
        '0261 15 555-1234',
        '+54 9 261 555 1234',
        '54 261 555 1234',
        '00 54 9 261 555 1234',
      ]) {
        expect(normalizarAr(escrito).numero).toBe(esperado);
      }
    });

    it('el teléfono tal como está cargado en el seed sale bien', () => {
      // Adriana Rossi, la garante del contrato 1: «261 633-1220».
      expect(normalizarAr('261 633-1220').numero).toBe('5492616331220');
      // Y uno de CABA, que lleva código de área de dos dígitos.
      expect(normalizarAr('11 5544-2200').numero).toBe('5491155442200');
    });

    it('el 15 se saca sabiendo dónde termina el código de área', () => {
      // El área es de 2, 3 o 4 dígitos, y sólo sabiendo eso se puede ubicar el
      // 15. Un `replace('15','')` a los tapones rompe los dos casos de abajo.
      expect(normalizarAr('011 15 5544-2200').numero).toBe('5491155442200');
      expect(normalizarAr('0261 15 555-1234').numero).toBe('5492615551234');
      // Y NO le come nada a un número que tiene un 15 en el medio sin ser el
      // prefijo de celular.
      expect(normalizarAr('11 1556-7788').numero).toBe('5491115567788');
    });

    it('un número que no cierra en 10 dígitos devuelve null CON motivo', () => {
      // Es la regla que sostiene todo: un wa.me armado a los tapones no falla,
      // abre el chat de otra persona y le manda los datos del inquilino.
      const r = normalizarAr('15 555-1234');
      expect(r.numero).toBeNull();
      expect(r.motivo).toContain('15 555-1234');
      expect(r.motivo).toContain('10');
    });

    it('sin teléfono y con un teléfono ilegible dicen cosas distintas', () => {
      expect(normalizarAr(null).motivo).toContain('No tiene teléfono cargado');
      expect(normalizarAr('a coordinar').motivo).toContain('no tiene ningún dígito');
    });

    it('un número del exterior no se disfraza de argentino', () => {
      const r = normalizarAr('+1 415 555 1234');
      expect(r.numero).toBeNull();
      expect(r.motivo).toBeTruthy();
    });
  });

  // ── Cheques rechazados ────────────────────────────────────────────────────

  describe('cheques rechazados', () => {
    /** La forma real: causales → entidades → detalle. Tres niveles. */
    const crudo = [
      {
        causal: 'SIN FONDOS',
        entidades: [
          {
            entidad: 11,
            detalle: [
              {
                nroCheque: 20377148, fechaRechazo: '2026-03-15', monto: 115000.0,
                fechaPago: null, fechaPagoMulta: null, estadoMulta: 'IMPAGA',
                ctaPersonal: true, denomJuridica: null, enRevision: false, procesoJud: false,
              },
              {
                nroCheque: 20377149, fechaRechazo: '2026-04-02', monto: 50000.0,
                fechaPago: '2026-04-20', fechaPagoMulta: null, estadoMulta: null,
                ctaPersonal: true, denomJuridica: null, enRevision: false, procesoJud: false,
              },
            ],
          },
        ],
      },
    ];

    it('el 404 del BCRA es «no tiene cheques», no un error', () => {
      const v = evaluarCheques([]);
      expect(v.cantidad).toBe(0);
      expect(v.resumen).toContain('No tiene cheques rechazados');
      expect(v.advertencias).toEqual([]);
    });

    it('EL MONTO VIENE EN PESOS, NO EN MILES', () => {
      // La trampa de esta feature. En `Deudas` el BCRA informa en miles y el
      // motor multiplica por 1000; en `ChequesRechazados` el campo es el
      // importe del cheque. Reusar esa constante convierte un cheque de
      // $115.000 en $115.000.000 y hace rechazar a alguien por mil veces lo
      // que debe.
      const v = evaluarCheques(crudo);
      expect(v.cheques.find((c) => c.nroCheque === 20377148)!.monto).toBe(115000);
      expect(v.montoTotal).toBe(165000);
    });

    it('aplana los tres niveles y separa lo que sigue sin levantarse', () => {
      const v = evaluarCheques(crudo);
      expect(v.cantidad).toBe(2);
      expect(v.sinPagar).toBe(1);
      expect(v.montoSinPagar).toBe(115000);
      expect(v.porCausal).toEqual([{ causal: 'SIN FONDOS', cantidad: 2, monto: 165000 }]);
      expect(v.advertencias[0]).toContain('sin levantar');
    });

    it('un cheque con proceso judicial se advierte, con la fecha en dd/mm/aaaa', () => {
      const v = evaluarCheques([
        {
          causal: 'DEFECTOS FORMALES',
          entidades: [{ entidad: 7, detalle: [
            { nroCheque: 99, fechaRechazo: '2026-01-05', monto: 20000, procesoJud: true },
          ] }],
        },
      ]);
      expect(v.advertencias.join(' ')).toContain('05/01/2026');
      expect(v.advertencias.join(' ')).toContain('proceso judicial');
    });
  });

  // ── Cuándo se vuelve a revisar ────────────────────────────────────────────

  describe('la próxima revisión del BCRA', () => {
    const base = {
      consultadoEl: '2026-08-06',
      apto: true,
      contratoDesde: '2026-01-01',
      contratoHasta: '2029-12-31',
    };

    it('un contrato de tres años programa la revisión a seis meses', () => {
      const r = proximaRevision(base);
      expect(r.fecha).toBe('2027-02-06');
      // Todo cálculo lleva su memoria: la fecha sola no la puede explicar nadie.
      expect(r.memoria).toContain('06/02/2027');
      expect(r.memoria).toContain('cada 6 meses');
    });

    it('un contrato corto no programa nada, y dice por qué', () => {
      const r = proximaRevision({ ...base, contratoHasta: '2027-01-01' });
      expect(r.fecha).toBeNull();
      expect(r.memoria).toContain('24');
    });

    it('la revisión nunca cae después de que termine el contrato', () => {
      const r = proximaRevision({ ...base, consultadoEl: '2029-08-06' });
      expect(r.fecha).toBeNull();
      expect(r.memoria).toContain('termine el contrato');
    });

    it('si la garantía vence antes que el contrato, manda la garantía', () => {
      const r = proximaRevision({ ...base, garantiaVenceEl: '2026-12-01' });
      expect(r.fecha).toBeNull();
      expect(r.memoria).toContain('venza la garantía');
    });

    it('al que hoy no da apto no se le programa revisión', () => {
      // Ya está en los pendientes del contrato desde el minuto uno: ponerle
      // fecha para volver a confirmar lo mismo es ruido.
      const r = proximaRevision({ ...base, apto: false });
      expect(r.fecha).toBeNull();
      expect(r.memoria).toContain('no da apto');
    });

    it('el 31 de agosto + 6 meses es el 28 de febrero, no el 3 de marzo', () => {
      expect(proximaRevision({ ...base, consultadoEl: '2026-08-31' }).fecha)
        .toBe('2027-02-28');
    });
  });

  // ── El legajo, contra Postgres real ────────────────────────────────────────

  describe('el legajo del contrato', () => {
    let app: INestApplication;
    let inmo: Inmobiliaria;
    let otra: Inmobiliaria;
    let contratoId: string;
    let personaId: string;

    const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
      auth(i.tokens[rol]);
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      await limpiarFixtures();
      app = await crearApp();
      const tk = app.get(TokensService);
      inmo = await crearInmobiliaria('garantes', tk);
      otra = await crearInmobiliaria('garantesvecina', tk);

      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Garantes 100', tipo: 'departamento' }).expect(201);

      const contrato = await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: prop.body.id,
          fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
          montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
        }).expect(201);
      contratoId = contrato.body.id;

      const persona = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Garante', apellido: 'Solidario', docTipo: 'dni', docNumero: '30111222' })
        .expect(201);
      personaId = persona.body.id;
    }, 60_000);

    afterAll(async () => {
      await app?.close();
      await limpiarFixtures();
    });

    async function nuevoGarante(nombre: string) {
      const p = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre, apellido: 'Garante', docTipo: 'dni', docNumero: `${Math.floor(10_000_000 + Math.random() * 80_000_000)}` })
        .expect(201);
      const g = await http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(inmo))
        .send({ personaId: p.body.id }).expect(201);
      return g.body;
    }

    it('el garante arranca sin veredicto, que no es lo mismo que rechazado', () => {
      // `apto: null` y no `false`: uno es "no lo sabemos" y el otro "lo
      // verificamos y no pasa". Confundirlos haría que un legajo sin consultar
      // se vea igual que uno rechazado.
      return http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(inmo))
        .send({ personaId }).expect(201)
        .then((r) => {
          expect(r.body.bcra.apto).toBeNull();
          expect(r.body.bcra.consultado).toBe(false);
          expect(r.body.faltan).toEqual([
            'dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3',
          ]);
          expect(r.body.legajoCompleto).toBe(false);
        });
    });

    it('la misma persona no garantiza dos veces el mismo contrato', async () => {
      // Si no, el mismo respaldo se contaría dos veces para llegar al mínimo.
      await http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(inmo))
        .send({ personaId }).expect(409);
    });

    it('el garante entra como parte del contrato, que es lo que imprime el pre-contrato', async () => {
      // La plantilla lee `contrato_parte`, no `garantia`: un garante que no
      // sale en el contrato no garantiza nada.
      const c = await http().get(`/v1/contratos/${contratoId}`).set(...como(inmo)).expect(200);
      const partes = JSON.stringify(c.body);
      expect(partes).toContain('garante');
    });

    it('subir dos veces el mismo documento reemplaza en vez de duplicar', async () => {
      const g = await nuevoGarante('Dos Veces');
      const datos = png().toString('base64');

      await http().post(`/v1/garantes/${g.id}/documentos`).set(...como(inmo))
        .send({ tipo: 'dni_frente', datos, nombre: 'viejo.png' }).expect(201);
      const r = await http().post(`/v1/garantes/${g.id}/documentos`).set(...como(inmo))
        .send({ tipo: 'dni_frente', datos, nombre: 'nuevo.png' }).expect(201);

      const frentes = r.body.documentos.filter((d: { tipo: string }) => d.tipo === 'dni_frente');
      expect(frentes).toHaveLength(1);
      expect(frentes[0].nombreOriginal).toBe('nuevo.png');
      expect(r.body.faltan).not.toContain('dni_frente');
    });

    it('el legajo está completo con las dos caras del DNI y los tres recibos', async () => {
      const g = await nuevoGarante('Completo');
      const datos = png().toString('base64');

      let ultimo = g;
      for (const tipo of ['dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3']) {
        const r = await http().post(`/v1/garantes/${g.id}/documentos`).set(...como(inmo))
          .send({ tipo, datos }).expect(201);
        ultimo = r.body;
      }

      expect(ultimo.faltan).toEqual([]);
      expect(ultimo.legajoCompleto).toBe(true);
      expect(ultimo.documentos).toHaveLength(5);
    });

    it('la verificación dice qué falta, en castellano', async () => {
      const r = await http().get(`/v1/contratos/${contratoId}/garantes/verificacion`)
        .set(...como(inmo)).expect(200);

      expect(r.body.minimo).toBe(2);
      expect(r.body.enRegla).toBe(false);
      // Nadie firmó ni se consultó el BCRA todavía: eso tiene que estar dicho.
      expect(r.body.pendientes.join(' ')).toContain('falta consultar el BCRA');
      expect(r.body.pendientes.join(' ')).toContain('todavía no firmó');
    });

    it('sin documento cargado no hay a quién consultar, y se dice', async () => {
      const p = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Sin', apellido: 'Documento' }).expect(201);
      const g = await http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(inmo))
        .send({ personaId: p.body.id }).expect(201);

      const r = await http().post(`/v1/garantes/${g.body.id}/bcra`).set(...como(inmo))
        .expect(422);
      expect(r.body.detail).toContain('no tiene documento cargado');
    });

    it('el asesor arma la carpeta; borrar un garante es de titular y administración', async () => {
      const g = await nuevoGarante('De Permisos');

      await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo, 'agente'))
        .send({ firmoEl: '2026-02-01' }).expect(200);
      await http().delete(`/v1/garantes/${g.id}`).set(...como(inmo, 'agente')).expect(403);
      await http().delete(`/v1/garantes/${g.id}`).set(...como(inmo, 'owner')).expect(204);
    });

    it('cero fuga: la vecina no ve los garantes de un contrato ajeno', async () => {
      const r = await http().get(`/v1/contratos/${contratoId}/garantes`)
        .set(...como(otra)).expect(200);
      expect(r.body).toHaveLength(0);
    });
  });

  // ── La revisión periódica, el historial y el WhatsApp ──────────────────────

  describe('volver a mirar al garante', () => {
    let app: INestApplication;
    let inmo: Inmobiliaria;
    let otra: Inmobiliaria;
    let deudores: DeudoresService;
    let contratoId: string;

    const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
      auth(i.tokens[rol]);
    const http = () => request(app.getHttpServer());

    /** Para tocar `bcra_revisar_el` y las fechas del historial, que no tienen endpoint. */
    async function sql<T extends object>(texto: string, params: unknown[] = []): Promise<T[]> {
      const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
      await c.connect();
      try {
        const { rows } = await c.query<T>(texto, params);
        return rows;
      } finally {
        await c.end();
      }
    }

    beforeAll(async () => {
      await limpiarFixtures();
      app = await crearApp();
      const tk = app.get(TokensService);
      inmo = await crearInmobiliaria('revision', tk);
      otra = await crearInmobiliaria('revisionvecina', tk);
      deudores = app.get(DeudoresService);

      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Revisión 200', tipo: 'casa' }).expect(201);

      // Tres años: es el largo que hace que la revisión periódica tenga sentido
      // y el que motiva toda esta parte. Fechas relativas para que el test no
      // envejezca.
      const contrato = await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: prop.body.id,
          fechaInicio: aMeses(-1), fechaFin: aMeses(35),
          montoInicial: 500000, moneda: 'ARS', indice: 'ninguno',
        }).expect(201);
      contratoId = contrato.body.id;
    }, 60_000);

    afterAll(async () => {
      jest.restoreAllMocks();
      await app?.close();
      await limpiarFixtures();
    });

    async function nuevoGarante(nombre: string, telefono?: string | null) {
      const p = await http().post('/v1/personas').set(...como(inmo))
        .send({
          nombre, apellido: 'Revisado', docTipo: 'dni',
          docNumero: `${Math.floor(10_000_000 + Math.random() * 80_000_000)}`,
          ...(telefono ? { telefono } : {}),
        }).expect(201);
      const g = await http().post(`/v1/contratos/${contratoId}/garantes`).set(...como(inmo))
        .send({ personaId: p.body.id }).expect(201);
      return g.body;
    }

    it('el WhatsApp sale armado del teléfono de la ficha', async () => {
      const g = await nuevoGarante('Con Teléfono', '0261 15 555-1234');
      expect(g.telefono).toBe('0261 15 555-1234');
      expect(g.whatsapp.numero).toBe('5492615551234');
      expect(g.whatsapp.motivo).toBeNull();
    });

    it('sin teléfono viene el motivo y NO un número a medias', async () => {
      // La pantalla deshabilita el botón con este texto. Un wa.me incompleto no
      // falla: abre el chat de otra persona.
      const g = await nuevoGarante('Sin Teléfono');
      expect(g.whatsapp.numero).toBeNull();
      expect(g.whatsapp.motivo).toContain('No tiene teléfono cargado');
    });

    it('«Vence el» se guarda, y mandando null se borra', async () => {
      // Es la única fecha que se puede borrar: sobre ella dispara un
      // recordatorio, y una fecha mal tipeada que no se puede sacar deja
      // avisando para siempre.
      const g = await nuevoGarante('Con Vencimiento');

      const puesto = await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo))
        .send({ venceEl: '2027-05-10' }).expect(200);
      expect(puesto.body.venceEl).toBe('2027-05-10');

      // Un PATCH que no manda `venceEl` no lo pisa: es la regla del coalesce.
      const otroCampo = await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo))
        .send({ detalle: 'Cambió el detalle' }).expect(200);
      expect(otroCampo.body.venceEl).toBe('2027-05-10');

      const borrado = await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo))
        .send({ venceEl: null }).expect(200);
      expect(borrado.body.venceEl).toBeNull();
    });

    it('la consulta guarda el veredicto, los cheques y la próxima revisión', async () => {
      const g = await nuevoGarante('Primera Consulta', '261 555-1234');

      jest.spyOn(deudores, 'consultar').mockResolvedValue(veredictoFalso());
      jest.spyOn(deudores, 'consultarCheques').mockResolvedValue(
        chequesFalsos({
          ...evaluarCheques([{
            causal: 'SIN FONDOS',
            entidades: [{ entidad: 11, detalle: [
              { nroCheque: 20377148, fechaRechazo: '2026-03-15', monto: 115000, fechaPago: null },
            ] }],
          }]),
        }),
      );

      const r = await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(201);

      expect(r.body.bcra.apto).toBe(true);
      // En pesos, no en miles: 115.000 y no 115.000.000.
      expect(r.body.bcra.cheques.montoTotal).toBe(115000);
      expect(r.body.bcra.cheques.sinPagar).toBe(1);
      expect(r.body.bcra.chequesError).toBeNull();
      // Contrato de 36 meses ⇒ hay revisión, y con su memoria de cálculo.
      expect(r.body.bcra.revisarEl).not.toBeNull();
      expect(r.body.bcra.revisionMemoria).toContain('cada 6 meses');
      expect(r.body.bcra.revisionVencida).toBe(false);
      expect(r.body.bcra.historial.consultas).toBe(1);
    });

    it('la SEGUNDA consulta no pisa a la primera: la que respaldó la firma queda', async () => {
      // Es la razón de ser de la tabla de historial. Si la revisión de junio
      // sobrescribiera el veredicto de enero, «por qué lo aceptamos» se queda
      // sin respuesta justo cuando alguien la necesita.
      const g = await nuevoGarante('Dos Consultas', '261 555-9999');

      jest.spyOn(deudores, 'consultar').mockResolvedValue(veredictoFalso());
      jest.spyOn(deudores, 'consultarCheques').mockResolvedValue(chequesFalsos());
      await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(201);

      // La primera se atrasa seis meses: es la que firmó el contrato.
      await sql(
        `UPDATE garantia_bcra_consulta SET consultado_el = now() - interval '6 months'
          WHERE garantia_id = $1`,
        [g.id],
      );

      // Y hoy el garante está peor.
      jest.spyOn(deudores, 'consultar').mockResolvedValue(
        veredictoFalso({
          apto: false, peorSituacion: 3,
          motivo: 'Situación 3 (riesgo medio) en BANCO FEO. Sólo se aceptan garantes en situación 1.',
          entidades: [{
            entidad: 'BANCO FEO', situacion: 3, monto: 900000, diasAtrasoPago: 90,
            refinanciaciones: false, situacionJuridica: false, procesoJud: false, enRevision: false,
          }],
        }),
      );
      const r = await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(201);

      expect(r.body.bcra.historial.consultas).toBe(2);
      expect(r.body.bcra.historial.primera.apto).toBe(true);
      expect(r.body.bcra.historial.primera.situacion).toBe(1);
      expect(r.body.bcra.historial.ultima.apto).toBe(false);
      expect(r.body.bcra.historial.ultima.situacion).toBe(3);
      // Y el cache de `garantia` muestra la de hoy, que es la que decide.
      expect(r.body.bcra.apto).toBe(false);
      // Al que ya no da apto no se le programa una revisión para confirmarlo.
      expect(r.body.bcra.revisarEl).toBeNull();
    });

    it('si fallan los cheques, el veredicto de deudas se guarda igual y se dice', async () => {
      // Tirar una consulta de deudas que salió bien porque el segundo endpoint
      // devolvió 429 sería perder el dato que importa por el que acompaña.
      const g = await nuevoGarante('Cheques Caídos', '261 555-8888');

      jest.spyOn(deudores, 'consultar').mockResolvedValue(veredictoFalso());
      jest.spyOn(deudores, 'consultarCheques').mockResolvedValue(null);

      const r = await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(201);
      expect(r.body.bcra.apto).toBe(true);
      expect(r.body.bcra.consultado).toBe(true);
      expect(r.body.bcra.cheques).toBeNull();
      expect(r.body.bcra.chequesError).toContain('cheques rechazados');
    });

    it('sin deudas NO hay veredicto: la consulta entera se descarta', async () => {
      const g = await nuevoGarante('BCRA Caído', '261 555-7777');
      jest.spyOn(deudores, 'consultar').mockResolvedValue(null);

      await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(503);

      const leido = await http().get(`/v1/contratos/${contratoId}/garantes`)
        .set(...como(inmo)).expect(200);
      const suyo = leido.body.find((x: { id: string }) => x.id === g.id);
      expect(suyo.bcra.consultado).toBe(false);
      expect(suyo.bcra.historial.consultas).toBe(0);
    });

    it('la revisión vencida entra en los pendientes del contrato, y no bloquea', async () => {
      const g = await nuevoGarante('Revisión Vieja', '261 555-6666');
      jest.spyOn(deudores, 'consultar').mockResolvedValue(veredictoFalso());
      jest.spyOn(deudores, 'consultarCheques').mockResolvedValue(chequesFalsos());
      await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo)).expect(201);

      await sql(
        "UPDATE garantia SET bcra_revisar_el = current_date - 10 WHERE id = $1",
        [g.id],
      );

      const leido = await http().get(`/v1/contratos/${contratoId}/garantes`)
        .set(...como(inmo)).expect(200);
      const suyo = leido.body.find((x: { id: string }) => x.id === g.id);
      expect(suyo.bcra.revisionVencida).toBe(true);
      // Sigue siendo apto: lo que hay es un dato viejo, no un rechazo.
      expect(suyo.bcra.apto).toBe(true);

      const v = await http().get(`/v1/contratos/${contratoId}/garantes/verificacion`)
        .set(...como(inmo)).expect(200);
      expect(v.body.pendientes.join(' ')).toContain('la revisión del BCRA venció');
    });

    it('quitar un garante cancela sus avisos', async () => {
      // `evento_programado.entidad_id` no es una FK: el CASCADE no lo alcanza y
      // la bandeja seguiría pidiendo revisar el BCRA de alguien que ya no está.
      const g = await nuevoGarante('Con Avisos', '261 555-5555');
      await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo))
        .send({ venceEl: aDias(40) }).expect(200);
      await http().post('/v1/avisos/generar').set(...como(inmo)).expect(201);

      const antes = await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM evento_programado
          WHERE entidad_id = $1 AND estado = 'pendiente'`,
        [g.id],
      );
      expect(Number(antes[0].n)).toBeGreaterThan(0);

      await http().delete(`/v1/garantes/${g.id}`).set(...como(inmo)).expect(204);

      const despues = await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM evento_programado
          WHERE entidad_id = $1 AND estado = 'pendiente'`,
        [g.id],
      );
      expect(Number(despues[0].n)).toBe(0);
    });

    it('el contable no consulta el BCRA: mira, no toca', async () => {
      const g = await nuevoGarante('De Permisos BCRA', '261 555-4444');
      await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(inmo, 'contable')).expect(403);
      await http().patch(`/v1/garantes/${g.id}`).set(...como(inmo, 'contable'))
        .send({ venceEl: '2027-01-01' }).expect(403);
    });

    it('cero fuga: la vecina no puede consultar ni tocar un garante ajeno', async () => {
      const g = await nuevoGarante('Ajeno', '261 555-3333');
      jest.spyOn(deudores, 'consultar').mockResolvedValue(veredictoFalso());
      jest.spyOn(deudores, 'consultarCheques').mockResolvedValue(chequesFalsos());

      await http().post(`/v1/garantes/${g.id}/bcra`).set(...como(otra)).expect(404);
      await http().patch(`/v1/garantes/${g.id}`).set(...como(otra))
        .send({ venceEl: '2027-01-01' }).expect(404);
      await http().delete(`/v1/garantes/${g.id}`).set(...como(otra)).expect(404);

      // Y el historial tampoco se filtra por la puerta de atrás.
      const filas = await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM garantia_bcra_consulta WHERE tenant_id = $1`,
        [otra.tenantId],
      );
      expect(Number(filas[0].n)).toBe(0);
    });
  });
});
