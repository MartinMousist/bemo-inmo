import { createHmac } from 'node:crypto';
import { EmailAdaptador } from '../src/inbox/adaptadores/email.adaptador';
import { MetaAdaptador } from '../src/inbox/adaptadores/meta.adaptador';
import { TelegramAdaptador } from '../src/inbox/adaptadores/telegram.adaptador';
import { TwilioAdaptador } from '../src/inbox/adaptadores/twilio.adaptador';
import type { ContextoWebhook, CuentaCanal } from '../src/inbox/adaptadores/tipos';

/**
 * Los adaptadores de canal (etapa 18).
 *
 * Se prueban las dos cosas que no dependen de tener credenciales y que son las
 * que rompen en producción: **el parseo del formato ajeno** y **la verificación
 * de firma**. El endpoint del webhook es público —el proveedor no tiene cómo
 * autenticarse contra nosotros—, así que la firma es lo único que separa un
 * mensaje real de uno que inyectó cualquiera que adivinó la URL.
 */

const cuenta = (over: Partial<CuentaCanal> = {}): CuentaCanal => ({
  id: 'c1', tenantId: 't1', canal: 'telegram', proveedor: 'telegram',
  identificador: '+5492610000000', config: {}, secreto: null, ...over,
});

const ctx = (over: Partial<ContextoWebhook> = {}): ContextoWebhook => ({
  url: 'https://app.test/v1/webhooks/tok', headers: {}, cuerpo: {}, ...over,
});

describe('Adaptadores de canal', () => {
  describe('Telegram', () => {
    const a = new TelegramAdaptador();

    it('sin token, dice que falta y no promete nada', () => {
      const r = a.disponible(cuenta());
      expect(r.ok).toBe(false);
      expect(r.detalle).toContain('BotFather');
    });

    it('parsea un mensaje de texto', () => {
      const [m] = a.parsear({
        message: {
          message_id: 7, date: 1_760_000_000, text: 'hola',
          chat: { id: 12345 }, from: { first_name: 'Ana', last_name: 'Torres' },
        },
      });
      expect(m.contactoExterno).toBe('12345');
      expect(m.contactoNombre).toBe('Ana Torres');
      expect(m.cuerpo).toBe('hola');
      expect(m.idExterno).toBe('tg:7:12345');
    });

    it('toma también el mensaje EDITADO', () => {
      // Para quien lee la bandeja, el texto corregido es lo que el cliente
      // quiso decir. Perderlo deja el hilo mintiendo.
      const [m] = a.parsear({
        edited_message: { message_id: 8, text: 'perdón, era el jueves', chat: { id: 9 } },
      });
      expect(m.cuerpo).toBe('perdón, era el jueves');
    });

    it('de las fotos se queda con la de MAYOR resolución', () => {
      // Telegram manda el mismo archivo en varios tamaños, del más chico al más
      // grande. Quedarse con el primero deja una miniatura ilegible.
      const [m] = a.parsear({
        message: {
          message_id: 9, chat: { id: 1 }, caption: 'el living',
          photo: [{ file_id: 'chica' }, { file_id: 'media' }, { file_id: 'grande' }],
        },
      });
      expect(m.adjuntos[0].idExterno).toBe('grande');
      expect(m.cuerpo).toBe('el living');
    });

    it('una ubicación se convierte en un enlace que se puede abrir', () => {
      const [m] = a.parsear({
        message: { message_id: 10, chat: { id: 1 }, location: { latitude: -32.89, longitude: -68.84 } },
      });
      expect(m.adjuntos[0].tipo).toBe('ubicacion');
      expect(m.adjuntos[0].url).toContain('-32.89,-68.84');
    });

    it('lo que no tiene ni texto ni adjunto no genera mensaje', () => {
      expect(a.parsear({ message: { message_id: 1, chat: { id: 1 } } })).toEqual([]);
      expect(a.parsear({})).toEqual([]);
    });

    describe('la firma', () => {
      it('SIN secreto configurado, rechaza — el default es cerrado', () => {
        // Un endpoint público sin verificación es una bandeja que llena
        // cualquiera que adivine la URL.
        expect(a.verificarFirma(cuenta(), ctx({
          headers: { 'x-telegram-bot-api-secret-token': 'loquesea' },
        }))).toBe(false);
      });

      it('con el secreto correcto, acepta', () => {
        const c = cuenta({ config: { webhookSecret: 'abc123' } });
        expect(a.verificarFirma(c, ctx({
          headers: { 'x-telegram-bot-api-secret-token': 'abc123' },
        }))).toBe(true);
      });

      it('con el secreto equivocado, rechaza', () => {
        const c = cuenta({ config: { webhookSecret: 'abc123' } });
        expect(a.verificarFirma(c, ctx({
          headers: { 'x-telegram-bot-api-secret-token': 'abc124' },
        }))).toBe(false);
      });

      it('sin la cabecera, rechaza', () => {
        const c = cuenta({ config: { webhookSecret: 'abc123' } });
        expect(a.verificarFirma(c, ctx())).toBe(false);
      });
    });
  });

  describe('Twilio', () => {
    const a = new TwilioAdaptador();
    const TOKEN = 'un-auth-token-de-prueba';
    const URL = 'https://app.test/v1/webhooks/tok';

    const c = cuenta({
      canal: 'whatsapp', proveedor: 'twilio', secreto: TOKEN,
      config: { accountSid: 'AC123', urlPublica: URL },
    });

    /** La firma real de Twilio, calculada como la calcula Twilio. */
    function firmar(params: Record<string, string>): string {
      const base = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], URL);
      return createHmac('sha1', TOKEN).update(Buffer.from(base, 'utf8')).digest('base64');
    }

    it('valida una firma legítima', () => {
      const params = { From: 'whatsapp:+5492611111111', Body: 'hola', MessageSid: 'SM1' };
      expect(a.verificarFirma(c, ctx({
        cuerpo: params, headers: { 'x-twilio-signature': firmar(params) },
      }))).toBe(true);
    });

    it('rechaza si cambió UN parámetro', () => {
      const params = { From: 'whatsapp:+5492611111111', Body: 'hola', MessageSid: 'SM1' };
      const firma = firmar(params);
      expect(a.verificarFirma(c, ctx({
        cuerpo: { ...params, Body: 'otra cosa' }, headers: { 'x-twilio-signature': firma },
      }))).toBe(false);
    });

    it('rechaza si la URL no es la que Twilio firmó', () => {
      // Detrás de un proxy, la URL que ve Express NO es la pública. Por eso la
      // cuenta puede fijarla: si no coincide, nada valida.
      const params = { From: 'x', MessageSid: 'SM1' };
      const otra = cuenta({ ...c, config: { accountSid: 'AC123', urlPublica: 'https://otro.test/x' } });
      expect(a.verificarFirma(otra, ctx({
        cuerpo: params, headers: { 'x-twilio-signature': firmar(params) },
      }))).toBe(false);
    });

    it('sin firma, rechaza', () => {
      expect(a.verificarFirma(c, ctx({ cuerpo: {} }))).toBe(false);
    });

    it('parsea un WhatsApp con imagen', () => {
      const [m] = a.parsear({
        MessageSid: 'SM9', From: 'whatsapp:+5492611111111', ProfileName: 'Ana',
        Body: 'mirá esto', NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/1', MediaContentType0: 'image/jpeg',
      });
      // El `whatsapp:` se conserva: es la dirección con la que hay que contestar.
      expect(m.contactoExterno).toBe('whatsapp:+5492611111111');
      expect(m.contactoNombre).toBe('Ana');
      expect(m.adjuntos[0].tipo).toBe('imagen');
    });

    it('sin Account SID o token, dice qué falta', () => {
      expect(a.disponible(cuenta({ proveedor: 'twilio' })).detalle).toContain('Account SID');
      expect(a.disponible(cuenta({ proveedor: 'twilio', config: { accountSid: 'AC1' } })).detalle)
        .toContain('Auth Token');
    });
  });

  describe('Meta', () => {
    const a = new MetaAdaptador();

    it('parsea el formato anidado y saca el nombre del OTRO array', () => {
      // Los mensajes vienen en entry[].changes[].value.messages[] y el nombre
      // del remitente en value.contacts[], indexado por wa_id. Descubrir eso el
      // día que llegue la aprobación de Meta es la peor forma de encontrarse
      // con un parser.
      const ms = a.parsear({
        entry: [{
          changes: [{
            value: {
              contacts: [{ wa_id: '5492611111111', profile: { name: 'Ana Torres' } }],
              messages: [{
                id: 'wamid.1', from: '5492611111111', timestamp: '1760000000',
                type: 'text', text: { body: 'hola' },
              }],
            },
          }],
        }],
      });
      expect(ms).toHaveLength(1);
      expect(ms[0].contactoNombre).toBe('Ana Torres');
      expect(ms[0].cuerpo).toBe('hola');
      expect(ms[0].idExterno).toBe('wamid.1');
    });

    it('un webhook de estado (sin mensajes) no genera nada', () => {
      expect(a.parsear({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    });

    it('la firma se calcula sobre el cuerpo CRUDO', () => {
      // Sobre el objeto ya parseado no valida nunca: JSON.stringify cambia el
      // orden de claves y los espacios. Es el error clásico de esta integración.
      const crudo = '{"entry":[{"id":"1"}]}';
      const c = cuenta({ proveedor: 'meta', config: { appSecret: 'secreto-app' } });
      const firma = 'sha256=' + createHmac('sha256', 'secreto-app').update(crudo, 'utf8').digest('hex');

      expect(a.verificarFirma(c, ctx({ crudo, headers: { 'x-hub-signature-256': firma } }))).toBe(true);
      expect(a.verificarFirma(c, ctx({ crudo: '{"otro":1}', headers: { 'x-hub-signature-256': firma } })))
        .toBe(false);
    });

    it('sin credenciales dice que hace falta verificación de negocio', () => {
      const r = a.disponible(cuenta({ proveedor: 'meta', config: { phoneNumberId: '1' } }));
      expect(r.ok).toBe(false);
      expect(r.detalle).toContain('verificación de negocio');
    });
  });

  describe('Correo', () => {
    const a = new EmailAdaptador();

    it('separa el nombre de la dirección', () => {
      const [m] = a.parsear({ from: 'Ana Torres <ana@correo.test>', subject: 'Consulta', text: 'Hola' });
      expect(m.contactoExterno).toBe('ana@correo.test');
      expect(m.contactoNombre).toBe('Ana Torres');
    });

    it('el asunto entra al cuerpo: en un chat no tiene dónde ir', () => {
      const [m] = a.parsear({ from: 'ana@correo.test', subject: 'Depto en Godoy Cruz', text: 'Sigue disponible?' });
      expect(m.cuerpo).toContain('Depto en Godoy Cruz');
      expect(m.cuerpo).toContain('Sigue disponible?');
    });

    it('NUNCA dice que envió: no hay proveedor todavía', async () => {
      // La regla de honestidad del repo. Un mensaje que el usuario cree enviado
      // y no salió es peor que no tener el cuadro de respuesta.
      const r = await a.enviar(cuenta({ proveedor: 'smtp', canal: 'email' }), 'x@y.test', 'hola');
      expect(r.enviado).toBe(false);
      expect(r.detalle).toContain('proveedor de correo');
    });
  });
});
