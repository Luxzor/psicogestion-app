import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { PerfilPacientePage } from './PerfilPacientePage';

type Handler = () => { status: number; body?: unknown };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async () => {
    const result = handler();
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const patient = {
  id: '5f0b4a6e-2c1d-4b8e-9f3a-7d6c5b4a3f21',
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  edad: 17,
  telefono: '9996402218',
  correo: null,
  consentimiento: false,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-08',
  version: 1,
  updated_at: '2026-10-08T12:00:00.000Z',
};

function renderPage(id = patient.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/inicio/pacientes/${id}`]}>
        <Routes>
          <Route path="/inicio/pacientes" element={<h1>Pacientes</h1>} />
          <Route
            path="/inicio/pacientes/:id"
            element={<PerfilPacientePage session={{ token: 'token-de-prueba' }} />}
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

describe('perfil de paciente (EDT 4.3.2, RF 3.2.3)', () => {
  it('muestra nombre, fecha con edad, CURP, sexo, teléfono y "No registrado" sin correo', async () => {
    mockApi(() => ({ status: 200, body: { paciente: patient } }));
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Valeria Ku Escalante' }),
    ).toBeInTheDocument();
    expect(screen.getByText('25/08/2009')).toBeInTheDocument();
    expect(screen.getByText('(17 años)')).toBeInTheDocument();
    expect(screen.getByText('KUEV090825MYNXSLA3')).toBeInTheDocument();
    expect(screen.getByText('Femenino')).toBeInTheDocument();
    expect(screen.getByText('9996402218')).toBeInTheDocument();
    expect(screen.getByText('No registrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Editar el perfil de Valeria/ })).toBeInTheDocument();
  });

  it('muestra el correo cuando el paciente lo tiene registrado', async () => {
    mockApi(() => ({
      status: 200,
      body: { paciente: { ...patient, correo: 'valeria.ku@gmail.com' } },
    }));
    renderPage();

    expect(await screen.findByText('valeria.ku@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('No registrado')).not.toBeInTheDocument();
  });

  it('un paciente inactivo muestra el aviso de baja y no ofrece "Editar"', async () => {
    mockApi(() => ({
      status: 200,
      body: { paciente: { ...patient, activo: false, fecha_baja: '2026-10-06' } },
    }));
    renderPage();

    expect(
      await screen.findByText(/Este paciente fue dado de baja el 06\/10\/2026/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
  });

  it('responde a un identificador inexistente con un mensaje claro y regreso a la lista', async () => {
    mockApi(() => ({
      status: 404,
      body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: 'No encontramos al paciente indicado.' },
    }));
    renderPage();

    expect(await screen.findByText('No encontramos a este paciente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toBeInTheDocument();
  });
});

type Call = { url: string; method: string; headers: Headers; body?: BodyInit | null };
type Result = { status: number; body?: unknown };
type RoutedHandler = (call: Call) => Result | Promise<Result>;

/** Mock que distingue la lectura del perfil de la baja y la reactivación. */
function mockRoutes(handler: RoutedHandler) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    const result = await handler(call);
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const inactive = { ...patient, activo: false, fecha_baja: '2026-10-14', version: 2 };

/** Muestra el estado del bloqueo de cierre de sesión (UnsavedChangesContext). */
function PendingProbe() {
  const { hasUnsavedChanges } = useUnsavedChanges();
  return <output aria-label="Operación pendiente">{String(hasUnsavedChanges)}</output>;
}

function ListStub() {
  const location = useLocation();
  const flash = (location.state as { flash?: { text: string } } | null)?.flash;
  return (
    <>
      <h1>Pacientes</h1>
      {flash ? <p>{flash.text}</p> : null}
    </>
  );
}

function renderWithProviders(id = patient.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <PendingProbe />
        <MemoryRouter initialEntries={[`/inicio/pacientes/${id}`]}>
          <Routes>
            <Route path="/inicio/pacientes" element={<ListStub />} />
            <Route
              path="/inicio/pacientes/:id"
              element={<PerfilPacientePage session={{ token: 'token-de-prueba' }} />}
            />
          </Routes>
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );
}

const isAction = (call: Call, action: 'baja' | 'reactivacion') =>
  call.method === 'POST' && call.url.endsWith(`/${action}`);

describe('baja lógica desde el perfil (EDT 4.3.3)', () => {
  it('un paciente activo muestra la insignia "Activo" y el botón "Dar de baja"', async () => {
    mockRoutes(() => ({ status: 200, body: { paciente: patient } }));
    renderWithProviders();

    expect(await screen.findByText('Activo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivar paciente' })).not.toBeInTheDocument();
  });

  it('pide confirmación en un alertdialog con el foco en "Cancelar"; Esc lo cierra sin cambios', async () => {
    const fetchMock = mockRoutes(() => ({ status: 200, body: { paciente: patient } }));
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja a Valeria Ku Escalante' });
    expect(dialog).toHaveTextContent('Sus datos se conservarán en el sistema.');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('"Cancelar" cierra el diálogo sin dar de baja', async () => {
    const fetchMock = mockRoutes(() => ({ status: 200, body: { paciente: patient } }));
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/baja'))).toBe(false);
  });

  it('al confirmar envía la baja con Idempotency-Key y regresa a la lista con el aviso', async () => {
    const fetchMock = mockRoutes((call) =>
      isAction(call, 'baja')
        ? { status: 200, body: { codigo: 'BAJA_REGISTRADA', paciente: inactive } }
        : { status: 200, body: { paciente: patient } },
    );
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de baja' }));

    expect(await screen.findByRole('heading', { name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByText('Paciente dado de baja.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/baja'));
    expect(String(call?.[0])).toBe(`/api/v1/pacientes/${patient.id}/baja`);
    expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('bloquea el cierre de sesión mientras la baja está en curso', async () => {
    let release: (() => void) | undefined;
    mockRoutes(async (call) => {
      if (!isAction(call, 'baja')) return { status: 200, body: { paciente: patient } };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 200, body: { codigo: 'BAJA_REGISTRADA', paciente: inactive } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    );

    expect(await screen.findByRole('button', { name: /Dando de baja/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByLabelText('Operación pendiente')).toHaveTextContent('true');

    release?.();
    expect(await screen.findByRole('heading', { name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Operación pendiente')).toHaveTextContent('false');
  });

  it('ante una falla de red conserva el diálogo y reintenta con la misma llave', async () => {
    let attempts = 0;
    const fetchMock = mockRoutes((call) => {
      if (!isAction(call, 'baja')) return { status: 200, body: { paciente: patient } };
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return { status: 200, body: { codigo: 'BAJA_REGISTRADA', paciente: inactive } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    );

    const dialog = screen.getByRole('alertdialog');
    expect(
      await within(dialog).findByText(/no hubo conexión con el servidor\. El perfil no cambió/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Paciente dado de baja.')).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/baja'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('si otra persona ya lo dio de baja, cierra el diálogo y vuelve a leer el perfil', async () => {
    let discharged = false;
    mockRoutes((call) => {
      if (isAction(call, 'baja')) {
        discharged = true;
        return {
          status: 409,
          body: {
            codigo: 'PACIENTE_INACTIVO',
            mensaje: 'Este paciente ya estaba dado de baja. El perfil no cambió.',
            fecha_baja: '2026-10-14',
          },
        };
      }
      return { status: 200, body: { paciente: discharged ? inactive : patient } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    );

    expect(
      await screen.findByText('Este paciente ya estaba dado de baja. El perfil no cambió.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reactivar paciente' })).toBeInTheDocument();
  });
});

describe('reactivación desde el perfil (EDT 4.3.3)', () => {
  it('un paciente dado de baja solo ofrece "Reactivar paciente"', async () => {
    mockRoutes(() => ({ status: 200, body: { paciente: inactive } }));
    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'Reactivar paciente' })).toBeInTheDocument();
    expect(screen.getByText('Dado de baja')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pacientes' })).toHaveAttribute(
      'href',
      '/inicio/pacientes?estado=inactivos',
    );
  });

  it('reactiva sin enviar datos y el perfil vuelve a estar activo sin recargar', async () => {
    const fetchMock = mockRoutes((call) =>
      isAction(call, 'reactivacion')
        ? {
            status: 200,
            body: {
              codigo: 'PACIENTE_REACTIVADO',
              paciente: { ...patient, version: 3 },
            },
          }
        : { status: 200, body: { paciente: inactive } },
    );
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar paciente' }));
    const dialog = screen.getByRole('dialog', { name: 'Reactivar a Valeria Ku Escalante' });
    expect(dialog).toHaveTextContent('con sus datos anteriores');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivar' }));

    expect(await screen.findByText('Paciente reactivado.')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reactivacion'));
    expect(call?.[1]?.body).toBeUndefined();
    expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('muestra el error dentro del diálogo y permite reintentar', async () => {
    let attempts = 0;
    mockRoutes((call) => {
      if (!isAction(call, 'reactivacion')) return { status: 200, body: { paciente: inactive } };
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return { status: 200, body: { codigo: 'PACIENTE_REACTIVADO', paciente: patient } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar paciente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }));

    expect(await screen.findByText(/No pudimos reactivar al paciente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(screen.getByText('Paciente reactivado.')).toBeInTheDocument());
  });
});
