import type { Session } from './types';

/**
 * DEF-005 (PG-DEF-ITER04). /auth/refresh solo devuelve el token de acceso: al renovarlo se
 * conservan los datos del usuario de la sesión vigente, para que el saludo y el menú no cambien
 * a "Usuario" a los 14 minutos.
 */
export function sessionWithToken(previous: Session | null, token: string): Session {
  return previous ? { ...previous, token } : { token };
}
