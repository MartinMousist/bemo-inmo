import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { DbService } from '../database/db.service';
import { FotosService } from '../archivos/fotos.service';
import { esIpPublica, revisarUrl } from './url-imagen.motor';
import { loadEnv } from '../config/env';

/**
 * Baja las fotos que dejó encoladas una importación.
 *
 * ── Por qué en segundo plano ──
 *
 * Una cartera de doscientas propiedades con ocho fotos son mil seiscientos
 * pedidos a un servidor ajeno. Adentro del request del importador, eso muere por
 * timeout, tiene una transacción abierta esperando a un tercero, y una sola foto
 * lenta arrastra la importación entera. Acá la importación termina en segundos y
 * las fotos llegan de a poco.
 *
 * ── El `setInterval` ──
 *
 * Igual que `IndicesCron`, y por la misma razón: una librería de cron para un
 * ciclo que corre cada medio minuto es una dependencia que hay que mantener para
 * no ganar nada. Si hay dos réplicas, las dos drenan la misma cola sin pisarse
 * gracias al `FOR UPDATE SKIP LOCKED` de `app_fotos_por_bajar`.
 *
 * ── Las tres defensas contra el SSRF ──
 *
 * La URL la escribió el usuario en una planilla, así que este servicio hace
 * pedidos HTTP a donde alguien más decida. Desde adentro de la red llega a
 * lugares que ese alguien no llega.
 *
 *   1. `revisarUrl` filtra el TEXTO — esquema, puerto, credenciales, IP escrita.
 *   2. Se resuelve el nombre y se comprueba la IP ANTES de conectar. Esto es lo
 *      que agarra a `interno.ejemplo.com` apuntando a `10.0.0.5`.
 *   3. `redirect: 'manual'`. Una redirección es una segunda URL que nadie
 *      revisó: el CDN podría contestar `302 → http://169.254.169.254`. Se
 *      siguen a mano, revisando cada salto igual que el primero.
 *
 * Ninguna de las tres sola alcanza.
 */

/** Después de tres intentos, la foto se da por perdida y queda con su motivo. */
const MAX_INTENTOS = 3;
const CADA_MS = 30_000;
/** De a cinco: son pedidos a servidores ajenos, no una carrera. */
const POR_TANDA = 5;
const TIMEOUT_MS = 15_000;
/** 12 MB. Una foto de propiedad más grande que eso es un error de origen. */
const MAX_BYTES = 12 * 1024 * 1024;
/** Cuántos `3xx` se siguen antes de darse por vencido. */
const MAX_SALTOS = 3;

interface Fila {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  url: string;
  intentos: number;
}

@Injectable()
export class FotosColaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FotosCola');
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;

  constructor(
    private readonly db: DbService,
    private readonly fotos: FotosService,
  ) {}

  onModuleInit(): void {
    // En los tests el ciclo NO arranca: un `setInterval` que sale a internet
    // mientras corre la suite la vuelve lenta y no determinista. Los tests
    // llaman a `drenar()` a mano.
    if (loadEnv().NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.drenar(), CADA_MS);
    this.logger.log(`Ciclo cada ${CADA_MS / 1000}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Una vuelta de la cola. Devuelve cuántas bajó.
   *
   * El `corriendo` evita que dos vueltas se pisen dentro del MISMO proceso si
   * una tanda tarda más que el intervalo. Entre procesos distintos, eso lo
   * resuelve el `SKIP LOCKED` de la consulta.
   */
  async drenar(): Promise<number> {
    if (this.corriendo) return 0;
    this.corriendo = true;
    let bajadas = 0;

    try {
      const filas = await this.db.query<Fila>(
        'SELECT * FROM app_fotos_por_bajar($1)',
        [POR_TANDA],
      );

      for (const f of filas) {
        try {
          const datos = await this.bajar(f.url);
          await this.fotos.subir(f.tenant_id, f.propiedad_id, datos, nombreDe(f.url));
          // Se borra al salir bien: esta tabla es una cola, no un historial. Lo
          // que quedó bien ya vive en `propiedad_foto`.
          await this.db.withTenant(f.tenant_id, (ej) =>
            ej.query('DELETE FROM foto_pendiente WHERE id = $1', [f.id]),
          );
          bajadas++;
        } catch (err) {
          await this.marcarFallo(f, err);
        }
      }
    } catch (err) {
      this.logger.error('No se pudo leer la cola', err instanceof Error ? err.stack : err);
    } finally {
      this.corriendo = false;
    }

    if (bajadas) this.logger.log(`${bajadas} fotos bajadas`);
    return bajadas;
  }

  private async marcarFallo(f: Fila, err: unknown): Promise<void> {
    const motivo = err instanceof Error ? err.message : String(err);
    // `f.intentos` ya viene incrementado por la función que la eligió.
    const definitivo = f.intentos >= MAX_INTENTOS;

    await this.db.withTenant(f.tenant_id, (ej) =>
      ej.query(
        `UPDATE foto_pendiente
            SET ultimo_error = $2, estado = CASE WHEN $3 THEN 'fallida' ELSE estado END
          WHERE id = $1`,
        [f.id, motivo.slice(0, 500), definitivo],
      ),
    );

    if (definitivo) this.logger.warn(`Foto abandonada tras ${f.intentos}: ${motivo}`);
  }

  /**
   * Trae los bytes de una URL que escribió un tercero.
   *
   * Sigue las redirecciones A MANO porque cada salto es una URL nueva que
   * ninguna de las revisiones anteriores vio. Con `redirect: 'follow'`, un CDN
   * que conteste `302 → http://169.254.169.254` nos lleva ahí sin que nadie
   * mire.
   */
  private async bajar(urlInicial: string, salto = 0): Promise<Buffer> {
    if (salto > MAX_SALTOS) throw new Error('Demasiadas redirecciones.');

    const v = revisarUrl(urlInicial);
    if (!v.ok || !v.url || !v.host) throw new Error(`URL rechazada (${v.motivo}).`);

    // La IP se comprueba DESPUÉS de resolver: un nombre público puede apuntar a
    // una dirección interna, y el filtro de texto no lo puede saber.
    const { address } = await lookup(v.host);
    if (!esIpPublica(address)) {
      throw new Error(`El nombre ${v.host} resuelve a una dirección interna.`);
    }

    const corte = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(v.url, { redirect: 'manual', signal: corte });

    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get('location');
      if (!destino) throw new Error(`Redirección ${res.status} sin destino.`);
      return this.bajar(new URL(destino, v.url).toString(), salto + 1);
    }

    if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);

    const tipo = res.headers.get('content-type') ?? '';
    if (!tipo.startsWith('image/')) {
      throw new Error(`No es una imagen: el servidor devolvió "${tipo || 'nada'}".`);
    }

    // El `content-length` se mira primero para cortar barato, pero NO se
    // confía: puede mentir o no venir. El tamaño real se vuelve a medir abajo.
    const declarado = Number(res.headers.get('content-length') ?? 0);
    if (declarado > MAX_BYTES) throw new Error('La imagen pesa más de 12 MB.');

    const datos = Buffer.from(await res.arrayBuffer());
    if (datos.length > MAX_BYTES) throw new Error('La imagen pesa más de 12 MB.');
    if (datos.length === 0) throw new Error('El servidor devolvió un archivo vacío.');

    return datos;
  }
}

/** El nombre del archivo, para que el bucket no quede lleno de `imagen`. */
function nombreDe(url: string): string {
  try {
    const p = new URL(url).pathname.split('/').pop();
    return p && /\.[a-z]{3,4}$/i.test(p) ? p : 'foto.jpg';
  } catch {
    return 'foto.jpg';
  }
}
