import { describe, expect, it } from 'vitest';
import {
  createTherapistSchema,
  therapistAvailabilitySchema,
} from '../src/modules/terapeutas/schemas.js';

const registrationDate = '2026-10-09';
const schema = createTherapistSchema(() => registrationDate);

const valid = {
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
};

const fieldError = (input: unknown, field: string) => {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join('.') === field)?.message;
};

describe('esquema de registro de terapeutas (EDT 4.3.4)', () => {
  it('acepta un terapeuta con datos válidos (CA-2.1-01)', () => {
    const result = schema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nombre_completo).toBe('Victoria Méndez Rosado');
      expect(result.data.telefono).toBe('9997845213');
      expect(result.data.correo_electronico).toBe('victoria.mendez@correo.uady.mx');
      expect(result.data.fecha_nacimiento).toBe('1988-05-19');
      expect(result.data.cedula_profesional).toBe('7845213');
    }
  });

  it('acepta alias correo y cedula', () => {
    const result = schema.safeParse({
      nombre_completo: 'Héctor Puerto Cámara',
      telefono: '9996123987',
      correo: 'hector.puerto@correo.uady.mx',
      fecha_nacimiento: '1979-09-03',
      cedula: '6123987',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correo_electronico).toBe('hector.puerto@correo.uady.mx');
      expect(result.data.cedula_profesional).toBe('6123987');
    }
  });

  it('normaliza el nombre y el correo', () => {
    const result = schema.parse({
      ...valid,
      nombre_completo: '  Victoria   Méndez   Rosado  ',
      correo_electronico: ' Victoria.Mendez@Uady.Mx ',
    });
    expect(result.nombre_completo).toBe('Victoria Méndez Rosado');
    expect(result.correo_electronico).toBe('victoria.mendez@uady.mx');
  });

  it('acepta un nombre de 50 caracteres y rechaza uno vacío o de 51 (CA-2.1-02)', () => {
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(50) }, 'nombre_completo')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(51) }, 'nombre_completo')).toBe(
      'El nombre no puede tener más de 50 caracteres.',
    );
    expect(fieldError({ ...valid, nombre_completo: '   ' }, 'nombre_completo')).toBe(
      'Escribe el nombre completo.',
    );
    expect(fieldError({ ...valid, nombre_completo: '' }, 'nombre_completo')).toBe(
      'Escribe el nombre completo.',
    );
  });

  it('exige todos los campos obligatorios (CA-2.1-06)', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toEqual(
        expect.arrayContaining([
          'nombre_completo',
          'telefono',
          'correo_electronico',
          'fecha_nacimiento',
          'cedula_profesional',
        ]),
      );
    }
  });

  it('exige cédula profesional obligatoria de 7 u 8 dígitos numéricos (CA-2.1-07)', () => {
    expect(fieldError({ ...valid, cedula_profesional: '123456' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '123456789' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '123456A' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '' }, 'cedula_profesional')).toBe(
      'Escribe la cédula profesional.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '1234567' }, 'cedula_profesional')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, cedula_profesional: '12345678' }, 'cedula_profesional')).toBe(
      undefined,
    );
  });

  it('exige un teléfono de exactamente 10 dígitos (CA-2.1-08)', () => {
    expect(fieldError({ ...valid, telefono: '999784521' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '99978452130' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '999-784-52' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '' }, 'telefono')).toBe('Escribe el teléfono.');
    expect(fieldError({ ...valid, telefono: '9997845213' }, 'telefono')).toBe(undefined);
  });

  it('rechaza un correo con formato inválido y exige correo obligatorio (CA-2.1-10)', () => {
    expect(
      fieldError({ ...valid, correo_electronico: 'victoria.mendez@' }, 'correo_electronico'),
    ).toBe('Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.');
    expect(fieldError({ ...valid, correo_electronico: 'victoria' }, 'correo_electronico')).toBe(
      'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.',
    );
    expect(fieldError({ ...valid, correo_electronico: '' }, 'correo_electronico')).toBe(
      'Escribe el correo electrónico.',
    );
  });

  it('rechaza fecha de nacimiento igual o posterior a la fecha de registro (CA-2.1-04)', () => {
    expect(fieldError({ ...valid, fecha_nacimiento: '2026-10-09' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2027-01-01' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '1988-10-08' }, 'fecha_nacimiento')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '1988-02-30' }, 'fecha_nacimiento')).toBe(
      'Esa fecha no existe en el calendario.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '19/05/1988' }, 'fecha_nacimiento')).toBe(
      'Escribe la fecha como dd/mm/aaaa.',
    );
  });

  it('valida las solicitudes de verificación de unicidad anticipada', () => {
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'telefono', valor: '9997845213' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'correo', valor: 'test@uady.mx' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'correo_electronico', valor: 'test@uady.mx' })
        .success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'cedula', valor: '7845213' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'cedula_profesional', valor: '12345678' })
        .success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'curp', valor: 'ABCD900101HDFRRN01' }).success,
    ).toBe(false);
  });
});
