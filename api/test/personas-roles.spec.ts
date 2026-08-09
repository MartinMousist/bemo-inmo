import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
import { ROLES_PERSONA } from '../src/personas/personas.service';

/**
 * Personas por rol: los seis roles derivados, el filtro y los conteos.
 *
 * Lo que este archivo defiende, en una línea: **el chip de la tabla, el filtro
 * de la pestaña y el número de la pestaña salen de la misma definición y no se
 * pueden contradecir.** Los tres se calculan con consultas distintas contra
 * `CONJUNTO_ROL`, y el día que alguien toque una sola, uno de estos tests cae.
 *
 * Los fixtures de las relaciones se cargan por SQL con el rol OWNER, que
 * **saltea RLS**: por eso cada INSERT lleva su `tenant_id` explícito. Es la
 * misma regla que el seed tiene escrita después de marcar como pagadas siete
 * cuotas de una inmobiliaria ajena.
 */
describe('Personas por rol', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  /** Los ids de las personas de prueba, por apodo. */
  const gente: Record<string, string> = {};
  let contratoId = '';
  let propiedadId = '';

  const http = () => request(app.getHttpServer());
  const como = (i: Inmobiliaria, rol: 'owner' | 'agente' = 'owner') =>
    auth(i.tokens[rol]);

  async function sql<T extends Record<string, unknown>>(
    texto: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<T>(texto, params);
      return rows;
    } finally {
      await c.end();
    }
  }

  let doc = 30_000_000;
  async function persona(apodo: string, i: Inmobiliaria = inmo): Promise<string> {
    const r = await http()
      .post('/v1/personas')
      .set(...como(i))
      .send({ nombre: apodo, apellido: 'DePrueba', docTipo: 'dni', docNumero: `${doc++}` })
      .expect(201);
    if (i === inmo) gente[apodo] = r.body.id;
    return r.body.id;
  }

  /** Una operación de venta viva sobre la propiedad, para colgarle comprador. */
  async function operacionVenta(tenantId: string, propId: string): Promise<string> {
    const [op] = await sql<{ id: string }>(
      `INSERT INTO operacion (tenant_id, propiedad_id, tipo, estado, precio, moneda)
       VALUES ($1, $2, 'venta', 'disponible', 120000, 'USD') RETURNING id`,
      [tenantId, propId],
    );
    return op.id;
  }

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('roles', tk);
    otra = await crearInmobiliaria('rolesvecina', tk);

    const prop = await http()
      .post('/v1/propiedades')
      .set(...como(inmo))
      .send({ calle: 'Roles 100', tipo: 'departamento' })
      .expect(201);
    propiedadId = prop.body.id;

    const contrato = await http()
      .post('/v1/contratos')
      .set(...como(inmo))
      .send({
        propiedadId,
        fechaInicio: '2025-01-01',
        fechaFin: '2028-01-01',
        montoInicial: 300000,
        moneda: 'ARS',
        indice: 'ipc',
        mesBase: '2025-01-01',
      })
      .expect(201);
    contratoId = contrato.body.id;

    // ── Una persona por rol, y los bordes que importan ──────────────────────
    await persona('propietaria');
    await persona('inquilina');
    await persona('garanteParte');
    await persona('garanteSoloGarantia');
    await persona('garanteEnLasDos');
    await persona('compradora');
    await persona('compradoraCaida');
    await persona('interesada');
    await persona('reservante');
    await persona('reservaConvertida');
    await persona('tresRoles');
    await persona('sinNingunRol');

    const t = inmo.tenantId;

    // propietario ← titularidad. `tresRoles` comparte la propiedad al 50/50
    // porque el trigger `titularidad_suma_100` exige que sume exactamente 100.
    await sql(
      `INSERT INTO titularidad (tenant_id, propiedad_id, persona_id, porcentaje)
       VALUES ($1, $2, $3, 50), ($1, $2, $4, 50)`,
      [t, propiedadId, gente.propietaria, gente.tresRoles],
    );

    // inquilino ← contrato_parte rol locatario
    await sql(
      `INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol)
       VALUES ($1, $2, $3, 'locatario'), ($1, $2, $4, 'locatario')`,
      [t, contratoId, gente.inquilina, gente.tresRoles],
    );

    // garante ← LAS DOS FUENTES, cada una por separado y las dos juntas.
    await sql(
      `INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol)
       VALUES ($1, $2, $3, 'garante'), ($1, $2, $4, 'fiador')`,
      [t, contratoId, gente.garanteParte, gente.garanteEnLasDos],
    );
    await sql(
      `INSERT INTO garantia (tenant_id, contrato_id, persona_id, tipo)
       VALUES ($1, $2, $3, 'garante_solidario'), ($1, $2, $4, 'garante_solidario')`,
      [t, contratoId, gente.garanteSoloGarantia, gente.garanteEnLasDos],
    );

    // comprador ← operacion_venta, una viva y una caída.
    const opViva = await operacionVenta(t, propiedadId);
    await sql(
      `INSERT INTO operacion_venta
         (tenant_id, operacion_id, comprador_id, precio_cierre, moneda, estado)
       VALUES ($1, $2, $3, 100000, 'USD', 'boleto')`,
      [t, opViva, gente.compradora],
    );
    // La caída va sobre OTRA operación: `ix_venta_viva` es unique por operación
    // mientras el estado no sea 'caida'.
    const opCaida = await operacionVenta(t, propiedadId).catch(() => null);
    const opParaCaida =
      opCaida ??
      (
        await sql<{ id: string }>(
          `INSERT INTO operacion (tenant_id, propiedad_id, tipo, estado, precio, moneda)
           VALUES ($1, $2, 'alquiler', 'cerrada', 1, 'ARS') RETURNING id`,
          [t, propiedadId],
        )
      )[0].id;
    await sql(
      `INSERT INTO operacion_venta
         (tenant_id, operacion_id, comprador_id, precio_cierre, moneda, estado, motivo_caida)
       VALUES ($1, $2, $3, 90000, 'USD', 'caida', 'No consiguió el crédito')`,
      [t, opParaCaida, gente.compradoraCaida],
    );

    // interesado ← oportunidad
    await sql(
      `INSERT INTO oportunidad (tenant_id, persona_id, origen, estado)
       VALUES ($1, $2, 'web', 'nueva'), ($1, $3, 'web', 'nueva')`,
      [t, gente.interesada, gente.tresRoles],
    );

    // reservante ← reserva ACTIVA. La convertida no cuenta.
    const opReserva = (
      await sql<{ id: string }>(
        `INSERT INTO operacion (tenant_id, propiedad_id, tipo, estado, precio, moneda)
         VALUES ($1, $2, 'venta', 'cerrada', 50000, 'USD') RETURNING id`,
        [t, propiedadId],
      )
    )[0].id;
    await sql(
      `INSERT INTO reserva (tenant_id, operacion_id, persona_id, monto, moneda, estado)
       VALUES ($1, $2, $3, 5000, 'USD', 'activa')`,
      [t, opReserva, gente.reservante],
    );
    const opReserva2 = (
      await sql<{ id: string }>(
        `INSERT INTO operacion (tenant_id, propiedad_id, tipo, estado, precio, moneda)
         VALUES ($1, $2, 'venta', 'cerrada', 60000, 'USD') RETURNING id`,
        [t, propiedadId],
      )
    )[0].id;
    await sql(
      `INSERT INTO reserva (tenant_id, operacion_id, persona_id, monto, moneda, estado)
       VALUES ($1, $2, $3, 6000, 'USD', 'convertida')`,
      [t, opReserva2, gente.reservaConvertida],
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  /** Los roles derivados de una persona del fixture. */
  async function rolesDe(apodo: string): Promise<string[]> {
    const r = await http()
      .get(`/v1/personas/${gente[apodo]}`)
      .set(...como(inmo))
      .expect(200);
    return r.body.roles;
  }

  // ── Los seis roles, cada uno desde su fuente ────────────────────────────────

  describe('los seis roles se derivan de su relación', () => {
    it('propietario sale de una titularidad', async () => {
      expect(await rolesDe('propietaria')).toEqual(['propietario']);
    });

    it('inquilino sale de contrato_parte con rol locatario', async () => {
      expect(await rolesDe('inquilina')).toEqual(['inquilino']);
    });

    it('comprador sale de operacion_venta', async () => {
      expect(await rolesDe('compradora')).toEqual(['comprador']);
    });

    it('interesado sale de una oportunidad', async () => {
      expect(await rolesDe('interesada')).toEqual(['interesado']);
    });

    it('reservante sale de una reserva activa', async () => {
      expect(await rolesDe('reservante')).toEqual(['reservante']);
    });

    it('quien no tiene ninguna relación no tiene ningún rol', async () => {
      // Y el array viene vacío, no `null`: la pantalla itera sobre él.
      expect(await rolesDe('sinNingunRol')).toEqual([]);
    });

    it('una persona con tres relaciones trae los tres roles', async () => {
      const roles = await rolesDe('tresRoles');
      // Ordenados para comparar: el orden del array lo fija `ROLES_PERSONA` y
      // no es lo que este test afirma.
      expect([...roles].sort()).toEqual(['inquilino', 'interesado', 'propietario']);
    });
  });

  // ── El borde que se pierde si se mira una sola fuente ───────────────────────

  describe('garante tiene DOS fuentes', () => {
    it('un garante cargado sólo en contrato_parte aparece', async () => {
      expect(await rolesDe('garanteParte')).toEqual(['garante']);
    });

    it('un garante cargado SÓLO en garantia también aparece', async () => {
      // Este es el que se pierde si el servicio mira nada más contrato_parte:
      // la 018 le dio a la garantía legajo, documentos y veredicto del BCRA
      // propios, y un contrato viejo puede tener la garantía sin la parte. La
      // pestaña mostraría menos garantes de los que hay y el número se vería
      // razonable — el mismo patrón por el que el árbol de comisiones del seed
      // estuvo mal en diez de once ventas sin que nadie lo notara.
      expect(await rolesDe('garanteSoloGarantia')).toEqual(['garante']);
    });

    it('estar en las dos fuentes NO duplica el chip', async () => {
      expect(await rolesDe('garanteEnLasDos')).toEqual(['garante']);
    });
  });

  // ── Los estados que sacan a alguien de un rol ───────────────────────────────

  describe('el estado de la operación decide', () => {
    it('una venta caída NO deja comprador a nadie', async () => {
      // Se cayó: la persona vuelve a ser alguien que quiso comprar, no alguien
      // que compró. Mismo criterio con el que `reservante` exige 'activa'.
      expect(await rolesDe('compradoraCaida')).toEqual([]);
    });

    it('una reserva convertida ya no deja reservante', async () => {
      expect(await rolesDe('reservaConvertida')).toEqual([]);
    });
  });

  // ── El test que impide que la pestaña y el paginador se contradigan ─────────

  describe('el filtro por rol y el conteo dicen lo mismo', () => {
    it('para cada uno de los seis roles, total del listado == conteo', async () => {
      const conteo = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);

      for (const rol of ROLES_PERSONA) {
        const lista = await http()
          .get(`/v1/personas?rol=${rol}&porPagina=100`)
          .set(...como(inmo))
          .expect(200);

        expect({ rol, total: lista.body.total }).toEqual({
          rol,
          total: conteo.body[rol],
        });

        // Y además: cada fila que vuelve TIENE ese rol. Un filtro que devuelve
        // el número correcto con las filas equivocadas suma igual.
        for (const p of lista.body.items) expect(p.roles).toContain(rol);
      }
    });

    it('`todas` es el total del tenant, no la suma de los roles', async () => {
      const c = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);
      const lista = await http()
        .get('/v1/personas?porPagina=100')
        .set(...como(inmo))
        .expect(200);

      expect(c.body.todas).toBe(lista.body.total);
      // Una persona con tres roles cuenta en los tres: la suma da MÁS que el
      // total, y está bien que dé más.
      const suma = ROLES_PERSONA.reduce((a, r) => a + c.body[r], 0);
      expect(suma).toBeGreaterThan(0);
    });

    it('el buscador filtra la lista pero NO cambia el conteo de las pestañas', async () => {
      // Es la decisión de producto escrita en `conteoPorRol()`: la pestaña
      // cuenta el alcance, la bajada cuenta lo filtrado. Si alguien mete el
      // ILIKE adentro del conteo, este test cae y el comentario explica por qué
      // no hay que "arreglarlo".
      const sinQ = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);

      const filtrada = await http()
        .get('/v1/personas?rol=propietario&q=propietaria')
        .set(...como(inmo))
        .expect(200);

      expect(filtrada.body.total).toBeLessThan(sinQ.body.propietario);
      expect(sinQ.body.propietario).toBeGreaterThan(1);
    });

    it('el conteo del paginador lleva el mismo WHERE que la página', async () => {
      // El bug clásico: el pager dice 40 y la tabla muestra 12 porque el filtro
      // entró en una sola de las dos consultas.
      const r = await http()
        .get('/v1/personas?rol=garante&porPagina=2')
        .set(...como(inmo))
        .expect(200);
      expect(r.body.items).toHaveLength(2);
      expect(r.body.total).toBe(3);
      expect(r.body.paginas).toBe(2);
    });
  });

  // ── Denegaciones ───────────────────────────────────────────────────────────

  describe('denegaciones', () => {
    it('sin sesión, el listado da 401', async () => {
      await http().get('/v1/personas').expect(401);
    });

    it('sin sesión, los conteos dan 401', async () => {
      await http().get('/v1/personas/conteo-roles').expect(401);
    });

    it('un rol que no existe da 400 con el mensaje en castellano', async () => {
      // `locador` a propósito: es una parte real de un contrato y NO es un rol
      // derivado, así que es el valor que alguien va a probar.
      const r = await http()
        .get('/v1/personas?rol=locador')
        .set(...como(inmo))
        .expect(400);

      expect(r.body.detail).toBe('El campo «rol» no es válido.');
      expect(r.body.detail).not.toContain('Bad Request');
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });

    it('«conteo-roles» no se lee como un uuid', async () => {
      // Si el endpoint quedara declarado DESPUÉS de `@Get(':id')`, el
      // ParseUUIDPipe se comería la ruta y devolvería 400.
      await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);
    });
  });

  // ── Aislamiento entre inmobiliarias ────────────────────────────────────────

  describe('aislamiento entre inmobiliarias', () => {
    it('el listado de una no trae personas de la otra', async () => {
      await persona('deLaVecina', otra);

      const mias = await http()
        .get('/v1/personas?porPagina=100')
        .set(...como(inmo))
        .expect(200);

      expect(mias.body.items.map((p: { nombre: string }) => p.nombre)).not.toContain(
        'deLaVecina',
      );
    });

    it('los CONTEOS de una no cuentan a los de la otra', async () => {
      // Lo que se olvida: una consulta de agregación mal escrita —un JOIN sin
      // el filtro de tenant, o un count sobre una tabla que RLS no está
      // filtrando— suma callada y nadie lo ve, porque el número que sale sigue
      // pareciendo razonable.
      const mios = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);
      const suyos = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(otra))
        .expect(200);

      expect(mios.body.propietario).toBeGreaterThan(0);
      // La vecina no tiene ni una titularidad, ni un contrato, ni una venta.
      expect(suyos.body).toEqual({
        todas: suyos.body.todas,
        propietario: 0,
        inquilino: 0,
        garante: 0,
        comprador: 0,
        interesado: 0,
        reservante: 0,
      });
    });

    it('el filtro por rol tampoco cruza inmobiliarias', async () => {
      const r = await http()
        .get('/v1/personas?rol=garante&porPagina=100')
        .set(...como(otra))
        .expect(200);
      expect(r.body.total).toBe(0);
      expect(r.body.items).toEqual([]);
    });
  });

  // ── Las tres pantallas ─────────────────────────────────────────────────────

  describe('pantalla Inquilinos', () => {
    it('la fila es el CONTRATO y trae su inquilino', async () => {
      const r = await http()
        .get('/v1/inquilinos')
        .set(...como(inmo))
        .expect(200);

      const fila = r.body.items.find(
        (f: { contratoId: string }) => f.contratoId === contratoId,
      );
      expect(fila).toBeDefined();
      expect(fila.moneda).toBe('ARS');
      // Fechas de columnas `date`: texto AAAA-MM-DD, sin correrse un día.
      expect(fila.desde).toBe('2025-01-01');
      expect(fila.hasta).toBe('2028-01-01');
      expect(fila.alquilerVigente).toBe(300000);
      expect(fila.garantes).toEqual({ cargados: 2, minimo: 2 });
    });

    it('devuelve también cuántas PERSONAS alquilaron, que es otro número', async () => {
      // Es la diferencia que la pantalla tiene que explicar: la pestaña cuenta
      // personas, esta lista cuenta contratos vigentes.
      const r = await http()
        .get('/v1/inquilinos')
        .set(...como(inmo))
        .expect(200);
      expect(r.body.personasQueAlquilaron).toBe(2);
    });

    it('sin sesión da 401', async () => {
      await http().get('/v1/inquilinos').expect(401);
    });

    it('no cruza inmobiliarias', async () => {
      const r = await http()
        .get('/v1/inquilinos')
        .set(...como(otra))
        .expect(200);
      expect(r.body.total).toBe(0);
    });
  });

  describe('pantalla Propietarios', () => {
    it('la fila es la PERSONA, con sus unidades y su porcentaje', async () => {
      const r = await http()
        .get('/v1/propietarios')
        .set(...como(inmo))
        .expect(200);

      const fila = r.body.items.find(
        (f: { personaId: string }) => f.personaId === gente.propietaria,
      );
      expect(fila).toBeDefined();
      expect(fila.unidades).toHaveLength(1);
      // 50 se muestra porque NO es 100. Un «100%» en cada fila es ruido.
      expect(fila.unidades[0].porcentaje).toBe(50);
      expect(fila.mesesSinLiquidar).toBeNull();
      expect(fila.ultimasLiquidaciones).toEqual([]);
    });

    it('lista exactamente a los que tienen el rol propietario', async () => {
      const lista = await http()
        .get('/v1/propietarios?porPagina=100')
        .set(...como(inmo))
        .expect(200);
      const conteo = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);
      expect(lista.body.total).toBe(conteo.body.propietario);
    });

    it('la última liquidación viene POR MONEDA, no colapsada', async () => {
      // La unique de `liquidacion` es (tenant, propietario, período, moneda):
      // un propietario con unidades en pesos y en dólares tiene DOS últimas
      // liquidaciones del mismo mes. Devolver una sola —o sumarlas— es un monto
      // sin moneda en una pantalla de plata.
      await sql(
        `INSERT INTO liquidacion
           (tenant_id, propietario_id, periodo, moneda, estado, total_neto)
         VALUES ($1, $2, '2026-07-01', 'ARS', 'cerrada', 150000),
                ($1, $2, '2026-07-01', 'USD', 'cerrada', 800)`,
        [inmo.tenantId, gente.propietaria],
      );

      const r = await http()
        .get('/v1/propietarios?porPagina=100')
        .set(...como(inmo))
        .expect(200);
      const fila = r.body.items.find(
        (f: { personaId: string }) => f.personaId === gente.propietaria,
      );

      expect(fila.ultimasLiquidaciones).toHaveLength(2);
      expect(fila.ultimasLiquidaciones.map((l: { moneda: string }) => l.moneda)).toEqual([
        'ARS',
        'USD',
      ]);
      expect(fila.pendiente).toEqual([
        { moneda: 'ARS', monto: 150000 },
        { moneda: 'USD', monto: 800 },
      ]);
      // Y el período es texto AAAA-MM-DD, sin haber pasado por `new Date()`.
      expect(fila.ultimasLiquidaciones[0].periodo).toBe('2026-07-01');
    });

    it('sin sesión da 401', async () => {
      await http().get('/v1/propietarios').expect(401);
    });

    it('no cruza inmobiliarias', async () => {
      const r = await http()
        .get('/v1/propietarios')
        .set(...como(otra))
        .expect(200);
      expect(r.body.total).toBe(0);
    });
  });

  describe('pantalla Garantes', () => {
    it('la fila es la GARANTÍA, con su contrato y su propiedad', async () => {
      const r = await http()
        .get('/v1/garantes?estado=todos&porPagina=100')
        .set(...como(inmo))
        .expect(200);

      expect(r.body.total).toBe(2);
      const g = r.body.items[0];
      expect(g.contrato.id).toBe(contratoId);
      expect(g.propiedad.etiqueta).toMatch(/^PROP-\d{4}$/);
      // El veredicto es derivado y sin consulta no hay veredicto: `null` no es
      // `false`. Uno es «no lo sabemos», el otro «lo miramos y no pasa».
      expect(g.bcra.consultado).toBe(false);
      expect(g.bcra.apto).toBeNull();
    });

    it('por defecto muestra los que NECESITAN algo', async () => {
      // Las dos garantías del fixture están sin documentos y sin firmar, así
      // que las dos necesitan algo. El default no es «todos» a propósito: la
      // pregunta de esta pantalla es qué carpeta falta.
      const r = await http()
        .get('/v1/garantes')
        .set(...como(inmo))
        .expect(200);
      expect(r.body.total).toBe(2);

      const aptos = await http()
        .get('/v1/garantes?estado=aptos')
        .set(...como(inmo))
        .expect(200);
      expect(aptos.body.total).toBe(0);
    });

    it('sin sesión da 401', async () => {
      await http().get('/v1/garantes').expect(401);
    });

    it('no cruza inmobiliarias', async () => {
      const r = await http()
        .get('/v1/garantes?estado=todos')
        .set(...como(otra))
        .expect(200);
      expect(r.body.total).toBe(0);
    });
  });

  // ── El CSV respeta el filtro que está en pantalla ──────────────────────────

  describe('exportar', () => {
    it('el CSV de personas filtrado por rol exporta ESE rol', async () => {
      const conteo = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);

      const csv = await http()
        .get('/v1/exportar/personas.csv?rol=propietario')
        .set(...como(inmo))
        .expect(200);

      // Encabezado + una fila por propietario. Un botón «Exportar» al lado de
      // la pestaña Propietarios que baje todas las personas no falla: devuelve
      // un archivo que parece bien y no es el que se pidió.
      const filas = csv.text.trim().split('\n').length - 1;
      expect(filas).toBe(conteo.body.propietario);
      expect(csv.text).toContain('Roles');
    });

    it('sin filtro exporta todas', async () => {
      const csv = await http()
        .get('/v1/exportar/personas.csv')
        .set(...como(inmo))
        .expect(200);
      const conteo = await http()
        .get('/v1/personas/conteo-roles')
        .set(...como(inmo))
        .expect(200);
      expect(csv.text.trim().split('\n').length - 1).toBe(conteo.body.todas);
    });

    it('un recurso que sólo existe en la cadena de prototipos da 404, no 500', async () => {
      // `RECURSOS['constructor']` devolvía una FUNCIÓN, pasaba el chequeo de
      // «no existe» y reventaba con un 500 en `ej.query(undefined)`.
      await http()
        .get('/v1/exportar/constructor.csv')
        .set(...como(inmo))
        .expect(404);
    });
  });
});
