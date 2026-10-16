import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { useTherapistList } from '../hooks/useTerapeutas';
import { PerfilTerapeutaPage } from './PerfilTerapeutaPage';

type Call = { url: string; method: string; headers: Headers; body: unknown };
type RoutedHandler = (
  call: Call,
) => { status: number; body?: unknown; isPhoto?: boolean } | Promise<{
  status: number;
  body?: unknown;
  isPhoto?: boolean;
}>;

function responseFor(result: { status: number; body?: unknown; isPhoto?: boolean }) {
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

/** Doble que distingue la lectura del perfil, el listado, la foto, la baja y la reactivación. */
function mockRoutes(handler: RoutedHandler) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    const result = await handler(call);
    return responseFor(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const isAction = (call: Call, action: 'baja' | 'reactivar') =>
  call.method === 'POST' && call.url.endsWith(`/${action}`);
const isFoto = (call: Call) => call.url.includes('/foto');
const isList = (call: Call) =>
  call.method === 'GET' && !isFoto(call) && !/\/terapeutas\/[^/?]+$/.test(call.url);

const therapist = {
  id: 'terapeuta-1',
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
  foto_perfil: 'terapeutas/terapeuta-1/perfil.png',
  foto_actualizada_en: '2026-01-01T00:00:00.000Z',
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-01-01',
  version: 1,
};

const inactive = { ...therapist, activo: false, fecha_baja: '2026-10-14', version: 2 };

/** Muestra el estado del bloqueo de cierre de sesión (UnsavedChangesContext). */
function PendingProbe() {
  const { hasUnsavedChanges } = useUnsavedChanges();
  return <output aria-label="Operación pendiente">{String(hasUnsavedChanges)}</output>;
}

function ListaInactivosStub() {
  const flash = (useLocation().state as { flash?: { text: string } } | null)?.flash;
  const list = useTherapistList({ pagina: 1, tamano: 25, estado: 'inactivos' }, 'token-de-prueba');
  return (
    <>
      <h1>Terapeutas</h1>
      {flash ? <p>{flash.text}</p> : null}
      <ul aria-label="Terapeutas dados de baja">
        {(list.data?.datos ?? []).map((t) => (
          <li key={t.id}>{t.nombre_completo}</li>
        ))}
      </ul>
    </>
  );
}

function renderWithProviders(id = therapist.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <PendingProbe />
        <MemoryRouter initialEntries={[`/inicio/terapeutas/${id}`]}>
          <Routes>
            <Route path="/inicio/terapeutas" element={<ListaInactivosStub />} />
            <Route
              path="/inicio/terapeutas/:id"
              element={<PerfilTerapeutaPage session={{ token: 'token-de-prueba' }} />}
            />
          </Routes>
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('perfil de terapeuta (EDT 4.3.5, RF 2.2.2)', () => {
  it('muestra nombre, fecha dd/mm/aaaa, cédula, teléfono, correo y la fotografía', async () => {
    mockRoutes((call) =>
      isFoto(call) ? { status: 200, isPhoto: true } : { status: 200, body: { terapeuta: therapist } },
    );
    const { container } = renderWithProviders();

    expect(
      await screen.findByRole('heading', { name: 'Victoria Méndez Rosado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('19/05/1988')).toBeInTheDocument();
    expect(screen.getByText('7845213')).toBeInTheDocument();
    expect(screen.getByText('9997845213')).toBeInTheDocument();
    expect(screen.getByText('victoria.mendez@correo.uady.mx')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
  });

  it('pide ?tam=perfil para la fotografía del encabezado', async () => {
    const fetchMock = mockRoutes((call) =>
      isFoto(call) ? { status: 200, isPhoto: true } : { status: 200, body: { terapeuta: therapist } },
    );
    renderWithProviders();

    await screen.findByRole('heading', { name: 'Victoria Méndez Rosado' });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/foto?tam=perfil')),
    ).toBe(true);
  });

  it('un terapeuta activo muestra "Editar" y "Dar de baja"', async () => {
    mockRoutes((call) =>
      isFoto(call) ? { status: 404 } : { status: 200, body: { terapeuta: therapist } },
    );
    renderWithProviders();

    expect(await screen.findByRole('link', { name: /Editar el perfil/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
  });

  it('un terapeuta inactivo muestra el aviso con la fecha, "Reactivar terapeuta" y sin "Editar" (RF 2.3.4)', async () => {
    mockRoutes((call) =>
      isFoto(call) ? { status: 404 } : { status: 200, body: { terapeuta: inactive } },
    );
    renderWithProviders();

    expect(await screen.findByText('Dado de baja')).toBeInTheDocument();
    expect(screen.getByText(/dado de baja el 14\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivar terapeuta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
  });

  it('responde 404 con un mensaje claro', async () => {
    mockRoutes(() => ({
      status: 404,
      body: { codigo: 'TERAPEUTA_NO_ENCONTRADO', mensaje: 'No encontramos al terapeuta indicado.' },
    }));
    renderWithProviders('no-existe');

    expect(await screen.findByText('No encontramos a este terapeuta')).toBeInTheDocument();
  });
});

describe('baja lógica desde el perfil (EDT 4.3.5, RF 2.3.1–2.3.3)', () => {
  it('pide confirmación en un alertdialog con foco en "Cancelar"; Esc lo cierra sin cambios', async () => {
    const fetchMock = mockRoutes((call) =>
      isFoto(call) ? { status: 404 } : { status: 200, body: { terapeuta: therapist } },
    );
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja a Victoria Méndez Rosado' });
    expect(dialog).toHaveTextContent(
      'Dejará de aparecer en la lista de terapeutas activos y no podrá asignarse a nuevas citas. Sus datos se conservarán.',
    );
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('"Cancelar" cierra el diálogo sin dar de baja', async () => {
    const fetchMock = mockRoutes((call) =>
      isFoto(call) ? { status: 404 } : { status: 200, body: { terapeuta: therapist } },
    );
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/baja'))).toBe(false);
  });

  it('al confirmar envía la baja con Idempotency-Key, sin cuerpo, y regresa a la lista con el aviso (RF 2.3.3)', async () => {
    const fetchMock = mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (isAction(call, 'baja')) {
        return { status: 200, body: { codigo: 'BAJA_REGISTRADA', terapeuta: inactive } };
      }
      if (isList(call)) return { status: 200, body: { datos: [], pagina: 1, tamano: 25, total: 0 } };
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de baja' }));

    expect(await screen.findByRole('heading', { name: 'Terapeutas' })).toBeInTheDocument();
    expect(screen.getByText('Terapeuta dado de baja.')).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/baja'));
    expect(String(call?.[0])).toBe(`/api/v1/terapeutas/${therapist.id}/baja`);
    expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('la baja hace que el terapeuta aparezca en el filtro "Dados de baja"', async () => {
    let discharged = false;
    mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (isAction(call, 'baja')) {
        discharged = true;
        return { status: 200, body: { codigo: 'BAJA_REGISTRADA', terapeuta: inactive } };
      }
      if (isList(call)) {
        return {
          status: 200,
          body: {
            datos: discharged ? [inactive] : [],
            pagina: 1,
            tamano: 25,
            total: discharged ? 1 : 0,
          },
        };
      }
      return { status: 200, body: { terapeuta: therapist } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    );

    await screen.findByRole('heading', { name: 'Terapeutas' });
    expect(
      await within(screen.getByLabelText('Terapeutas dados de baja')).findByText(
        'Victoria Méndez Rosado',
      ),
    ).toBeInTheDocument();
  });

  it('bloquea el cierre de sesión mientras la baja está en curso', async () => {
    let release: (() => void) | undefined;
    mockRoutes(async (call) => {
      if (isFoto(call)) return { status: 404 };
      if (!isAction(call, 'baja')) return { status: 200, body: { terapeuta: therapist } };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 200, body: { codigo: 'BAJA_REGISTRADA', terapeuta: inactive } };
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
    expect(await screen.findByRole('heading', { name: 'Terapeutas' })).toBeInTheDocument();
    expect(screen.getByLabelText('Operación pendiente')).toHaveTextContent('false');
  });

  it('ante una falla de red conserva el diálogo y reintenta con la misma llave', async () => {
    let attempts = 0;
    const fetchMock = mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (!isAction(call, 'baja')) return { status: 200, body: { terapeuta: therapist } };
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return { status: 200, body: { codigo: 'BAJA_REGISTRADA', terapeuta: inactive } };
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

    expect(await screen.findByText('Terapeuta dado de baja.')).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/baja'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('409 TERAPEUTA_INACTIVO: cierra el diálogo, vuelve a leer el perfil y lo informa', async () => {
    let discharged = false;
    mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (isAction(call, 'baja')) {
        discharged = true;
        return {
          status: 409,
          body: {
            codigo: 'TERAPEUTA_INACTIVO',
            mensaje: 'Este terapeuta ya estaba dado de baja. El perfil no cambió.',
            fecha_baja: '2026-10-14',
          },
        };
      }
      return { status: 200, body: { terapeuta: discharged ? inactive : therapist } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    );

    expect(
      await screen.findByText('Este terapeuta ya estaba dado de baja. El perfil no cambió.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reactivar terapeuta' })).toBeInTheDocument();
  });
});

describe('reactivación desde el perfil (EDT 4.3.5, RF 2.3.4)', () => {
  it('un terapeuta dado de baja solo ofrece "Reactivar terapeuta"', async () => {
    mockRoutes((call) =>
      isFoto(call) ? { status: 404 } : { status: 200, body: { terapeuta: inactive } },
    );
    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'Reactivar terapeuta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
  });

  it('reactiva sin enviar datos, con Idempotency-Key, y el perfil vuelve a estar activo sin recargar', async () => {
    const fetchMock = mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (isAction(call, 'reactivar')) {
        return { status: 200, body: { codigo: 'TERAPEUTA_REACTIVADO', terapeuta: therapist } };
      }
      return { status: 200, body: { terapeuta: inactive } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar terapeuta' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivar' }));

    expect(await screen.findByText('Terapeuta reactivado.')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reactivar'));
    expect(call?.[1]?.body).toBeUndefined();
    expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('ante una falla de red conserva el diálogo y reintenta con la misma llave', async () => {
    let attempts = 0;
    const fetchMock = mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (!isAction(call, 'reactivar')) return { status: 200, body: { terapeuta: inactive } };
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return { status: 200, body: { codigo: 'TERAPEUTA_REACTIVADO', terapeuta: therapist } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar terapeuta' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivar' }));

    const dialog = screen.getByRole('dialog');
    expect(
      await within(dialog).findByText(/no hubo conexión con el servidor\. El perfil no cambió/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Terapeuta reactivado.')).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/reactivar'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('409 TERAPEUTA_ACTIVO: cierra el diálogo, vuelve a leer el perfil y lo informa', async () => {
    let reactivated = false;
    mockRoutes((call) => {
      if (isFoto(call)) return { status: 404 };
      if (isAction(call, 'reactivar')) {
        reactivated = true;
        return {
          status: 409,
          body: { codigo: 'TERAPEUTA_ACTIVO', mensaje: 'El terapeuta ya está activo.' },
        };
      }
      return { status: 200, body: { terapeuta: reactivated ? therapist : inactive } };
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar terapeuta' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivar' }));

    expect(
      await screen.findByText('Este terapeuta ya estaba activo. El perfil no cambió.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
  });
});
