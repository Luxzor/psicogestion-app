import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { DashboardLayout } from './DashboardLayout';

const session: Session = {
  token: 'token-de-prueba',
  user: { nombre_completo: 'Julia Morales Cetina', rol: 'administrador' },
};

function PaginaConCambiosSinGuardar() {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [setHasUnsavedChanges]);
  return <p>Formulario a medio llenar</p>;
}

function renderLayout(onLogout: () => Promise<void>, conCambiosSinGuardar = false) {
  return render(
    <MemoryRouter initialEntries={['/inicio']}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/inicio" element={<DashboardLayout session={session} onLogout={onLogout} />}>
            <Route
              index
              element={
                conCambiosSinGuardar ? <PaginaConCambiosSinGuardar /> : <p>Contenido de inicio</p>
              }
            />
          </Route>
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

describe('DashboardLayout: cierre de sesión desde el menú (RF 7.2.6, CA-7.2-01, TC-U-012)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('muestra la opción Cerrar sesión en el menú', () => {
    renderLayout(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('pide confirmación y cierra la sesión solo al confirmar', () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    renderLayout(onLogout);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('¿Cerrar sesión?');
    expect(onLogout).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' }).at(-1)!);

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no cierra la sesión si se cancela la confirmación', () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    renderLayout(onLogout);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('avisa de la acción pendiente y no cierra la sesión si hay cambios sin guardar', () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    renderLayout(onLogout, true);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Acción pendiente');
    expect(onLogout).not.toHaveBeenCalled();
  });
});
