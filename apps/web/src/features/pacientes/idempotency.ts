/**
 * Llave de idempotencia para una operación de escritura (ADR-13). Se genera una por intento y se
 * reutiliza al pulsar "Reintentar", de modo que un reintento tras perder la respuesta no repita
 * la operación en el servidor.
 */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
