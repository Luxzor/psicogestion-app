import { describe, expect, it } from 'vitest';
import type { PatientFormValues } from './types';
import { maskDate, normalizeInput, parseDisplayDate, toPayload, validateField } from './validation';

const today = '2026-10-08';
const values: PatientFormValues = {
  nombre: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fechaNacimiento: '25/08/2009',
  telefono: '9996402218',
  correo: '',
};

describe('validación del formulario de pacientes', () => {
  it('aplica la máscara dd/mm/aaaa y normaliza CURP y teléfono', () => {
    expect(maskDate('2508')).toBe('25/08');
    expect(maskDate('25082009999')).toBe('25/08/2009');
    expect(normalizeInput('curp', 'kuev 0908')).toBe('KUEV0908');
    expect(normalizeInput('telefono', '999-640 22a')).toBe('99964022');
  });

  it('distingue formato inválido de fecha inexistente', () => {
    expect(parseDisplayDate('2009-08-25')).toEqual({ error: 'formato' });
    expect(parseDisplayDate('30/02/2009')).toEqual({ error: 'inexistente' });
    expect(parseDisplayDate('25/08/2009')).toEqual({ iso: '2009-08-25' });
  });

  it('acepta exactamente 7 años y rechaza menos, hoy o fechas futuras (CA-3.1-04)', () => {
    const at = (fechaNacimiento: string) =>
      validateField('fechaNacimiento', { ...values, fechaNacimiento }, today);
    expect(at('08/10/2019')).toBe('');
    expect(at('09/10/2019')).toBe('El paciente debe tener al menos 7 años cumplidos.');
    expect(at('08/10/2026')).toBe('La fecha de nacimiento debe ser anterior a hoy.');
    expect(at('01/01/2030')).toBe('La fecha de nacimiento debe ser anterior a hoy.');
  });

  it('valida nombre, CURP, teléfono y correo opcional', () => {
    expect(validateField('nombre', { ...values, nombre: 'a'.repeat(51) })).toBe(
      'El nombre no puede tener más de 50 caracteres.',
    );
    expect(validateField('nombre', { ...values, nombre: 'a'.repeat(50) })).toBe('');
    expect(validateField('curp', { ...values, curp: 'KUEV090825' })).toContain('formato válido');
    expect(validateField('telefono', { ...values, telefono: '99945' })).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(validateField('correo', values)).toBe('');
    expect(validateField('correo', { ...values, correo: 'a@b' })).toContain('formato válido');
    expect(validateField('sexo', { ...values, sexo: '' })).toBe('Selecciona el sexo.');
  });

  it('arma la carga útil con la fecha en ISO y el correo vacío como null', () => {
    expect(toPayload({ ...values, nombre: ' Valeria  Ku ', correo: ' ' }, true)).toEqual({
      nombre_completo: 'Valeria Ku',
      curp: 'KUEV090825MYNXSLA3',
      sexo: 'F',
      fecha_nacimiento: '2009-08-25',
      telefono: '9996402218',
      correo: null,
      consentimiento: true,
    });
  });
});
