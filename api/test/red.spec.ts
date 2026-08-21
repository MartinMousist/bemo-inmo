import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * La Red entre inmobiliarias.
 *
 * Esta suite tiene un peso distinto al resto. Todo el sistema se apoya en que
 * una inmobiliaria no ve lo de otra, y la Red es la única pieza que cruza ese
 * borde a propósito. Si algo acá se afloja, se afloja el aislamiento entero.
 *
 * Por eso la mitad de los casos son sobre lo que NO se ve.
 */
/** La ficha recortada que devuelve la Red. Lo que NO está acá es el punto. */
interface FichaRed {
  id: string; codigo: string; tipo: string; zona: string;
  precio: number | null; comisionPct: number | null; inmobiliaria: string;
}

describe('La Red entre inmobiliarias', () => {
  let app: INestApplication;
  let andes: Inmobiliaria;
  let plata: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    andes = await crearInmobiliaria('redandes', tk);
    plata = await crearInmobiliaria('redplata', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  async function crearPropiedad(
    i: Inmobiliaria,
    calle: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const p = await http().post('/v1/propiedades').set(...como(i))
      .send({ calle, numero: '742', localidad: 'Godoy Cruz', tipo: 'departamento', ...extra })
      .expect(201);
    return p.body.id;
  }

  async function conOperacion(i: Inmobiliaria, id: string, precio = 150000) {
    await http().post(`/v1/propiedades/${id}/operaciones`).set(...como(i))
      .send({ tipo: 'venta', precio, moneda: 'USD', estado: 'disponible' })
      .expect(201);
  }

  /**
   * Lo que ve `quien` de lo que comparte `de`.
   *
   * La Red es GLOBAL por definición: `limpiarFixtures()` limpia los tenants de
   * prueba, no las inmobiliarias reales que haya en la base de desarrollo. Un
   * test que dé por sentado que la Red arranca vacía pasa hoy y falla el día que
   * alguien comparte una propiedad — que fue exactamente lo que pasó.
   *
   * Así que se filtra por inmobiliaria. Además es lo que se quiere decir: no
   * «la Red tiene tres cosas» sino «lo de Andes se ve, y con esta comisión».
   */
  const deLaRed = async (quien: Inmobiliaria, de: Inmobiliaria, query = '') => {
    const r = await http().get(`/v1/red${query}`).set(...como(quien)).expect(200);
    return (r.body as FichaRed[]).filter((p) => p.inmobiliaria === de.nombre);
  };

  const compartir = (i: Inmobiliaria, id: string, comisionPct?: number) =>
    http().put(`/v1/red/propiedades/${id}`).set(...como(i))
      .send({ compartida: true, comisionPct });

  // ───────────────────────────────────────────────────────────────────────────
  // Lo que la Red SÍ hace
  // ───────────────────────────────────────────────────────────────────────────

  it('El Plata ve lo que Andes compartió, con la comisión ofrecida', async () => {
    const id = await crearPropiedad(andes, 'Belgrano');
    await conOperacion(andes, id);
    await compartir(andes, id, 2.5).expect(200);

    const mias = await deLaRed(plata, andes);
    const ficha = mias.find((p) => p.zona.includes('Belgrano'));

    expect(ficha).toBeDefined();
    expect(ficha!.comisionPct).toBe(2.5);
    expect(ficha!.inmobiliaria).toBe(andes.nombre);
  });

  it('compartir sube el pulso del vecino y NO el propio', async () => {
    const pulso = async (i: Inmobiliaria) =>
      (await http().get('/v1/red/pulso').set(...como(i)).expect(200)).body.propiedades as number;

    // Se miden deltas y no totales: la Red es global y en la base de desarrollo
    // puede haber inmobiliarias reales compartiendo. Lo que este test afirma es
    // el efecto de compartir UNA, que es lo que importa.
    const antesPlata = await pulso(plata);
    const antesAndes = await pulso(andes);

    const id = await crearPropiedad(andes, 'Lavalle');
    await conOperacion(andes, id);
    await compartir(andes, id, 4).expect(200);

    expect(await pulso(plata)).toBe(antesPlata + 1);
    // Para Andes no cambia: lo propio ya se ve por el camino normal, y contarlo
    // haría creer que hay más red de la que hay.
    expect(await pulso(andes)).toBe(antesAndes);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Lo que la Red NO hace. Acá está el valor de esta suite.
  // ───────────────────────────────────────────────────────────────────────────

  it('lo NO compartido es invisible, aunque exista y esté disponible', async () => {
    const id = await crearPropiedad(andes, 'Chacabuco');
    await conOperacion(andes, id);
    // Sin compartir: el default de `red_compartida` es false.

    const mias = await deLaRed(plata, andes);
    expect(mias.some((p) => p.zona.includes('Chacabuco'))).toBe(false);
  });

  it('bajarla de la Red la vuelve invisible y borra la comisión', async () => {
    const id = await crearPropiedad(andes, 'Rivadavia');
    await conOperacion(andes, id);
    await compartir(andes, id, 3).expect(200);

    const baja = await http().put(`/v1/red/propiedades/${id}`).set(...como(andes))
      .send({ compartida: false }).expect(200);
    expect(baja.body.compartida).toBe(false);
    expect(baja.body.comisionPct).toBeNull();

    const mias = await deLaRed(plata, andes);
    expect(mias.some((p) => p.zona.includes('Rivadavia'))).toBe(false);
  });

  it('la Red no devuelve lo propio: eso ya se ve por el camino normal', async () => {
    const r = await http().get('/v1/red').set(...como(andes)).expect(200);
    expect(
      (r.body as FichaRed[]).some((p) => p.inmobiliaria === andes.nombre),
    ).toBe(false);
  });

  /**
   * El caso que justifica la proyección recortada.
   *
   * Un colega necesita saber qué es y dónde queda. Quién es el dueño, cuánto se
   * le cobra y qué anotó el captador no son asunto suyo. Si mañana alguien
   * agrega un campo a `app_red_buscar`, este test se lo hace notar.
   */
  it('la ficha de la Red no trae titular, ni notas, ni la altura de la calle', async () => {
    const id = await crearPropiedad(andes, 'Sarmiento', {
      descripcion: 'Piso alto, contrafrente',
    });
    await conOperacion(andes, id);
    await http().post(`/v1/propiedades/${id}/notas`).set(...como(andes))
      .send({ texto: 'La dueña acepta 140.000 si es contado' })
      .expect((res) => { if (![200, 201, 404].includes(res.status)) throw new Error(String(res.status)); });
    await compartir(andes, id, 2).expect(200);

    const mias = await deLaRed(plata, andes);
    const ficha = mias.find((p) => p.zona.includes('Sarmiento'));
    expect(ficha).toBeDefined();

    const texto = JSON.stringify(ficha);
    expect(texto).not.toContain('140.000');
    expect(texto).not.toContain('742');           // la altura no viaja
    // `as unknown as Record<...>` a propósito: se pregunta por campos que NO
    // están en el tipo, que es justo lo que hay que comprobar.
    const crudo = ficha as unknown as Record<string, unknown>;
    expect(crudo.titular).toBeUndefined();
    expect(crudo.captadorId).toBeUndefined();
    expect(crudo.notas).toBeUndefined();

    // Los campos que sí tienen que estar, para que el test no pase por vacío.
    expect(ficha!.zona).toContain('Godoy Cruz');
    expect(ficha!.precio).toBe(150000);
  });

  it('sin operación disponible no se puede compartir: no la vería nadie', async () => {
    const id = await crearPropiedad(andes, 'Mitre');
    const r = await compartir(andes, id, 2).expect(409);
    expect(r.body.code).toBe('ESTADO_INVALIDO');
  });

  it('un asesor busca en la Red pero no decide qué se ofrece', async () => {
    await http().get('/v1/red').set(...como(plata, 'agente')).expect(200);

    const id = await crearPropiedad(andes, 'Colón');
    await conOperacion(andes, id);
    await http().put(`/v1/red/propiedades/${id}`).set(...como(andes, 'agente'))
      .send({ compartida: true, comisionPct: 2 })
      .expect(403);
  });

  it('no se puede compartir una propiedad de otra inmobiliaria', async () => {
    const id = await crearPropiedad(andes, 'Perú');
    await conOperacion(andes, id);
    await http().put(`/v1/red/propiedades/${id}`).set(...como(plata))
      .send({ compartida: true, comisionPct: 2 })
      .expect(404);
  });

  it('los filtros acotan sin abrir nada: un precio máximo bajo no trae de más', async () => {
    const mias = await deLaRed(plata, andes, '?precioMax=1000');
    expect(mias).toEqual([]);
  });
});
