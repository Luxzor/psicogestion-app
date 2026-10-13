import { describe, expect, it } from 'vitest';
import { ageOn, parseIsoDate, todayInClinic } from '../src/platform/clock.js';
import {
  availabilitySchema,
  createPatientSchema,
  createUpdatePatientSchema,
  listQuerySchema,
} from '../src/modules/pacientes/schemas.js';

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

describe('esquema de parámetros de listado (EDT 4.3.2)', () => {
  it('acepta pagina y tamano por defecto cuando no se envían', () => {
    const result = listQuerySchema.parse({});
    expect(result).toMatchObject({ pagina: 1, tamano: 25, orden: 'nombre_completo' });
    expect(result.q).toBeUndefined();
  });

  it('acepta el tamaño mínimo (1) y el máximo (100), rechaza 0 y 101 (RNF 3.2.1)', () => {
    expect(listQuerySchema.safeParse({ tamano: '1' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '25' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '100' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ tamano: '101' }).success).toBe(false);
  });

  it('rechaza una página inválida', () => {
    expect(listQuerySchema.safeParse({ pagina: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ pagina: 'abc' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ pagina: '2' }).success).toBe(true);
  });

  it('rechaza un orden que no sea nombre_completo o -fecha_registro', () => {
    expect(listQuerySchema.safeParse({ orden: 'curp' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ orden: '-fecha_registro' }).success).toBe(true);
  });

  it('rechaza un parámetro desconocido (el filtro de estado llega con la EDT 4.3.3)', () => {
    expect(listQuerySchema.safeParse({ estado: 'inactivos' }).success).toBe(false);
  });

  it('recorta la búsqueda y la convierte en undefined si queda vacía', () => {
    expect(listQuerySchema.parse({ q: '  Valeria  ' }).q).toBe('Valeria');
    expect(listQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });
});

describe('esquema de edición de pacientes (EDT 4.3.2, ADR-10)', () => {
  const update = createUpdatePatientSchema(() => registrationDate);

  it('acepta un cuerpo parcial con un solo campo además de version', () => {
    const result = update.safeParse({ version: 1, telefono: '9991234567' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ version: 1, telefono: '9991234567' });
    }
  });

  it('exige la versión; un cuerpo sin version se rechaza', () => {
    const result = update.safeParse({ telefono: '9991234567' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('version');
    }
  });

  it('acepta un cuerpo con solo version (SIN_CAMBIOS se decide en el servicio, no aquí)', () => {
    expect(update.safeParse({ version: 1 }).success).toBe(true);
  });

  it('es estricto: rechaza campos desconocidos y de solo lectura', () => {
    expect(update.safeParse({ version: 1, id: 'x' }).success).toBe(false);
    expect(update.safeParse({ version: 1, activo: false }).success).toBe(false);
    expect(update.safeParse({ version: 1, created_by: 'x' }).success).toBe(false);
    expect(update.safeParse({ version: 1, fecha_registro: '2026-01-01' }).success).toBe(false);
  });

  it('rechaza version no entera o no positiva, sin coerción de cadenas', () => {
    expect(update.safeParse({ version: 0 }).success).toBe(false);
    expect(update.safeParse({ version: 1.5 }).success).toBe(false);
    expect(update.safeParse({ version: '1' }).success).toBe(false);
  });

  it('aplica las mismas reglas de formato del alta a cada campo editado', () => {
    expect(update.safeParse({ version: 1, nombre_completo: '' }).success).toBe(false);
    expect(update.safeParse({ version: 1, curp: 'KUEV090825MYNXSLA' }).success).toBe(false);
    expect(update.safeParse({ version: 1, telefono: '99912345' }).success).toBe(false);
    expect(update.safeParse({ version: 1, correo: 'no-valido' }).success).toBe(false);
    expect(update.safeParse({ version: 1, sexo: 'X' }).success).toBe(false);
  });

  it('normaliza los campos editados igual que en el registro', () => {
    const result = update.parse({
      version: 1,
      nombre_completo: '  Ana   López ',
      curp: 'kuev090825mynxsla3',
      correo: ' Ana.Lopez@Gmail.com ',
    });
    expect(result).toMatchObject({
      nombre_completo: 'Ana López',
      curp: 'KUEV090825MYNXSLA3',
      correo: 'ana.lopez@gmail.com',
    });
  });

  it('la fecha de nacimiento se valida contra el "hoy" inyectado, no contra la fecha real', () => {
    // "hoy" inyectado es registrationDate (2026-10-08); una fecha posterior se rechaza aunque
    // sea anterior a la fecha real de ejecución de la prueba.
    const result = update.safeParse({ version: 1, fecha_nacimiento: registrationDate });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'La fecha de nacimiento debe ser anterior a hoy.',
      );
    }
  });

  it('mide la edad mínima de 7 años contra la fecha de registro, no contra hoy (§4.5)', () => {
    // El paciente se registró el 2019-10-08 (registrationDate - 7 años exactos de PG-DSN-002
    // §4.5): una fecha de nacimiento de 7 años antes de ESE registro cumple; una de 6 no.
    const registeredSevenYearsAgo = createUpdatePatientSchema(() => '2019-10-08');
    expect(
      registeredSevenYearsAgo.safeParse({ version: 1, fecha_nacimiento: '2012-10-08' }).success,
    ).toBe(true);
    expect(
      registeredSevenYearsAgo.safeParse({ version: 1, fecha_nacimiento: '2013-10-09' }).success,
    ).toBe(false);
  });
});
