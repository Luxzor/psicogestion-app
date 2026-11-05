/**
 * Llave de idempotencia para el alta de citas (ADR-23). Sin packages/shared (PG-DSN-003 1.4), se
 * duplica a mano igual que en apps/web/src/features/salas/idempotency.ts.
 */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
