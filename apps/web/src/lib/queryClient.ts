import { QueryClient } from '@tanstack/react-query';

/**
 * Caché de datos del servidor (ADR-12). Se vacía al cerrar sesión o al expirar, para no dejar
 * datos personales de pacientes en el navegador (RNF 1.3.3, R01).
 *
 * `retry: false` es deliberado: los errores de carga se muestran con un botón "Reintentar"
 * explícito (PG-DSN-002 §5.4) en lugar de repetir la solicitud en silencio, y así un 404 o un
 * 409 llegan de inmediato a la pantalla.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
