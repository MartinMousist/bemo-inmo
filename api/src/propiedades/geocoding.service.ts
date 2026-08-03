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
