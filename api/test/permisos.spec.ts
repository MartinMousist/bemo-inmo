import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  ROLES,
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Matriz de permisos, table-driven: cada rol × cada endpoint, incluido "sin token".
 *
 * Sumar una fila cuando se agrega un endpoint cuesta treinta segundos. Enterarse
 * en producción de que a un endpoint le faltaba el @Roles cuesta bastante más.
 *
 * La tabla es la fuente de verdad y tiene que espejar docs/spec.md §5.
 */

type Rol = (typeof ROLES)[number];
type Quien = Rol | 'anonimo';

interface Caso {
  nombre: string;
  metodo: 'get' | 'post';
  ruta: string;
  cuerpo?: Record<string, unknown>;
  /** Quiénes deben poder. Todos los demás reciben 401 (anónimo) o 403. */
  permitidos: Quien[];
}

const CASOS: Caso[] = [
  {
    nombre: 'GET /equipo',
    metodo: 'get',
    ruta: '/v1/equipo',
    permitidos: ['owner', 'admin', 'agente', 'contable'],
  },
  {
    nombre: 'GET /equipo/invitaciones',
    metodo: 'get',
    ruta: '/v1/equipo/invitaciones',
    permitidos: ['owner', 'admin'],
  },
  {
    nombre: 'POST /equipo/invitaciones',
    metodo: 'post',
    ruta: '/v1/equipo/invitaciones',
    cuerpo: { email: 'nuevo@test.local', rol: 'agente' },
    permitidos: ['owner'],
  },
  {
    nombre: 'GET /auth/yo',
    metodo: 'get',
    ruta: '/v1/auth/yo',
    permitidos: ['owner', 'admin', 'agente', 'contable'],
  },
  {
    nombre: 'GET /health',
    metodo: 'get',
    ruta: '/v1/health',
    permitidos: ['owner', 'admin', 'agente', 'contable', 'anonimo'],
  },
];

describe('Matriz de permisos', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('permisos', app.get(TokensService));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const todos: Quien[] = [...ROLES, 'anonimo'];

  for (const caso of CASOS) {
    for (const quien of todos) {
      const deberia = caso.permitidos.includes(quien);
      const etiqueta = deberia ? 'PERMITE' : 'RECHAZA';

      it(`${caso.nombre} — ${etiqueta} a ${quien}`, async () => {
        let req = request(app.getHttpServer())[caso.metodo](caso.ruta);
        if (quien !== 'anonimo') req = req.set(...auth(inmo.tokens[quien]));
        // Un cuerpo distinto por rol: si dos roles pudieran, el segundo chocaría
        // con la invitación pendiente del primero y el test mentiría.
        if (caso.cuerpo) {
          req = req.send({ ...caso.cuerpo, email: `${quien}.${caso.cuerpo.email}` });
        }

        const res = await req;

        if (deberia) {
          expect(res.status).toBeLessThan(400);
        } else {
          expect(res.status).toBe(quien === 'anonimo' ? 401 : 403);
          // El contrato de error también se respeta en las denegaciones.
          expect(res.body.code).toBe(quien === 'anonimo' ? 'UNAUTHENTICATED' : 'FORBIDDEN');
        }
      });
    }
  }

  it('un token firmado con otro secreto se rechaza', async () => {
    // El guard fija algorithms: ['HS256']. Sin eso, un token con alg "none"
    // pasaría la verificación.
    const falso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJmYWxzbyIsInRpZCI6ImZhbHNvIiwicm9sIjoib3duZXIifQ.' +
      'firmainventada';

    const res = await request(app.getHttpServer())
      .get('/v1/equipo')
      .set('Authorization', `Bearer ${falso}`);

    expect(res.status).toBe(401);
  });
});
