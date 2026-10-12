import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { todayInClinic } from '../../platform/clock.js';
import { db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { patientRepository, type PatientRecord, type PatientSummary } from './repository.js';
import {
  createBirthDateSchema,
  EDITABLE_FIELDS,
  type AvailabilityInput,
  type ListQuery,
  type PatientInput,
  type UpdatePatientInput,
} from './schemas.js';

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

/**
 * Conflicto de unicidad al editar. A diferencia del alta, el código sigue el orden de
 * PG-DSN-002 §5.12.6 (CURP y luego teléfono) y `campos` incluye todos los conflictos a la vez,
 * de modo que el formulario los pinte juntos (RF 3.2.5, RNF 3.2.4).
 */
function editConflictError(fields: Record<string, string>) {
  const code = fields.curp ? 'CURP_EN_USO' : 'TELEFONO_EN_USO';
  const message = fields.curp ?? fields.telefono;
  return new AppError(409, code, message, fields);
}

/** Red de seguridad para dos ediciones simultáneas que superen la verificación previa. */
function translateEditUniqueViolation(error: unknown) {
  const databaseError = error as DatabaseError;
  if (databaseError.code !== '23505') return null;
  if (databaseError.constraint === 'paciente_curp_unico') {
    return editConflictError({ curp: CURP_TAKEN });
  }
  if (databaseError.constraint === 'paciente_telefono_unico') {
    return editConflictError({ telefono: PHONE_TAKEN });
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

async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  translate: (error: unknown) => AppError | null = translateUniqueViolation,
) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw translate(error) ?? error;
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

/** Columna `detalle` de bitacora_acceso. */
const AUDIT_DETAIL_MAX = 255;

/**
 * Detalle de auditoría de una edición: el identificador del paciente y solo los NOMBRES de los
 * campos que cambiaron, nunca sus valores (R01, ADR-14). Si no cabe, se recorta en el límite de
 * un nombre completo para no dejar un campo partido a la mitad.
 */
function updateAuditDetail(id: string, fields: readonly string[]) {
  const prefix = `${id} campos=`;
  const included: string[] = [];
  let length = prefix.length;
  for (const field of fields) {
    const extra = field.length + (included.length ? 1 : 0);
    if (length + extra > AUDIT_DETAIL_MAX) break;
    included.push(field);
    length += extra;
  }
  return prefix + included.join(',');
}

/** Día de registro del paciente en la zona de la clínica, nunca en UTC (CLAUDE.md, §4.5). */
const registrationDateOf = (patient: PatientSummary) => todayInClinic(patient.created_at);

function notFoundError() {
  return new AppError(404, 'PACIENTE_NO_ENCONTRADO', 'No encontramos al paciente indicado.');
}

function inactiveError() {
  return new AppError(
    409,
    'PACIENTE_INACTIVO',
    'Este paciente está dado de baja. Reactívalo para poder editar sus datos.',
  );
}

function versionConflictError(currentVersion: number) {
  return new AppError(
    409,
    'CONFLICTO_VERSION',
    'Otra persona actualizó este perfil mientras lo editabas. Revisa los cambios y guarda de nuevo.',
    undefined,
    { version_actual: currentVersion },
  );
}

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

  /** Unicidad anticipada de CURP y teléfono (RF 3.1.5, RF 3.1.11, RF 3.2.5, RNF 3.1.3). */
  async checkAvailability(input: AvailabilityInput) {
    if (input.campo === 'curp') {
      const existing = await patientRepository.findByCurp(input.valor);
      if (!existing) return { campo: input.campo, disponible: true };
      // Al editar, el propio paciente no es un conflicto consigo mismo (RF 3.2.5).
      if (input.excluir_id && existing.id === input.excluir_id) {
        return { campo: input.campo, disponible: true };
      }
      if (!existing.activo) {
        // No es un error del campo: al guardar se ofrece reactivar el perfil.
        return { campo: input.campo, disponible: true, dado_de_baja: true };
      }
      return { campo: input.campo, disponible: false, mensaje: CURP_TAKEN };
    }

    const inactive = input.curp ? await patientRepository.findByCurp(input.curp) : null;
    const excludeId = input.excluir_id ?? (inactive && !inactive.activo ? inactive.id : null);
    const taken = await patientRepository.isPhoneTaken(input.valor, excludeId);
    return taken
      ? { campo: input.campo, disponible: false, mensaje: PHONE_TAKEN }
      : { campo: input.campo, disponible: true };
  },

  /** RF 3.2.1. Listado paginado de pacientes activos; los listados no se auditan (§4.3.3). */
  async list(query: ListQuery) {
    const { datos, total } = await patientRepository.list(query, todayInClinic());
    return { datos, pagina: query.pagina, tamano: query.tamano, total };
  },

  /** RF 3.2.2–3.2.3. Cada apertura del perfil se registra en la bitácora (ADR-14, §5.6). */
  async getById(id: string, context: RequestContext) {
    const patient = await patientRepository.findById(id, todayInClinic());
    if (!patient) throw notFoundError();

    await audit({ ...auditContext(context), event: 'paciente_consultado', detail: patient.id });
    return patient;
  },

  /**
   * RF 3.2.4 a RF 3.2.6. Edición parcial con control de versión optimista (ADR-10). Solo se
   * editan pacientes activos; la reactivación y la baja corresponden a la EDT 4.3.3.
   */
  async update(id: string, input: UpdatePatientInput, context: RequestContext) {
    const changed = EDITABLE_FIELDS.filter((field) => field in input);
    if (!changed.length) {
      throw new AppError(
        400,
        'SIN_CAMBIOS',
        'No hay cambios por guardar. Modifica al menos un campo.',
      );
    }

    return inTransaction(async (client) => {
      const current = await patientRepository.findSummaryById(id, client, true);
      if (!current) throw notFoundError();
      if (!current.activo) throw inactiveError();
      if (current.version !== input.version) throw versionConflictError(current.version);

      // La edad mínima de 7 años se mide contra la fecha de registro, no contra hoy (§4.5).
      if (input.fecha_nacimiento !== undefined) {
        const parsed = createBirthDateSchema(() => registrationDateOf(current)).safeParse(
          input.fecha_nacimiento,
        );
        if (!parsed.success) {
          // El esquema valida una cadena suelta, así que el mensaje se asocia al campo aquí.
          throw new AppError(
            400,
            'VALIDACION_INVALIDA',
            'Revisa los datos marcados e inténtalo de nuevo.',
            {
              fecha_nacimiento:
                parsed.error.issues[0]?.message ?? 'La fecha de nacimiento no es válida.',
            },
          );
        }
      }

      const fields: Record<string, string> = {};
      if (
        input.curp !== undefined &&
        (await patientRepository.isCurpTaken(input.curp, id, client))
      ) {
        fields.curp = CURP_TAKEN;
      }
      if (
        input.telefono !== undefined &&
        (await patientRepository.isPhoneTaken(input.telefono, id, client))
      ) {
        fields.telefono = PHONE_TAKEN;
      }
      if (Object.keys(fields).length) throw editConflictError(fields);

      const updated = await patientRepository.update(
        id,
        input,
        context.userId,
        todayInClinic(),
        client,
      );
      if (!updated) {
        // El UPDATE no afectó ninguna fila: alguien cambió el perfil entre la lectura y la
        // escritura, pese al bloqueo. Se averigua la causa exacta para informarla.
        const after = await patientRepository.findSummaryById(id, client);
        if (!after) throw notFoundError();
        if (!after.activo) throw inactiveError();
        throw versionConflictError(after.version);
      }

      await audit(
        {
          ...auditContext(context),
          event: 'paciente_actualizado',
          detail: updateAuditDetail(updated.id, changed),
        },
        client,
      );
      return updated;
    }, translateEditUniqueViolation);
  },
};
