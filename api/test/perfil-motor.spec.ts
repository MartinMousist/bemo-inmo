import {
  panelesDeInicio,
  panelesDelTablero,
  type Perfil,
} from '../src/cuenta/perfil.motor';
import { MODULOS, MODULOS_POR_TIPO } from '../src/cuenta/modulos.motor';

/**
 * Qué ve cada clase de cuenta en Inicio y en el Tablero.
 *
 * Lo que se prueba acá y no contra la base: que la decisión dependa del MÓDULO
 * y no del tipo. Es la diferencia entre un interruptor que hace algo y uno que
 * miente.
 */
describe('perfil.motor', () => {
  const inmobiliaria: Perfil = {
    tipo: 'inmobiliaria',
    activos: MODULOS_POR_TIPO.inmobiliaria,
  };
  const gestor: Perfil = { tipo: 'gestor', activos: MODULOS_POR_TIPO.gestor };

  describe('Inicio', () => {
    it('la inmobiliaria ve su embudo enfriándose', () => {
      expect(panelesDeInicio(inmobiliaria).oportunidadesFrias).toBe(true);
    });

    it('el gestor no: sin Leads la lista sería siempre vacía', () => {
      expect(panelesDeInicio(gestor).oportunidadesFrias).toBe(false);
    });

    it('al gestor se le cuentan las unidades vacías, que son su mes sin cobrar', () => {
      expect(panelesDeInicio(gestor).unidadesVacias).toBe(true);
      // A la inmobiliaria no: su menú ya parte la cartera en venta y alquiler.
      expect(panelesDeInicio(inmobiliaria).unidadesVacias).toBe(false);
    });
  });

  describe('Tablero', () => {
    it('la inmobiliaria ve todo', () => {
      expect(panelesDelTablero(inmobiliaria)).toEqual({
        embudo: true,
        honorarios: true,
        comisionesPorCobrar: true,
        rankingPorAgente: true,
      });
    });

    it('al gestor se le van el embudo y lo de comisiones', () => {
      const p = panelesDelTablero(gestor);
      expect(p.embudo).toBe(false);
      expect(p.comisionesPorCobrar).toBe(false);
      expect(p.rankingPorAgente).toBe(false);
    });

    it('los honorarios NO se van: es de lo que vive un gestor', () => {
      // `honorariosDevengados` suma comisiones de venta y honorarios de
      // liquidación. Los segundos son el ingreso propio de quien administra:
      // sacarle el panel por no vender le esconde justo lo que más mira.
      expect(panelesDelTablero(gestor).honorarios).toBe(true);
    });
  });

  describe('el interruptor hace lo que promete', () => {
    it('un gestor que prende Leads recupera su embudo', () => {
      const conLeads: Perfil = { tipo: 'gestor', activos: ['leads'] };
      expect(panelesDelTablero(conLeads).embudo).toBe(true);
      expect(panelesDeInicio(conLeads).oportunidadesFrias).toBe(true);
      // Y sigue sin lo de comisiones: prendió uno, no los cinco.
      expect(panelesDelTablero(conLeads).rankingPorAgente).toBe(false);
    });

    it('una inmobiliaria que apaga Comisiones deja de ver el ranking', () => {
      // El tipo sigue siendo inmobiliaria: si la decisión mirara el tipo, esto
      // devolvería `true` y el interruptor sería decorativo.
      const sinComisiones: Perfil = {
        tipo: 'inmobiliaria',
        activos: MODULOS_POR_TIPO.inmobiliaria.filter((m) => m !== 'comisiones'),
      };
      expect(panelesDelTablero(sinComisiones).rankingPorAgente).toBe(false);
      expect(panelesDelTablero(sinComisiones).embudo).toBe(true);
    });
  });

  it('no decide sobre módulos que no existen', () => {
    // Si mañana se renombra una clave en MODULOS, este test cae acá y no en una
    // pantalla que dejó de mostrar un panel sin que nadie se diera cuenta.
    const claves = new Set(MODULOS.map((m) => m.clave));
    for (const usada of ['leads', 'ventas', 'comisiones']) {
      expect(claves.has(usada)).toBe(true);
    }
  });
});
