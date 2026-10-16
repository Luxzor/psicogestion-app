import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { therapistsApi } from '../api';
import type { Therapist, TherapistListParams, TherapistUpdatePayload } from '../types';

/** Claves de caché del módulo (ADR-12). */
export const therapistKeys = {
  todo: ['terapeutas'] as const,
  listas: ['terapeutas', 'lista'] as const,
  lista: (params: TherapistListParams) => ['terapeutas', 'lista', params] as const,
  detalle: (id: string) => ['terapeutas', 'detalle', id] as const,
};

export function useTherapistList(params: TherapistListParams, accessToken: string) {
  return useQuery({
    queryKey: therapistKeys.lista(params),
    queryFn: ({ signal }) => therapistsApi.list(params, accessToken, signal),
  });
}

export function useTherapist(id: string, accessToken: string) {
  return useQuery({
    queryKey: therapistKeys.detalle(id),
    queryFn: ({ signal }) => therapistsApi.getById(id, accessToken, signal),
  });
}

/**
 * Edición parcial. La respuesta reemplaza el detalle en caché y se invalidan las listas, de modo
 * que el perfil y el listado reflejen el cambio sin recargar la página (RNF 2.2.6).
 */
export function useUpdateTherapist(id: string, accessToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TherapistUpdatePayload) => therapistsApi.update(id, payload, accessToken),
    onSuccess: (updated) => {
      queryClient.setQueryData(therapistKeys.detalle(id), updated);
      void queryClient.invalidateQueries({ queryKey: therapistKeys.listas });
    },
  });
}

/**
 * Deja en caché un perfil recién leído del servidor. Se usa tras un conflicto de versión y tras
 * cambiar la fotografía (PUT o DELETE aparte del PATCH): la nueva `foto_actualizada_en` hace que
 * TherapistAvatar vuelva a descargarla sin recargar la página.
 */
export function useSyncTherapistProfile(id: string) {
  const queryClient = useQueryClient();
  return (profile: Therapist) => {
    queryClient.setQueryData(therapistKeys.detalle(id), profile);
    void queryClient.invalidateQueries({ queryKey: therapistKeys.listas });
  };
}

/**
 * EDT 4.3.5. Baja lógica y reactivación desde el perfil. Al terminar, el perfil en caché se
 * reemplaza por el que devuelve el servidor y se invalidan las listas, de modo que la lista de
 * activos y la de dados de baja reflejen el cambio sin recargar la página (RNF 2.3.1).
 */
function useTherapistStateChange(
  id: string,
  change: (id: string, accessToken: string, idempotencyKey: string) => Promise<Therapist>,
  accessToken: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => change(id, accessToken, idempotencyKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(therapistKeys.detalle(id), updated);
      void queryClient.invalidateQueries({ queryKey: therapistKeys.listas });
    },
    onError: (error) => {
      // Si otra persona ya cambió el estado, el perfil en caché quedó desfasado: se vuelve a
      // leer. Ante una falla de red no se invalida, para conservar el perfil que se muestra.
      if (isStateConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: therapistKeys.detalle(id) });
        void queryClient.invalidateQueries({ queryKey: therapistKeys.listas });
      }
    },
  });
}

const STATE_CONFLICTS = new Set(['TERAPEUTA_INACTIVO', 'TERAPEUTA_ACTIVO']);

const isStateConflict = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'codigo' in error &&
  STATE_CONFLICTS.has(String(error.codigo));

export function useDischargeTherapist(id: string, accessToken: string) {
  return useTherapistStateChange(id, therapistsApi.discharge, accessToken);
}

export function useRestoreTherapist(id: string, accessToken: string) {
  return useTherapistStateChange(id, therapistsApi.restore, accessToken);
}
