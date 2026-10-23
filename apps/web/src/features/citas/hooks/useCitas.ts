import { useQuery } from '@tanstack/react-query';
import { salasApi } from '../../salas/api';
import type { DisponibilidadParams } from '../../salas/types';
import { citasApi } from '../api';
import type { CitaListParams } from '../types';

/** Claves de caché del módulo (ADR-12), con el patrón de pacientes/hooks/usePacientes.ts. */
export const citaKeys = {
  todo: ['citas'] as const,
  listas: ['citas', 'lista'] as const,
  lista: (params: CitaListParams) => ['citas', 'lista', params] as const,
  detalle: (id: string) => ['citas', 'detalle', id] as const,
};

export function useCitaList(params: CitaListParams, accessToken: string) {
  return useQuery({
    queryKey: citaKeys.lista(params),
    queryFn: ({ signal }) => citasApi.list(params, accessToken, signal),
  });
}

export function useCita(id: string, accessToken: string) {
  return useQuery({
    queryKey: citaKeys.detalle(id),
    queryFn: ({ signal }) => citasApi.getById(id, accessToken, signal),
  });
}

/**
 * EDT 5.3.3. Disponibilidad de salas para la pantalla de agendar (GET /salas/disponibilidad,
 * PG-DSN-003 5.7). Vive aquí, no en features/salas, porque quien la consume es esta pantalla;
 * el endpoint y su cálculo son de salas y no se tocan ni se repiten.
 */
export const disponibilidadKeys = {
  todo: ['citas', 'disponibilidad'] as const,
  consulta: (params: DisponibilidadParams) => ['citas', 'disponibilidad', params] as const,
};

export function useDisponibilidad(
  params: DisponibilidadParams,
  accessToken: string,
  enabled = true,
) {
  return useQuery({
    queryKey: disponibilidadKeys.consulta(params),
    queryFn: ({ signal }) => salasApi.getDisponibilidad(params, accessToken, signal),
    enabled,
  });
}
