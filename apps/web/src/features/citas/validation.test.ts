import { describe, expect, it } from 'vitest';
import {
  APERTURA_MINUTOS,
  BLOQUES_DEL_DIA,
  cabeEnHorario,
  CIERRE_MINUTOS,
  DURACION_POR_DEFECTO,
  DURACIONES,
  enHoraClinica,
  esDomingo,
  etiquetaDuracion,
  horaAMinutos,
  hoyEnClinica,
  minutosAHora,
  rangoLegible,
  toInicioIso,
  yaPaso,
} from './horario';
import type { Cita, CitaFormValues } from './types';
import { CITA_ESTADOS } from './types';
import {
  CITA_EXITO,
  CITA_MENSAJES,
  CITA_TABS,
  diffCitaPayload,
  FOLIO_PATTERN,
  isCitaEditable,
  isPatientEligibleForAppointment,
  isTherapistEligibleForAppointment,
  mensajeDeError,
  normalizeFolio,
  toCitaFormValues,
  toCitaPayload,
  validateCitaForm,
  validateFolio,
} from './validation';

/** Miércoles 21 de octubre de 2026, 11:10 en Mérida (UTC-6), como en la maqueta. */
const ahora = new Date('2026-10-21T17:10:00Z');

const values: CitaFormValues = {
  id_paciente: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  id_terapeuta: '7a2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b5c',
  id_sala: '8b3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c6d',
  fecha: '2026-10-26',
  inicio: 9 * 60,
  duracion: 60,
};

const cita: Cita = {
  id: '9c4d5e6f-7081-4c92-9dae-2f3a4b5c6d7e',
  folio: 'C26000118',
  estado: 'Pendiente',
  inicio: '2026-10-26T15:00:00.000Z',
  fin: '2026-10-26T16:00:00.000Z',
  duracion_bloques: 2,
  paciente: { id: values.id_paciente, nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: values.id_terapeuta, nombre_completo: 'Victoria Méndez Rosado' },
  sala: { id: values.id_sala, nombre: 'Sala 1' },
  cancelada_en: null,
  fecha_registro: '2026-10-21',
  version: 4,
};

describe('rejilla horaria de citas en el cliente (EDT 5.2.1, ADR-15)', () => {
  it('ofrece 20 bloques de 30 minutos de 07:00 a 17:00 y duraciones de 30 min a 2 h', () => {
    expect(BLOQUES_DEL_DIA).toHaveLength(20);
    expect(BLOQUES_DEL_DIA[0]).toBe(APERTURA_MINUTOS);
    expect(minutosAHora(BLOQUES_DEL_DIA[19])).toBe('16:30');
    expect(CIERRE_MINUTOS).toBe(17 * 60);
    expect(DURACIONES).toEqual([30, 60, 90, 120]);
    expect(DURACION_POR_DEFECTO).toBe(60);
    expect(DURACIONES.map(etiquetaDuracion)).toEqual(['30 min', '1 h', '1 h 30 min', '2 h']);
  });

  it('convierte entre minutos y horas', () => {
    expect(minutosAHora(540)).toBe('09:00');
    expect(horaAMinutos('09:30')).toBe(570);
    expect(horaAMinutos('9:30')).toBeNull();
    expect(horaAMinutos('24:00')).toBeNull();
  });

  it('decide si una cita cabe en la rejilla y el horario operativo', () => {
    expect(cabeEnHorario(7 * 60, 30)).toBe(true);
    expect(cabeEnHorario(15 * 60, 120)).toBe(true);
    expect(cabeEnHorario(16 * 60 + 30, 60)).toBe(false);
    expect(cabeEnHorario(6 * 60 + 30, 30)).toBe(false);
    expect(cabeEnHorario(9 * 60 + 15, 30)).toBe(false);
    expect(cabeEnHorario(9 * 60, 150)).toBe(false);
    expect(cabeEnHorario(9 * 60, 45)).toBe(false);
  });

  it('convierte la hora de la clínica a UTC sin depender de la zona del navegador', () => {
    expect(toInicioIso('2026-10-26', 9 * 60)).toBe('2026-10-26T15:00:00.000Z');
    expect(toInicioIso('2026-02-30', 9 * 60)).toBeNull();
    expect(toInicioIso('26/10/2026', 9 * 60)).toBeNull();
    expect(enHoraClinica('2026-10-26T15:00:00.000Z')).toEqual({
      fecha: '2026-10-26',
      minutos: 540,
      segundos: 0,
    });
    expect(enHoraClinica('2026-10-27T01:30:00Z').fecha).toBe('2026-10-26');
    expect(rangoLegible(cita.inicio, cita.fin)).toBe('09:00 a 10:00');
  });

  it('calcula hoy, domingo y bloques pasados en la hora de la clínica', () => {
    expect(hoyEnClinica(ahora)).toBe('2026-10-21');
    // A las 23:30 de Mérida ya es el día siguiente en UTC; hoy sigue siendo el 21.
    expect(hoyEnClinica(new Date('2026-10-22T05:30:00Z'))).toBe('2026-10-21');
    expect(esDomingo('2026-10-25')).toBe(true);
    expect(esDomingo('2026-10-26')).toBe(false);
    expect(yaPaso('2026-10-21', 11 * 60, ahora)).toBe(true);
    expect(yaPaso('2026-10-21', 11 * 60 + 30, ahora)).toBe(false);
    expect(yaPaso('2026-10-20', 16 * 60, ahora)).toBe(true);
  });
});

describe('validación del formulario de citas (EDT 5.2.1)', () => {
  const nuevo = { modo: 'nuevo' as const, ahora };

  it('acepta una cita completa en un bloque libre futuro (CA-5.1-01)', () => {
    expect(validateCitaForm(values, nuevo)).toEqual({});
  });

  it('marca los campos obligatorios con los textos de la maqueta (RF 5.1.2)', () => {
    expect(
      validateCitaForm(
        { ...values, id_paciente: '', id_terapeuta: '', id_sala: '', fecha: '', inicio: null },
        nuevo,
      ),
    ).toEqual({
      id_paciente: 'Selecciona un paciente.',
      id_terapeuta: 'Selecciona un terapeuta.',
      id_sala: 'Elige una sala.',
      fecha: 'Elige una fecha.',
    });
    expect(validateCitaForm({ ...values, inicio: null }, nuevo)).toEqual({
      inicio: 'Elige un horario disponible.',
    });
  });

  it('rechaza paciente, terapeuta o sala dados de baja (CA-5.1-03, CA-2.3-03, CA-4.2-01)', () => {
    expect(
      validateCitaForm(values, {
        ...nuevo,
        paciente: { activo: false },
        terapeuta: { activo: false },
        sala: { activo: false },
      }),
    ).toEqual({
      id_paciente: CITA_MENSAJES.PACIENTE_INACTIVO_NO_ASIGNABLE,
      id_terapeuta: 'Este terapeuta está dado de baja y no se puede asignar. Elige otro.',
      id_sala: 'Esta sala fue eliminada. Elige otra.',
    });
    expect(isPatientEligibleForAppointment({ activo: true })).toBe(true);
    expect(isTherapistEligibleForAppointment({ activo: false })).toBe(false);
  });

  it('al modificar no revalida un recurso que no cambió (RF 5.3.4)', () => {
    const editar = {
      modo: 'editar' as const,
      ahora,
      inicial: values,
      terapeuta: { activo: false },
    };
    expect(validateCitaForm(values, editar)).toEqual({});
    expect(
      validateCitaForm({ ...values, id_terapeuta: 'otro' }, { ...editar, inicial: values })
        .id_terapeuta,
    ).toBeDefined();
  });

  it('valida fecha y horario: domingo, pasado, fin después de las 17:00 (TP3-02, TP3-06)', () => {
    expect(validateCitaForm({ ...values, fecha: '2026-10-25' }, nuevo).fecha).toBe(
      'La clínica no atiende en domingo. Elige otro día.',
    );
    expect(validateCitaForm({ ...values, fecha: '2026-10-20' }, nuevo).fecha).toBe(
      'La fecha no puede ser anterior a hoy.',
    );
    expect(validateCitaForm({ ...values, fecha: '2026-02-30' }, nuevo).fecha).toBe(
      'Elige una fecha válida.',
    );
    expect(
      validateCitaForm({ ...values, fecha: '2026-10-21', inicio: 10 * 60 + 30 }, nuevo).inicio,
    ).toBe(CITA_MENSAJES.CITA_EN_EL_PASADO);
    expect(
      validateCitaForm({ ...values, fecha: '2026-10-21', inicio: 11 * 60 + 30 }, nuevo),
    ).toEqual({});
    expect(validateCitaForm({ ...values, inicio: 16 * 60 + 30, duracion: 60 }, nuevo).inicio).toBe(
      'La sesión debe terminar a más tardar a las 17:00.',
    );
    expect(validateCitaForm({ ...values, inicio: 9 * 60 + 15 }, nuevo).inicio).toBe(
      CITA_MENSAJES.HORARIO_INVALIDO,
    );
  });

  it('arma el cuerpo del alta con el inicio en UTC y la duración en bloques', () => {
    expect(toCitaPayload(values)).toEqual({
      id_paciente: values.id_paciente,
      id_terapeuta: values.id_terapeuta,
      id_sala: values.id_sala,
      inicio: '2026-10-26T15:00:00.000Z',
      duracion_bloques: 2,
    });
    expect(toCitaPayload({ ...values, inicio: null })).toBeNull();
  });

  it('precarga la cita y envía solo lo que cambió con la versión leída (RF 5.3.2, ADR-23)', () => {
    expect(toCitaFormValues(cita)).toEqual(values);
    expect(diffCitaPayload(cita, values)).toBeNull();
    expect(diffCitaPayload(cita, { ...values, inicio: 12 * 60, duracion: 90 })).toEqual({
      inicio: '2026-10-26T18:00:00.000Z',
      duracion_bloques: 3,
      version: 4,
    });
    expect(diffCitaPayload(cita, { ...values, id_sala: 'otra-sala' })).toEqual({
      id_sala: 'otra-sala',
      version: 4,
    });
  });
});

describe('folio, estados y mensajes de citas (EDT 5.2.1)', () => {
  it('normaliza y valida el folio C + AA + 6 dígitos (ADR-17, RF 5.4.2)', () => {
    expect(normalizeFolio(' c26 000118 ')).toBe('C26000118');
    expect(validateFolio('c26000118')).toBe('');
    expect(validateFolio('')).toBe('Escribe el folio de la cita.');
    expect(validateFolio('C-2026-00118')).toBe(
      'El folio no tiene un formato válido. Ejemplo: C26000118.',
    );
    expect(FOLIO_PATTERN.test('C2600011')).toBe(false);
  });

  it('expone los estados y las pestañas de la lista (RF 5.2.2)', () => {
    expect(CITA_ESTADOS).toEqual(['Pendiente', 'Cancelada', 'Vencida']);
    expect(CITA_TABS.map((tab) => tab.label)).toEqual(['Pendientes', 'Canceladas', 'Vencidas']);
    expect(isCitaEditable(cita)).toBe(true);
    expect(isCitaEditable({ estado: 'Cancelada' })).toBe(false);
    expect(isCitaEditable({ estado: 'Vencida' })).toBe(false);
  });

  it('traduce los códigos del servidor al catálogo de mensajes (PG-DSN-003 5.6)', () => {
    expect(mensajeDeError('SALA_OCUPADA')).toBe(
      'Esa sala ya está reservada a esa hora. Elige otro horario.',
    );
    expect(mensajeDeError('TERAPEUTA_OCUPADO')).toBe('El terapeuta ya tiene una cita a esa hora.');
    expect(mensajeDeError('CONFLICTO_VERSION')).toBe(
      'Otra persona modificó esta cita. Revisa los cambios y vuelve a intentar.',
    );
    expect(mensajeDeError('DESCONOCIDO')).toBeNull();
    expect(CITA_EXITO.agendada('C26000001')).toBe('Cita agendada con éxito. Folio C26000001.');
    expect(CITA_EXITO.cancelada('C26000001')).toBe('Cita C26000001 cancelada.');
  });
});
