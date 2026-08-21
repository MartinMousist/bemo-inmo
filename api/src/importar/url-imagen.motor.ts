/**
 * Qué URL de imagen se puede ir a buscar, y cuál no.
 *
 * ── Por qué esto existe y por qué es un motor aparte ──
 *
 * Importar una cartera trae las fotos como URLs escritas en una planilla. Ir a
 * buscarlas significa que **nuestro servidor hace un pedido HTTP a una
 * dirección que eligió el usuario**, y eso es un SSRF de manual: quien controla
 * la planilla controla adónde apunta nuestro backend.
 *
 * Desde adentro de la red, nuestro servidor llega a lugares que el usuario no
 * llega: el `169.254.169.254` de las nubes —que devuelve credenciales de la
 * instancia—, el Postgres en `10.x`, el MinIO del compose, un panel de
 * administración en `localhost`. Una URL que apunte ahí convierte el importador
 * en una ventana a la red interna.
 *
 * Va en un motor puro porque es la clase de código donde un caso olvidado no se
 * ve en pantalla: se prueba en una mesa, con la lista de direcciones que hay que
 * rechazar escrita como casos.
 *
 * ── Lo que NO alcanza ──
 *
 * Filtrar el texto de la URL no alcanza por sí solo: `http://interno.ejemplo.com`
 * puede resolver a `10.0.0.5`. Por eso esto es la primera mitad y la segunda es
 * comprobar la IP DESPUÉS de resolver el nombre, antes de conectar. Las dos son
 * necesarias; ninguna sola sirve.
 */

export type MotivoRechazo =
  | 'esquema'      // no es http ni https
  | 'credenciales' // trae usuario:clave@
  | 'puerto'       // un puerto que no es el de la web
  | 'host'         // localhost, .local, o vacío
  | 'ip-privada';  // apunta a una IP que no sale a internet

export interface Veredicto {
  ok: boolean;
  motivo?: MotivoRechazo;
  /** La URL normalizada, cuando pasa. */
  url?: string;
  host?: string;
}

/**
 * Los puertos que sirve una web.
 *
 * Sin esto, `http://interno:6379` deja hablarle al Redis de la red. Se listan
 * los de HTTP en vez de listar los prohibidos: la lista de lo permitido es
 * corta y no se queda vieja.
 */
const PUERTOS = new Set(['', '80', '443', '8080', '8443']);

/** Nombres que siempre son la propia máquina. */
const HOSTS_PROPIOS = new Set(['localhost', 'localhost.localdomain', '[::1]', '::1']);

export function revisarUrl(crudo: string): Veredicto {
  let u: URL;
  try {
    u = new URL(crudo.trim());
  } catch {
    return { ok: false, motivo: 'esquema' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    // `file:` leería el disco del servidor; `gopher:` y `dict:` sirven para
    // hablarle a otros protocolos de la red interna.
    return { ok: false, motivo: 'esquema' };
  }

  // `http://usuario:clave@destino` — no hay ninguna razón legítima para que una
  // planilla traiga credenciales, y sí varias para que alguien las use para
  // saltear un proxy.
  if (u.username || u.password) return { ok: false, motivo: 'credenciales' };

  if (!PUERTOS.has(u.port)) return { ok: false, motivo: 'puerto' };

  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, motivo: 'host' };
  if (HOSTS_PROPIOS.has(host)) return { ok: false, motivo: 'host' };

  // `.local` es mDNS: la impresora y el NAS de la oficina. `.internal` es lo que
  // usan las nubes para sus nombres privados.
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, motivo: 'host' };
  }

  // Si el host YA es una IP, se comprueba acá. Si es un nombre, esta parte no
  // puede decir nada todavía — la comprueba `esIpPublica` después de resolver.
  if (esIpLiteral(host) && !esIpPublica(host)) {
    return { ok: false, motivo: 'ip-privada' };
  }

  return { ok: true, url: u.toString(), host };
}

function esIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * ¿Esta IP sale a internet?
 *
 * Se llama DOS veces: acá, si la URL trae una IP escrita, y de nuevo con la IP
 * que devolvió el DNS. La segunda es la que importa —un nombre puede resolver a
 * `10.0.0.5`— y por eso la función está exportada.
 */
export function esIpPublica(ip: string): boolean {
  const limpio = ip.replace(/^\[|\]$/g, '');

  // ── IPv6 ──
  if (limpio.includes(':')) {
    const b = limpio.toLowerCase();
    if (b === '::' || b === '::1') return false;              // sin especificar, loopback
    if (b.startsWith('fe80')) return false;                   // link-local
    if (b.startsWith('fc') || b.startsWith('fd')) return false; // únicas locales
    // `::ffff:10.0.0.5` es una IPv4 disfrazada: se desarma y se vuelve a mirar,
    // o el filtro de IPv4 entero se saltea escribiendo la dirección así.
    const m = b.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (m) return esIpPublica(m[1]);
    return true;
  }

  // ── IPv4 ──
  const p = limpio.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;

  if (a === 0) return false;                        // «esta red»
  if (a === 10) return false;                       // privada
  if (a === 127) return false;                      // loopback
  if (a === 169 && b === 254) return false;         // link-local Y metadatos de la nube
  if (a === 172 && b >= 16 && b <= 31) return false; // privada
  if (a === 192 && b === 168) return false;         // privada
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 192 && b === 0) return false;           // reservada / documentación
  if (a >= 224) return false;                       // multicast y reservado

  return true;
}
