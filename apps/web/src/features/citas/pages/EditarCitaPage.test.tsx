import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { toInicioIso } from '../horario';
import { EditarCitaPage } from './EditarCitaPage';

const FECHA = '2031-05-12';
const cita = {
  id: 'cita-1',
  folio: 'C31000001',
  estado: 'Pendiente',
  inicio: toInicioIso(FECHA, 540),
  fin: toInicioIso(FECHA, 600),
  duracion_bloques: 2,
  paciente: { id: 'paciente-1', nombre_completo: 'Valeria Ku' },
  terapeuta: { id: 'terapeuta-1', nombre_completo: 'Victoria Méndez' },
  sala: { id: 'sala-1', nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2031-05-01',
  version: 1,
};

function setup(
  patchResponse: (body: Record<string, unknown>) => { status: number; body: unknown },
  getCita?: () => { status: number; body: unknown },
) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let result: { status: number; body: unknown };
    if (url.endsWith('/api/v1/citas/cita-1') && init?.method === 'PATCH') {
      result = patchResponse(JSON.parse(String(init.body)));
    } else if (url.endsWith('/api/v1/citas/cita-1')) {
      result = getCita ? getCita() : { status: 200, body: { cita } };
    } else if (url.includes('/api/v1/salas')) {
      result = {
        status: 200,
        body: {
          salas: [
            { id: 'sala-1', nombre: 'Sala A' },
            { id: 'sala-2', nombre: 'Sala B' },
          ],
        },
      };
    } else if (url.includes('/api/v1/pacientes')) {
      result = { status: 200, body: { datos: [], pagina: 1, tamano: 20, total: 0 } };
    } else if (url.includes('/api/v1/terapeutas')) {
      result = { status: 200, body: { datos: [], pagina: 1, tamano: 20, total: 0 } };
    } else {
      result = { status: 500, body: {} };
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UnsavedChangesProvider>
        <MemoryRouter initialEntries={['/inicio/citas/cita-1/editar']}>
          <Routes>
            <Route
              path="/inicio/citas/:id/editar"
              element={<EditarCitaPage session={{ token: 'token' }} />}
            />
          </Routes>
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('modificación de citas (RF 5.3.1–5.3.6)', () => {
  it('precarga datos, confirma y envía solo campos modificados con versión', async () => {
    const fetchMock = setup(() => ({
      status: 200,
      body: {
        codigo: 'CITA_MODIFICADA',
        cita: { ...cita, sala: { id: 'sala-2', nombre: 'Sala B' }, version: 2 },
      },
    }));
    expect(
      await screen.findByRole('heading', { name: /Modificar cita C31000001/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Valeria Ku');
    expect(screen.getByLabelText('Fecha')).toHaveValue(FECHA);
    await screen.findByRole('option', { name: 'Sala B' });
    fireEvent.change(screen.getByLabelText('Sala'), { target: { value: 'sala-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y guardar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/Cita modificada con éxito/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/v1/citas/cita-1') && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ version: 1, id_sala: 'sala-2' });
  }, 15000);

  it('conserva lo capturado si el servidor informa un conflicto de horario', async () => {
    setup(() => ({ status: 409, body: { codigo: 'SALA_OCUPADA', mensaje: 'Sala ocupada.' } }));
    await screen.findByRole('heading', { name: /Modificar cita C31000001/ });
    await screen.findByRole('option', { name: 'Sala B' });
    fireEvent.change(screen.getByLabelText('Sala'), { target: { value: 'sala-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.getByText(/Esa sala ya está reservada/)).toBeInTheDocument());
    expect(screen.getByLabelText('Sala')).toHaveValue('sala-2');
  });

  it('no guarda si se cancela la confirmación', async () => {
    const fetchMock = setup(() => ({ status: 500, body: {} }));
    await screen.findByRole('heading', { name: /Modificar cita C31000001/ });
    await screen.findByRole('option', { name: 'Sala B' });
    fireEvent.change(screen.getByLabelText('Sala'), { target: { value: 'sala-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/api/v1/citas/cita-1') && init?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('desactiva domingos y muestra error al cambiar fecha a domingo', async () => {
    setup(() => ({ status: 200, body: {} }));
    await screen.findByRole('heading', { name: /Modificar cita C31000001/ });

    const input = screen.getByLabelText('Fecha');
    // 2026-11-08 es domingo
    fireEvent.change(input, { target: { value: '2026-11-08' } });

    expect(
      screen.getByText('La clínica no atiende en domingo. Elige otro día.'),
    ).toBeInTheDocument();
  });

  it('conserva los cambios del borrador tras conflicto de versión y clic en «Ver cambios actuales» (CA-5.3-02, DEF-003)', async () => {
    let versionActual = 1;
    let patchCount = 0;
    const fetchMock = setup(
      (body) => {
        patchCount += 1;
        if (patchCount === 1) {
          versionActual = 2;
          return {
            status: 409,
            body: {
              codigo: 'CONFLICTO_VERSION',
              mensaje: 'La cita fue modificada por otro usuario.',
            },
          };
        }
        return {
          status: 200,
          body: {
            codigo: 'CITA_MODIFICADA',
            cita: { ...cita, ...body, version: versionActual + 1 },
          },
        };
      },
      () => ({ status: 200, body: { cita: { ...cita, version: versionActual } } }),
    );

    await screen.findByRole('heading', { name: /Modificar cita C31000001/ });
    await screen.findByRole('option', { name: 'Sala B' });

    fireEvent.change(screen.getByLabelText('Sala'), { target: { value: 'sala-2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Revisar y guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText(/Otra persona modificó esta cita/i)).toBeInTheDocument();
    const btnVerCambios = screen.getByRole('button', { name: 'Ver cambios actuales' });
    expect(btnVerCambios).toBeInTheDocument();

    fireEvent.click(btnVerCambios);

    expect(
      await screen.findByText(/Se actualizaron los datos base de la cita/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Sala')).toHaveValue('sala-2');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar y guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText(/Cita modificada con éxito/)).toBeInTheDocument();
    const secondPatch = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/api/v1/citas/cita-1') && init?.method === 'PATCH',
    )[1];
    expect(JSON.parse(String(secondPatch?.[1]?.body))).toEqual({ version: 2, id_sala: 'sala-2' });
  });
});
