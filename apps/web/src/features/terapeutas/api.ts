import { api, NETWORK_ERROR, type ApiError } from '../../auth/api';
import type { Therapist, TherapistAvailability, TherapistPayload } from './types';

type TherapistResponse = { codigo: string; terapeuta: Therapist };

export const therapistsApi = {
  register(payload: TherapistPayload, accessToken: string, idempotencyKey: string) {
    return api<TherapistResponse>('/terapeutas', {
      method: 'POST',
      body: payload,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  uploadPhoto(
    therapistId: string,
    file: File,
    accessToken: string,
    onProgress?: (percent: number) => void,
  ): Promise<TherapistResponse> {
    if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
      return new Promise<TherapistResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/v1/terapeutas/${encodeURIComponent(therapistId)}/foto`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

        if (xhr.upload) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
              onProgress(percent);
            }
          };
        }

        xhr.onload = () => {
          let payload: unknown;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            payload = undefined;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload as TherapistResponse);
          } else {
            const error: ApiError =
              typeof payload === 'object' && payload !== null && 'codigo' in payload
                ? (payload as ApiError)
                : { codigo: 'ERROR_CARGA_FOTO', mensaje: 'No fue posible cargar la fotografía.' };
            reject(error);
          }
        };

        xhr.onerror = () => {
          reject(NETWORK_ERROR);
        };

        const formData = new FormData();
        formData.append('foto', file);
        xhr.send(formData);
      });
    }

    const formData = new FormData();
    formData.append('foto', file);
    return api<TherapistResponse>(`/terapeutas/${encodeURIComponent(therapistId)}/foto`, {
      method: 'PUT',
      body: formData,
      accessToken,
    });
  },

  checkAvailability(
    body: { campo: 'telefono' | 'correo' | 'cedula'; valor: string },
    accessToken: string,
    signal?: AbortSignal,
  ) {
    return api<TherapistAvailability>('/terapeutas/validaciones', {
      method: 'POST',
      body,
      accessToken,
      signal,
    });
  },
};
