import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import {
  fechaFlexible,
  normalizar,
  numeroFlexible,
  parsearCsv,
} from './csv.parser';

export type Recurso = 'personas' | 'propiedades';

export interface ProblemaFila {
  fila: number;
  campo?: string;
  mensaje: string;
  grave: boolean;
}

export interface Previsualizacion {
  recurso: Recurso;
  totalFilas: number;
  aImportar: number;
  aOmitir: number;
  columnasReconocidas: string[];
  columnasIgnoradas: string[];
  problemas: ProblemaFila[];
  muestra: Array<Record<string, unknown>>;
}

export interface ResultadoImportacion {
  importadas: number;
  omitidas: number;
  problemas: ProblemaFila[];
}

/** Alias que una planilla real puede traer. Escritos por personas, no por un sistema. */
const ALIAS: Record<Recurso, Record<string, string[]>> = {
  personas: {
    nombre: ['nombre', 'nombres', 'razon_social', 'razonsocial'],
    apellido: ['apellido', 'apellidos'],
    docNumero: ['dni', 'documento', 'doc', 'nro_documento', 'cuit', 'cuil', 'doc_numero'],
    docTipo: ['tipo_doc', 'doc_tipo', 'tipo_documento'],
    email: ['email', 'correo', 'mail', 'e_mail'],
    telefono: ['telefono', 'tel', 'celular', 'cel', 'movil', 'whatsapp'],
    domicilio: ['domicilio', 'direccion', 'direccion_particular'],
    notas: ['notas', 'observaciones', 'comentarios'],
  },
  propiedades: {
    calle: ['calle', 'direccion', 'domicilio'],
    numero: ['numero', 'nro', 'altura', 'num'],
    piso: ['piso'],
    depto: ['depto', 'departamento', 'dpto', 'unidad'],
    localidad: ['localidad', 'ciudad', 'barrio', 'zona'],
    provincia: ['provincia'],
    cp: ['cp', 'codigo_postal'],
    tipo: ['tipo', 'tipo_propiedad', 'tipo_inmueble'],
    supTotal: ['sup_total', 'superficie_total', 'superficie', 'm2', 'metros'],
    supCubierta: ['sup_cubierta', 'superficie_cubierta', 'm2_cubiertos'],
    ambientes: ['ambientes', 'amb'],
    dormitorios: ['dormitorios', 'habitaciones', 'cuartos'],
    banos: ['banos', 'banios', 'bany_os', 'baos'],
    cocheras: ['cocheras', 'garage', 'garages'],
    antiguedad: ['antiguedad', 'anos', 'anios'],
    descripcion: ['descripcion', 'detalle', 'observaciones'],
    lat: ['lat', 'latitud'],
    lng: ['lng', 'lon', 'longitud'],
    // ── La operación y su precio ──
    //
    // Faltaban, y sin ellos una migración desde otro sistema dejaba la cartera
    // cargada y SIN UN PRECIO: doscientas propiedades y ni un número. La
    // planilla que exporta cualquier CRM del rubro los trae.
    operacion: ['operacion', 'tipo_operacion', 'op', 'modalidad'],
    precio: ['precio', 'valor', 'importe', 'precio_venta', 'precio_alquiler'],
    moneda: ['moneda', 'currency', 'divisa'],
    expensas: ['expensas', 'expensa'],
  },
};

/** Cómo escribe cada planilla las dos operaciones que existen. */
const OPERACION_ALIAS: Record<string, string> = {
  venta: 'venta', vender: 'venta', vta: 'venta', sale: 'venta',
  alquiler: 'alquiler', alquilar: 'alquiler', renta: 'alquiler',
  arriendo: 'alquiler', locacion: 'alquiler', rent: 'alquiler',
  alquiler_temporario: 'alquiler_temporario', temporario: 'alquiler_temporario',
  temporal: 'alquiler_temporario',
};

const TIPOS_PROPIEDAD = [
  'departamento', 'casa', 'ph', 'local', 'oficina',
  'galpon', 'terreno', 'cochera', 'campo',
];

/** Cómo se escribe en una planilla lo que en la base es un enum. */
const TIPO_ALIAS: Record<string, string> = {
  depto: 'departamento', dpto: 'departamento', dto: 'departamento',
  monoambiente: 'departamento', duplex: 'casa', chalet: 'casa',
  quinta: 'casa', local_comercial: 'local', deposito: 'galpon',
  lote: 'terreno', terreno_lote: 'terreno', oficinas: 'oficina',
  garage: 'cochera', cochera_fija: 'cochera',
};

@Injectable()
export class ImportarService {
  private readonly logger = new Logger('Importar');

  constructor(private readonly db: DbService) {}

  /**
   * Previsualiza sin escribir NADA.
   *
   * Importar a ciegas una planilla de 400 filas y descubrir después que 90
   * quedaron mal es peor que no importar: hay que deshacerlo a mano. Primero se
   * muestra qué va a pasar; recién después se confirma.
   */
  async previsualizar(
    tenantId: string,
    recurso: Recurso,
    csv: string,
  ): Promise<Previsualizacion> {
    const { cabeceras, filas } = parsearCsv(csv);
    if (!cabeceras.length) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'El archivo está vacío o no se pudo leer como CSV.',
        'Unprocessable Entity',
      );
    }

    const mapa = this.mapearColumnas(recurso, cabeceras);
    const reconocidas = Object.values(mapa);
    const ignoradas = cabeceras.filter((c) => !reconocidas.includes(c));

    const problemas: ProblemaFila[] = [];
    const muestra: Array<Record<string, unknown>> = [];
    let validas = 0;

    for (let i = 0; i < filas.length; i++) {
      const r = this.normalizarFila(recurso, filas[i], mapa, i + 2, problemas);
      if (r) {
        validas++;
        if (muestra.length < 5) muestra.push(r);
      }
    }

    if (!Object.keys(mapa).length) {
      problemas.push({
        fila: 1,
        mensaje:
          `Ninguna columna coincide con lo esperado. Las de este archivo son: ${cabeceras.join(', ')}.`,
        grave: true,
      });
    }

    return {
      recurso,
      totalFilas: filas.length,
      aImportar: validas,
      aOmitir: filas.length - validas,
      columnasReconocidas: reconocidas,
      columnasIgnoradas: ignoradas,
      problemas: problemas.slice(0, 100),
      muestra,
    };
  }

  /**
   * Importa de verdad.
   *
   * Cada fila va en su propio intento: una fila mala no puede tumbar las 399
   * buenas. Lo que falla se informa con el número de fila del archivo, que es
   * lo que el usuario ve en Excel.
   */
  async importar(
    tenantId: string,
    recurso: Recurso,
    csv: string,
  ): Promise<ResultadoImportacion> {
    const { cabeceras, filas } = parsearCsv(csv);
    const mapa = this.mapearColumnas(recurso, cabeceras);
    const problemas: ProblemaFila[] = [];

    let importadas = 0;

    for (let i = 0; i < filas.length; i++) {
      const nroFila = i + 2;
      const datos = this.normalizarFila(recurso, filas[i], mapa, nroFila, problemas);
      if (!datos) continue;

      try {
        await this.db.withTenant(tenantId, (ej) =>
          recurso === 'personas'
            ? this.insertarPersona(ej, tenantId, datos)
            : this.insertarPropiedad(ej, tenantId, datos),
        );
        importadas++;
      } catch (err) {
        problemas.push({
          fila: nroFila,
          mensaje: this.explicar(err),
          grave: true,
        });
      }
    }

    this.logger.log(
      `Importación de ${recurso}: ${importadas} de ${filas.length}, ${problemas.length} problemas`,
    );

    return { importadas, omitidas: filas.length - importadas, problemas: problemas.slice(0, 200) };
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private mapearColumnas(recurso: Recurso, cabeceras: string[]): Record<string, string> {
    const mapa: Record<string, string> = {};
    for (const [campo, alias] of Object.entries(ALIAS[recurso])) {
      const encontrada = cabeceras.find((c) => alias.includes(normalizar(c)));
      if (encontrada) mapa[campo] = encontrada;
    }
    return mapa;
  }

  private normalizarFila(
    recurso: Recurso,
    fila: Record<string, string>,
    mapa: Record<string, string>,
    nroFila: number,
    problemas: ProblemaFila[],
  ): Record<string, unknown> | null {
    const v = (campo: string) => (mapa[campo] ? fila[mapa[campo]]?.trim() : undefined);

    if (recurso === 'personas') {
      const nombre = v('nombre');
      if (!nombre) {
        problemas.push({ fila: nroFila, campo: 'nombre', mensaje: 'Sin nombre.', grave: true });
        return null;
      }

      const doc = v('docNumero')?.replace(/\D/g, '') || undefined;
      return {
        nombre,
        apellido: v('apellido') || null,
        docNumero: doc ?? null,
        // Si hay documento pero no se dijo el tipo, DNI es lo razonable en
        // Argentina; 11 dígitos es CUIT.
        docTipo: doc ? (v('docTipo')?.toLowerCase() || (doc.length === 11 ? 'cuit' : 'dni')) : null,
        email: v('email') || null,
        telefono: v('telefono') || null,
        domicilio: v('domicilio') || null,
        notas: v('notas') || null,
      };
    }

    const calle = v('calle');
    if (!calle) {
      problemas.push({ fila: nroFila, campo: 'calle', mensaje: 'Sin dirección.', grave: true });
      return null;
    }

    const tipoCrudo = normalizar(v('tipo') ?? '');
    let tipo = TIPO_ALIAS[tipoCrudo] ?? tipoCrudo;
    if (!TIPOS_PROPIEDAD.includes(tipo)) {
      if (tipoCrudo) {
        // Se importa igual con un tipo por defecto y se avisa: perder la fila
        // entera por una palabra sería peor.
        problemas.push({
          fila: nroFila,
          campo: 'tipo',
          mensaje: `Tipo "${v('tipo')}" no reconocido; se importa como departamento.`,
          grave: false,
        });
      }
      tipo = 'departamento';
    }

    return {
      calle,
      numero: v('numero') || null,
      piso: v('piso') || null,
      depto: v('depto') || null,
      localidad: v('localidad') || null,
      provincia: v('provincia') || null,
      cp: v('cp') || null,
      tipo,
      supTotal: numeroFlexible(v('supTotal')),
      supCubierta: numeroFlexible(v('supCubierta')),
      ambientes: entero(numeroFlexible(v('ambientes'))),
      dormitorios: entero(numeroFlexible(v('dormitorios'))),
      banos: entero(numeroFlexible(v('banos'))),
      cocheras: entero(numeroFlexible(v('cocheras'))),
      antiguedad: entero(numeroFlexible(v('antiguedad'))),
      descripcion: v('descripcion') || null,
      lat: numeroFlexible(v('lat')),
      lng: numeroFlexible(v('lng')),
      ...this.operacionDeLaFila(v, nroFila, problemas),
    };
  }

  /**
   * La operación y su precio, si la planilla los trae.
   *
   * ── Las tres reglas ──
   *
   * **Sin precio no hay operación.** Una operación en la base con `precio NULL`
   * es una propiedad «disponible» que no dice a cuánto: aparece en la cartera y
   * en los filtros de precio no entra en ningún rango. Es peor que no tenerla.
   *
   * **Con precio y sin operación se asume VENTA y se avisa.** Es lo que trae la
   * mayoría de las planillas de cartera, pero se avisa porque adivinar mal
   * mete un alquiler en la cartera de venta.
   *
   * **Entra como `disponible`, no como `borrador`.** Quien migra su cartera
   * quiere verla publicada, no revisar doscientos borradores uno por uno.
   */
  private operacionDeLaFila(
    v: (campo: string) => string | undefined,
    nroFila: number,
    problemas: ProblemaFila[],
  ): Record<string, unknown> {
    const precio = numeroFlexible(v('precio'));
    const crudo = normalizar(v('operacion') ?? '');

    if (precio === null) {
      // Una operación declarada sin precio se avisa: la planilla dice que la
      // propiedad está en venta y no dice a cuánto, y eso el importador no lo
      // puede inventar.
      if (crudo) {
        problemas.push({
          fila: nroFila,
          campo: 'precio',
          mensaje: `Dice "${v('operacion')}" pero no trae precio; la propiedad se importa sin operación.`,
          grave: false,
        });
      }
      return { operacion: null };
    }

    let operacion = OPERACION_ALIAS[crudo] ?? null;
    if (!operacion) {
      problemas.push({
        fila: nroFila,
        campo: 'operacion',
        mensaje: crudo
          ? `Operación "${v('operacion')}" no reconocida; se importa como venta.`
          : 'Sin operación declarada; con un precio cargado se importa como venta.',
        grave: false,
      });
      operacion = 'venta';
    }

    // La moneda por defecto sigue a la operación, que es como se cotiza en esta
    // plaza: las ventas en dólares, los alquileres en pesos. Adivinar al revés
    // convierte un alquiler de 400.000 en uno de USD 400.000.
    const monedaCruda = (v('moneda') ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const moneda = monedaCruda === 'USD' || monedaCruda === 'ARS'
      ? monedaCruda
      : (operacion === 'venta' ? 'USD' : 'ARS');

    return {
      operacion,
      precio,
      moneda,
      expensas: numeroFlexible(v('expensas')),
    };
  }

  private async insertarPersona(ej: Ejecutor, tenantId: string, d: Record<string, unknown>) {
    await ej.query(
      `INSERT INTO persona (tenant_id, nombre, apellido, doc_tipo, doc_numero,
                            email, telefono, domicilio, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId, d.nombre, d.apellido, d.docTipo, d.docNumero,
        d.email, d.telefono, d.domicilio, d.notas,
      ],
    );
  }

  private async insertarPropiedad(ej: Ejecutor, tenantId: string, d: Record<string, unknown>) {
    const { rows: cod } = await ej.query<{ codigo: number }>(
      'SELECT app_proximo_codigo_propiedad() AS codigo',
    );

    // La procedencia de las coordenadas se resuelve acá y no con un CASE en el
    // SQL: usar el mismo parámetro dentro de un `IS NULL` deja a Postgres sin
    // forma de inferir su tipo, y falla con "could not determine data type".
    const tieneUbicacion = d.lat !== null && d.lng !== null;

    const { rows: prop } = await ej.query<{ id: string }>(
      `INSERT INTO propiedad (
         tenant_id, codigo, calle, numero, piso, depto, localidad, provincia, cp,
         tipo, sup_total, sup_cubierta, ambientes, dormitorios, banos, cocheras,
         antiguedad, descripcion, lat, lng, geocode_fuente, geocode_el)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22)
       RETURNING id`,
      [
        tenantId, cod[0].codigo, d.calle, d.numero, d.piso, d.depto,
        d.localidad, d.provincia, d.cp, d.tipo, d.supTotal, d.supCubierta,
        d.ambientes, d.dormitorios, d.banos, d.cocheras, d.antiguedad,
        d.descripcion, d.lat, d.lng,
        tieneUbicacion ? 'importado' : null,
        tieneUbicacion ? new Date() : null,
      ],
    );

    // La operación va en la MISMA transacción que la propiedad: si el precio
    // rebota por lo que sea, no queda una propiedad huérfana sin él — que es
    // exactamente el estado que esto vino a evitar.
    if (d.operacion) {
      await ej.query(
        `INSERT INTO operacion (tenant_id, propiedad_id, tipo, precio, moneda,
                                expensas, estado)
         VALUES ($1,$2,$3,$4,$5,$6,'disponible')`,
        [tenantId, prop[0].id, d.operacion, d.precio, d.moneda, d.expensas ?? null],
      );
    }
  }

  /** Traduce el error de Postgres a algo que le sirva a quien mira la planilla. */
  private explicar(err: unknown): string {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';

    if (code === '23505') return 'Ya existe una persona con ese documento.';
    if (code === 'BE001') {
      return (err as Error).message;
    }
    if (code === '22001') return 'Un valor es demasiado largo para su columna.';
    if (code === '23514') return 'Un valor no es válido para su campo.';
    return err instanceof Error ? err.message : 'Error desconocido.';
  }
}

function entero(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}

/** Plantilla de ejemplo, para que nadie tenga que adivinar las columnas. */
export const PLANTILLAS: Record<Recurso, string> = {
  personas:
    'nombre;apellido;dni;email;telefono;domicilio;notas\r\n' +
    'Marta;Silva;18456789;marta@ejemplo.com;2614567890;San Martín 100;Propietaria\r\n',
  // La plantilla trae operación, precio y moneda: es lo que hace que una
  // cartera importada sirva. Sin ellos entran doscientas propiedades y ni un
  // número, y quien migró tiene que cargar los precios a mano igual.
  propiedades:
    'calle;numero;piso;depto;localidad;provincia;tipo;superficie total;ambientes;dormitorios;banos;cocheras;operacion;precio;moneda;expensas;descripcion\r\n' +
    'Arístides Villanueva;345;3;B;Ciudad;Mendoza;departamento;78;3;2;1;1;alquiler;480000;ARS;62000;"Luminoso, con balcón"\r\n' +
    'San Martín;1200;;;Godoy Cruz;Mendoza;casa;210;5;3;2;2;venta;185000;USD;;"Con parque y pileta"\r\n',
};
