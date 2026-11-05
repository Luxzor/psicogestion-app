import { api } from '../../auth/api';
import type {
  Disponibilidad,
  DisponibilidadParams,
  Sala,
  SalaAvailability,
  SalaListParams,
  SalaPayload,
  SalaResponse,
} from './types';

export const salasApi = {
  /**
   * EDT 5.3.1. Listado de salas según su estado (PG-DSN-003 3.3).
   */
  list(params?: SalaListParams, accessToken?: string, signal?: AbortSignal) {
    const searchParams = new URLSearchParams();
    if (params?.estado) searchParams.set('estado', params.estado);
    const query = searchParams.toString();
    const endpoint = query ? `/salas?${query}` : '/salas';
    return api<{ salas: Sala[] }>(endpoint, { accessToken, signal });
  },

  /**
   * RF 4.3.1. Obtiene el detalle de una sala por identificador.
   */
  getById(id: string, accessToken?: string, signal?: AbortSignal) {
    return api<{ sala: Sala }>(`/salas/${id}`, { accessToken, signal });
  },

  /**
   * EDT 5.3.2. Consulta de disponibilidad de salas por día (RF 4.3.2, RF 4.3.3, RF 5.1.3; PG-DSN-003 5.7).
   */
  getDisponibilidad(params: DisponibilidadParams, accessToken?: string, signal?: AbortSignal) {
    const searchParams = new URLSearchParams();
    searchParams.set('fecha', params.fecha);
    if (params.id_terapeuta) searchParams.set('id_terapeuta', params.id_terapeuta);
    if (params.id_paciente) searchParams.set('id_paciente', params.id_paciente);
    if (params.duracion) searchParams.set('duracion', String(params.duracion));
    return api<Disponibilidad>(`/salas/disponibilidad?${searchParams.toString()}`, {
      accessToken,
      signal,
    });
  },

  /**
   * EDT 5.3.1. Conteo de citas pendientes de una sala (ADR-19, CA-4.2-02).
   */
  countPendingAppointments(id: string, accessToken?: string, signal?: AbortSignal) {
    return api<{ total: number }>(`/salas/${id}/citas-pendientes`, { accessToken, signal });
  },

  /**
   * EDT 5.3.1. Alta de sala con clave de idempotencia (RF 4.1.1, RF 4.1.2; ADR-13).
   */
  register(payload: SalaPayload, accessToken: string, idempotencyKey: string) {
    return api<SalaResponse>('/salas', {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /**
   * EDT 5.3.1. Baja lógica de sala con clave de idempotencia (RF 4.2.1 a RF 4.2.5; ADR-13, ADR-19).
   */
  discharge(id: string, accessToken: string, idempotencyKey: string) {
    return api<SalaResponse>(`/salas/${id}/baja`, {
      method: 'POST',
      body: {},
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /**
   * EDT 5.3.1. Verificación anticipada de disponibilidad de nombre (RF 4.1.4, RNF 4.1.2).
   */
  checkAvailability(
    body: { campo: 'nombre'; valor: string; excluir_id?: string },
    accessToken: string,
    signal?: AbortSignal,
  ) {
    return api<SalaAvailability>('/salas/validaciones', {
      method: 'POST',
      body,
      accessToken,
      signal,
    });
  },
};

