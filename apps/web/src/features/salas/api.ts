import { api } from '../../auth/api';
import type { Sala, SalaAvailability, SalaListParams, SalaPayload, SalaResponse } from './types';

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

