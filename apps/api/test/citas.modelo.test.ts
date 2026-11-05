import { describe, expect, it } from 'vitest';
import { citaDatabaseError, citaError, CITA_ERRORES } from '../src/modules/citas/errors.js';
import {
  APERTURA_MINUTOS,
  BLOQUES_POR_DIA,
  bloquesDelDia,
  calcularFin,
  CIERRE_MINUTOS,
  clinicDateTimeToUtc,
  clinicParts,
  duracionEnBloques,
  evaluarHorario,
  HORARIO_MENSAJES,
  ventanaDelDia,
} from '../src/modules/citas/horario.js';
import {
  cancelCitaSchema,
  CITA_ESTADOS,
  createCitaSchema,
  folioSchema,
  updateCitaSchema,
} from '../src/modules/citas/schemas.js';

const ZONA = 'America/Merida';
/** Mérida está en UTC-6 todo el año: las 09:00 locales son las 15:00 UTC. */
const lunes9 = new Date('2026-10-26T15:00:00.000Z');
const antes = new Date('2026-10-21T17:00:00.000Z');

const ids = {
  id_paciente: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  id_terapeuta: '7a2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b5c',
  id_sala: '8b3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c6d',
};

describe('modelo de datos de citas: rejilla horaria (EDT 5.2.1, ADR-15)', () => {
  it('genera 20 bloques de 30 minutos de 07:00 a 17:00 hora de Mérida (CA-4.3-02)', () => {
    const bloques = bloquesDelDia('2026-10-26', ZONA);
    expect(BLOQUES_POR_DIA).toBe(20);
    expect(bloques).toHaveLength(20);
    expect(bloques?.[0].inicio.toISOString()).toBe('2026-10-26T13:00:00.000Z');
    expect(bloques?.[0].fin.toISOString()).toBe('2026-10-26T13:30:00.000Z');
    expect(bloques?.[19].fin.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(bloquesDelDia('2026-02-30', ZONA)).toBeNull();
  });

  it('convierte la hora de la clínica a UTC y de regreso', () => {
    expect(clinicDateTimeToUtc('2026-10-26', 9 * 60, ZONA)?.toISOString()).toBe(
      lunes9.toISOString(),
    );
    expect(clinicParts(lunes9, ZONA)).toEqual({
      fecha: '2026-10-26',
      minutos: 9 * 60,
      segundos: 0,
      milisegundos: 0,
    });
    // Las 19:30 de Mérida ya son el día siguiente en UTC; la fecha local se conserva.
    expect(clinicParts(new Date('2026-10-27T01:30:00Z'), ZONA).fecha).toBe('2026-10-26');
    expect(clinicDateTimeToUtc('2026-13-01', 0, ZONA)).toBeNull();
    expect(clinicDateTimeToUtc('2026-10-26', -1, ZONA)).toBeNull();
  });

  it('calcula la ventana del día y la duración en bloques', () => {
    expect(ventanaDelDia('2026-10-26', ZONA)).toEqual({
      desde: new Date('2026-10-26T13:00:00Z'),
      hasta: new Date('2026-10-26T23:00:00Z'),
    });
    expect(ventanaDelDia('no-es-fecha', ZONA)).toBeNull();
    expect(calcularFin(lunes9, 2).toISOString()).toBe('2026-10-26T16:00:00.000Z');
    expect(duracionEnBloques(lunes9, calcularFin(lunes9, 3))).toBe(3);
    expect(APERTURA_MINUTOS).toBe(420);
    expect(CIERRE_MINUTOS).toBe(1020);
  });

  it('acepta citas en la rejilla, incluidas las que empiezan a las 07:00 y terminan a las 17:00', () => {
    expect(evaluarHorario(lunes9, 2, antes, ZONA)).toBeNull();
    expect(evaluarHorario(new Date('2026-10-26T13:00:00Z'), 1, antes, ZONA)).toBeNull();
    expect(evaluarHorario(new Date('2026-10-26T21:00:00Z'), 4, antes, ZONA)).toBeNull();
    expect(evaluarHorario(new Date('2026-10-26T15:30:00Z'), 1, antes, ZONA)).toBeNull();
  });

  it('rechaza con HORARIO_INVALIDO lo que sale de la rejilla o del horario operativo', () => {
    const invalido = { codigo: 'HORARIO_INVALIDO', mensaje: HORARIO_MENSAJES.HORARIO_INVALIDO };
    // Minuto 15, segundos y milisegundos fuera de la rejilla.
    expect(evaluarHorario(new Date('2026-10-26T15:15:00Z'), 1, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(new Date('2026-10-26T15:00:30Z'), 1, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(new Date('2026-10-26T15:00:00.500Z'), 1, antes, ZONA)).toEqual(invalido);
    // 06:30 empieza antes de abrir; 16:30 con dos bloques termina a las 17:30.
    expect(evaluarHorario(new Date('2026-10-26T12:30:00Z'), 1, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(new Date('2026-10-26T22:30:00Z'), 2, antes, ZONA)).toEqual(invalido);
    // 17:00 de inicio no deja espacio para ningún bloque.
    expect(evaluarHorario(new Date('2026-10-26T23:00:00Z'), 1, antes, ZONA)).toEqual(invalido);
    // Duración fuera de 1 a 4 bloques o no entera, y fecha inválida.
    expect(evaluarHorario(lunes9, 0, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(lunes9, 5, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(lunes9, 1.5, antes, ZONA)).toEqual(invalido);
    expect(evaluarHorario(new Date('x'), 1, antes, ZONA)).toEqual(invalido);
  });

  it('rechaza con CITA_EN_EL_PASADO un inicio anterior al momento actual (TP3-06)', () => {
    const despues = new Date('2026-10-26T15:10:00Z');
    expect(evaluarHorario(lunes9, 1, despues, ZONA)).toEqual({
      codigo: 'CITA_EN_EL_PASADO',
      mensaje: HORARIO_MENSAJES.CITA_EN_EL_PASADO,
    });
    // El mismo instante todavía es válido.
    expect(evaluarHorario(lunes9, 1, lunes9, ZONA)).toBeNull();
  });
});

describe('modelo de datos de citas: esquemas (EDT 5.2.1)', () => {
  const valida = { ...ids, inicio: '2026-10-26T15:00:00Z', duracion_bloques: 2 };

  it('acepta un alta válida, normaliza los UUID y convierte el inicio a Date', () => {
    const parsed = createCitaSchema.parse({
      ...valida,
      id_paciente: ids.id_paciente.toUpperCase(),
      inicio: '2026-10-26T09:00:00-06:00',
    });
    expect(parsed.id_paciente).toBe(ids.id_paciente);
    expect(parsed.inicio).toEqual(lunes9);
    expect(parsed.duracion_bloques).toBe(2);
  });

  it('el alta no acepta estado ni folio: nace Pendiente y el folio lo asigna la base (RF 5.1.5)', () => {
    expect(createCitaSchema.safeParse({ ...valida, estado: 'Pendiente' }).success).toBe(false);
    expect(createCitaSchema.safeParse({ ...valida, folio: 'C26000001' }).success).toBe(false);
  });

  it('marca cada campo obligatorio con su mensaje', () => {
    const result = createCitaSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
    expect(fields).toMatchObject({
      id_paciente: 'Selecciona un paciente.',
      id_terapeuta: 'Selecciona un terapeuta.',
      id_sala: 'Elige una sala.',
      inicio: 'Elige la fecha y la hora de inicio.',
      duracion_bloques: 'Elige la duración de la cita.',
    });
  });

  it('rechaza un inicio sin zona horaria y duraciones fuera de 1 a 4 bloques', () => {
    expect(createCitaSchema.safeParse({ ...valida, inicio: '2026-10-26T09:00:00' }).success).toBe(
      false,
    );
    expect(createCitaSchema.safeParse({ ...valida, inicio: '26/10/2026 09:00' }).success).toBe(
      false,
    );
    for (const duracion of [0, 5, 1.5, '2']) {
      expect(createCitaSchema.safeParse({ ...valida, duracion_bloques: duracion }).success).toBe(
        false,
      );
    }
  });

  it('la modificación es parcial, estricta y exige la versión (ADR-23)', () => {
    expect(updateCitaSchema.parse({ id_sala: ids.id_sala, version: 3 })).toEqual({
      id_sala: ids.id_sala,
      version: 3,
    });
    expect(updateCitaSchema.safeParse({ id_sala: ids.id_sala }).success).toBe(false);
    expect(updateCitaSchema.safeParse({ estado: 'Vencida', version: 1 }).success).toBe(true);
    expect(cancelCitaSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(cancelCitaSchema.safeParse({ version: 1, motivo: 'x' }).success).toBe(false);
  });

  it('normaliza el folio y valida su formato C + AA + 6 dígitos (ADR-17, RF 5.4.2)', () => {
    expect(folioSchema.parse('  c26000118 ')).toBe('C26000118');
    expect(folioSchema.safeParse('').error?.issues[0].message).toBe('Escribe el folio de la cita.');
    for (const folio of ['C-2026-00118', 'C2600011', 'C260001180', 'X26000118']) {
      expect(folioSchema.safeParse(folio).error?.issues[0].message).toBe(
        'El folio no tiene un formato válido. Ejemplo: C26000118.',
      );
    }
  });

  it('expone los tres estados en el orden del tipo cita_estado (RF 5.2.2)', () => {
    expect(CITA_ESTADOS).toEqual(['Pendiente', 'Cancelada', 'Vencida']);
  });
});

describe('modelo de datos de citas: traducción de restricciones (EDT 5.2.1, ADR-16)', () => {
  it('traduce cada restricción EXCLUDE al recurso ocupado (CA-5.1-04)', () => {
    expect(citaDatabaseError({ code: '23P01', constraint: 'cita_sala_sin_empalme' })).toMatchObject(
      { status: 409, code: 'SALA_OCUPADA' },
    );
    expect(
      citaDatabaseError({ code: '23P01', constraint: 'cita_terapeuta_sin_empalme' }),
    ).toMatchObject({ status: 409, code: 'TERAPEUTA_OCUPADO' });
    expect(
      citaDatabaseError({ code: '23P01', constraint: 'cita_paciente_sin_empalme' }),
    ).toMatchObject({ status: 409, code: 'PACIENTE_OCUPADO' });
  });

  it('traduce las restricciones de horario a 400 HORARIO_INVALIDO', () => {
    for (const constraint of [
      'cita_rango_valido',
      'cita_rejilla_30min',
      'cita_mismo_dia',
      'cita_horario_operativo',
    ]) {
      expect(citaDatabaseError({ code: '23514', constraint })).toMatchObject({
        status: 400,
        code: 'HORARIO_INVALIDO',
        fields: { inicio: HORARIO_MENSAJES.HORARIO_INVALIDO },
      });
    }
  });

  it('traduce las llaves foráneas a 404 del recurso inexistente', () => {
    expect(citaDatabaseError({ code: '23503', constraint: 'cita_id_paciente_fkey' })).toMatchObject(
      { status: 404, code: 'PACIENTE_NO_ENCONTRADO' },
    );
    expect(
      citaDatabaseError({ code: '23503', constraint: 'cita_id_terapeuta_fkey' }),
    ).toMatchObject({ status: 404, code: 'TERAPEUTA_NO_ENCONTRADO' });
    expect(citaDatabaseError({ code: '23503', constraint: 'cita_id_sala_fkey' })).toMatchObject({
      status: 404,
      code: 'SALA_NO_ENCONTRADA',
    });
  });

  it('no traduce errores ajenos al modelo de citas', () => {
    expect(citaDatabaseError({ code: '23P01', constraint: 'otra_restriccion' })).toBeNull();
    expect(citaDatabaseError({ code: '23505', constraint: 'uq_sala_nombre' })).toBeNull();
    expect(citaDatabaseError(new Error('sin código'))).toBeNull();
    expect(citaDatabaseError(null)).toBeNull();
  });

  it('construye los errores del catálogo con su estado, mensaje, campo y detalles', () => {
    expect(citaError('TERAPEUTA_INACTIVO_NO_ASIGNABLE')).toMatchObject({
      status: 409,
      message: 'Ese terapeuta está dado de baja y no puede asignarse a citas nuevas.',
      fields: { id_terapeuta: CITA_ERRORES.TERAPEUTA_INACTIVO_NO_ASIGNABLE.mensaje },
    });
    expect(citaError('CONFLICTO_VERSION', { version_actual: 4 })).toMatchObject({
      status: 409,
      fields: undefined,
      details: { version_actual: 4 },
    });
    expect(citaError('CITA_EN_EL_PASADO').status).toBe(422);
  });
});
