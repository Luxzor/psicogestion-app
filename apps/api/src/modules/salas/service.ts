import type { PoolClient } from 'pg';
import { AppError } from '../../platform/errors.js';
import { audit } from '../../platform/audit.js';
import { db } from '../../platform/db.js';
import { salaDatabaseError } from './errors.js';
import { salaRepository, type SalaListState, type SalaRecord } from './repository.js';
import {
  SALA_MENSAJES,
  type CreateSalaInput,
  type SalaAvailabilityInput,
} from './schemas.js';

export type RequestContext = {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};

const auditContext = (context: RequestContext) => ({
  userId: context.userId,
  ip: context.ip,
  userAgent: context.userAgent,
  correlationId: context.correlationId,
});

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw salaDatabaseError(error) ?? error;
  } finally {
    client.release();
  }
}

export const salaService = {
  /**
   * EDT 5.3.1. Registro de sala (RF 4.1.1 a RF 4.1.4, CA-4.1-01 a CA-4.1-03).
   * Valida la unicidad y persiste la sala en una transacción con auditoría en bitacora_acceso.
   */
  async create(input: CreateSalaInput, context: RequestContext): Promise<SalaRecord> {
    const isTaken = await salaRepository.isNameTaken(input.nombre);
    if (isTaken) {
      throw new AppError(409, 'NOMBRE_SALA_EN_USO', SALA_MENSAJES.NOMBRE_SALA_EN_USO, {
        nombre: SALA_MENSAJES.NOMBRE_SALA_EN_USO,
      });
    }

    return inTransaction(async (client) => {
      const sala = await salaRepository.create(input.nombre, context.userId, client);
      await audit(
        {
          ...auditContext(context),
          event: 'sala_creada',
          detail: sala.id,
        },
        client,
      );
      return sala;
    });
  },

  /**
   * EDT 5.3.1. Verificación anticipada de unicidad del nombre de la sala (RF 4.1.4, RNF 4.1.2).
   */
  async checkAvailability(input: SalaAvailabilityInput) {
    const taken = await salaRepository.isNameTaken(input.valor, input.excluir_id);
    return taken
      ? { campo: input.campo, disponible: false, mensaje: SALA_MENSAJES.NOMBRE_SALA_EN_USO }
      : { campo: input.campo, disponible: true };
  },

  /**
   * Listado de salas por estado (PG-DSN-003 3.3, RNF 4.2.1).
   */
  async list(estado: SalaListState = 'activas'): Promise<SalaRecord[]> {
    return salaRepository.list(estado);
  },

  /**
   * Conteo de citas pendientes que aún no terminan (ADR-19, CA-4.2-02).
   */
  async countPendingAppointments(id: string): Promise<number> {
    return salaRepository.countPendingAppointments(id);
  },

  /**
   * EDT 5.3.1. Baja lógica de sala (RF 4.2.1 a RF 4.2.5, ADR-19, CA-4.2-01, CA-4.2-02).
   * Valida existencia, que esté activa y que no tenga citas pendientes futuras.
   */
  async discharge(id: string, context: RequestContext): Promise<SalaRecord> {
    return inTransaction(async (client) => {
      const current = await salaRepository.findSummaryById(id, client, 'update');
      if (!current) {
        throw new AppError(404, 'SALA_NO_ENCONTRADA', SALA_MENSAJES.SALA_NO_ENCONTRADA);
      }
      if (!current.activo) {
        throw new AppError(409, 'SALA_INACTIVA', SALA_MENSAJES.SALA_INACTIVA);
      }

      const pending = await salaRepository.countPendingAppointments(id, new Date(), client);
      if (pending > 0) {
        throw new AppError(
          409,
          'SALA_CON_CITAS_PENDIENTES',
          SALA_MENSAJES.SALA_CON_CITAS_PENDIENTES(pending),
          undefined,
          { citas_pendientes: pending },
        );
      }

      const updated = await salaRepository.discharge(id, context.userId, client);
      if (!updated) {
        throw new AppError(409, 'SALA_INACTIVA', SALA_MENSAJES.SALA_INACTIVA);
      }

      await audit(
        {
          ...auditContext(context),
          event: 'sala_dada_de_baja',
          detail: updated.id,
        },
        client,
      );

      return updated;
    });
  },
};

