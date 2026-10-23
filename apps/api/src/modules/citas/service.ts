import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { db } from '../../platform/db.js';
import { mailService, type CitaConfirmacion } from '../auth/mail.js';
import { citaDatabaseError, citaError } from './errors.js';
import { calcularFin, evaluarHorario } from './horario.js';
import { citaRepository, type CitaRecord } from './repository.js';
import type { CreateCitaInput } from './schemas.js';

export type RequestContext = {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};

/** Respuesta del alta (PG-DSN-003 5.7): la cita con el resultado del correo de confirmación. */
export type CitaCreada = CitaRecord & { confirmacion: CitaConfirmacion };

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
    throw citaDatabaseError(error) ?? error;
  } finally {
    client.release();
  }
}

export const citaService = {
  /**
   * RF 5.1.1–5.1.15, RF 2.3.5 (EDT 5.3.3). Agenda una cita Pendiente (PG-DSN-003 5.8): dentro de
   * una transacción bloquea con FOR SHARE paciente, terapeuta y sala (ADR-21) y rechaza los que
   * no existen o están inactivos; luego verifica la rejilla y el horario (ADR-15); inserta la
   * cita (el empalme lo impide la restricción EXCLUDE de la base, ADR-16, aquí solo se traduce el
   * 23P01); y registra audit('cita_creada'). Ya confirmada la transacción, fuera de ella, envía
   * la confirmación por correo sin bloquear el alta si falla (ADR-22). `ahora` se inyecta para
   * las pruebas, igual que en horario.ts.
   */
  async create(
    input: CreateCitaInput,
    context: RequestContext,
    ahora: Date = new Date(),
  ): Promise<CitaCreada> {
    const { cita, correoPaciente } = await inTransaction(async (client) => {
      const asignables = await citaRepository.lockAssignables(
        {
          id_paciente: input.id_paciente,
          id_terapeuta: input.id_terapeuta,
          id_sala: input.id_sala,
        },
        client,
      );

      if (!asignables.paciente) throw citaError('PACIENTE_NO_ENCONTRADO');
      if (!asignables.paciente.activo) throw citaError('PACIENTE_INACTIVO_NO_ASIGNABLE');
      if (!asignables.terapeuta) throw citaError('TERAPEUTA_NO_ENCONTRADO');
      if (!asignables.terapeuta.activo) throw citaError('TERAPEUTA_INACTIVO_NO_ASIGNABLE');
      if (!asignables.sala) throw citaError('SALA_NO_ENCONTRADA');
      if (!asignables.sala.activo) throw citaError('SALA_INACTIVA');

      const horarioError = evaluarHorario(input.inicio, input.duracion_bloques, ahora);
      if (horarioError) throw citaError(horarioError.codigo);
      const fin = calcularFin(input.inicio, input.duracion_bloques);

      /**
       * NOTA PARA EDT 5.3.6 (generación de folios)
       * - Se genera en la base: el DEFAULT de cita.folio y la secuencia cita_folio_seq
       *   (db/migrations/0009_sala_cita.sql). Este servicio no construye ni formatea el folio.
       * - Se lee aquí mismo con RETURNING folio, dentro de citaRepository.create().
       * - Un alta fallida (por ejemplo por empalme, 23P01) ya consumió un número de la secuencia
       *   y deja un hueco; es el comportamiento esperado (PG-DSN-003 11.3).
       * - El máximo es 999 999, sin ciclo; al agotarse, nextval() falla con SQLSTATE 2200H y
       *   citaDatabaseError() lo traduce a FOLIO_AGOTADO (500) en vez de un 500 genérico.
       * - El año del folio sale de America/Merida (CLINIC_TIME_ZONE), no de UTC.
       * - El folio no se reutiliza, ni siquiera el de una cita cancelada.
       * - Se consume en: la respuesta de esta alta (cita.folio), el correo de confirmación
       *   (mailService.sendConfirmacionCita, más abajo), la pantalla de éxito de "Agendar cita" y
       *   la búsqueda por folio del listado de citas (GET /citas?folio=, próximo commit de 5.3.3).
       * - La prueba que verifica RNF 5.1.2 (folio en menos de 2 s) es la de integración del alta
       *   de citas que agrega esta EDT (apps/api/test).
       */
      const nueva = await citaRepository.create(
        {
          id_paciente: input.id_paciente,
          id_terapeuta: input.id_terapeuta,
          id_sala: input.id_sala,
          inicio: input.inicio,
          fin,
        },
        context.userId,
        client,
      );

      await audit(
        {
          ...auditContext(context),
          event: 'cita_creada',
          detail: `${nueva.id} ${nueva.folio}`,
        },
        client,
      );

      return { cita: nueva, correoPaciente: asignables.paciente.correo };
    });

    const confirmacion = await mailService.sendConfirmacionCita({
      correoPaciente,
      nombrePaciente: cita.paciente.nombre_completo,
      nombreTerapeuta: cita.terapeuta.nombre_completo,
      nombreSala: cita.sala.nombre,
      folio: cita.folio,
      inicio: new Date(cita.inicio),
    });

    return { ...cita, confirmacion };
  },
};
