import { IndicesCron } from '../src/alquileres/indices.cron';
import { resetEnvCache } from '../src/config/env';
import type { IndicesService } from '../src/alquileres/indices.service';

/**
 * El cron de índices.
 *
 * Lo que importa probar acá no es que traiga valores —eso es del BCRA y ya
 * tiene su test de contrato— sino las tres cosas que hacen que un job de fondo
 * sea seguro o sea una bomba:
 *
 *   1. **Apagado por defecto.** Prendido, cualquier `npm test` sale a internet.
 *   2. **No tumba el proceso.** Una fuente externa que falla no puede voltear
 *      la API: el sistema tiene que seguir con los valores que ya tiene.
 *   3. **No se pisa a sí mismo.** Si el BCRA tarda más que el intervalo, la
 *      vuelta siguiente se saltea en vez de acumular consultas.
 */
describe('IndicesCron', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    resetEnvCache();
    jest.useRealTimers();
  });

  /** Un doble mínimo: sólo hace falta `sincronizar`. */
  const servicio = (impl: () => Promise<unknown>) =>
    ({ sincronizar: jest.fn(impl) } as unknown as IndicesService & {
      sincronizar: jest.Mock;
    });

  it('apagado por defecto NO programa nada', () => {
    process.env.SINCRONIZAR_INDICES = 'false';
    resetEnvCache();
    jest.useFakeTimers();

    const svc = servicio(async () => ({}));
    const cron = new IndicesCron(svc);
    cron.onModuleInit();

    // Doce horas y media: si estuviera programado, ya habría corrido.
    jest.advanceTimersByTime(12.5 * 60 * 60 * 1000);
    expect(svc.sincronizar).not.toHaveBeenCalled();

    cron.onModuleDestroy();
  });

  it('prendido corre después del arranque y sigue cada 12 h', async () => {
    process.env.SINCRONIZAR_INDICES = 'true';
    resetEnvCache();
    jest.useFakeTimers();

    const svc = servicio(async () => ({ icl: { cargados: 2, yaEstaban: 70 } }));
    const cron = new IndicesCron(svc);
    cron.onModuleInit();

    // No dispara al arrancar: la API se está levantando.
    expect(svc.sincronizar).not.toHaveBeenCalled();

    jest.advanceTimersByTime(31_000);
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(1);
    // `null` y no un usuario inventado: lo cargó el sistema, y la auditoría no
    // puede decir que alguien apretó un botón que nadie apretó.
    expect(svc.sincronizar).toHaveBeenCalledWith(null);

    jest.advanceTimersByTime(12 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(2);

    cron.onModuleDestroy();
  });

  it('si la fuente explota, el proceso sigue vivo y vuelve a intentar', async () => {
    process.env.SINCRONIZAR_INDICES = 'true';
    resetEnvCache();
    jest.useFakeTimers();

    const svc = servicio(async () => {
      throw new Error('BCRA caído');
    });
    const cron = new IndicesCron(svc);
    cron.onModuleInit();

    // Sin `expect().rejects`: el punto es que NO se propaga a ningún lado.
    jest.advanceTimersByTime(31_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(1);

    // Y la vuelta siguiente igual ocurre: un error no apaga el job.
    jest.advanceTimersByTime(12 * 60 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(2);

    cron.onModuleDestroy();
  });

  it('una vuelta lenta no se superpone con la siguiente', async () => {
    process.env.SINCRONIZAR_INDICES = 'true';
    resetEnvCache();
    jest.useFakeTimers();

    // Nunca resuelve: simula al BCRA colgado.
    const svc = servicio(() => new Promise(() => undefined));
    const cron = new IndicesCron(svc);
    cron.onModuleInit();

    jest.advanceTimersByTime(31_000);
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(1);

    // Dos intervalos más con la primera todavía en curso: no se acumulan.
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(svc.sincronizar).toHaveBeenCalledTimes(1);

    cron.onModuleDestroy();
  });
});
