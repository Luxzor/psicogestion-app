export type ApiError = {
  codigo: string;
  mensaje: string;
  campos?: Record<string, string>;
  correlation_id?: string;
};

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

type UnauthorizedHandler = () => void;
type TokenRefreshedHandler = (token: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let tokenRefreshedHandler: TokenRefreshedHandler | null = null;

export const setOnUnauthorized = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler;
};

export const setOnTokenRefreshed = (handler: TokenRefreshedHandler | null) => {
  tokenRefreshedHandler = handler;
};

let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string };
      return data.access_token ?? null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        ...options.headers,
      },
      signal: options.signal,
      ...(options.body
        ? { body: isFormData ? (options.body as FormData) : JSON.stringify(options.body) }
        : {}),
    });
  } catch (error) {
    // Una cancelación no es una falla de red: se propaga tal cual.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw NETWORK_ERROR;
  }

  // Manejo de sesión expirada o inválida (401) en peticiones autenticadas:
  if (response.status === 401 && path !== '/auth/iniciar-sesion' && path !== '/auth/refresh') {
    const newToken = await tryRefreshToken();
    if (newToken) {
      tokenRefreshedHandler?.(newToken);
      return api<T>(path, { ...options, accessToken: newToken });
    }
    // Si el refresco falló o no fue posible, terminar la sesión y notificar
    unauthorizedHandler?.();
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
