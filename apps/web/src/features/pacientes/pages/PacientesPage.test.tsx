import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PacientesPage } from './PacientesPage';

type Handler = (url: string) => { status: number; body?: unknown };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const result = handler(String(input));
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const item = (n: number) => ({
  id: `paciente-${n}`,
  nombre_completo: `Paciente Número ${n}`,
  telefono: `99900000${String(n).padStart(2, '0')}`,
  edad: 30 + n,
  activo: true,
});

function PerfilStub() {
  return <h1>Perfil del paciente</h1>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/inicio/pacientes']}>
        <Routes>
          <Route
            path="/inicio/pacientes"
            element={<PacientesPage session={{ token: 'token-de-prueba' }} />}
          />
          <Route path="/inicio/pacientes/:id" element={<PerfilStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lista de pacientes (EDT 4.3.2)', () => {
  it('muestra el esqueleto de carga mientras llega la respuesta (5.4)', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveFetch = resolve;
      });
      return json(200, { datos: [], pagina: 1, tamano: 25, total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(screen.getByText('Cargando pacientes')).toBeInTheDocument();
    // Las filas de esqueleto son aria-hidden; se incluyen explícitamente para contarlas.
    expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(6); // encabezado + 5

    resolveFetch?.();
    expect(await screen.findByText('Aún no hay pacientes')).toBeInTheDocument();
  });

  it('muestra el aviso de vacío cuando no hay pacientes registrados', async () => {
    mockApi(() => ({ status: 200, body: { datos: [], pagina: 1, tamano: 25, total: 0 } }));
    renderPage();

    expect(await screen.findByText('Aún no hay pacientes')).toBeInTheDocument();
    expect(
      screen.getByText('Usa “Añadir paciente” para registrar el primero.'),
    ).toBeInTheDocument();
  });

  it('muestra el aviso de búsqueda sin resultados tras la pausa de 300 ms (5.4)', async () => {
    const fetchMock = mockApi((url) => {
      const sinResultados = url.includes('q=zzzzz');
      return {
        status: 200,
        body: sinResultados
          ? { datos: [], pagina: 1, tamano: 25, total: 0 }
          : { datos: [item(1)], pagina: 1, tamano: 25, total: 1 },
      };
    });
    renderPage();
    await screen.findByText('Paciente Número 1');

    fireEvent.change(screen.getByLabelText('Buscar por nombre, CURP o teléfono'), {
      target: { value: 'zzzzz' },
    });

    expect(
      await screen.findByText(/No encontramos pacientes con/, {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/zzzzz/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=zzzzz'))).toBe(true);
  });

  it('muestra un error con "Reintentar" cuando falla la carga', async () => {
    const fetchMock = mockApi(() => ({ status: 500 }));
    renderPage();

    expect(await screen.findByText('No pudimos cargar la lista')).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it('pagina de 25 en 25 y navega con Anterior y Siguiente (RF 3.2.1)', async () => {
    const fetchMock = mockApi((url) => {
      const pagina2 = url.includes('pagina=2');
      return {
        status: 200,
        body: pagina2
          ? { datos: [item(26)], pagina: 2, tamano: 25, total: 26 }
          : {
              datos: Array.from({ length: 25 }, (_, i) => item(i + 1)),
              pagina: 1,
              tamano: 25,
              total: 26,
            },
      };
    });
    renderPage();

    expect(await screen.findByText('Mostrando 1–25 de 26')).toBeInTheDocument();
    const anterior = screen.getByRole('button', { name: 'Anterior' });
    const siguiente = screen.getByRole('button', { name: 'Siguiente' });
    expect(anterior).toBeDisabled();
    expect(siguiente).toBeEnabled();

    fireEvent.click(siguiente);

    expect(await screen.findByText('Mostrando 26–26 de 26')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('pagina=2'))).toBe(true);
  });

  it('abre el perfil al presionar Enter sobre la fila (navegable con teclado)', async () => {
    mockApi(() => ({
      status: 200,
      body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 },
    }));
    renderPage();

    const fila = await screen.findByRole('row', { name: /Abrir el perfil de Paciente Número 1/ });
    fireEvent.keyDown(fila, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Perfil del paciente' })).toBeInTheDocument();
  });

  it('abre el perfil al hacer clic sobre la fila', async () => {
    mockApi(() => ({
      status: 200,
      body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 },
    }));
    renderPage();

    const fila = await screen.findByRole('row', { name: /Abrir el perfil de Paciente Número 1/ });
    fireEvent.click(within(fila).getByText('Paciente Número 1'));

    expect(await screen.findByRole('heading', { name: 'Perfil del paciente' })).toBeInTheDocument();
  });
});
