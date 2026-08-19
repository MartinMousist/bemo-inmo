import { TokensService } from '../src/auth/tokens.service';
import { loadEnv, resetEnvCache } from '../src/config/env';

/**
 * Rotación del secreto de firma (etapa 17.4).
 *
 * ── Por qué hace falta ──
 *
 * Antes de esto, cambiar `JWT_SECRET` deslogueaba a todo el mundo en el acto:
 * cada access token vivo dejaba de verificar de golpe. Un secreto que duele
 * rotar no se rota nunca —que es exactamente el estado en el que está la
 * mayoría de los sistemas cuando se enteran de que se les filtró—.
 *
 * Con el secreto anterior aceptado sólo para VERIFICAR, la rotación es:
 * poner el nuevo, mover el viejo a `JWT_SECRET_ANTERIOR`, esperar un
 * `ACCESS_TTL_MIN` y sacar la variable.
 */

const VIEJO = 'secreto-viejo-de-mas-de-treinta-y-dos-caracteres';
const NUEVO = 'secreto-nuevo-de-mas-de-treinta-y-dos-caracteres';

const CLAIMS = {
  sub: '11111111-1111-4111-8111-111111111111',
  tid: '22222222-2222-4222-8222-222222222222',
  rol: 'owner' as const,
};

/** Un servicio con el entorno que se le pida. */
function servicioCon(secreto: string, anterior?: string): TokensService {
  resetEnvCache();
  process.env.JWT_SECRET = secreto;
  if (anterior) process.env.JWT_SECRET_ANTERIOR = anterior;
  else delete process.env.JWT_SECRET_ANTERIOR;
  loadEnv();
  return new TokensService();
}

describe('Rotación de JWT_SECRET', () => {
  const previo = { ...process.env };

  afterAll(() => {
    process.env = previo;
    resetEnvCache();
  });

  it('un token del secreto viejo sigue valiendo durante la rotación', () => {
    const antes = servicioCon(VIEJO);
    const token = antes.firmarAccess(CLAIMS);

    // Se rota: el nuevo firma, el viejo queda sólo para verificar.
    const durante = servicioCon(NUEVO, VIEJO);
    expect(durante.verificarAccess(token).sub).toBe(CLAIMS.sub);
  });

  it('lo nuevo se firma con el nuevo, no con el viejo', () => {
    const durante = servicioCon(NUEVO, VIEJO);
    const token = durante.firmarAccess(CLAIMS);

    // Terminada la rotación —sin `ANTERIOR`— el token nuevo sigue valiendo.
    const despues = servicioCon(NUEVO);
    expect(despues.verificarAccess(token).tid).toBe(CLAIMS.tid);
  });

  it('terminada la rotación, el token viejo deja de valer', () => {
    const antes = servicioCon(VIEJO);
    const token = antes.firmarAccess(CLAIMS);

    const despues = servicioCon(NUEVO);
    expect(() => despues.verificarAccess(token)).toThrow();
  });

  it('un token inventado no vale contra ninguno de los dos', () => {
    const durante = servicioCon(NUEVO, VIEJO);
    expect(() => durante.verificarAccess('esto.no.es')).toThrow();
  });

  it('poner el mismo secreto en los dos lados es un error de configuración', () => {
    // No rota nada y deja creyendo que sí: es peor que no rotar, porque el
    // secreto viejo sigue firmando y nadie lo revisa de nuevo.
    resetEnvCache();
    process.env.JWT_SECRET = NUEVO;
    process.env.JWT_SECRET_ANTERIOR = NUEVO;
    expect(() => loadEnv()).toThrow(/no rota nada/);
  });
});
