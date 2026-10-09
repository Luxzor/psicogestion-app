import { describe, expect, it } from 'vitest';
import type { TherapistFormValues } from './types';
import {
  CEDULA_PATTERN,
  EMAIL_PATTERN,
  maskDate,
  NAME_MAX,
  normalizeInput,
  parseDisplayDate,
  PHONE_PATTERN,
  toPayload,
  validateField,
} from './validation';

const valid: TherapistFormValues = {
  nombre: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo: 'victoria.mendez@correo.uady.mx',
  fechaNacimiento: '19/05/1988',
  cedula: '7845213',
};

describe('validación en cliente de terapeutas (EDT 4.3.4)', () => {
  it('valida el nombre completo (CA-2.1-02)', () => {
    expect(validateField('nombre', valid)).toBe('');
    expect(validateField('nombre', { ...valid, nombre: '   ' })).toBe(
      'Escribe el nombre completo.',
    );
    expect(validateField('nombre', { ...valid, nombre: 'a'.repeat(NAME_MAX) })).toBe('');
    expect(validateField('nombre', { ...valid, nombre: 'a'.repeat(NAME_MAX + 1) })).toBe(
      'El nombre no puede tener más de 50 caracteres.',
    );
  });

  it('valida el teléfono de 10 dígitos (CA-2.1-08)', () => {
    expect(validateField('telefono', valid)).toBe('');
    expect(validateField('telefono', { ...valid, telefono: '' })).toBe('Escribe el teléfono.');
    expect(validateField('telefono', { ...valid, telefono: '999123456' })).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(validateField('telefono', { ...valid, telefono: '99912345678' })).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(PHONE_PATTERN.test('9997845213')).toBe(true);
  });

  it('valida el correo electrónico obligatorio y formato (CA-2.1-10)', () => {
    expect(validateField('correo', valid)).toBe('');
    expect(validateField('correo', { ...valid, correo: '' })).toBe(
      'Escribe el correo electrónico.',
    );
    expect(validateField('correo', { ...valid, correo: 'victoria@' })).toBe(
      'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.',
    );
    expect(EMAIL_PATTERN.test('victoria.mendez@correo.uady.mx')).toBe(true);
  });

  it('valida la cédula profesional de 7 u 8 dígitos (CA-2.1-07)', () => {
    expect(validateField('cedula', valid)).toBe('');
    expect(validateField('cedula', { ...valid, cedula: '' })).toBe(
      'Escribe la cédula profesional.',
    );
    expect(validateField('cedula', { ...valid, cedula: '123456' })).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(validateField('cedula', { ...valid, cedula: '123456789' })).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(CEDULA_PATTERN.test('7845213')).toBe(true);
    expect(CEDULA_PATTERN.test('12345678')).toBe(true);
  });

  it('valida la fecha de nacimiento y rechaza fechas no anteriores a hoy (CA-2.1-04)', () => {
    expect(validateField('fechaNacimiento', valid, '2026-10-09')).toBe('');
    expect(validateField('fechaNacimiento', { ...valid, fechaNacimiento: '' }, '2026-10-09')).toBe(
      'Escribe la fecha de nacimiento.',
    );
    expect(
      validateField('fechaNacimiento', { ...valid, fechaNacimiento: '19/05/26' }, '2026-10-09'),
    ).toBe('Escribe la fecha como dd/mm/aaaa.');
    expect(
      validateField('fechaNacimiento', { ...valid, fechaNacimiento: '30/02/1988' }, '2026-10-09'),
    ).toBe('Esa fecha no existe en el calendario.');
    expect(
      validateField('fechaNacimiento', { ...valid, fechaNacimiento: '09/10/2026' }, '2026-10-09'),
    ).toBe('La fecha de nacimiento debe ser anterior a hoy.');
    expect(
      validateField('fechaNacimiento', { ...valid, fechaNacimiento: '15/12/2026' }, '2026-10-09'),
    ).toBe('La fecha de nacimiento debe ser anterior a hoy.');
  });

  it('aplica máscara a la fecha y normaliza entradas', () => {
    expect(maskDate('19051988')).toBe('19/05/1988');
    expect(maskDate('1905')).toBe('19/05');
    expect(normalizeInput('telefono', '999 784-5213')).toBe('9997845213');
    expect(normalizeInput('cedula', '78-45-213')).toBe('7845213');
  });

  it('convierte correctamente los valores al payload para la API', () => {
    const payload = toPayload(valid);
    expect(payload).toEqual({
      nombre_completo: 'Victoria Méndez Rosado',
      telefono: '9997845213',
      correo_electronico: 'victoria.mendez@correo.uady.mx',
      fecha_nacimiento: '1988-05-19',
      cedula_profesional: '7845213',
    });
    expect(parseDisplayDate('19/05/1988').iso).toBe('1988-05-19');
  });
});
