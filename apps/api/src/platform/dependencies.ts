/**
 * Clasifica los errores que indican que una dependencia crítica (PostgreSQL o Redis) no está
 * disponible en este momento, para responder 503 SERVICIO_NO_DISPONIBLE en lugar de un 500
 * genérico (DEF-005 y DEF-006 de PG-DEF-ITER03). La API sigue viva y se recupera sola cuando
 * la dependencia regresa; el cliente puede reintentar.
 */

/** Códigos SQLSTATE de PostgreSQL por conexión perdida, servidor apagándose o sin conexiones. */
const POSTGRES_UNAVAILABLE_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/** Códigos de red de Node.js cuando no se alcanza el servidor o se cortó la conexión. */
const NETWORK_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);

/** Mensajes de pg y de ioredis cuando la conexión no existe o no respondió a tiempo. */
const UNAVAILABLE_MESSAGES = [
  /^Connection terminated/,
  /timeout exceeded when trying to connect/,
  /Client has encountered a connection error/,
  /^Connection is closed\.?$/,
  /^Stream isn't writeable/,
  /^Command timed out$/,
  /max retries per request limit/i,
];

export function isDependencyUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code } = error as Error & { code?: unknown };
  if (typeof code === 'string') {
    if (POSTGRES_UNAVAILABLE_CODES.has(code) || NETWORK_UNAVAILABLE_CODES.has(code)) return true;
  }
  if (error.name === 'MaxRetriesPerRequestError') return true;
  return UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(error.message));
}

export class DependencyTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(dependency: string, milliseconds: number) {
    super(`${dependency} no respondió en ${milliseconds} ms`);
    this.name = 'DependencyTimeoutError';
  }
}

/** Rechaza si la promesa no termina en el tiempo indicado, para que /ready responda rápido. */
export function withTimeout<T>(promise: Promise<T>, milliseconds: number, dependency: string) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DependencyTimeoutError(dependency, milliseconds)),
      milliseconds,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
