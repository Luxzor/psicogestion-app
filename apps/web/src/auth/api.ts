export type ApiError = {
  codigo: string;
  mensaje: string;
  campos?: Record<string, string>;
  correlation_id?: string;
};

type Options = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export const NETWORK_ERROR: ApiError = {
  codigo: 'SIN_CONEXION',
  mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
};

const isApiError = (payload: unknown): payload is ApiError =>
  typeof payload === 'object' && payload !== null && 'mensaje' in payload && 'codigo' in payload;

const parsePayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  return response.json();
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        ...options.headers,
      },
      signal: options.signal,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    // Una cancelación no es una falla de red: se propaga tal cual.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw NETWORK_ERROR;
  }

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw isApiError(payload)
      ? payload
      : { codigo: 'RESPUESTA_INVALIDA', mensaje: 'No fue posible completar la operación.' };
  }
  return payload as T;
}

export const messageFrom = (error: unknown) =>
  isApiError(error) ? error.mensaje : 'No fue posible completar la operación. Inténtalo de nuevo.';

export const fieldsFrom = (error: unknown): Record<string, string> =>
  isApiError(error) && error.campos ? error.campos : {};
