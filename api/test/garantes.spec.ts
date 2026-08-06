import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { deflateSync, crc32 } from 'node:zlib';
import { TokensService } from '../src/auth/tokens.service';
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
} from '../src/garantes/situacion.motor';

/**
 * Garantes: el legajo, los documentos y el veredicto del BCRA.
 *
 * **Ningún test de acá sale a internet.** La regla que decide si a alguien se
 * le alquila vive en `situacion.motor.ts`, que es puro, y se prueba con las
 * respuestas que la API real devuelve —el contrato quedó verificado a mano el
 * 2026-08-06—. Un test que consultara la Central de Deudores de verdad
 * dependería de que el BCRA esté arriba y, peor, tendría que usar el documento
 * de una persona real para dar algo distinto de "sin deudas".
 */

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
});
