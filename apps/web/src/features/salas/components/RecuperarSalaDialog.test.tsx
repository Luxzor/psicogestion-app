import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salasApi } from '../api';
import type { Sala } from '../types';
import { RecuperarSalaDialog } from './RecuperarSalaDialog';

/**
 * Recuperación de una sala dada de baja (POST /salas/{id}/reactivar, ADR-13).
 */
const baja = (id: string, nombre: string): Sala => ({
  id,
  nombre,
  activo: false,
  fecha_baja: '2026-10-06',
  fecha_registro: '2026-09-01',
  version: 2,
});

describe('RecuperarSalaDialog', () => {
  const onClose = vi.fn();
  const onRestored = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const abrir = (props: Partial<Parameters<typeof RecuperarSalaDialog>[0]> = {}) =>
    render(
      <RecuperarSalaDialog
        isOpen
        onClose={onClose}
        onRestored={onRestored}
        accessToken="t"
        {...props}
      />,
    );

  it('no renderiza nada si isOpen es false', () => {
    render(<RecuperarSalaDialog isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lista las salas dadas de baja con su fecha y selecciona la primera', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({
      salas: [baja('s1', 'Sala A'), baja('s2', 'Sala B')],
    } as never);
    abrir();

    expect(await screen.findByText('Sala A')).toBeInTheDocument();
    expect(screen.getByText('Sala B')).toBeInTheDocument();
    expect(salasApi.list).toHaveBeenCalledWith({ estado: 'inactivas' }, 't');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(screen.getAllByText(/Dada de baja el/)).toHaveLength(2);
  });

  it('avisa cuando no hay salas dadas de baja y deshabilita Recuperar', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({ salas: [] } as never);
    abrir();

    expect(await screen.findByText('No hay salas dadas de baja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recuperar sala/ })).toBeDisabled();
  });

  it('muestra un error si no se pudo obtener la lista', async () => {
    vi.spyOn(salasApi, 'list').mockRejectedValue(new Error('fallo'));
    abrir();
    expect(
      await screen.findByText('No se pudo obtener la lista de salas dadas de baja.'),
    ).toBeInTheDocument();
  });

  it('recupera la sala elegida, notifica al llamador y cierra', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({
      salas: [baja('s1', 'Sala A'), baja('s2', 'Sala B')],
    } as never);
    const restore = vi.spyOn(salasApi, 'restore').mockResolvedValue({
      codigo: 'SALA_REACTIVADA',
      sala: { ...baja('s2', 'Sala B'), activo: true, fecha_baja: null },
    } as never);
    abrir();

    await screen.findByText('Sala B');
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Recuperar sala/ }));

    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore).toHaveBeenCalledWith('s2', 't', expect.any(String));
    await waitFor(() =>
      expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ id: 's2', activo: true })),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('con una sala preseleccionada no consulta el listado', async () => {
    const list = vi.spyOn(salasApi, 'list');
    const restore = vi.spyOn(salasApi, 'restore').mockResolvedValue({
      codigo: 'SALA_REACTIVADA',
      sala: { ...baja('s1', 'Sala A'), activo: true },
    } as never);
    abrir({ preselectedSala: baja('s1', 'Sala A') } as never);

    expect(await screen.findByText('Sala A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Recuperar sala/ }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('s1', 't', expect.any(String)));
    expect(list).not.toHaveBeenCalled();
  });

  it('si la sala ya estaba activa (SALA_ACTIVA) lo informa y no cierra', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({ salas: [baja('s1', 'Sala A')] } as never);
    vi.spyOn(salasApi, 'restore').mockRejectedValue({ codigo: 'SALA_ACTIVA', status: 409 });
    abrir();

    await screen.findByText('Sala A');
    fireEvent.click(screen.getByRole('button', { name: /Recuperar sala/ }));

    expect(await screen.findByText('Esta sala ya se encuentra activa.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ante una falla de red ofrece Reintentar y no cierra', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({ salas: [baja('s1', 'Sala A')] } as never);
    vi.spyOn(salasApi, 'restore').mockRejectedValue(new Error('Network error'));
    abrir();

    await screen.findByText('Sala A');
    fireEvent.click(screen.getByRole('button', { name: /Recuperar sala/ }));

    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancelar y Escape cierran sin recuperar', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({ salas: [baja('s1', 'Sala A')] } as never);
    const restore = vi.spyOn(salasApi, 'restore');
    abrir();

    await screen.findByText('Sala A');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(restore).not.toHaveBeenCalled();
  });
});
