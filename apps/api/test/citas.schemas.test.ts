import { describe, expect, it } from 'vitest';
import {
  createCitaSchema,
  citaListQuerySchema,
  updateCitaSchema,
} from '../src/modules/citas/schemas.js';

/**
 * EDT 5.3.3. Pruebas de esquemas nuevas de esta tarea: la estrictez del alta (campos
 * desconocidos, no probada en citas.modelo.test.ts) y citaListQuerySchema completo (no existía
 * en 5.2.1). Lo ya cubierto en citas.modelo.test.ts (campos obligatorios, estado y folio
 * rechazados en el alta, duración fuera de 1 a 4 bloques) no se repite aquí.
 */

const ids = {
  id_paciente: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  id_terapeuta: '7a2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b5c',
  id_sala: '8b3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c6d',
};

const valida = { ...ids, inicio: '2026-10-26T15:00:00Z', duracion_bloques: 2 };

describe('modificación de citas (RF 5.3.2–5.3.4)', () => {
  it('acepta cambios parciales con versión y los tres estatus', () => {
    expect(updateCitaSchema.safeParse({ version: 1, id_sala: ids.id_sala }).success).toBe(true);
    for (const estado of ['Pendiente', 'Cancelada', 'Vencida']) {
      expect(updateCitaSchema.safeParse({ version: 1, estado }).success).toBe(true);
    }
  });

  it('rechaza versión ausente, estatus desconocido y campos ajenos', () => {
    expect(updateCitaSchema.safeParse({ id_sala: ids.id_sala }).success).toBe(false);
    expect(updateCitaSchema.safeParse({ version: 1, estado: 'Confirmada' }).success).toBe(false);
    expect(updateCitaSchema.safeParse({ version: 1, folio: 'C26000001' }).success).toBe(false);
  });
});

describe('alta de citas: cuerpo estricto (EDT 5.3.3)', () => {
  it('rechaza un campo desconocido en el cuerpo del alta (RF 5.1.2)', () => {
    const result = createCitaSchema.safeParse({ ...valida, notas: 'texto libre' });
    expect(result.success).toBe(false);
  });

  it('rechaza el campo "fin": el servidor lo calcula, no se recibe del cliente', () => {
    expect(createCitaSchema.safeParse({ ...valida, fin: '2026-10-26T16:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('listado de citas: citaListQuerySchema (RF 5.2.1-5.2.3, RNF 5.1.4)', () => {
  it('acepta un listado sin parámetros con pagina, tamano y orden por defecto', () => {
    const result = citaListQuerySchema.parse({});
    expect(result).toMatchObject({ pagina: 1, tamano: 25 });
    expect(result.estado).toBeUndefined();
    expect(result.desde).toBeUndefined();
    expect(result.hasta).toBeUndefined();
    expect(result.folio).toBeUndefined();
  });

  it('acepta cada uno de los tres estados y rechaza uno fuera del catálogo (RF 5.2.2)', () => {
    for (const estado of ['Pendiente', 'Cancelada', 'Vencida']) {
      expect(citaListQuerySchema.safeParse({ estado }).success).toBe(true);
    }
    expect(citaListQuerySchema.safeParse({ estado: 'Confirmada' }).success).toBe(false);
  });

  it('exige UUID válido en id_sala e id_terapeuta y los normaliza a minúsculas', () => {
    expect(citaListQuerySchema.safeParse({ id_sala: 'no-es-un-uuid' }).success).toBe(false);
    expect(
      citaListQuerySchema.parse({ id_terapeuta: ids.id_terapeuta.toUpperCase() }).id_terapeuta,
    ).toBe(ids.id_terapeuta);
  });

  it('exige formato AAAA-MM-DD en desde y hasta, y rechaza fechas que no existen', () => {
    expect(citaListQuerySchema.safeParse({ desde: '2026-10-26' }).success).toBe(true);
    expect(citaListQuerySchema.safeParse({ desde: '26/10/2026' }).success).toBe(false);
    expect(citaListQuerySchema.safeParse({ hasta: '2026-02-30' }).success).toBe(false);
  });

  it('rechaza "desde" posterior a "hasta" (RF 5.2.3)', () => {
    const result = citaListQuerySchema.safeParse({ desde: '2026-11-01', hasta: '2026-10-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['desde']);
    }
    expect(
      citaListQuerySchema.safeParse({ desde: '2026-10-01', hasta: '2026-10-01' }).success,
    ).toBe(true);
  });

  it('el folio reutiliza folioSchema: normaliza a mayúsculas y exige el formato exacto (CA-5.2-01)', () => {
    expect(citaListQuerySchema.parse({ folio: ' c26000118 ' }).folio).toBe('C26000118');
    expect(citaListQuerySchema.safeParse({ folio: 'C-2026-00118' }).success).toBe(false);
  });

  it('acepta el tamaño mínimo (1) y máximo (100), rechaza 0 y 101', () => {
    expect(citaListQuerySchema.safeParse({ tamano: '1' }).success).toBe(true);
    expect(citaListQuerySchema.safeParse({ tamano: '100' }).success).toBe(true);
    expect(citaListQuerySchema.safeParse({ tamano: '0' }).success).toBe(false);
    expect(citaListQuerySchema.safeParse({ tamano: '101' }).success).toBe(false);
  });

  it('rechaza una página inválida', () => {
    expect(citaListQuerySchema.safeParse({ pagina: '0' }).success).toBe(false);
    expect(citaListQuerySchema.safeParse({ pagina: 'abc' }).success).toBe(false);
  });

  it('rechaza un parámetro de consulta desconocido', () => {
    expect(citaListQuerySchema.safeParse({ paciente: ids.id_paciente }).success).toBe(false);
  });
});
