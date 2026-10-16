import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerapeutasPage } from './TerapeutasPage';

type Handler = (url: string) => { status: number; body?: unknown; isPhoto?: boolean };

function responseFor(result: ReturnType<Handler>) {
  if (result.isPhoto) {
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: result.status,
      headers: { 'Content-Type': 'image/png' },
    });
  }
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const result = handler(String(input));
    return responseFor(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const item = (n: number, overrides: Partial<Record<string, unknown>> = {}) => ({
  id: `terapeuta-${n}`,
  nombre_completo: `Terapeuta Número ${n}`,
  cedula_profesional: `700000${n}`,
  telefono: `99970000${String(n).padStart(2, '0')}`,
  correo_electronico: `terapeuta${n}@correo.uady.mx`,
  foto_actualizada_en: null,
  activo: true,
  ...overrides,
});

function PerfilStub() {
  return <h1>Perfil del terapeuta</h1>;
}

function renderPage(entry = '/inicio/terapeutas') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/inicio/terapeutas"
            element={<TerapeutasPage session={{ token: 'token-de-prueba' }} />}
          />
          <Route path="/inicio/terapeutas/:id" element={<PerfilStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lista de terapeutas (EDT 4.3.5)', () => {
  it('muestra el esqueleto de carga mientras llega la respuesta (§5.7)', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/foto')) return responseFor({ status: 404, isPhoto: true });
      await new Promise<void>((resolve) => {
        resolveFetch = resolve;
      });
      return responseFor({ status: 200, body: { datos: [], pagina: 1, tamano: 25, total: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(screen.getByText('Cargando terapeutas')).toBeInTheDocument();
    expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(6); // encabezado + 5

    resolveFetch?.();
    expect(await screen.findByText('Aún no hay terapeutas')).toBeInTheDocument();
  });

  it('muestra el aviso de vacío cuando no hay terapeutas registrados', async () => {
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [], pagina: 1, tamano: 25, total: 0 } },
    );
    renderPage();

    expect(await screen.findByText('Aún no hay terapeutas')).toBeInTheDocument();
    expect(screen.getByText('Usa “Añadir terapeuta” para registrar el primero.')).toBeInTheDocument();
  });

  it('muestra las columnas de nombre, cédula, teléfono y correo (RF 2.2.1, §5.7)', async () => {
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 } },
    );
    renderPage();

    await screen.findByText('Terapeuta Número 1');
    expect(screen.getByText('7000001')).toBeInTheDocument();
    expect(screen.getByText('9997000001')).toBeInTheDocument();
    expect(screen.getByText('terapeuta1@correo.uady.mx')).toBeInTheDocument();
  });

  it('muestra el aviso de búsqueda sin resultados tras la pausa de 300 ms (§5.7)', async () => {
    const fetchMock = mockApi((url) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      const sinResultados = url.includes('q=zzzzz');
      return {
        status: 200,
        body: sinResultados
          ? { datos: [], pagina: 1, tamano: 25, total: 0 }
          : { datos: [item(1)], pagina: 1, tamano: 25, total: 1 },
      };
    });
    renderPage();
    await screen.findByText('Terapeuta Número 1');

    fireEvent.change(
      screen.getByLabelText('Buscar por nombre, cédula, teléfono o correo'),
      { target: { value: 'zzzzz' } },
    );

    expect(
      await screen.findByText(/No encontramos terapeutas con/, {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/zzzzz/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=zzzzz'))).toBe(true);
  });

  it('muestra un error con "Reintentar" cuando falla la carga', async () => {
    const fetchMock = mockApi((url) =>
      url.includes('/foto') ? { status: 404, isPhoto: true } : { status: 500 },
    );
    renderPage();

    expect(await screen.findByText('No pudimos cargar la lista')).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it('pagina de 25 en 25 y navega con Anterior y Siguiente (RF 2.2.1)', async () => {
    const fetchMock = mockApi((url) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
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
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 } },
    );
    renderPage();

    const fila = await screen.findByRole('row', { name: /Abrir el perfil de Terapeuta Número 1/ });
    fireEvent.keyDown(fila, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Perfil del terapeuta' })).toBeInTheDocument();
  });

  it('abre el perfil al hacer clic sobre la fila', async () => {
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 } },
    );
    renderPage();

    const fila = await screen.findByRole('row', { name: /Abrir el perfil de Terapeuta Número 1/ });
    fireEvent.click(within(fila).getByText('Terapeuta Número 1'));

    expect(await screen.findByRole('heading', { name: 'Perfil del terapeuta' })).toBeInTheDocument();
  });
});

describe('filtro de terapeutas dados de baja (EDT 4.3.5)', () => {
  const baja = (n: number) => item(n, { activo: false });

  it('por omisión lista los activos y no envía el parámetro estado', async () => {
    const fetchMock = mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [item(1)], pagina: 1, tamano: 25, total: 1 } },
    );
    renderPage();

    await screen.findByText('Terapeuta Número 1');
    const filtro = screen.getByRole('group', { name: 'Mostrar terapeutas' });
    expect(within(filtro).getByRole('button', { name: 'Activos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      fetchMock.mock.calls.every(
        ([url]) => String(url).includes('/foto') || !String(url).includes('estado='),
      ),
    ).toBe(true);
    expect(screen.queryByText('Dado de baja')).not.toBeInTheDocument();
  });

  it('al elegir "Dados de baja" consulta estado=inactivos y marca cada fila', async () => {
    const fetchMock = mockApi((url) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      return {
        status: 200,
        body: url.includes('estado=inactivos')
          ? { datos: [baja(7)], pagina: 1, tamano: 25, total: 1 }
          : { datos: [item(1)], pagina: 1, tamano: 25, total: 1 },
      };
    });
    renderPage();
    await screen.findByText('Terapeuta Número 1');

    fireEvent.click(screen.getByRole('button', { name: 'Dados de baja' }));

    expect(await screen.findByText('Terapeuta Número 7')).toBeInTheDocument();
    const fila = screen.getByRole('row', { name: /Abrir el perfil de Terapeuta Número 7/ });
    expect(within(fila).getByText('Dado de baja')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('estado=inactivos'))).toBe(
      true,
    );
  });

  it('respeta el filtro de la URL al volver desde un perfil (?estado=inactivos)', async () => {
    const fetchMock = mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [baja(3)], pagina: 1, tamano: 25, total: 1 } },
    );
    renderPage('/inicio/terapeutas?estado=inactivos');

    expect(await screen.findByText('Terapeuta Número 3')).toBeInTheDocument();
    const firstListCall = fetchMock.mock.calls.find(([url]) => !String(url).includes('/foto'));
    expect(String(firstListCall?.[0])).toContain('estado=inactivos');
  });

  it('muestra un aviso propio cuando no hay terapeutas dados de baja', async () => {
    mockApi((url) =>
      url.includes('/foto')
        ? { status: 404, isPhoto: true }
        : { status: 200, body: { datos: [], pagina: 1, tamano: 25, total: 0 } },
    );
    renderPage('/inicio/terapeutas?estado=inactivos');

    expect(await screen.findByText('No hay terapeutas dados de baja')).toBeInTheDocument();
    expect(screen.queryByText('Aún no hay terapeutas')).not.toBeInTheDocument();
  });

  it('cambiar el filtro conserva la búsqueda y regresa a la primera página', async () => {
    const fetchMock = mockApi((url) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      return {
        status: 200,
        body: url.includes('pagina=2')
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
    fireEvent.change(
      screen.getByLabelText('Buscar por nombre, cédula, teléfono o correo'),
      { target: { value: 'Terapeuta' } },
    );
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes('q=Terapeuta')),
        ).toBe(true),
      { timeout: 2000 },
    );
    await screen.findByText('Mostrando 1–25 de 26');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Mostrando 26–26 de 26');

    fireEvent.click(screen.getByRole('button', { name: 'Dados de baja' }));

    await screen.findByText('Mostrando 1–25 de 26');
    const ultima = String(
      fetchMock.mock.calls.filter(([url]) => !String(url).includes('/foto')).at(-1)?.[0],
    );
    expect(ultima).toContain('estado=inactivos');
    expect(ultima).toContain('q=Terapeuta');
    expect(ultima).toContain('pagina=1');
  });
});

describe('fotografías en la lista de terapeutas (EDT 4.3.5, ERS 2.1.6)', () => {
  it('muestra iniciales cuando no hay fotografía y la imagen cuando sí la hay', async () => {
    mockApi((url) => {
      if (url.includes('/foto')) {
        return url.includes('terapeuta-2')
          ? { status: 200, isPhoto: true }
          : { status: 404, isPhoto: true };
      }
      return {
        status: 200,
        body: {
          datos: [
            item(1, { nombre_completo: 'Ana López' }),
            item(2, { foto_actualizada_en: '2026-01-01T00:00:00.000Z' }),
          ],
          pagina: 1,
          tamano: 25,
          total: 2,
        },
      };
    });
    const { container } = renderPage();

    await screen.findByText('Ana López');
    expect(screen.getByText('AL')).toBeInTheDocument(); // iniciales del terapeuta sin foto

    await waitFor(() => {
      expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });
  });

  it('libera el object URL de la fotografía al salir de la lista', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    mockApi((url) => {
      if (url.includes('/foto')) return { status: 200, isPhoto: true };
      return {
        status: 200,
        body: {
          datos: [item(1, { foto_actualizada_en: '2026-01-01T00:00:00.000Z' })],
          pagina: 1,
          tamano: 25,
          total: 1,
        },
      };
    });
    const { container, unmount } = renderPage();

    await screen.findByText('Terapeuta Número 1');
    await waitFor(() => {
      expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });

    unmount();
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('pide ?tam=miniatura para las fotos de la lista', async () => {
    const fetchMock = mockApi((url) => {
      if (url.includes('/foto')) return { status: 404, isPhoto: true };
      return {
        status: 200,
        body: {
          datos: [item(1, { foto_actualizada_en: '2026-01-01T00:00:00.000Z' })],
          pagina: 1,
          tamano: 25,
          total: 1,
        },
      };
    });
    renderPage();

    await screen.findByText('Terapeuta Número 1');
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/foto?tam=miniatura')),
      ).toBe(true);
    });
  });
});
