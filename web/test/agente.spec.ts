import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import {
  AGENTE_SIN_ASIGNAR,
  AGENTE_TODOS,
  AGENTE_YO,
  hayFiltroDeAgente,
  paramsDeAgente,
} from '../src/dominio/agente';
import { filtrosRecordados } from '../src/dominio/filtros';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('paramsDeAgente', () => {
  it('sin filtro no manda nada', () => {
    expect(paramsDeAgente(AGENTE_TODOS, UUID_A)).toEqual({});
  });

  it('«las mías» viaja como el uuid propio: no existe agenteId=mias', () => {
    // El backend tiene UNA sola semántica. Si algún día alguien manda el
    // centinela crudo, la API contesta 400 y la pantalla no carga.
    expect(paramsDeAgente(AGENTE_YO, UUID_A)).toEqual({ agenteId: UUID_A });
  });

  it('«las mías» sin sesión resuelta no inventa un filtro', () => {
    // Mandar cualquier otra cosa sería filtrar por alguien que no es nadie.
    expect(paramsDeAgente(AGENTE_YO, null)).toEqual({});
  });

  it('«sin asignar» va por su propio parámetro, no como un agenteId mágico', () => {
    // `agenteId` es un uuid validado en los seis listados. Meterle una palabra
    // obligaría a aflojar el @IsUUID() en todos para que uno solo pueda decir
    // «ninguno».
    expect(paramsDeAgente(AGENTE_SIN_ASIGNAR, UUID_A)).toEqual({ sinCaptador: 'true' });
  });

  it('un uuid de otra persona viaja tal cual', () => {
    expect(paramsDeAgente(UUID_B, UUID_A)).toEqual({ agenteId: UUID_B });
  });

  it('hayFiltroDeAgente distingue «toda la inmobiliaria» de lo demás', () => {
    expect(hayFiltroDeAgente(AGENTE_TODOS)).toBe(false);
    expect(hayFiltroDeAgente(AGENTE_YO)).toBe(true);
    expect(hayFiltroDeAgente(UUID_B)).toBe(true);
  });
});

describe('el centinela «yo» en localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('se guarda «yo» y NO el uuid: la PC del mostrador se comparte', async () => {
    // Es el motivo concreto de que exista el centinela. Si se guardara el uuid,
    // la segunda persona que abre la pantalla la ve filtrada por la primera y
    // con cero filas, sin haber elegido nada.
    const { valores } = filtrosRecordados('prueba-agente', { agente: '' });
    valores.value = { agente: AGENTE_YO };
    // El `watch` que persiste corre en el flush 'pre' de Vue, no al asignar.
    await nextTick();

    const guardado = JSON.parse(localStorage.getItem('bemo_inmo_filtros_prueba-agente')!);
    expect(guardado.agente).toBe('yo');

    // Y quien lo lee después resuelve «yo» contra SU sesión, no contra la ajena.
    expect(paramsDeAgente(guardado.agente, UUID_B)).toEqual({ agenteId: UUID_B });
  });
});

describe('filtrosRecordados.revalidar', () => {
  beforeEach(() => localStorage.clear());

  it('descarta un uuid que ya no está en el equipo', () => {
    // La regla 2 del helper, aplicada a una lista que no existe hasta que
    // vuelve el fetch: sin esto, el uuid de alguien que se fue de la
    // inmobiliaria deja la pantalla en cero filas para siempre.
    localStorage.setItem(
      'bemo_inmo_filtros_prueba-revalidar',
      JSON.stringify({ agente: UUID_B }),
    );

    const { valores, revalidar } = filtrosRecordados('prueba-revalidar', { agente: '' });
    expect(valores.value.agente).toBe(UUID_B);

    revalidar('agente', [UUID_A]);
    expect(valores.value.agente).toBe('');
  });

  it('deja en paz un uuid que sigue estando', () => {
    localStorage.setItem(
      'bemo_inmo_filtros_prueba-revalidar-2',
      JSON.stringify({ agente: UUID_A }),
    );

    const { valores, revalidar } = filtrosRecordados('prueba-revalidar-2', { agente: '' });
    revalidar('agente', [UUID_A, UUID_B]);
    expect(valores.value.agente).toBe(UUID_A);
  });
});
