import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { inspectImage, photoStorage } from '../../platform/images.js';
import { therapistRepository, type TherapistRecord } from './repository.js';
import type { TherapistAvailabilityInput, TherapistInput } from './schemas.js';

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

  /** Unicidad anticipada de teléfono, correo o cédula (RF 2.1.5, RF 2.1.7, RF 2.1.15). */
  async checkAvailability(input: TherapistAvailabilityInput) {
    const campo = input.campo;
    const valor = input.valor;

    if (campo === 'telefono') {
      const taken = await therapistRepository.isPhoneTaken(valor);
      return taken
        ? { campo, disponible: false, mensaje: PHONE_TAKEN }
        : { campo, disponible: true };
    }

    if (campo === 'correo' || campo === 'correo_electronico') {
      const taken = await therapistRepository.isEmailTaken(valor);
      return taken
        ? { campo, disponible: false, mensaje: EMAIL_TAKEN }
        : { campo, disponible: true };
    }

    if (campo === 'cedula' || campo === 'cedula_profesional') {
      const taken = await therapistRepository.isCedulaTaken(valor);
      return taken
        ? { campo, disponible: false, mensaje: CEDULA_TAKEN }
        : { campo, disponible: true };
    }

    return { campo, disponible: true };
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
