import { api } from '../../auth/api';
import type { Cita, CitaCreada, CitaListParams, CitaListResponse, CitaPayload } from './types';

type CitaCreadaResponse = { codigo: string; cita: CitaCreada };

/**
 * EDT 5.3.3. Cliente HTTP del módulo de citas (PG-DSN-003 5.7). Solo `create` se usa en la
 * pantalla de agendar; `list` y `getById` quedan listas para la pantalla de lista y detalle.
 */
export const citasApi = {
  /** RF 5.1.1–5.1.15, RF 2.3.5. Alta de cita con Idempotency-Key (ADR-23). */
  create(payload: CitaPayload, accessToken: string, idempotencyKey: string) {
    return api<CitaCreadaResponse>('/citas', {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /** RF 5.2.1–5.2.3. Listado paginado con filtros por estado, sala, terapeuta, periodo y folio. */
  list(params: CitaListParams, accessToken: string, signal?: AbortSignal) {
    const query = new URLSearchParams({
      pagina: String(params.pagina),
      tamano: String(params.tamano),
    });
    if (params.estado) query.set('estado', params.estado);
    if (params.id_sala) query.set('id_sala', params.id_sala);
    if (params.id_terapeuta) query.set('id_terapeuta', params.id_terapeuta);
    if (params.desde) query.set('desde', params.desde);
    if (params.hasta) query.set('hasta', params.hasta);
    if (params.folio) query.set('folio', params.folio);
    return api<CitaListResponse>(`/citas?${query.toString()}`, { accessToken, signal });
  },

  /** RF 5.2. Detalle de una cita. */
  async getById(id: string, accessToken: string, signal?: AbortSignal) {
    const result = await api<{ cita: Cita }>(`/citas/${encodeURIComponent(id)}`, {
      accessToken,
      signal,
    });
    return result.cita;
  },
};
