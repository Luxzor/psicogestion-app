import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetalleCitaDialog } from './DetalleCitaDialog';
import type { Cita } from '../types';

const citaBase: Cita = {
  id: '11111111-1111-4111-8111-111111111111',
  folio: 'C26000001',
  estado: 'Pendiente',
  inicio: '2026-11-09T15:00:00.000Z',
  fin: '2026-11-09T16:00:00.000Z',
  duracion_bloques: 2,
  paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado' },
  sala: { id: 'sala-1', nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2026-10-01',
  version: 1,
};

afterEach(() => {
  cleanup();
});

describe('DetalleCitaDialog (PG-DSN-003-INT dialogCita)', () => {
  it('renderiza la información completa de la cita', () => {
    render(
      <DetalleCitaDialog
        isOpen={true}
        cita={citaBase}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cita C26000001' })).toBeInTheDocument();
    expect(screen.getByText('Valeria Ku Escalante')).toBeInTheDocument();
    expect(screen.getByText('Victoria Méndez Rosado')).toBeInTheDocument();
    expect(screen.getByText(/Sala A/)).toBeInTheDocument();
    expect(screen.getByText(/1 h/)).toBeInTheDocument();
  });

  it('muestra el botón Cancelar cita cuando está Pendiente y lo invoca', () => {
    const onCancelar = vi.fn();
    const onClose = vi.fn();

    render(
      <DetalleCitaDialog
        isOpen={true}
        cita={citaBase}
        onClose={onClose}
        onCancelar={onCancelar}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Cancelar cita' });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalled();
    expect(onCancelar).toHaveBeenCalledWith(citaBase);
  });

  it('no muestra el botón Cancelar cita cuando está Cancelada', () => {
    render(
      <DetalleCitaDialog
        isOpen={true}
        cita={{ ...citaBase, estado: 'Cancelada', cancelada_en: '2026-11-09T17:00:00.000Z' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Cancelar cita' })).toBeNull();
    expect(screen.getByText('Cancelada el')).toBeInTheDocument();
  });

  it('cierra el diálogo al presionar Cerrar', () => {
    const onClose = vi.fn();
    render(
      <DetalleCitaDialog
        isOpen={true}
        cita={citaBase}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});

