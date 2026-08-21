import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';

/**
 * La Red entre inmobiliarias.
 *
 * Una inmobiliaria marca una propiedad como compartida y ofrece un porcentaje
 * de su comisión a quien traiga el comprador. Las demás la ven en el buscador
 * de la Red y pueden ofrecerla a sus clientes.
 *
 * ── Lo que hay que tener claro antes de leer el código ──
 *
 * Esto es lo ÚNICO del sistema que cruza el borde entre inmobiliarias. Todo lo
 * demás está aislado por RLS y la etapa 17 se dedicó entera a blindarlo.
 *
 * Por eso la Red no relaja ni una política: es una función `SECURITY DEFINER`
 * (`app_red_buscar`) que filtra por `red_compartida` adentro, donde quien la
 * llama no puede tocarlo, y devuelve una proyección recortada. La calle sí, el
 * número no; nunca el titular, nunca las notas internas, nunca el captador.
 *
 * ── Una advertencia sobre el valor de esto ──
 *
 * Una red con una sola inmobiliaria no es una red. El buscador va a devolver
 * cero hasta que haya varias cuentas compartiendo, y eso es correcto: preferimos
 * un vacío honesto a un catálogo inflado con lo propio. La pantalla lo dice con
 * todas las letras en vez de mostrar una tabla vacía sin explicación.
 */
@Injectable()
export class RedService {
  constructor(private readonly db: DbService) {}

  /** Qué tan poblada está la Red hoy. La pantalla lo usa para no mentir. */
  async pulso(tenantId: string) {
    const rows = await this.db.query<{ propiedades: string; inmobiliarias: string }>(
      'SELECT * FROM app_red_total($1)',
      [tenantId],
    );
    return {
      propiedades: Number(rows[0]?.propiedades ?? 0),
      inmobiliarias: Number(rows[0]?.inmobiliarias ?? 0),
    };
  }

  async buscar(
    tenantId: string,
    f: {
      operacion?: string; tipo?: string; localidad?: string;
      precioMin?: number; precioMax?: number; limite?: number;
    },
  ) {
    const rows = await this.db.query(
      'SELECT * FROM app_red_buscar($1, $2, $3, $4, $5, $6, $7)',
      [
        tenantId,
        f.operacion ?? null, f.tipo ?? null, f.localidad ?? null,
        f.precioMin ?? null, f.precioMax ?? null, f.limite ?? 50,
      ],
    );

    return rows.map((r: Record<string, unknown>) => ({
      id: r.propiedad_id,
      codigo: r.codigo,
      tipo: r.tipo,
      // Sin altura: es lo que la función decidió no devolver, y se refleja tal
      // cual en el nombre del campo para que nadie lo confunda con la dirección.
      zona: [r.calle, r.localidad, r.provincia].filter(Boolean).join(', '),
      ambientes: r.ambientes,
      dormitorios: r.dormitorios,
      banos: r.banos,
      supTotal: r.sup_total === null ? null : Number(r.sup_total),
      operacion: r.operacion,
      precio: r.precio === null ? null : Number(r.precio),
      moneda: r.moneda,
      comisionPct: r.comision_pct === null ? null : Number(r.comision_pct),
      inmobiliaria: r.inmobiliaria,
      inmobiliariaId: r.inmobiliaria_id,
    }));
  }

  /**
   * Publicar una propiedad en la Red, o bajarla.
   *
   * `comisionPct` es lo que se OFRECE a quien traiga el comprador, no lo que se
   * le cobra al cliente. Es una oferta publicada: el trato se cierra entre las
   * dos inmobiliarias y este número es el punto de partida de esa charla.
   */
  async compartir(
    tenantId: string,
    propiedadId: string,
    d: { compartida: boolean; comisionPct?: number | null },
  ) {
    return this.db.withTenant(tenantId, async (ej) => {
      // La existencia se comprueba PRIMERO. Si no, una propiedad de otra
      // inmobiliaria —invisible por RLS— caía en la validación de operación y
      // respondía «necesita una operación disponible», que es falso y confuso.
      // Lo encontró un test.
      const { rows: existe } = await ej.query('SELECT 1 FROM propiedad WHERE id = $1', [propiedadId]);
      if (!existe.length) throw AppError.notFound('La propiedad no existe.');

      if (d.compartida) {
        // Sin una operación disponible no hay nada que ofrecer: la propiedad no
        // aparecería igual (`app_red_buscar` la exige), y dejar el flag prendido
        // haría creer que está publicada cuando no la ve nadie.
        const { rows: op } = await ej.query<{ n: string }>(
          `SELECT count(*) AS n FROM operacion
            WHERE propiedad_id = $1 AND estado = 'disponible'`,
          [propiedadId],
        );
        if (Number(op[0].n) === 0) {
          throw new AppError(
            409,
            ErrorCode.ESTADO_INVALIDO,
            'Para compartirla en la Red necesita una operación disponible. Sin eso no la vería ninguna inmobiliaria.',
            'Conflict',
          );
        }
      }

      const { rows } = await ej.query(
        `UPDATE propiedad
            SET red_compartida = $2,
                red_comision_pct = CASE WHEN $2 THEN $3::numeric ELSE NULL END,
                red_compartida_el = CASE WHEN $2 THEN coalesce(red_compartida_el, now()) ELSE NULL END
          WHERE id = $1
          RETURNING id, red_compartida, red_comision_pct, red_compartida_el`,
        [propiedadId, d.compartida, d.comisionPct ?? null],
      );
      const r = rows[0] as Record<string, unknown>;
      return {
        compartida: r.red_compartida,
        comisionPct: r.red_comision_pct === null ? null : Number(r.red_comision_pct),
        desde: r.red_compartida_el,
      };
    });
  }

  /** Lo que esta inmobiliaria está ofreciendo hoy. */
  async misCompartidas(tenantId: string) {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query(
        `SELECT p.id, 'PROP-' || lpad(p.codigo::text,4,'0') AS codigo, p.tipo,
                p.calle, p.localidad, p.red_comision_pct, p.red_compartida_el,
                o.tipo AS operacion, o.precio, o.moneda
           FROM propiedad p
           LEFT JOIN LATERAL (
             SELECT tipo, precio, moneda FROM operacion
              WHERE propiedad_id = p.id AND estado = 'disponible' LIMIT 1
           ) o ON true
          WHERE p.red_compartida
          ORDER BY p.red_compartida_el DESC`,
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id, codigo: r.codigo, tipo: r.tipo,
        zona: [r.calle, r.localidad].filter(Boolean).join(', '),
        operacion: r.operacion,
        precio: r.precio === null ? null : Number(r.precio),
        moneda: r.moneda,
        comisionPct: r.red_comision_pct === null ? null : Number(r.red_comision_pct),
        desde: r.red_compartida_el,
      }));
    });
  }
}
