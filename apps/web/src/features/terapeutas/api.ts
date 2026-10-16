import { api, NETWORK_ERROR, type ApiError } from '../../auth/api';
import type {
  PhotoSize,
  Therapist,
  TherapistAvailability,
  TherapistListParams,
  TherapistListResponse,
  TherapistPayload,
} from './types';

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

  /** RF 2.2.1. Listado paginado de terapeutas activos o dados de baja (EDT 4.3.5). */
  list(params: TherapistListParams, accessToken: string, signal?: AbortSignal) {
    const query = new URLSearchParams({
      pagina: String(params.pagina),
      tamano: String(params.tamano),
    });
    if (params.q) query.set('q', params.q);
    if (params.estado && params.estado !== 'activos') query.set('estado', params.estado);
    return api<TherapistListResponse>(`/terapeutas?${query.toString()}`, { accessToken, signal });
  },

  /** RF 2.2.2. Perfil del terapeuta, activo o dado de baja. */
  async getById(id: string, accessToken: string, signal?: AbortSignal) {
    const result = await api<{ terapeuta: Therapist }>(`/terapeutas/${encodeURIComponent(id)}`, {
      accessToken,
      signal,
    });
    return result.terapeuta;
  },

  /**
   * Descarga la fotografía como Blob (ERS 2.1.6: nada de URLs públicas; se muestra desde un
   * Blob con fetch autenticado). No usa el helper `api()` porque la respuesta no es JSON. Trata
   * cualquier falla (sin foto, sin conexión, error del servidor) igual: no hay imagen que
   * mostrar y el avatar cae a las iniciales; una cancelación sí se propaga.
   */
  async getPhotoBlob(
    therapistId: string,
    tam: PhotoSize,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<Blob | null> {
    let response: Response;
    try {
      response = await fetch(`/api/v1/terapeutas/${encodeURIComponent(therapistId)}/foto?tam=${tam}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return null;
    }
    if (!response.ok) return null;
    return response.blob();
  },
};
