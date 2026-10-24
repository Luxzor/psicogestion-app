import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetalleCitaPage } from './DetalleCitaPage';

/** EDT 5.3.3. Detalle de solo lectura de una cita (RF 5.2), mismo patrón que CitasPage.test.tsx. */

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockFetch(handler: (url: string) => { status: number; body?: unknown }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const result = handler(String(input));
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const cita = {
  id: 'cita-1',
  folio: 'C26000001',
  estado: 'Pendiente' as const,
  inicio: '2026-10-26T15:00:00.000Z',
  fin: '2026-10-26T15:30:00.000Z',
  duracion_bloques: 1,
  paciente: { id: 'paciente-1', nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: 'terapeuta-1', nombre_completo: 'Victoria Méndez Rosado' },
  sala: { id: 'sala-1', nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2026-10-01',
  version: 1,
};

function renderDetalle(id = 'cita-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/inicio/citas/${id}`]}>
        <Routes>
          <Route
            path="/inicio/citas/:id"
            element={<DetalleCitaPage session={{ token: 'token-de-prueba' }} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('detalle de cita (RF 5.2)', () => {
  it('muestra el folio y los datos de la cita, sin acciones de modificar ni cancelar', async () => {
    mockFetch(() => ({ status: 200, body: { cita } }));
    renderDetalle();

    expect(await screen.findByText('C26000001')).toBeInTheDocument();
    expect(screen.getByText('Valeria Ku Escalante')).toBeInTheDocument();
    expect(screen.getByText('Victoria Méndez Rosado')).toBeInTheDocument();
    expect(screen.getByText('Sala A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /modificar|cancelar la cita/i })).toBeNull();
  });

  it('un folio inexistente muestra "no encontramos esa cita" (CITA_NO_ENCONTRADA)', async () => {
    mockFetch(() => ({
      status: 404,
      body: { codigo: 'CITA_NO_ENCONTRADA', mensaje: 'No existe una cita con ese folio.' },
    }));
    renderDetalle('00000000-0000-4000-8000-000000000000');

    expect(await screen.findByText('No encontramos esa cita')).toBeInTheDocument();
  });

  it('una falla de red muestra el aviso de conexión con reintentar', async () => {
    const fetchMock = mockFetch(() => ({ status: 500 }));
    renderDetalle();

    expect(await screen.findByText('No pudimos cargar la cita')).toBeInTheDocument();
    const llamadas = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(llamadas));
  });
});
