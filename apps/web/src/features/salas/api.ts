import { api } from '../../auth/api';
import type { SalaAvailability, SalaPayload, SalaResponse } from './types';

export const salasApi = {
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

