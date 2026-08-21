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

/**
 * Etapa 9 — planes y límites.
 *
 * Lo único que importa acá: **los límites se APLICAN**. Un plan que sólo existe
 * en la pantalla de precios es un cartel, no un plan.
 */
describe('Planes, límites y API', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('planes', app.get(TokensService));
    await ponerPlan(inmo.tenantId, 'inmo_medio');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Cambia el plan por SQL: no hay endpoint para autoasignarse un plan. */
  async function ponerPlan(tenantId: string, plan: string) {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query(
        `INSERT INTO suscripcion (tenant_id, plan_codigo) VALUES ($1,$2)
         ON CONFLICT (tenant_id) DO UPDATE SET plan_codigo = $2`,
        [tenantId, plan],
      );
    } finally {
      await c.end();
    }
  }

  /**
   * Cambia el tope del plan Inmobiliaria · Básico y devuelve el que había.
   *
   * Devuelve el anterior en vez de que el `finally` restaure una constante: la
   * primera versión restauraba un 100 escrito a mano y el día que el plan pasó
   * a 150, este test dejó el tope en 100 y rompió a OTRO test del mismo archivo.
   * Pasaba solo y fallaba en la suite completa.
   */
  async function topeDePropiedades(n: number | null): Promise<number | null> {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      // Se lee ANTES y se escribe después, en dos sentencias. Un `RETURNING`
      // con subconsulta daría el valor viejo por el snapshot de la sentencia,
      // pero eso es demasiado sutil para dejarlo escrito en un test.
      const { rows } = await c.query<{ max_propiedades: number | null }>(
        `SELECT max_propiedades FROM plan WHERE codigo = 'inmo_basico'`,
      );
      await c.query(`UPDATE plan SET max_propiedades = $1 WHERE codigo = 'inmo_basico'`, [n]);
      return rows[0]?.max_propiedades ?? null;
    } finally {
      await c.end();
    }
  }

  it('el catálogo es público y NO trae precios inventados', async () => {
    const res = await request(app.getHttpServer()).get('/v1/planes').expect(200);

    // Cinco, en DOS familias: no son cinco tamaños del mismo producto.
    // Gestión primero, que es la puerta de entrada.
    expect(res.body).toHaveLength(5);
    expect(res.body.map((p: { codigo: string }) => p.codigo)).toEqual([
      'gestion_esencial', 'gestion_dia',
      'inmo_basico', 'inmo_medio', 'inmo_total',
    ]);
    expect(res.body.map((p: { familia: string }) => p.familia)).toEqual([
      'gestion', 'gestion', 'inmobiliaria', 'inmobiliaria', 'inmobiliaria',
    ]);
    // El gate de la etapa 0 es que alguien diga un número concreto. Hasta
    // entonces, precio null y no una cifra puesta a ojo. La columna
    // `precio_usd` ya existe (migración 044) y arranca vacía justamente por
    // esto: la propuesta está en docs/planes.md, sin publicar.
    expect(res.body.every((p: { precio: null }) => p.precio === null)).toBe(true);

    // El plan de entrada de VERDAD es el más chico de Gestión, no el de
    // Inmobiliaria: compite con una planilla, no con Tokko.
    const entrada = res.body.find((p: { codigo: string }) => p.codigo === 'gestion_esencial');
    expect(entrada.maxPropiedades).toBe(40);

    // Los módulos vienen ENRIQUECIDOS, no como claves sueltas: la landing y la
    // pantalla de «Tu plan» los dibujan sin diccionarios propios, que era donde
    // se les iba divergiendo la verdad.
    expect(entrada.modulos).toHaveLength(1);
    expect(entrada.modulos[0]).toMatchObject({
      clave: 'liquidaciones',
      nombre: 'Liquidaciones',
      estado: 'listo',
    });
  });

  /**
   * Un tilde en una página de precios es una promesa.
   *
   * Este repo ya lo pagó una vez: «Comisiones por punta» salía con tilde en una
   * sección de la landing y como «En desarrollo» ocho más arriba, en la MISMA
   * página. Ahora el estado sale de un solo lugar, y esto lo cuida.
   */
  it('lo que no está construido NO se ofrece como listo', async () => {
    const res = await request(app.getHttpServer()).get('/v1/planes').expect(200);
    const todos = (res.body as Array<{ modulos: Array<{ clave: string; estado: string; nota: string | null }> }>)
      .flatMap((p) => p.modulos);
    const porClave = new Map(todos.map((m) => [m.clave, m]));

    // Marca blanca y ARCA no tienen una línea de código: no pueden decir
    // «listo».
    expect(porClave.get('marca_blanca')?.estado).toBe('pronto');
    expect(porClave.get('arca')?.estado).toBe('pronto');

    // Lo parcial tiene que decir QUÉ le falta, o «parcial» no informa nada.
    for (const m of porClave.values()) {
      if (m.estado === 'parcial') expect(m.nota).toBeTruthy();
    }

    // Y el que sí anda no arrastra una nota de disculpa.
    expect(porClave.get('liquidaciones')?.estado).toBe('listo');
    const pro = res.body.find((p: { codigo: string }) => p.codigo === 'inmo_total');
    expect(pro.maxPropiedades).toBeNull();   // sin límite
  });

  it('mi-plan dice el estado REAL del cobro, sin simularlo', async () => {
    const res = await http().get('/v1/planes/mi-plan').set(...como(inmo)).expect(200);

    expect(res.body.plan.codigo).toBe('inmo_medio');
    expect(res.body.cobro.integrado).toBe(false);
    expect(res.body.cobro.detalle).toContain('medio de pago');
    // Y los límites vienen con lo usado de verdad.
    const props = res.body.limites.find((l: { recurso: string }) => l.recurso === 'propiedades');
    expect(props.maximo).toBe(1500);
    expect(typeof props.usado).toBe('number');
  });

  it('el tope de propiedades se aplica de verdad', async () => {
    // El try/finally NO es decorativo: `plan` es una tabla GLOBAL y si una
    // aserción falla antes de restaurar, el tope queda tocado y rompe los
    // demás tests. Un test que muta estado compartido lo restaura pase lo que
    // pase.
    const topeOriginal = await topeDePropiedades(2);
    try {
      // El MISMO plan que toca `topeDePropiedades`. Moverle el tope a un plan
      // y probar con otro deja el test verde por accidente.
      await ponerPlan(inmo.tenantId, 'inmo_basico');

      await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Una', tipo: 'casa' }).expect(201);
      await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Dos', tipo: 'casa' }).expect(201);

      // La tercera choca. El corte viene del TRIGGER, así que no hay camino de
      // código que lo saltee, y llega como 403 con el motivo escrito.
      const res = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Tres', tipo: 'casa' })
        .expect(403);

      expect(res.body.code).toBe('LIMITE_DE_PLAN');
      expect(res.body.detail).toContain('tope de 2 propiedades');
      expect(res.body.detail).toContain('plan superior');
    } finally {
      await topeDePropiedades(topeOriginal);
      await ponerPlan(inmo.tenantId, 'inmo_medio');
    }
  });


  /**
   * El portón de módulos.
   *
   * Hasta la migración 044, `plan.modulos` declaraba trece módulos y el código
   * exigía dos: los otros once eran texto en una página de precios. Esta tanda
   * es lo que hace que dejen de ser una promesa.
   */
  describe('el plan se hace valer, no sólo se declara', () => {
    afterEach(async () => { await ponerPlan(inmo.tenantId, 'inmo_medio'); });

    /**
     * El plan de entrada TIENE liquidaciones, que es lo más caro de construir.
     *
     * Sin ellas no administra nada, y un plan barato al que le falta el trabajo
     * entero de quien lo compra no es barato: es inútil. Lo que se reserva para
     * arriba es lo comercial, que es lo que un gestor no hace.
     */
    it('el plan Gestión SÍ liquida: es el trabajo de quien lo compra', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_esencial');
      await http().get('/v1/liquidaciones').set(...como(inmo)).expect(200);
    });

    it('pero no vende ni reparte comisiones', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_esencial');

      // Con ESCRITURAS y no con lecturas: `ventas` y `comisiones` llevan
      // `lecturaLibre`, así que un GET pasa a propósito —lo ya registrado sigue
      // siendo suyo—. Lo que el plan corta es registrar algo nuevo.
      //
      // El guard corre antes que el ValidationPipe, así que el cuerpo vacío no
      // llega a validarse: el 403 gana al 400.
      const res = await http().post('/v1/ventas').set(...como(inmo)).send({}).expect(403);
      expect(res.body.code).toBe('MODULO_NO_INCLUIDO');

      await http().post('/v1/comisiones/externas').set(...como(inmo)).send({}).expect(403);
    });

    /**
     * El caso que separa un límite de plan de un secuestro de datos.
     *
     * Quien baja de plan deja de EMITIR. Lo que ya emitió es suyo y lo sigue
     * viendo. Cortarle el acceso a dos años de registros para presionarlo a
     * pagar no es un límite comercial.
     */
    it('bajar de plan corta emitir, no leer lo ya hecho', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_esencial');
      // Las liquidaciones ya emitidas se siguen leyendo, aunque el plan no
      // incluyera el módulo: es el trabajo de esta inmobiliaria, no nuestro.
      await http().get('/v1/liquidaciones').set(...como(inmo)).expect(200);
    });

    it('la Red se corta entera, también para leer: ahí leer ES el servicio', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_esencial');
      const res = await http().get('/v1/red').set(...como(inmo)).expect(403);
      expect(res.body.code).toBe('MODULO_NO_INCLUIDO');
    });

    /**
     * La separación que pidió el producto: centralizar sí, contestar solo no.
     *
     * Centralizar mensajes es infraestructura y sirve desde el primer día. Que
     * algo conteste solo es una decisión —palabras de salida, escalado,
     * confirmaciones— y mal configurada le contesta cualquier cosa a un
     * inquilino. Son dos cosas y se compran por separado.
     */
    it('«Al día» abre la bandeja pero NO el bot', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_dia');

      await http().get('/v1/inbox').set(...como(inmo)).expect(200);
      await http().get('/v1/canales').set(...como(inmo)).expect(200);

      // `/respuestas` es la mitad «contesta solo» de la bandeja y va con el
      // módulo `bot`, igual que la configuración del bot en sí.
      const res = await http().get('/v1/respuestas').set(...como(inmo)).expect(403);
      expect(res.body.code).toBe('MODULO_NO_INCLUIDO');
      expect(res.body.detail).toContain('bot');
    });

    it('el bot llega recién con el plan Inmobiliaria', async () => {
      await ponerPlan(inmo.tenantId, 'inmo_medio');
      await http().get('/v1/respuestas').set(...como(inmo)).expect(200);
    });

    /**
     * El BCRA se vende; los garantes no.
     *
     * Cargar un garante es núcleo —sin garantes no se alquila— así que el gate
     * va sobre el ENDPOINT que sale a la Central de Deudores, no sobre el
     * controlador entero. Un plan de entrada que no deja cargar garantes no
     * sirve para alquilar.
     */
    it('«Esencial» carga garantes pero no consulta el BCRA', async () => {
      await ponerPlan(inmo.tenantId, 'gestion_esencial');

      // El legajo del garante se lee igual.
      await http().get('/v1/garantes/documentos/00000000-0000-4000-8000-000000000000')
        .set(...como(inmo))
        .expect((r) => { if (r.status === 403) throw new Error('los garantes no se gatean'); });

      const res = await http().post('/v1/garantes/00000000-0000-4000-8000-000000000000/bcra')
        .set(...como(inmo)).send({})
        .expect(403);
      expect(res.body.code).toBe('MODULO_NO_INCLUIDO');
      expect(res.body.detail).toContain('bcra');
    });

    it('los pre-contratos llegan con «Al día», no recién con Medio', async () => {
      // Escribir cada contrato a mano en Word es el dolor de quien administra
      // alquileres, y era la razón por la que la familia Gestión no servía para
      // dejar la planilla.
      await ponerPlan(inmo.tenantId, 'gestion_dia');
      await http().get('/v1/plantillas').set(...como(inmo)).expect(200);
    });

    it('los emprendimientos son del plan Total', async () => {
      await ponerPlan(inmo.tenantId, 'inmo_medio');
      await http().post('/v1/emprendimientos').set(...como(inmo))
        .send({ nombre: 'Torre', calle: 'Alguna' })
        .expect(403);

      await ponerPlan(inmo.tenantId, 'inmo_total');
      await http().post('/v1/emprendimientos').set(...como(inmo))
        .send({ nombre: 'Torre', calle: 'Alguna' })
        .expect(201);
    });

    /**
     * Lo que NO se corta.
     *
     * El feed XML lo consume un portal inmobiliario con un token, sin sesión.
     * Un 403 ahí no lo ve nadie de la inmobiliaria: lo ve Zonaprop, que deja de
     * publicar la cartera sin que nadie se entere. Las rutas públicas dentro de
     * un controlador con módulo siguen andando.
     */
    it('una ruta pública dentro de un módulo no se corta', async () => {
      await ponerPlan(inmo.tenantId, 'inmo_basico');
      // Sin token: no hay actor, así que no hay plan que consultar. Da 404 por
      // el token inventado, NO 403.
      await request(app.getHttpServer()).get('/v1/feed/tokeninventado.xml').expect(404);
    });
  });

  it('un módulo fuera del plan devuelve 403 con el motivo', async () => {
    await ponerPlan(inmo.tenantId, 'inmo_basico');

    const res = await http().get('/v1/sucursales').set(...como(inmo)).expect(403);
    expect(res.body.code).toBe('MODULO_NO_INCLUIDO');
    expect(res.body.detail).toContain('multisucursal');

    await ponerPlan(inmo.tenantId, 'inmo_medio');
  });

  it('con el plan Pro, multisucursal y API funcionan', async () => {
    await ponerPlan(inmo.tenantId, 'inmo_total');

    await http().post('/v1/sucursales').set(...como(inmo))
      .send({ nombre: 'Centro' }).expect(201);
    const suc = await http().get('/v1/sucursales').set(...como(inmo)).expect(200);
    expect(suc.body).toHaveLength(1);

    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Integración propia' }).expect(201);

    expect(clave.body.clave).toMatch(/^bemo_/);
    expect(clave.body.aviso).toContain('no se vuelve a mostrar');

    // En el listado NO vuelve a aparecer la clave, sólo el prefijo.
    const lista = await http().get('/v1/api-keys').set(...como(inmo)).expect(200);
    expect(lista.body[0].prefijo).toBe(clave.body.clave.slice(0, 12));
    expect(JSON.stringify(lista.body)).not.toContain(clave.body.clave);
  });

  it('en la base sólo queda el hash de la clave, nunca la clave', async () => {
    await ponerPlan(inmo.tenantId, 'inmo_total');
    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Otra' }).expect(201);

    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM api_key WHERE clave_hash = $1',
        [clave.body.clave],
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('revocar una clave dos veces no funciona', async () => {
    await ponerPlan(inmo.tenantId, 'inmo_total');
    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Revocable' }).expect(201);

    await http().delete(`/v1/api-keys/${clave.body.id}`).set(...como(inmo)).expect(200);
    await http().delete(`/v1/api-keys/${clave.body.id}`).set(...como(inmo)).expect(404);
  });

  it('sólo el titular administra sucursales y claves', async () => {
    await ponerPlan(inmo.tenantId, 'inmo_total');
    await http().post('/v1/sucursales').set(...como(inmo, 'admin'))
      .send({ nombre: 'Sur' }).expect(403);
    await http().get('/v1/api-keys').set(...como(inmo, 'admin')).expect(403);
  });

  describe('export CSV', () => {
    it('trae BOM y separador de punto y coma', async () => {
      const res = await http().get('/v1/exportar/propiedades.csv')
        .set(...como(inmo)).expect(200);

      // Sin BOM, Excel en Windows rompe los acentos.
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text.split('\r\n')[0]).toContain(';');
      expect(res.headers['content-disposition']).toContain('.csv');
    });

    it('neutraliza las fórmulas de Excel', async () => {
      await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: '=1+1', apellido: 'Inyeccion' }).expect(201);

      const res = await http().get('/v1/exportar/personas.csv')
        .set(...como(inmo)).expect(200);

      // Un valor que arranca con "=" lo ejecuta Excel al abrir el archivo.
      expect(res.text).toContain("'=1+1");
      expect(res.text).not.toMatch(/(^|;)=1\+1/m);
    });

    it('un recurso que no existe dice cuáles sí', async () => {
      const res = await http().get('/v1/exportar/inventado.csv')
        .set(...como(inmo)).expect(404);
      expect(res.body.detail).toContain('propiedades');
    });

    it('el asesor no puede exportar', async () => {
      await http().get('/v1/exportar/liquidaciones.csv')
        .set(...como(inmo, 'agente')).expect(403);
    });
  });
});
