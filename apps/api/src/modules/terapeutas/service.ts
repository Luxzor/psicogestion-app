import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { todayInClinic } from '../../platform/clock.js';
import { db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { inspectImage, photoStorage } from '../../platform/images.js';
import { therapistRepository, type TherapistRecord, type TherapistSummary } from './repository.js';
import {
  createBirthDateSchema,
  EDITABLE_FIELDS,
  type ListQuery,
  type TherapistAvailabilityInput,
  type TherapistInput,
  type UpdateTherapistInput,
} from './schemas.js';

export type RequestContext = {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};

type DatabaseError = Error & { code?: string; constraint?: string };

const PHONE_TAKEN = 'Este teléfono ya está registrado en otro terapeuta.';
const EMAIL_TAKEN = 'Este correo ya está registrado en otro terapeuta.';
const CEDULA_TAKEN = 'Esta cédula ya está registrada en otro terapeuta.';

/**
 * Respuesta de duplicado sin exponer datos de otros terapeutas (CA-2.1-03, CA-2.1-07).
 * Se devuelven los errores por campo para pintarlos junto a cada entrada del formulario.
 */
function duplicateError(fields: Record<string, string>) {
  const count = Object.keys(fields).length;
  // Orden de prioridad del código de error conforme a PG-DSN-002 5.12.6: cédula, teléfono, correo
  const code =
    count > 1
      ? 'DATOS_EN_USO'
      : fields.cedula_profesional
        ? 'CEDULA_EN_USO'
        : fields.telefono
          ? 'TELEFONO_EN_USO'
          : 'CORREO_EN_USO';

  const message =
    count > 1
      ? 'Hay datos que ya están registrados en otro terapeuta.'
      : (fields.cedula_profesional ??
        fields.telefono ??
        fields.correo_electronico ??
        'Dato ya registrado.');

  return new AppError(409, code, message, fields);
}

function translateUniqueViolation(error: unknown) {
  const databaseError = error as DatabaseError;
  if (databaseError.code !== '23505') return null;
  if (databaseError.constraint === 'uq_terapeuta_telefono') {
    return duplicateError({ telefono: PHONE_TAKEN });
  }
  if (databaseError.constraint === 'uq_terapeuta_correo') {
    return duplicateError({ correo_electronico: EMAIL_TAKEN });
  }
  if (databaseError.constraint === 'uq_terapeuta_cedula') {
    return duplicateError({ cedula_profesional: CEDULA_TAKEN });
  }
  return null;
}

/**
 * Conflicto de unicidad al editar (RF 2.2.4, EDT 4.3.5). A diferencia del alta, el código
 * corresponde solo al primer conflicto según el orden de PG-DSN-002 5.12.6 (cédula, teléfono,
 * correo: terapeuta no tiene CURP), sin el agregado DATOS_EN_USO del alta; `campos` incluye todos
 * los conflictos a la vez, de modo que el formulario los pinte juntos (RNF 2.2.5).
 */
function editConflictError(fields: Record<string, string>) {
  const code = fields.cedula_profesional
    ? 'CEDULA_EN_USO'
    : fields.telefono
      ? 'TELEFONO_EN_USO'
      : 'CORREO_EN_USO';
  const message = fields.cedula_profesional ?? fields.telefono ?? fields.correo_electronico;
  return new AppError(409, code, message, fields);
}

/** Red de seguridad para dos ediciones simultáneas que superen la verificación previa. */
function translateEditUniqueViolation(error: unknown) {
  const databaseError = error as DatabaseError;
  if (databaseError.code !== '23505') return null;
  if (databaseError.constraint === 'uq_terapeuta_cedula') {
    return editConflictError({ cedula_profesional: CEDULA_TAKEN });
  }
  if (databaseError.constraint === 'uq_terapeuta_telefono') {
    return editConflictError({ telefono: PHONE_TAKEN });
  }
  if (databaseError.constraint === 'uq_terapeuta_correo') {
    return editConflictError({ correo_electronico: EMAIL_TAKEN });
  }
  return null;
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
 * Detalle de auditoría de una edición: el identificador del terapeuta y solo los NOMBRES de los
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

function notFoundError() {
  return new AppError(404, 'TERAPEUTA_NO_ENCONTRADO', 'No encontramos al terapeuta indicado.');
}

function inactiveError() {
  return new AppError(
    409,
    'TERAPEUTA_INACTIVO',
    'Este terapeuta está dado de baja. Reactívalo para poder editar sus datos.',
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

/** Día de registro del terapeuta en la zona de la clínica, nunca en UTC. */
const registrationDateOf = (therapist: TherapistSummary) => todayInClinic(therapist.created_at);

export const therapistService = {
  /** RF 2.1.1 a RF 2.1.15. El terapeuta queda registrado y activo (CA-2.1-01). */
  async register(input: TherapistInput, context: RequestContext): Promise<TherapistRecord> {
    const therapist = await inTransaction(async (client) => {
      const fields: Record<string, string> = {};

      if (await therapistRepository.isCedulaTaken(input.cedula_profesional, null, client)) {
        fields.cedula_profesional = CEDULA_TAKEN;
      }
      if (await therapistRepository.isPhoneTaken(input.telefono, null, client)) {
        fields.telefono = PHONE_TAKEN;
      }
      if (await therapistRepository.isEmailTaken(input.correo_electronico, null, client)) {
        fields.correo_electronico = EMAIL_TAKEN;
      }

      if (Object.keys(fields).length) {
        throw duplicateError(fields);
      }

      const created = await therapistRepository.create(input, context.userId, client);
      await audit(
        { ...auditContext(context), event: 'terapeuta_registrado', detail: created.id },
        client,
      );
      return created;
    });

    return therapist;
  },

  /**
   * Unicidad anticipada de teléfono, correo o cédula (RF 2.1.5, RF 2.1.7, RF 2.1.15, RF 2.2.4).
   * `excluir_id` excluye al propio terapeuta de la verificación al editar.
   */
  async checkAvailability(input: TherapistAvailabilityInput) {
    const campo = input.campo;
    const valor = input.valor;
    const excludeId = input.excluir_id ?? null;

    if (campo === 'telefono') {
      const taken = await therapistRepository.isPhoneTaken(valor, excludeId);
      return taken
        ? { campo, disponible: false, mensaje: PHONE_TAKEN }
        : { campo, disponible: true };
    }

    if (campo === 'correo' || campo === 'correo_electronico') {
      const taken = await therapistRepository.isEmailTaken(valor, excludeId);
      return taken
        ? { campo, disponible: false, mensaje: EMAIL_TAKEN }
        : { campo, disponible: true };
    }

    if (campo === 'cedula' || campo === 'cedula_profesional') {
      const taken = await therapistRepository.isCedulaTaken(valor, excludeId);
      return taken
        ? { campo, disponible: false, mensaje: CEDULA_TAKEN }
        : { campo, disponible: true };
    }

    return { campo, disponible: true };
  },

  /**
   * RF 2.2.1. Listado paginado de terapeutas activos, dados de baja o todos (EDT 4.3.5). Los
   * listados no se auditan, igual que en pacientes.
   */
  async list(query: ListQuery) {
    const { datos, total } = await therapistRepository.list(query);
    return { datos, pagina: query.pagina, tamano: query.tamano, total };
  },

  /** RF 2.2.2. Cada apertura del perfil se registra en la bitácora (ADR-14) con solo el id. */
  async getById(id: string, context: RequestContext) {
    const therapist = await therapistRepository.findById(id);
    if (!therapist) throw notFoundError();

    await audit({ ...auditContext(context), event: 'terapeuta_consultado', detail: therapist.id });
    return therapist;
  },

  /**
   * RF 2.2.3 a RF 2.2.5. Edición parcial con control de versión optimista (ADR-10). Solo se
   * editan terapeutas activos; la baja y la reactivación son operaciones aparte.
   */
  async update(id: string, input: UpdateTherapistInput, context: RequestContext) {
    const changed = EDITABLE_FIELDS.filter((field) => field in input);
    if (!changed.length) {
      throw new AppError(
        400,
        'SIN_CAMBIOS',
        'No hay cambios por guardar. Modifica al menos un campo.',
      );
    }

    return inTransaction(async (client) => {
      const current = await therapistRepository.findSummaryById(id, client, true);
      if (!current) throw notFoundError();
      if (!current.activo) throw inactiveError();
      if (current.version !== input.version) throw versionConflictError(current.version);

      // "Anterior a la fecha de registro" se mide contra la fecha de registro del propio
      // terapeuta, no contra hoy (RF 2.1.9; mismo criterio que PG-DSN-002 4.5 para pacientes).
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
        input.cedula_profesional !== undefined &&
        (await therapistRepository.isCedulaTaken(input.cedula_profesional, id, client))
      ) {
        fields.cedula_profesional = CEDULA_TAKEN;
      }
      if (
        input.telefono !== undefined &&
        (await therapistRepository.isPhoneTaken(input.telefono, id, client))
      ) {
        fields.telefono = PHONE_TAKEN;
      }
      if (
        input.correo_electronico !== undefined &&
        (await therapistRepository.isEmailTaken(input.correo_electronico, id, client))
      ) {
        fields.correo_electronico = EMAIL_TAKEN;
      }
      if (Object.keys(fields).length) throw editConflictError(fields);

      const updated = await therapistRepository.update(id, input, context.userId, client);
      if (!updated) {
        // El UPDATE no afectó ninguna fila: alguien cambió el perfil entre la lectura y la
        // escritura, pese al bloqueo. Se averigua la causa exacta para informarla.
        const after = await therapistRepository.findSummaryById(id, client);
        if (!after) throw notFoundError();
        if (!after.activo) throw inactiveError();
        throw versionConflictError(after.version);
      }

      await audit(
        {
          ...auditContext(context),
          event: 'terapeuta_actualizado',
          detail: updateAuditDetail(updated.id, changed),
        },
        client,
      );
      return updated;
    }, translateEditUniqueViolation);
  },

  /** Carga y valida la fotografía de perfil del terapeuta (RF 2.1.11 a 2.1.13, CA-2.1-05). */
  async uploadPhoto(
    therapistId: string,
    imageBuffer: Buffer,
    context: RequestContext,
  ): Promise<TherapistRecord> {
    const imageInfo = inspectImage(imageBuffer);

    const therapist = await therapistRepository.findById(therapistId);
    if (!therapist) {
      throw new AppError(404, 'TERAPEUTA_NO_ENCONTRADO', 'No encontramos al terapeuta indicado.');
    }
    const { storageKey } = await photoStorage.save(therapistId, imageBuffer, imageInfo.format);

    const updated = await therapistRepository.updatePhoto(therapistId, storageKey, context.userId);
    if (!updated) {
      throw new AppError(404, 'TERAPEUTA_NO_ENCONTRADO', 'No encontramos al terapeuta indicado.');
    }

    await audit(
      { ...auditContext(context), event: 'terapeuta_foto_actualizada', detail: therapistId },
      db,
    );

    return updated;
  },

  /** Descarga la fotografía de perfil de un terapeuta (RF 2.2.2). */
  async getPhoto(therapistId: string) {
    const therapist = await therapistRepository.findById(therapistId);
    if (!therapist || !therapist.foto_perfil) {
      throw new AppError(404, 'FOTO_NO_ENCONTRADA', 'El terapeuta no tiene fotografía asignada.');
    }

    const buffer = await photoStorage.get(therapist.foto_perfil);
    if (!buffer) {
      throw new AppError(404, 'FOTO_NO_ENCONTRADA', 'El archivo de fotografía no existe.');
    }

    const contentType = therapist.foto_perfil.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const etag = therapist.foto_actualizada_en
      ? `"${new Date(therapist.foto_actualizada_en).getTime()}"`
      : `"${therapist.version}"`;

    return { buffer, contentType, etag };
  },

  /** Elimina la fotografía de perfil de un terapeuta. */
  async deletePhoto(therapistId: string, context: RequestContext) {
    const therapist = await therapistRepository.findById(therapistId);
    if (!therapist) {
      throw new AppError(404, 'TERAPEUTA_NO_ENCONTRADO', 'No encontramos al terapeuta indicado.');
    }

    if (therapist.foto_perfil) {
      await photoStorage.delete(therapist.foto_perfil);
      await therapistRepository.removePhoto(therapistId, context.userId);
      await audit(
        { ...auditContext(context), event: 'terapeuta_foto_eliminada', detail: therapistId },
        db,
      );
    }
  },
};
