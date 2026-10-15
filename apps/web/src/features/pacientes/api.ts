import { api } from '../../auth/api';
import type {
  Availability,
  Patient,
  PatientListParams,
  PatientListResponse,
  PatientPayload,
  PatientProfile,
  PatientUpdatePayload,
} from './types';

type PatientResponse = { codigo: string; paciente: Patient };
type ProfileResponse = { paciente: PatientProfile };
type ProfileActionResponse = { codigo: string; paciente: PatientProfile };

export const patientsApi = {
  /** RF 3.2.1. Listado paginado de pacientes activos o dados de baja (EDT 4.3.3). */
  list(params: PatientListParams, accessToken: string, signal?: AbortSignal) {
    const query = new URLSearchParams({
      pagina: String(params.pagina),
      tamano: String(params.tamano),
    });
    if (params.q) query.set('q', params.q);
    if (params.estado && params.estado !== 'activos') query.set('estado', params.estado);
    return api<PatientListResponse>(`/pacientes?${query.toString()}`, { accessToken, signal });
  },

  /** RF 3.2.2–3.2.3. Perfil del paciente, activo o dado de baja. */
  async getById(id: string, accessToken: string, signal?: AbortSignal) {
    const result = await api<ProfileResponse>(`/pacientes/${encodeURIComponent(id)}`, {
      accessToken,
      signal,
    });
    return result.paciente;
  },

  /** RF 3.2.4–3.2.6. Edición parcial con control de versión (ADR-10). */
  async update(id: string, payload: PatientUpdatePayload, accessToken: string) {
    const result = await api<{ codigo: string; paciente: PatientProfile }>(
      `/pacientes/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: payload, accessToken },
    );
    return result.paciente;
  },
  register(payload: PatientPayload, accessToken: string, idempotencyKey: string) {
    return api<PatientResponse>('/pacientes', {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  reactivate(id: string, payload: PatientPayload, accessToken: string, idempotencyKey: string) {
    return api<PatientResponse>(`/pacientes/${encodeURIComponent(id)}/reactivacion`, {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /** EDT 4.3.3. Baja lógica: el perfil se conserva con activo en falso (RF 3.3.1). */
  async discharge(id: string, accessToken: string, idempotencyKey: string) {
    const result = await api<ProfileActionResponse>(`/pacientes/${encodeURIComponent(id)}/baja`, {
      method: 'POST',
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return result.paciente;
  },

  /** EDT 4.3.3. Reactivación desde el perfil, sin cuerpo: conserva los datos anteriores. */
  async restore(id: string, accessToken: string, idempotencyKey: string) {
    const result = await api<ProfileActionResponse>(
      `/pacientes/${encodeURIComponent(id)}/reactivacion`,
      { method: 'POST', accessToken, headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return result.paciente;
  },

  checkAvailability(
    body:
      | { campo: 'curp'; valor: string; excluir_id?: string }
      | { campo: 'telefono'; valor: string; curp?: string; excluir_id?: string },
    accessToken: string,
    signal?: AbortSignal,
  ) {
    return api<Availability>('/pacientes/validaciones', {
      method: 'POST',
      body,
      accessToken,
      signal,
    });
  },
};
