import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';

export interface Coordenadas {
  lat: number;
  lng: number;
  fuente: string;
}

export interface ResultadoGeocoding {
  coordenadas: Coordenadas | null;
  /** Por qué no hay coordenadas. El front lo muestra tal cual. */
  motivo?: 'sin_api_key' | 'sin_resultados' | 'error';
}

export interface Diagnostico {
  configurado: boolean;
  /** `true` sólo si Google respondió OK a una consulta real. */
  funciona: boolean;
  /** El `status` que devolvió Google, tal cual. */
  estado: string;
  /** Qué hacer, en castellano. */
  detalle: string;
  /**
   * El `error_message` de Google, sin tocar. Es lo único que dice **cuál** API
   * falta habilitar o **qué** restricción rebotó; traducirlo pierde el dato.
   */
  mensajeDeGoogle?: string;
}

/**
 * Geocodificación contra Google Maps.
 *
 * Reglas de costo, que en este producto son reglas de arquitectura:
 *
 * 1. Se geocodifica UNA vez, al guardar la dirección, y se persiste lat/lng.
 *    Resolver la dirección en cada render sería pagar lo mismo mil veces.
 * 2. Los listados usan Static Maps (una imagen), no el mapa interactivo.
 * 3. El mapa interactivo se carga sólo cuando el usuario lo pide.
 *
 * Si no hay API key configurada, la app NO se rompe y NO inventa coordenadas:
 * devuelve `motivo: 'sin_api_key'` y la UI ofrece cargar lat/lng a mano.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger('Geocoding');
  private readonly env = loadEnv();

  get configurado(): boolean {
    return this.env.GOOGLE_MAPS_API_KEY.length > 0;
  }

  async geocodificar(direccion: string): Promise<ResultadoGeocoding> {
    if (!this.configurado) {
      return { coordenadas: null, motivo: 'sin_api_key' };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', direccion);
    // Sesga los resultados a Argentina: "San Martín 500" existe en medio mundo.
    url.searchParams.set('components', 'country:AR');
    url.searchParams.set('key', this.env.GOOGLE_MAPS_API_KEY);

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const datos = (await res.json()) as {
        status: string;
        results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
      };

      if (datos.status === 'ZERO_RESULTS' || !datos.results?.length) {
        return { coordenadas: null, motivo: 'sin_resultados' };
      }

      if (datos.status !== 'OK') {
        // OVER_QUERY_LIMIT y REQUEST_DENIED se registran: son problemas de
        // facturación o de configuración de la key, no del usuario.
        this.logger.error(`Google Geocoding devolvió ${datos.status}`);
        return { coordenadas: null, motivo: 'error' };
      }

      const { lat, lng } = datos.results[0].geometry.location;
      return { coordenadas: { lat, lng, fuente: 'google' } };
    } catch (err) {
      this.logger.error(
        'Falló la geocodificación',
        err instanceof Error ? err.message : String(err),
      );
      // Nunca se propaga: que no se pueda ubicar una propiedad en el mapa no
      // puede impedir darla de alta.
      return { coordenadas: null, motivo: 'error' };
    }
  }

  /**
   * Prueba la key contra Google de verdad, con una dirección conocida.
   *
   * Existe porque "hay una key en el `.env`" y "la key funciona" son dos cosas
   * distintas, y las tres formas de que no funcione —la Geocoding API sin
   * habilitar, la facturación sin activar, la key restringida a otro dominio o a
   * otras IPs— dan todas el mismo síntoma en la app: propiedades sin ubicación.
   * Sin esto, el diagnóstico es leer los logs del contenedor.
   *
   * Se consulta el Obelisco: existe, es inequívoco, y si eso no resuelve el
   * problema no es la dirección.
   */
  async diagnostico(): Promise<Diagnostico> {
    if (!this.configurado) {
      return {
        configurado: false,
        funciona: false,
        estado: 'SIN_API_KEY',
        detalle:
          'No hay GOOGLE_MAPS_API_KEY configurada. Las propiedades se pueden ' +
          'cargar igual con latitud y longitud a mano.',
      };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', 'Av. 9 de Julio, Obelisco, Buenos Aires');
    url.searchParams.set('components', 'country:AR');
    url.searchParams.set('key', this.env.GOOGLE_MAPS_API_KEY);

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const datos = (await res.json()) as { status: string; error_message?: string };

      return {
        configurado: true,
        funciona: datos.status === 'OK',
        estado: datos.status,
        detalle: EXPLICACION[datos.status] ?? `Google respondió ${datos.status}.`,
        ...(datos.error_message ? { mensajeDeGoogle: datos.error_message } : {}),
      };
    } catch (err) {
      return {
        configurado: true,
        funciona: false,
        estado: 'SIN_RESPUESTA',
        detalle:
          'No se pudo llegar a Google. Puede ser la red del servidor o un ' +
          'firewall de salida.',
        mensajeDeGoogle: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Arma la dirección completa tal como se le manda al geocodificador. */
  static direccionCompleta(p: {
    calle: string;
    numero?: string | null;
    localidad?: string | null;
    provincia?: string | null;
  }): string {
    return [p.calle, p.numero, p.localidad, p.provincia, 'Argentina']
      .filter(Boolean)
      .join(', ');
  }
}

/**
 * Qué hacer con cada `status` de Google.
 *
 * El texto dice el paso concreto, no "hubo un error": quien lee esto está
 * mirando una pantalla y necesita saber a qué consola entrar.
 */
const EXPLICACION: Record<string, string> = {
  OK: 'La key funciona: Geocoding responde y la facturación está activa.',
  REQUEST_DENIED:
    'Google rechazó la consulta. Casi siempre es una de tres: la Geocoding API ' +
    'no está habilitada en el proyecto, la key tiene una restricción de HTTP ' +
    'referrer (que no sirve para llamadas desde el servidor — tiene que ser ' +
    'restricción por IP), o la key está mal copiada.',
  OVER_QUERY_LIMIT:
    'Se pasó la cuota o falta activar la facturación del proyecto. Google exige ' +
    'una tarjeta asociada aunque el uso entre en el crédito mensual gratuito.',
  INVALID_REQUEST: 'La consulta salió mal armada. Es un error del sistema, no de la key.',
  ZERO_RESULTS:
    'La key funciona, pero Google no encontró la dirección de prueba. Raro: ' +
    'revisá si hay un proxy de salida modificando las consultas.',
  UNKNOWN_ERROR: 'Google tuvo un problema momentáneo. Volvé a probar en un minuto.',
};
