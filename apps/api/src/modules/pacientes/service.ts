import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { patientRepository, type PatientRecord, type PatientSummary } from './repository.js';
import type { AvailabilityInput, PatientInput } from './schemas.js';

export type RequestContext = {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};

type DatabaseError = Error & { code?: string; constraint?: string };

const CURP_TAKEN = 'Este CURP ya está registrado.';
const PHONE_TAKEN = 'Este teléfono ya está registrado en otro paciente.';

/**
 * Respuesta de duplicado sin exponer datos de otros pacientes (CA-3.1-03).
 * Se devuelve un error por campo para pintarlo junto a cada entrada del formulario.
 */
function duplicateError(fields: Record<string, string>) {
  const both = fields.curp && fields.telefono;
  const code = both ? 'DATOS_EN_USO' : fields.curp ? 'CURP_EN_USO' : 'TELEFONO_EN_USO';
  const message = both
    ? 'El CURP y el teléfono ya están registrados.'
    : fields.curp
      ? 'El CURP ya está registrado.'
      : 'El teléfono ya está registrado en otro paciente.';
  return new AppError(409, code, message, fields);
}

function translateUniqueViolation(error: unknown) {
  const databaseError = error as DatabaseError;
  if (databaseError.code !== '23505') return null;
  if (databaseError.constraint === 'paciente_curp_unico') {
    return duplicateError({ curp: CURP_TAKEN });
  }
  if (databaseError.constraint === 'paciente_telefono_unico') {
    return duplicateError({ telefono: PHONE_TAKEN });
  }
  return null;
}

function inactivePatientError(patient: PatientSummary) {
  return new AppError(
    409,
    'PACIENTE_DADO_DE_BAJA',
    'Este CURP pertenece a un paciente dado de baja. Puedes reactivar su perfil con los datos capturados.',
    undefined,
    {
      paciente: {
        id: patient.id,
        nombre_completo: patient.nombre_completo,
        fecha_baja: patient.fecha_baja,
      },
    },
  );
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw translateUniqueViolation(error) ?? error;
  } finally {
    client.release();
  }
}

const auditContext = (context: RequestContext) => ({
  userId: context.userId,
  ip: context.ip,
  userAgent: context.userAgent,
  correlationId: context.correlationId,
});

export const patientService = {
  /** RF 3.1.1 a RF 3.1.14. El paciente queda registrado y activo (CA-3.1-01). */
  async register(input: PatientInput, context: RequestContext): Promise<PatientRecord> {
    const patient = await inTransaction(async (client) => {
      const existing = await patientRepository.findByCurp(input.curp, client);
      if (existing && !existing.activo) throw inactivePatientError(existing);

      const fields: Record<string, string> = {};
      if (existing) fields.curp = CURP_TAKEN;
      if (await patientRepository.isPhoneTaken(input.telefono, null, client)) {
        fields.telefono = PHONE_TAKEN;
      }
      if (Object.keys(fields).length) throw duplicateError(fields);

      const created = await patientRepository.create(input, context.userId, client);
      await audit(
        { ...auditContext(context), event: 'paciente_registrado', detail: created.id },
        client,
      );
      return created;
    });

    return patient;
  },

  /**
   * Reactiva a un paciente dado de baja cuyo CURP coincide con el capturado en el registro.
   * Sus datos anteriores se reemplazan por los nuevos (PG-DSN-002-INT, registro de paciente).
   */
  async reactivate(id: string, input: PatientInput, context: RequestContext) {
    const patient = await inTransaction(async (client) => {
      const current = await patientRepository.findSummaryById(id, client, true);
      if (!current) {
        throw new AppError(404, 'PACIENTE_NO_ENCONTRADO', 'No encontramos al paciente indicado.');
      }
      if (current.activo) {
        throw new AppError(409, 'PACIENTE_ACTIVO', 'El paciente ya está activo.');
      }
      if (current.curp !== input.curp) {
        throw new AppError(
          400,
          'VALIDACION_INVALIDA',
          'El CURP capturado no corresponde al paciente que se quiere reactivar.',
          { curp: 'El CURP no corresponde al paciente que se quiere reactivar.' },
        );
      }
      if (await patientRepository.isPhoneTaken(input.telefono, id, client)) {
        throw duplicateError({ telefono: PHONE_TAKEN });
      }

      const updated = await patientRepository.reactivate(id, input, context.userId, client);
      if (!updated) throw new AppError(409, 'PACIENTE_ACTIVO', 'El paciente ya está activo.');
      await audit(
        { ...auditContext(context), event: 'paciente_reactivado', detail: updated.id },
        client,
      );
      return updated;
    });

    return patient;
  },

  /** Unicidad anticipada de CURP y teléfono (RF 3.1.5, RF 3.1.11, RNF 3.1.3). */
  async checkAvailability(input: AvailabilityInput) {
    if (input.campo === 'curp') {
      const existing = await patientRepository.findByCurp(input.valor);
      if (!existing) return { campo: input.campo, disponible: true };
      if (!existing.activo) {
        // No es un error del campo: al guardar se ofrece reactivar el perfil.
        return { campo: input.campo, disponible: true, dado_de_baja: true };
      }
      return { campo: input.campo, disponible: false, mensaje: CURP_TAKEN };
    }

    const inactive = input.curp ? await patientRepository.findByCurp(input.curp) : null;
    const excludeId = inactive && !inactive.activo ? inactive.id : null;
    const taken = await patientRepository.isPhoneTaken(input.valor, excludeId);
    return taken
      ? { campo: input.campo, disponible: false, mensaje: PHONE_TAKEN }
      : { campo: input.campo, disponible: true };
  },
};
