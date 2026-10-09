import { describe, expect, it } from 'vitest';
import { ageOn, parseIsoDate, todayInClinic } from '../src/platform/clock.js';
import { availabilitySchema, createPatientSchema } from '../src/modules/pacientes/schemas.js';

const registrationDate = '2026-10-08';
const schema = createPatientSchema(() => registrationDate);
const valid = {
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  telefono: '9996402218',
};

const fieldError = (input: unknown, field: string) => {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join('.') === field)?.message;
};

describe('esquema de registro de pacientes', () => {
  it('acepta un paciente con datos válidos y sin correo (CA-3.1-01, CA-3.1-07)', () => {
    const result = schema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correo).toBeNull();
      expect(result.data.consentimiento).toBe(false);
    }
  });

  it('normaliza el nombre, el CURP y el correo', () => {
    const result = schema.parse({
      ...valid,
      nombre_completo: '  Valeria   Ku  Escalante ',
      curp: 'kuev 090825 myn xsla3',
      correo: ' Valeria.Ku@Gmail.com ',
    });
    expect(result.nombre_completo).toBe('Valeria Ku Escalante');
    expect(result.curp).toBe('KUEV090825MYNXSLA3');
    expect(result.correo).toBe('valeria.ku@gmail.com');
  });

  it('acepta un nombre de 50 caracteres y rechaza uno vacío o de 51 (CA-3.1-02)', () => {
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(50) }, 'nombre_completo')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(51) }, 'nombre_completo')).toBe(
      'El nombre no puede tener más de 50 caracteres.',
    );
    expect(fieldError({ ...valid, nombre_completo: '   ' }, 'nombre_completo')).toBe(
      'Escribe el nombre completo.',
    );
  });

  it('exige nombre, CURP, sexo, fecha de nacimiento y teléfono (CA-3.1-05)', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toEqual(
        expect.arrayContaining(['nombre_completo', 'curp', 'sexo', 'fecha_nacimiento', 'telefono']),
      );
      expect(fields).not.toContain('correo');
    }
  });

  it('valida la estructura del CURP (CA-3.1-08)', () => {
    expect(fieldError({ ...valid, curp: 'KUEV090825MYNXSLA' }, 'curp')).toBe(
      'El CURP no tiene un formato válido. Debe tener 18 caracteres.',
    );
    expect(fieldError({ ...valid, curp: 'KUEV091325MYNXSLA3' }, 'curp')).toBeDefined();
    expect(fieldError({ ...valid, curp: '' }, 'curp')).toBe('Escribe el CURP.');
  });

  it('exige un teléfono de exactamente 10 dígitos (CA-3.1-08)', () => {
    expect(fieldError({ ...valid, telefono: '99964022' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '99964022181' }, 'telefono')).toBeDefined();
    expect(fieldError({ ...valid, telefono: '999-640-22' }, 'telefono')).toBeDefined();
  });

  it('acepta solo los valores de sexo previstos', () => {
    expect(fieldError({ ...valid, sexo: 'X' }, 'sexo')).toBe('Selecciona el sexo.');
    expect(fieldError({ ...valid, sexo: 'O' }, 'sexo')).toBe(undefined);
  });

  it('rechaza un correo con formato inválido (CA-3.1-07)', () => {
    expect(fieldError({ ...valid, correo: 'valeria.ku@' }, 'correo')).toBe(
      'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.',
    );
    expect(fieldError({ ...valid, correo: '' }, 'correo')).toBe(undefined);
  });

  it('aplica las reglas de fecha de nacimiento y edad mínima (CA-3.1-04)', () => {
    expect(fieldError({ ...valid, fecha_nacimiento: '2026-10-08' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2027-01-01' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2019-10-09' }, 'fecha_nacimiento')).toBe(
      'El paciente debe tener al menos 7 años cumplidos.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2019-10-08' }, 'fecha_nacimiento')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2009-02-30' }, 'fecha_nacimiento')).toBe(
      'Esa fecha no existe en el calendario.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '25/08/2009' }, 'fecha_nacimiento')).toBe(
      'Escribe la fecha como dd/mm/aaaa.',
    );
  });

  it('valida las solicitudes de verificación de unicidad', () => {
    expect(
      availabilitySchema.safeParse({ campo: 'curp', valor: 'kuev090825mynxsla3' }).success,
    ).toBe(true);
    expect(availabilitySchema.safeParse({ campo: 'telefono', valor: '9996402218' }).success).toBe(
      true,
    );
    expect(availabilitySchema.safeParse({ campo: 'correo', valor: 'x@y.mx' }).success).toBe(false);
  });
});

describe('utilidades de fecha de la clínica', () => {
  it('calcula la edad cumplida incluyendo el día del cumpleaños', () => {
    expect(ageOn('2019-10-08', '2026-10-08')).toBe(7);
    expect(ageOn('2019-10-09', '2026-10-08')).toBe(6);
    expect(ageOn('2016-02-29', '2023-02-28')).toBe(6);
    expect(ageOn('2016-02-29', '2023-03-01')).toBe(7);
  });

  it('detecta fechas inexistentes y usa la zona horaria configurada', () => {
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    // 05:30 UTC del 9 de octubre aún es 8 de octubre en Mérida (UTC-6).
    expect(todayInClinic(new Date('2026-10-09T05:30:00Z'), 'America/Merida')).toBe('2026-10-08');
  });
});
