import { useQuery } from '@tanstack/react-query';
import { therapistsApi } from '../api';
import type { TherapistListParams } from '../types';

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
