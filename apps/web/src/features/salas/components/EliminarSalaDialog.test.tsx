import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EliminarSalaDialog } from './EliminarSalaDialog';
import { salasApi } from '../api';
import type { Sala } from '../types';

const mockSalas: Sala[] = [
  {
    id: 'sala-1',
    nombre: 'Sala 1',
    activo: true,
    fecha_baja: null,
    fecha_registro: '2026-10-21',
    version: 1,
  },
  {
    id: 'sala-2',
    nombre: 'Sala 2',
    activo: true,
    fecha_baja: null,
    fecha_registro: '2026-10-21',
    version: 1,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EliminarSalaDialog (EDT 5.3.1 Baja lógica de salas)', () => {
  it('no renderiza nada cuando isOpen es false', () => {
    render(<EliminarSalaDialog isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra la lista de salas para selección y bloquea Continuar hasta seleccionar una', async () => {
    vi.spyOn(salasApi, 'list').mockResolvedValue({ salas: mockSalas });
    vi.spyOn(salasApi, 'countPendingAppointments').mockImplementation(async (id) => ({
      total: id === 'sala-1' ? 2 : 0,
    }));

    render(<EliminarSalaDialog isOpen={true} onClose={vi.fn()} activeSalas={mockSalas} />);

    expect(screen.getByRole('heading', { name: 'Eliminar sala' })).toBeInTheDocument();
    expect(
      screen.getByText('Selecciona la sala que quieres eliminar.'),
    ).toBeInTheDocument();

    const continueBtn = screen.getByRole('button', { name: 'Continuar' });
    expect(continueBtn).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByText('2 citas pendientes')).toBeInTheDocument();
      expect(screen.getByText('Sin citas pendientes')).toBeInTheDocument();
    });

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);

    fireEvent.click(radios[0]);
    expect(continueBtn).not.toBeDisabled();
  });

  it('bloquea la eliminación si la sala tiene citas pendientes futuras (CA-4.2-02)', async () => {
    vi.spyOn(salasApi, 'countPendingAppointments').mockResolvedValue({ total: 2 });

    render(
      <EliminarSalaDialog
        isOpen={true}
        onClose={vi.fn()}
        preselectedSala={mockSalas[0]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '¿Eliminar la sala “Sala 1”?' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No es posible eliminarla todavía.')).toBeInTheDocument();
      expect(
        screen.getByText(/La sala tiene 2 citas pendientes/),
      ).toBeInTheDocument();
    });

    const delButton = screen.getByRole('button', { name: /Eliminar sala/i });
    expect(delButton).toBeDisabled();
  });

  it('permite eliminar la sala si no tiene citas pendientes y llama a salasApi.discharge (CA-4.2-01)', async () => {
    vi.spyOn(salasApi, 'countPendingAppointments').mockResolvedValue({ total: 0 });
    const dischargeSpy = vi.spyOn(salasApi, 'discharge').mockResolvedValue({
      codigo: 'SALA_DADA_DE_BAJA',
      sala: { ...mockSalas[1], activo: false, fecha_baja: '2026-10-22' },
    });
    const handleDischarged = vi.fn();
    const handleClose = vi.fn();

    render(
      <EliminarSalaDialog
        isOpen={true}
        onClose={handleClose}
        onDischarged={handleDischarged}
        preselectedSala={mockSalas[1]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/La sala dejará de aparecer en la lista/),
      ).toBeInTheDocument();
    });

    const delButton = screen.getByRole('button', { name: /Eliminar sala/i });
    expect(delButton).not.toBeDisabled();

    fireEvent.click(delButton);

    await waitFor(() => {
      expect(dischargeSpy).toHaveBeenCalledWith('sala-2', '', expect.any(String));
      expect(handleDischarged).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sala-2', activo: false }),
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('cierra el diálogo al presionar Cancelar o Escape', () => {
    const handleClose = vi.fn();
    render(
      <EliminarSalaDialog
        isOpen={true}
        onClose={handleClose}
        preselectedSala={mockSalas[1]}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
