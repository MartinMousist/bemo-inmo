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
      const prev = await http().post('/v1/importar/previsualizar').set(...como())
        .send({ recurso: 'propiedades', csv: res.text }).expect(201);
      expect(prev.body.aImportar).toBe(1);
      expect(prev.body.problemas.filter((p: { grave: boolean }) => p.grave)).toHaveLength(0);
    });

    it('el asesor no puede importar', async () => {
      await http().post('/v1/importar').set(...como('agente'))
        .send({ recurso: 'personas', csv: 'nombre\nX\n' }).expect(403);
    });
  });
});
