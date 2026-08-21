import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  detectarSeparador,
  fechaFlexible,
  numeroFlexible,
  parsearCsv,
} from '../src/importar/csv.parser';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Importador CSV.
 *
 * Todos los casos raros de acá salieron de pensar en una planilla REAL: la
 * escribió una persona, la exportó Excel, y tiene comas adentro de las
 * direcciones y números escritos de cinco maneras distintas.
 */
describe('Importación desde CSV', () => {
  describe('parser', () => {
    it('respeta las comas dentro de comillas', () => {
      // Un split(',') parte esta dirección en dos columnas y corre todo el resto.
      const r = parsearCsv('calle,localidad\n"San Martín 1450, Piso 3",Godoy Cruz', ',');
      expect(r.filas[0].calle).toBe('San Martín 1450, Piso 3');
      expect(r.filas[0].localidad).toBe('Godoy Cruz');
    });

    it('entiende las comillas escapadas', () => {
      const r = parsearCsv('desc\n"Dijo ""hola"" al entrar"', ',');
      expect(r.filas[0].desc).toBe('Dijo "hola" al entrar');
    });

    it('soporta saltos de línea dentro de un campo', () => {
      const r = parsearCsv('calle,desc\nMitre,"Piso 1\nCon balcón"', ',');
      expect(r.filas).toHaveLength(1);
      expect(r.filas[0].desc).toContain('\n');
    });

    it('detecta el separador solo', () => {
      expect(detectarSeparador('a;b;c\n1;2;3')).toBe(';');
      expect(detectarSeparador('a,b,c\n1,2,3')).toBe(',');
      expect(detectarSeparador('a\tb\tc')).toBe('\t');
    });

    it('se come el BOM de Excel', () => {
      // Sin esto, la primera columna se llama "﻿calle" y no matchea nunca.
      const r = parsearCsv('﻿calle;numero\nMitre;100');
      expect(r.cabeceras[0]).toBe('calle');
      expect(r.filas[0].calle).toBe('Mitre');
    });

    it('normaliza los nombres de columna', () => {
      const r = parsearCsv('Sup. Total;AMBIENTES;Año\n78;3;1990');
      expect(r.cabeceras).toEqual(['sup_total', 'ambientes', 'ano']);
    });

    it('ignora las filas totalmente vacías', () => {
      const r = parsearCsv('a;b\n1;2\n;\n3;4');
      expect(r.filas).toHaveLength(2);
    });
  });

  describe('números escritos por personas', () => {
    it.each([
      ['1.234,56', 1234.56],   // formato argentino
      ['1,234.56', 1234.56],   // formato inglés
      ['1234.56', 1234.56],
      ['1234,56', 1234.56],
      ['1.234', 1234],         // miles, NO 1,234
      ['$ 485.000', 485000],
      ['485000', 485000],
      ['78', 78],
      ['0,5', 0.5],
      ['-3,5', -3.5],
    ])('interpreta "%s" como %s', (entrada, esperado) => {
      expect(numeroFlexible(entrada)).toBe(esperado);
    });

    it('lo que no se entiende es null, nunca cero', () => {
      // Un 0 inventado en un precio o una superficie es peor que un vacío.
      expect(numeroFlexible('')).toBeNull();
      expect(numeroFlexible('s/d')).toBeNull();
      expect(numeroFlexible(null)).toBeNull();
    });
  });

  describe('fechas escritas por personas', () => {
    it('dd/mm/aaaa es argentino, nunca mm/dd', () => {
      // 03/04/2026 es 3 de abril. Interpretarlo al revés cambia un vencimiento.
      expect(fechaFlexible('03/04/2026')).toBe('2026-04-03');
      expect(fechaFlexible('31/12/2025')).toBe('2025-12-31');
    });

    it('acepta ISO y años de dos dígitos', () => {
      expect(fechaFlexible('2026-04-03')).toBe('2026-04-03');
      expect(fechaFlexible('3-4-26')).toBe('2026-04-03');
    });

    it('rechaza una fecha imposible', () => {
      expect(fechaFlexible('31/02/2026')).toBeNull();
      expect(fechaFlexible('cualquiera')).toBeNull();
    });
  });

  describe('API', () => {
    let app: INestApplication;
    let inmo: Inmobiliaria;

    beforeAll(async () => {
      await limpiarFixtures();
      app = await crearApp();
      inmo = await crearInmobiliaria('import', app.get(TokensService));
    }, 60_000);

    afterAll(async () => {
      await app?.close();
      await limpiarFixtures();
    });

    const como = (rol: 'owner' | 'admin' | 'agente' = 'owner') => auth(inmo.tokens[rol]);
    const http = () => request(app.getHttpServer());

    it('la previsualización NO escribe nada', async () => {
      const csv = 'nombre;apellido;dni\nAna;Prueba;11222333\n';

      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(prev.body.aImportar).toBe(1);

      const lista = await http().get('/v1/personas?q=11222333').set(...como()).expect(200);
      expect(lista.body.total).toBe(0);
    });

    it('reconoce los alias de columna de una planilla real', async () => {
      const csv = 'Nombres;Apellidos;Documento;Celular;Correo\nJorge;Perez;22333444;2615551234;j@e.com\n';

      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(prev.body.aImportar).toBe(1);
      expect(prev.body.muestra[0]).toMatchObject({
        nombre: 'Jorge', apellido: 'Perez',
        docNumero: '22333444', telefono: '2615551234', email: 'j@e.com',
      });
    });

    it('importa de verdad y reporta por número de fila del archivo', async () => {
      const csv =
        'nombre;dni\n' +
        'Uno;30111000\n' +
        ';30111001\n' +          // fila 3: sin nombre
        'Tres;30111002\n';

      const r = await http().post('/v1/importar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(r.body.importadas).toBe(2);
      expect(r.body.omitidas).toBe(1);
      // La fila que reporta es la que el usuario ve en Excel: la 3, contando
      // el encabezado. Decir "índice 1" no le sirve a nadie.
      expect(r.body.problemas[0].fila).toBe(3);
      expect(r.body.problemas[0].mensaje).toContain('Sin nombre');
    });

    it('una fila mala no tumba las buenas', async () => {
      const csv =
        'nombre;dni\n' +
        'Repetido;40555000\n' +
        'Otro;40555000\n' +     // mismo documento: choca
        'Bueno;40555001\n';

      const r = await http().post('/v1/importar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(r.body.importadas).toBe(2);
      expect(r.body.problemas[0].mensaje).toContain('documento');
    });

    it('deduce el tipo de documento por el largo', async () => {
      const csv = 'nombre;documento\nConCuit;30712345679\nConDni;25888777\n';
      await http().post('/v1/importar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      const cuit = await http().get('/v1/personas?q=30712345679').set(...como()).expect(200);
      expect(cuit.body.items[0].docTipo).toBe('cuit');

      const dni = await http().get('/v1/personas?q=25888777').set(...como()).expect(200);
      expect(dni.body.items[0].docTipo).toBe('dni');
    });

    it('importa propiedades con números escritos a mano', async () => {
      const csv =
        'calle;numero;localidad;tipo;superficie total;ambientes\n' +
        'Belgrano;100;Ciudad;Depto;78,5;3\n' +
        'Rivadavia;200;Ciudad;Casa;1.250;5\n';

      const r = await http().post('/v1/importar').set(...como())
        .send({ recurso: 'propiedades', csv }).expect(201);
      expect(r.body.importadas).toBe(2);

      const lista = await http().get('/v1/propiedades?q=Rivadavia').set(...como()).expect(200);
      // "1.250" son mil doscientos cincuenta metros, no 1,25.
      expect(lista.body.items[0].supTotal).toBe(1250);
      expect(lista.body.items[0].tipo).toBe('casa');
    });

    it('un tipo desconocido no pierde la fila: avisa y usa uno por defecto', async () => {
      const csv = 'calle;tipo\nSanMartin;Chalet Premium\n';

      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'propiedades', csv }).expect(201);

      expect(prev.body.aImportar).toBe(1);
      const aviso = prev.body.problemas.find((p: { grave: boolean }) => !p.grave);
      expect(aviso.mensaje).toContain('no reconocido');
    });

    it('avisa qué columnas ignoró', async () => {
      const csv = 'nombre;color_favorito;signo\nAna;azul;piscis\n';
      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(prev.body.columnasIgnoradas).toEqual(
        expect.arrayContaining(['color_favorito', 'signo']),
      );
    });

    it('un archivo sin ninguna columna reconocible lo dice claro', async () => {
      const csv = 'aaa;bbb\n1;2\n';
      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'personas', csv }).expect(201);

      expect(prev.body.aImportar).toBe(0);
      expect(prev.body.problemas.some((p: { mensaje: string }) =>
        p.mensaje.includes('Ninguna columna coincide'))).toBe(true);
    });

    it('un archivo vacío da 422, no un 500', async () => {
      const r = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'personas', csv: '' }).expect(422);
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });

    it('la plantilla de ejemplo trae BOM y se puede reimportar', async () => {
      const res = await http().get('/v1/importar/plantilla/propiedades.csv')
        .set(...como()).expect(200);

      expect(res.text.charCodeAt(0)).toBe(0xfeff);

      // La plantilla que el sistema entrega tiene que poder volver a entrar.
      //
      // Dos filas y no una: la plantilla muestra un ALQUILER en pesos y una
      // VENTA en dólares, porque la moneda por defecto depende de la operación
      // y con un solo ejemplo eso no se ve.
      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'propiedades', csv: res.text }).expect(201);
      expect(prev.body.aImportar).toBe(2);
      expect(prev.body.problemas.filter((p: { grave: boolean }) => p.grave)).toHaveLength(0);
    });

    it('el asesor no puede importar', async () => {
      await http().post('/v1/importar').set(...como('agente'))
        .send({ recurso: 'personas', csv: 'nombre\nX\n' }).expect(403);
    });

    /**
     * Migrar una cartera desde otro sistema.
     *
     * Antes el importador tomaba la propiedad y NO el precio: entraban
     * doscientas fichas y ni un número, así que quien migraba tenía que cargar
     * los precios a mano igual. La planilla que exporta cualquier CRM del rubro
     * trae operación y precio; ahora se leen.
     */
    describe('la operación y su precio', () => {
      it('importa la propiedad CON su precio, lista para verse en la cartera', async () => {
        const csv =
          'calle;numero;localidad;tipo;operacion;precio;moneda;expensas\n' +
          'Belgrano;1240;Ciudad;departamento;alquiler;480000;ARS;62000\n' +
          'San Martín;1200;Godoy Cruz;casa;venta;185000;USD;\n';

        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(2);

        const lista = await http().get('/v1/propiedades?q=Belgrano').set(...como()).expect(200);
        const p = lista.body.items[0];
        expect(p.operaciones).toHaveLength(1);
        expect(p.operaciones[0]).toMatchObject({
          tipo: 'alquiler', precio: 480000, moneda: 'ARS',
          // `disponible` y no `borrador`: quien migra su cartera quiere verla
          // publicada, no revisar doscientos borradores uno por uno.
          estado: 'disponible',
        });
      });

      it('sin precio no se inventa una operación', async () => {
        // Una operación con `precio NULL` es una propiedad «disponible» que no
        // dice a cuánto: sale en la cartera y no entra en ningún filtro de
        // precio. Es peor que no tenerla.
        const csv =
          'calle;localidad;tipo;operacion;precio\n' +
          'Sin Precio;Ciudad;casa;venta;\n';

        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);

        expect(r.body.importadas).toBe(1);
        expect(r.body.problemas[0].mensaje).toContain('no trae precio');
        expect(r.body.problemas[0].grave).toBe(false);

        const lista = await http().get('/v1/propiedades?q=Sin Precio').set(...como()).expect(200);
        expect(lista.body.items[0].operaciones).toHaveLength(0);
      });

      it('con precio y sin operación asume venta, y lo dice', async () => {
        const csv = 'calle;localidad;tipo;precio\nSolo Precio;Ciudad;casa;250000\n';

        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);

        expect(r.body.problemas[0].mensaje).toContain('se importa como venta');

        const lista = await http().get('/v1/propiedades?q=Solo Precio').set(...como()).expect(200);
        expect(lista.body.items[0].operaciones[0].tipo).toBe('venta');
      });

      /**
       * La moneda por defecto sigue a la OPERACIÓN, como se cotiza en esta
       * plaza: las ventas en dólares, los alquileres en pesos.
       *
       * Al revés, un alquiler de 400.000 se convierte en uno de USD 400.000 —
       * un error de dos órdenes de magnitud que además se ve razonable.
       */
      it('sin moneda, la venta va en dólares y el alquiler en pesos', async () => {
        const csv =
          'calle;localidad;tipo;operacion;precio\n' +
          'Moneda Venta;Ciudad;casa;venta;185000\n' +
          'Moneda Alquiler;Ciudad;departamento;alquiler;400000\n';

        await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);

        const v = await http().get('/v1/propiedades?q=Moneda Venta').set(...como()).expect(200);
        expect(v.body.items[0].operaciones[0].moneda).toBe('USD');

        const a = await http().get('/v1/propiedades?q=Moneda Alquiler').set(...como()).expect(200);
        expect(a.body.items[0].operaciones[0].moneda).toBe('ARS');
      });

      it('entiende cómo llama cada planilla a lo mismo', async () => {
        const csv =
          'calle;localidad;tipo;operacion;precio;moneda\n' +
          'Renta Uno;Ciudad;departamento;RENTA;400000;ARS\n' +
          'Sale Dos;Ciudad;casa;Sale;185000;USD\n' +
          'Temporario Tres;Ciudad;departamento;temporario;90000;ARS\n';

        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(3);

        const t = await http().get('/v1/propiedades?q=Temporario Tres').set(...como()).expect(200);
        expect(t.body.items[0].operaciones[0].tipo).toBe('alquiler_temporario');
      });

      it('la plantilla de ejemplo trae las columnas de precio', async () => {
        // Si la plantilla no las trae, nadie se entera de que se pueden mandar.
        const r = await http().get('/v1/importar/plantilla/propiedades.csv')
          .set(...como()).expect(200);
        expect(r.text).toContain('operacion');
        expect(r.text).toContain('precio');
        expect(r.text).toContain('moneda');
      });
    });

    /**
     * El propietario, que es lo que convierte una lista de direcciones en una
     * cartera administrable: sin titular no hay a quién liquidarle.
     */
    describe('el propietario', () => {
      it('ata la propiedad al dueño que YA existe, buscándolo por documento', async () => {
        await http().post('/v1/importar').set(...como())
          .send({ recurso: 'personas', csv: 'nombre;apellido;dni\nMarta;Quiroga;16777333\n' })
          .expect(201);

        const csv =
          'calle;localidad;tipo;titular_doc\n' +
          'Con Dueña;Ciudad;casa;16.777.333\n';
        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(1);

        const lista = await http().get('/v1/propiedades?q=Con Dueña').set(...como()).expect(200);
        const det = await http().get(`/v1/propiedades/${lista.body.items[0].id}`)
          .set(...como()).expect(200);
        expect(det.body.titulares).toHaveLength(1);
        expect(det.body.titulares[0].nombre).toContain('Quiroga');
        expect(det.body.titulares[0].porcentaje).toBe(100);
      });

      it('el documento se compara sin puntos: la planilla los escribe como quiere', async () => {
        // «16.777.333» y «16777333» son la misma persona. Sin normalizar, la
        // segunda propiedad crearía una Marta Quiroga duplicada.
        const csv = 'calle;localidad;tipo;titular_doc\nSin Puntos;Ciudad;casa;16777333\n';
        await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);

        const r = await http().get('/v1/personas?q=16777333').set(...como()).expect(200);
        expect(r.body.items).toHaveLength(1);
      });

      it('si el dueño no existe se crea, y doce propiedades suyas no lo duplican', async () => {
        const csv =
          'calle;localidad;tipo;titular_doc;titular\n' +
          'Nueva Uno;Ciudad;casa;20999888;Ernesto Ballester\n' +
          'Nueva Dos;Ciudad;casa;20999888;Ernesto Ballester\n' +
          'Nueva Tres;Ciudad;casa;20999888;Ernesto Ballester\n';

        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(3);

        // UNA persona, no tres: la segunda fila ya lo encuentra por documento.
        const p = await http().get('/v1/personas?q=20999888').set(...como()).expect(200);
        expect(p.body.items).toHaveLength(1);
        expect(p.body.items[0].nombre).toBe('Ernesto');
        expect(p.body.items[0].apellido).toBe('Ballester');
        expect(p.body.items[0].docTipo).toBe('dni');
      });

      it('once dígitos se cargan como CUIT y no como DNI', async () => {
        const csv =
          'calle;localidad;tipo;titular_doc;titular\n' +
          'De Sociedad;Ciudad;local;30712345670;Inversora del Oeste SRL\n';
        await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);

        const p = await http().get('/v1/personas?q=30712345670').set(...como()).expect(200);
        expect(p.body.items[0].docTipo).toBe('cuit');
      });

      it('un documento que no existe y sin nombre no crea a nadie', async () => {
        // Una persona con documento y sin nombre es una fila que después nadie
        // sabe qué es. La propiedad entra igual, sin titular.
        const csv = 'calle;localidad;tipo;titular_doc\nHuerfana;Ciudad;casa;27000111\n';
        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(1);

        const p = await http().get('/v1/personas?q=27000111').set(...como()).expect(200);
        expect(p.body.items).toHaveLength(0);
      });

      it('sin columnas de titular no pasa nada: la mayoría de las planillas no lo trae', async () => {
        const csv = 'calle;localidad;tipo\nSin Titular;Ciudad;casa\n';
        const r = await http().post('/v1/importar').set(...como())
          .send({ recurso: 'propiedades', csv }).expect(201);
        expect(r.body.importadas).toBe(1);
        expect(r.body.problemas).toHaveLength(0);
      });
    });
  });
});
