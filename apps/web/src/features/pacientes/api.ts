import { api } from '../../auth/api';
import type { Availability, Patient, PatientPayload } from './types';

type PatientResponse = { codigo: string; paciente: Patient };

export const patientsApi = {
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

  checkAvailability(
    body: { campo: 'curp'; valor: string } | { campo: 'telefono'; valor: string; curp?: string },
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
