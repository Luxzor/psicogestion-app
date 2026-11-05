import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelarPorFolioDialog } from './CancelarPorFolioDialog';
import type { Cita } from '../types';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const citaBase: Cita = {
  id: '11111111-1111-4111-8111-111111111111',
  folio: 'C26000001',
  estado: 'Pendiente',
  inicio: '2026-11-09T15:00:00.000Z',
  fin: '2026-11-09T15:30:00.000Z',
  duracion_bloques: 1,
  paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado' },
  sala: { id: 'sala-1', nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2026-10-01',
  version: 1,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CancelarPorFolioDialog (EDT 5.3.5)', () => {
  it('renderiza el diálogo con el campo de folio y botón de búsqueda', () => {
    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cancelar cita por folio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Folio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar cita' })).toBeInTheDocument();
  });

  it('valida que el folio no esté vacío', () => {
    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));
    expect(screen.getByText('Escribe el folio de la cita.')).toBeInTheDocument();
  });

  it('valida el formato del folio', () => {
    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'invalido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    expect(
      screen.getByText('El folio no tiene un formato válido. Ejemplo: C26000001.'),
    ).toBeInTheDocument();
  });

  it('muestra error si la cita no existe en la búsqueda', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        datos: [],
        pagina: 1,
        tamano: 1,
        total: 0,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'C26000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    expect(
      await screen.findByText('No existe una cita con ese folio. Revísalo e intenta de nuevo.'),
    ).toBeInTheDocument();
  });

  it('muestra error si la cita ya está cancelada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        datos: [{ ...citaBase, estado: 'Cancelada' }],
        pagina: 1,
        tamano: 1,
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'C26000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    expect(await screen.findByText('Esa cita ya está cancelada.')).toBeInTheDocument();
  });

  it('muestra error si la cita ya venció', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        datos: [{ ...citaBase, estado: 'Vencida' }],
        pagina: 1,
        tamano: 1,
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'C26000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    expect(
      await screen.findByText('Esa cita ya venció; no es posible cancelarla.'),
    ).toBeInTheDocument();
  });

  it('selecciona la cita encontrada cuando está Pendiente y cierra el diálogo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        datos: [citaBase],
        pagina: 1,
        tamano: 1,
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSelectCita = vi.fn();
    const onClose = vi.fn();

    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={onClose}
        onSelectCita={onSelectCita}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'c26000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    await waitFor(() => {
      expect(onSelectCita).toHaveBeenCalledWith(citaBase);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('maneja errores de conexión al buscar por folio', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CancelarPorFolioDialog
        isOpen={true}
        onClose={vi.fn()}
        onSelectCita={vi.fn()}
        accessToken="test-token"
      />,
    );

    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: 'C26000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cita' }));

    expect(
      await screen.findByText(
        'No pudimos buscar la cita por un error de conexión. Intenta de nuevo.',
      ),
    ).toBeInTheDocument();
  });
});

