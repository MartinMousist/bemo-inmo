import { esIpPublica, revisarUrl } from '../src/importar/url-imagen.motor';

/**
 * El filtro de URLs del importador de fotos.
 *
 * Cada caso de acá es una dirección a la que nuestro servidor NO tiene que ir
 * porque se lo pidió una planilla. Desde adentro de la red llega a lugares que
 * el usuario no llega, y una URL bien elegida convertiría el importador en una
 * ventana a la red interna.
 */
describe('Qué URL de imagen se puede ir a buscar', () => {
  const ok = (u: string) => revisarUrl(u).ok;
  const motivo = (u: string) => revisarUrl(u).motivo;

  it('una foto en un CDN cualquiera pasa', () => {
    expect(ok('https://images.tokkobroker.com/thumbs/abc123.jpg')).toBe(true);
    expect(ok('http://static.ejemplo.com.ar/fotos/1.jpg')).toBe(true);
    expect(ok('https://cdn.ejemplo.com:8443/x.png')).toBe(true);
  });

  describe('lo que apunta a la propia máquina', () => {
    it.each([
      'http://localhost/x.jpg',
      'http://127.0.0.1/x.jpg',
      'http://127.1.2.3/x.jpg',
      'http://[::1]/x.jpg',
      'http://algo.localhost/x.jpg',
    ])('%s', (u) => expect(ok(u)).toBe(false));
  });

  describe('lo que apunta a la red interna', () => {
    it.each([
      ['http://10.0.0.5/x.jpg', 'el Postgres de la red'],
      ['http://192.168.1.10/x.jpg', 'la oficina'],
      ['http://172.16.0.9/x.jpg', 'privada 172.16–31'],
      ['http://impresora.local/x.jpg', 'mDNS'],
      ['http://db.internal/x.jpg', 'nombre privado de la nube'],
    ])('%s — %s', (u) => expect(ok(u)).toBe(false));

    /**
     * El caso más grave de todos.
     *
     * `169.254.169.254` es el servicio de metadatos de AWS, GCP y Azure:
     * devuelve las credenciales de la instancia a quien le pregunte desde
     * adentro. Una foto apuntada ahí se lleva las llaves del servidor.
     */
    it('169.254.169.254 — los metadatos de la nube', () => {
      expect(ok('http://169.254.169.254/latest/meta-data/iam/security-credentials/')).toBe(false);
      expect(motivo('http://169.254.169.254/x')).toBe('ip-privada');
    });
  });

  it('una IPv4 disfrazada de IPv6 no saltea el filtro', () => {
    // Sin desarmar `::ffff:`, el filtro entero de IPv4 se saltea escribiendo la
    // dirección de esta forma.
    expect(esIpPublica('::ffff:10.0.0.5')).toBe(false);
    expect(esIpPublica('::ffff:8.8.8.8')).toBe(true);
  });

  it('otros protocolos no se hablan', () => {
    // `file:` leería el disco del servidor; los otros sirven para hablarle a
    // servicios de la red que no son HTTP.
    expect(motivo('file:///etc/passwd')).toBe('esquema');
    expect(motivo('gopher://interno:70/x')).toBe('esquema');
    expect(motivo('ftp://archivos/x.jpg')).toBe('esquema');
    expect(motivo('no es una url')).toBe('esquema');
  });

  it('un puerto que no es de web no se toca', () => {
    // Sin esto, la planilla puede hacerle un pedido al Redis o al Postgres.
    expect(motivo('http://interno.ejemplo.com:6379/x')).toBe('puerto');
    expect(motivo('http://interno.ejemplo.com:5432/x')).toBe('puerto');
    expect(ok('https://cdn.ejemplo.com:443/x.jpg')).toBe(true);
  });

  it('una URL con credenciales se rechaza', () => {
    // No hay razón legítima para que una planilla las traiga, y sí varias para
    // usarlas para saltear un proxy.
    expect(motivo('http://usuario:clave@cdn.ejemplo.com/x.jpg')).toBe('credenciales');
  });

  /**
   * Esto es la MITAD del trabajo.
   *
   * `interno.ejemplo.com` es un nombre público que puede resolver a `10.0.0.5`.
   * El texto de la URL no lo puede saber; por eso la IP se vuelve a comprobar
   * después de resolver el nombre y antes de conectar.
   */
  it('un nombre público pasa el filtro de texto: la IP se revisa después', () => {
    expect(ok('http://interno.ejemplo.com/x.jpg')).toBe(true);
    // Y la segunda mitad, que es la que lo agarra:
    expect(esIpPublica('10.0.0.5')).toBe(false);
  });

  it('el rango de CGNAT tampoco sale a internet', () => {
    expect(esIpPublica('100.64.0.1')).toBe(false);
    expect(esIpPublica('100.128.0.1')).toBe(true);
  });
});
