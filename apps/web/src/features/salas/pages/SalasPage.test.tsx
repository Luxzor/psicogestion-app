import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SalasPage } from './SalasPage';

afterEach(() => {
  cleanup();
});

describe('SalasPage (EDT 5.3.1 Registro de salas)', () => {
  it('renderiza la pantalla de salas con botón de agregar sala y diálogo cerrado', () => {
    render(<SalasPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Salas' })).toBeInTheDocument();
    expect(screen.getByText('Administración de salas de la clínica.')).toBeInTheDocument();

    const addButtons = screen.getAllByRole('button', { name: /Agregar sala/i });
    expect(addButtons.length).toBeGreaterThan(0);

    // Diálogo inicialmente no está en el documento
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre el diálogo de registro de sala al hacer clic en el botón Agregar sala', () => {
    render(<SalasPage />);

    const addButtons = screen.getAllByRole('button', { name: /Agregar sala/i });
    fireEvent.click(addButtons[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agregar sala' })).toBeInTheDocument();
  });
});

