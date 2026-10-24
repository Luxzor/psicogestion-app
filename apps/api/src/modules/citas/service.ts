import type { PoolClient } from 'pg';
import { audit } from '../../platform/audit.js';
import { db } from '../../platform/db.js';
import { mailService, type CitaConfirmacion } from '../auth/mail.js';
import { citaDatabaseError, citaError } from './errors.js';
import { calcularFin, clinicDateTimeToUtc, evaluarHorario } from './horario.js';
import { citaRepository, type CitaListItem, type CitaRecord } from './repository.js';
import type { CreateCitaInput, CitaListQueryInput } from './schemas.js';

export type RequestContext = {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
};

/** Respuesta del alta (PG-DSN-003 5.7): la cita con el resultado del correo de confirmación. */
export type CitaCreada = CitaRecord & { confirmacion: CitaConfirmacion };

/** Respuesta del listado (GET /citas, RF 5.2.1–5.2.3; convención de PG-DSN-002 5.12.1). */
export type CitaListResponse = {
  datos: CitaListItem[];
  pagina: number;
  tamano: number;
  total: number;
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

  /**
   * RF 5.2.1–5.2.3, RNF 5.1.4 (EDT 5.3.3). Listado paginado con filtros por estado, sala,
   * terapeuta, folio y periodo. El periodo (día, semana o mes) ya llegó resuelto como `desde` y
   * `hasta` (fechas de calendario); aquí se interpretan en CLINIC_TIME_ZONE con
   * clinicDateTimeToUtc(): `desde` es el inicio de ese día y `hasta` el inicio del día siguiente
   * (límite superior exclusivo), de modo que el rango cubre el día de `hasta` completo. Antes de
   * listar, marca como Vencida toda cita Pendiente cuyo fin ya pasó (ADR-18).
   */
  async list(input: CitaListQueryInput): Promise<CitaListResponse> {
    await citaRepository.markExpired();

    const desde = input.desde ? (clinicDateTimeToUtc(input.desde, 0) ?? undefined) : undefined;
    const hasta = input.hasta
      ? (clinicDateTimeToUtc(input.hasta, 24 * 60) ?? undefined)
      : undefined;

    const { datos, total } = await citaRepository.list({
      estado: input.estado,
      id_sala: input.id_sala,
      id_terapeuta: input.id_terapeuta,
      folio: input.folio,
      desde,
      hasta,
      pagina: input.pagina,
      tamano: input.tamano,
    });

    return { datos, pagina: input.pagina, tamano: input.tamano, total };
  },

  /** RF 5.2 (EDT 5.3.3). Detalle de una cita; registra audit('cita_consultada'). */
  async getById(id: string, context: RequestContext): Promise<CitaRecord> {
    const cita = await citaRepository.findById(id);
    if (!cita) throw citaError('CITA_NO_ENCONTRADA');

    await audit({
      ...auditContext(context),
      event: 'cita_consultada',
      detail: `${cita.id} ${cita.folio}`,
    });

    return cita;
  },
};
