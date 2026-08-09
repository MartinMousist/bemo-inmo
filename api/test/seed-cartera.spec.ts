import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * El orden de los dos `.sql` del seed, y las referencias entre ellos.
 *
 * ── Por qué esto es un test y no una convención ─────────────────────────────
 *
 * `correrSql()` manda el archivo entero en UNA sola consulta, o sea en una sola
 * transacción implícita: si una fila falla por foreign key, **no queda un seed a
 * medias, queda la base vacía** y la API no arranca. Y el mensaje que se ve es
 * «violates foreign key constraint», sin nombre de archivo ni número de línea.
 *
 * Ya pasó: el árbol de comisiones de `demo.sql` nombraba a Martín Aguirre
 * (`comision.beneficiario_id` → `usuario(id)`) unas quinientas líneas antes de
 * que ese usuario existiera. En la base de desarrollo no se notaba —los usuarios
 * ya estaban de una corrida vieja— y sólo aparecía en una base limpia, que es
 * justo la que ve alguien que se suma al proyecto.
 *
 * Estos chequeos son de texto a propósito: no necesitan Postgres, corren en
 * milisegundos y fallan con el UUID culpable en el mensaje.
 */
describe('Seed demo: orden de los .sql y sus referencias', () => {
  const seeds = join(__dirname, '..', 'seeds');
  const demo = readFileSync(join(seeds, 'demo.sql'), 'utf8');
  const cartera = readFileSync(join(seeds, 'demo-cartera.sql'), 'utf8');
  const seedTs = readFileSync(join(__dirname, '..', 'src', 'database', 'seed.ts'), 'utf8');

  /**
   * Una fila de `INSERT INTO usuario`: UUID, email y hash bcrypt. El hash es lo
   * que la distingue de cualquier otra fila que empiece con un UUID.
   */
  const FILA_USUARIO = /\('([0-9a-f-]{36})',\s*'[^']+',\s*'\$2b\$12\$/g;

  /** Los UUID de usuario de la demo: `11000000-…` en Andes, `22000000-…` en La Plata. */
  const REF_USUARIO = /'((?:11|22)000000-0000-4000-8000-[0-9a-f]{12})'/g;

  function usuariosDefinidos(sql: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const x of sql.matchAll(FILA_USUARIO)) {
      // La posición del UUID, no la del `('` que lo precede: se compara contra
      // `indexOf(id)`, que apunta al UUID pelado.
      if (!m.has(x[1])) m.set(x[1], x.index! + x[0].indexOf(x[1]));
    }
    return m;
  }

  it('el seed corre demo.sql y DESPUÉS demo-cartera.sql', () => {
    const base = seedTs.indexOf("'demo.sql'");
    const ampliada = seedTs.indexOf("'demo-cartera.sql'");

    // Que esté enganchado: sin esta línea, una base limpia se queda sin las 16
    // unidades ofrecidas y la cartera se ve vacía.
    expect(ampliada).toBeGreaterThan(-1);
    // Y en ese orden: la cartera ampliada cuelga de los asesores y las
    // sucursales que crea demo.sql.
    expect(ampliada).toBeGreaterThan(base);
  });

  it('demo.sql define cada usuario ANTES de la primera vez que lo nombra', () => {
    const definidos = usuariosDefinidos(demo);
    expect(definidos.size).toBeGreaterThanOrEqual(11);

    for (const [id, posicionDefinicion] of definidos) {
      // La primera aparición del UUID en el archivo tiene que ser su propia
      // definición. Si aparece antes, es una FK que apunta a un usuario que
      // todavía no existe y el archivo entero se cae.
      expect({ id, primeraAparicion: demo.indexOf(id) })
        .toEqual({ id, primeraAparicion: posicionDefinicion });
    }
  });

  it('demo-cartera.sql sólo referencia usuarios que demo.sql ya creó', () => {
    const definidos = usuariosDefinidos(demo);
    const referenciados = new Set(
      [...cartera.matchAll(REF_USUARIO)].map((m) => m[1]),
    );

    // Los captadores y los agentes de los leads: si alguno no está, la cartera
    // ampliada no entra y no hay pantalla que mostrar.
    expect(referenciados.size).toBeGreaterThan(0);
    for (const id of referenciados) {
      expect({ id, definidoEnDemo: definidos.has(id) })
        .toEqual({ id, definidoEnDemo: true });
    }
  });

  it('demo-cartera.sql fija el tenant antes de insertar propiedades', () => {
    // El trigger `propiedad_limite_plan` consulta el plan del tenant ACTUAL.
    // Sin `app.current_tenant_id`, `app_limite_plan()` contesta "no permitido" y
    // no entra ni una fila — con un error que habla de planes, no de seeds.
    const setConfig = cartera.indexOf('app.current_tenant_id');
    const primerInsert = cartera.indexOf('INSERT INTO');
    expect(setConfig).toBeGreaterThan(-1);
    expect(setConfig).toBeLessThan(primerInsert);
  });
});
