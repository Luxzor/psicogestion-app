import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { patientsApi } from '../api';
import type { PatientListParams, PatientProfile, PatientUpdatePayload } from '../types';

/** Claves de caché del módulo (ADR-12). */
export const patientKeys = {
  todo: ['pacientes'] as const,
  listas: ['pacientes', 'lista'] as const,
  lista: (params: PatientListParams) => ['pacientes', 'lista', params] as const,
  detalle: (id: string) => ['pacientes', 'detalle', id] as const,
};

export function usePatientList(params: PatientListParams, accessToken: string) {
  return useQuery({
    queryKey: patientKeys.lista(params),
    queryFn: ({ signal }) => patientsApi.list(params, accessToken, signal),
  });
}

export function usePatient(id: string, accessToken: string) {
  return useQuery({
    queryKey: patientKeys.detalle(id),
    queryFn: ({ signal }) => patientsApi.getById(id, accessToken, signal),
  });
}

/**
 * Edición parcial. La respuesta reemplaza el detalle en caché y se invalidan las listas, de modo
 * que el perfil y el listado reflejen el cambio sin recargar la página (RNF 3.2.5).
 */
export function useUpdatePatient(id: string, accessToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PatientUpdatePayload) => patientsApi.update(id, payload, accessToken),
    onSuccess: (updated) => {
      queryClient.setQueryData(patientKeys.detalle(id), updated);
      void queryClient.invalidateQueries({ queryKey: patientKeys.listas });
    },
  });
}

/** Deja en caché un perfil recién leído del servidor (se usa tras un conflicto de versión). */
export function useSyncPatientProfile(id: string) {
  const queryClient = useQueryClient();
  return (profile: PatientProfile) => {
    queryClient.setQueryData(patientKeys.detalle(id), profile);
    void queryClient.invalidateQueries({ queryKey: patientKeys.listas });
  };
}

/**
 * EDT 4.3.3. Baja lógica y reactivación desde el perfil. Al terminar, el perfil en caché se
 * reemplaza por el que devuelve el servidor y se invalidan las listas, de modo que la lista de
 * activos y la de dados de baja reflejen el cambio sin recargar la página (RNF 3.2.5).
 */
function usePatientStateChange(
  id: string,
  change: (id: string, accessToken: string, idempotencyKey: string) => Promise<PatientProfile>,
  accessToken: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => change(id, accessToken, idempotencyKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(patientKeys.detalle(id), updated);
      void queryClient.invalidateQueries({ queryKey: patientKeys.listas });
    },
    onError: (error) => {
      // Si otra persona ya cambió el estado, el perfil en caché quedó desfasado: se vuelve a
      // leer. Ante una falla de red no se invalida, para conservar el perfil que se muestra.
      if (isStateConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: patientKeys.detalle(id) });
        void queryClient.invalidateQueries({ queryKey: patientKeys.listas });
      }
    },
  });
}

const STATE_CONFLICTS = new Set(['PACIENTE_INACTIVO', 'PACIENTE_ACTIVO']);

const isStateConflict = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'codigo' in error &&
  STATE_CONFLICTS.has(String(error.codigo));

export function useDischargePatient(id: string, accessToken: string) {
  return usePatientStateChange(id, patientsApi.discharge, accessToken);
}

export function useRestorePatient(id: string, accessToken: string) {
  return usePatientStateChange(id, patientsApi.restore, accessToken);
}
