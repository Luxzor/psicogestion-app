import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { CitasPage } from './CitasPage';
import { NuevaCitaPage } from './NuevaCitaPage';
import { toInicioIso } from '../horario';

/**
 * EDT 5.3.3. Pruebas de "Lista y detalle de citas", con el mismo patrón que
 * NuevaCitaPage.test.tsx: vi.stubGlobal('fetch', ...) y MemoryRouter + QueryClientProvider. Los
 * filtros viven en la URL (CitasPage.tsx), así que cada prueba lee la ubicación con un
 * componente sonda en vez de inspeccionar el estado interno de la página.
 */

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const result = handler(String(input), init ?? {});
    return json(result.status, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const SALA = { id: 'sala-1', nombre: 'Sala A', activo: true };
const TERAPEUTA = {
  id: 'terapeuta-1',
  nombre_completo: 'Victoria Méndez Rosado',
  cedula_profesional: '7845213',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  foto_actualizada_en: null,
  activo: true,
};

const cita = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'cita-1',
  folio: 'C26000001',
  estado: 'Pendiente',
  inicio: '2026-10-26T15:00:00.000Z',
  fin: '2026-10-26T15:30:00.000Z',
  duracion_bloques: 1,
  paciente: { id: 'paciente-1', nombre_completo: 'Valeria Ku Escalante' },
  terapeuta: { id: TERAPEUTA.id, nombre_completo: TERAPEUTA.nombre_completo },
  sala: { id: SALA.id, nombre: SALA.nombre },
  cancelada_en: null,
  fecha_registro: '2026-10-01',
  version: 1,
  confirmacion: { enviada: true, destino: 'v***@example.com' },
  ...overrides,
});

const listaDe = (datos: unknown[], overrides: Partial<Record<string, unknown>> = {}) => ({
  datos,
  pagina: 1,
  tamano: 25,
  total: datos.length,
  ...overrides,
});

/** Responde salas y terapeutas activos de los filtros; `onList` decide la respuesta de /citas. */
function baseHandler(onList: (url: string) => { status: number; body?: unknown }): Handler {
  return (url) => {
    if (url.includes('/api/v1/salas?estado=activas')) {
      return { status: 200, body: { salas: [SALA] } };
    }
    if (url.includes('/api/v1/terapeutas')) {
      return { status: 200, body: { datos: [TERAPEUTA], pagina: 1, tamano: 100, total: 1 } };
    }
    if (url.includes('/api/v1/citas/')) {
      return { status: 200, body: { cita: cita() } };
    }
    if (url.includes('/api/v1/citas')) {
      return onList(url);
    }
    return { status: 500 };
  };
}

function DetalleStub() {
  const { pathname } = useLocation();
  return <h1>Detalle de {pathname}</h1>;
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="ubicacion">{`${location.pathname}${location.search}`}</p>;
}

function renderList(initialEntry = '/inicio/citas') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <UnsavedChangesProvider>
          <LocationProbe />
          <Routes>
            <Route
              path="/inicio/citas"
              element={<CitasPage session={{ token: 'token-de-prueba' }} />}
            />
            <Route path="/inicio/citas/:id" element={<DetalleStub />} />
            <Route
              path="/inicio/citas/nueva"
              element={<NuevaCitaPage session={{ token: 'token-de-prueba' }} />}
            />
          </Routes>
        </UnsavedChangesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent ?? '';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lista de citas (RF 5.2.1-5.2.3, CA-5.2-01)', () => {
  it('la pestaña Pendientes está activa por omisión y cambiar de pestaña filtra por estado (RF 5.2.2)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();

    expect(screen.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screen.findByText('C26000001');

    fireEvent.click(screen.getByRole('tab', { name: 'Vencidas' }));

    await waitFor(() => expect(ubicacion()).toContain('estado=Vencida'));
    expect(screen.getByRole('tab', { name: 'Vencidas' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('estado=Vencida'))).toBe(
        true,
      ),
    );
  });

  it('filtrar por sala o terapeuta queda en la URL y reinicia la página (RF 5.2.3)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList('/inicio/citas?pagina=2');
    await screen.findByText('C26000001');

    fireEvent.change(await screen.findByLabelText('Filtrar por sala'), {
      target: { value: SALA.id },
    });

    await waitFor(() => expect(ubicacion()).toContain(`sala=${SALA.id}`));
    expect(ubicacion()).not.toContain('pagina=');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`id_sala=${SALA.id}`))).toBe(
        true,
      ),
    );

    fireEvent.change(await screen.findByLabelText('Filtrar por terapeuta'), {
      target: { value: TERAPEUTA.id },
    });

    await waitFor(() => expect(ubicacion()).toContain(`terapeuta=${TERAPEUTA.id}`));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes(`id_terapeuta=${TERAPEUTA.id}`)),
      ).toBe(true),
    );
  });

  it('el botón Cancelar por folio abre el diálogo correspondiente (RF 5.4.1)', async () => {
    mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();

    const btnFolio = await screen.findByRole('button', { name: /cancelar por folio/i });
    expect(btnFolio).toBeInTheDocument();
    fireEvent.click(btnFolio);

    expect(await screen.findByRole('dialog', { name: 'Cancelar cita por folio' })).toBeInTheDocument();
  });

  it('el botón de cancelar en la fila de una cita pendiente abre la confirmación de cancelación (RF 5.4.2)', async () => {
    mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();

    await screen.findByText('C26000001');
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar C26000001' });
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);

    expect(
      await screen.findByRole('alertdialog', { name: '¿Cancelar la cita C26000001?' }),
    ).toBeInTheDocument();
  });

  it('el periodo semana envía el rango de lunes a domingo de la fecha elegida (RF 5.2.3)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();
    await screen.findByText('C26000001');

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    fireEvent.change(screen.getByLabelText('Fecha de referencia del periodo'), {
      target: { value: '2026-12-09' }, // miércoles de esa semana
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes('desde=2026-12-07') && String(url).includes('hasta=2026-12-13'),
        ),
      ).toBe(true),
    );
  });

  it('el periodo mes envía el primer y el último día del mes de la fecha elegida (RF 5.2.3)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();
    await screen.findByText('C26000001');

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    fireEvent.change(screen.getByLabelText('Fecha de referencia del periodo'), {
      target: { value: '2027-02-14' },
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes('desde=2027-02-01') && String(url).includes('hasta=2027-02-28'),
        ),
      ).toBe(true),
    );
  });

  it('la búsqueda por folio solo se envía con el formato válido, normalizado a mayúsculas (CA-5.2-01)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();
    await screen.findByText('C26000001');

    fireEvent.change(screen.getByLabelText('Buscar por folio'), {
      target: { value: 'c-2026-0001' },
    });
    await waitFor(() =>
      expect(screen.getByText(/El folio no tiene un formato válido/)).toBeVisible(),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('folio='))).toBe(false);

    fireEvent.change(screen.getByLabelText('Buscar por folio'), {
      target: { value: ' c26000118 ' },
    });

    await waitFor(() => expect(ubicacion()).toContain('folio=C26000118'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('folio=C26000118'))).toBe(
        true,
      ),
    );
  });

  it('muestra un esqueleto de carga mientras llega la respuesta', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v1/salas')) return Promise.resolve(json(200, { salas: [SALA] }));
      if (url.includes('/api/v1/terapeutas')) {
        return Promise.resolve(json(200, { datos: [TERAPEUTA], pagina: 1, tamano: 100, total: 1 }));
      }
      return pending;
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    expect(screen.getByText('Cargando citas')).toBeInTheDocument();

    resolve(json(200, listaDe([cita()])));
    await screen.findByText('C26000001');
  });

  it('sin filtros activos, el vacío muestra el mensaje del estatus; con filtros, ofrece quitarlos', async () => {
    mockApi(baseHandler(() => ({ status: 200, body: listaDe([]) })));
    renderList();

    expect(await screen.findByText('No hay citas pendientes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar filtros' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar por folio'), {
      target: { value: 'C26000118' },
    });
    await waitFor(() => expect(ubicacion()).toContain('folio=C26000118'));

    expect(await screen.findByText('No encontramos citas con estos filtros')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));

    await waitFor(() => expect(ubicacion()).not.toContain('folio='));
    expect(screen.getByLabelText('Buscar por folio')).toHaveValue('');
  });

  it('el estado de error muestra el aviso de conexión y permite reintentar (RNF 5.1.4)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 500 })));
    renderList();

    expect(await screen.findByText('No pudimos cargar las citas')).toBeInTheDocument();
    const llamadasPrevias = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/v1/citas?'),
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/v1/citas?')).length,
      ).toBeGreaterThan(llamadasPrevias),
    );
  });

  it('al agendar una cita, volver a la lista la refleja de inmediato sin recargar (ADR-12)', async () => {
    let agendada = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      if (url.includes('/api/v1/pacientes')) {
        return json(200, {
          datos: [{ id: 'paciente-1', nombre_completo: 'Valeria Ku Escalante', activo: true }],
          pagina: 1,
          tamano: 20,
          total: 1,
        });
      }
      if (url.includes('/api/v1/terapeutas')) {
        return json(200, { datos: [TERAPEUTA], pagina: 1, tamano: 100, total: 1 });
      }
      if (url.includes('/api/v1/salas/disponibilidad')) {
        const fecha = '2031-05-12';
        const bloques = Array.from({ length: 4 }, (_, i) => ({
          inicio: toInicioIso(fecha, 420 + i * 30)!,
          estado: 'libre' as const,
        }));
        return json(200, {
          fecha,
          bloques: bloques.map((b) => ({ inicio: b.inicio, fin: b.inicio })),
          salas: [{ ...SALA, bloques, citas: [], total_citas: 0, bloques_ocupados: 0 }],
        });
      }
      if (url.includes('/api/v1/salas?estado=activas')) return json(200, { salas: [SALA] });
      if (url.endsWith('/api/v1/citas') && method === 'POST') {
        agendada = true;
        return json(201, {
          codigo: 'CITA_REGISTRADA',
          cita: cita({ id: 'cita-nueva', folio: 'C31000099' }),
        });
      }
      if (url.includes('/api/v1/citas')) {
        return json(
          200,
          listaDe(agendada ? [cita(), cita({ id: 'cita-nueva', folio: 'C31000099' })] : [cita()]),
        );
      }
      return json(500);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList('/inicio/citas/nueva');

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2031-05-12' } });
    fireEvent.focus(screen.getByLabelText('Paciente'));
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Valeria' } });
    fireEvent.click(await screen.findByText('Valeria Ku Escalante', {}, { timeout: 2000 }));
    fireEvent.focus(screen.getByLabelText('Terapeuta'));
    fireEvent.change(screen.getByLabelText('Terapeuta'), { target: { value: 'Victoria' } });
    fireEvent.click(await screen.findByText('Victoria Méndez Rosado', {}, { timeout: 2000 }));
    const chips = within(await screen.findByRole('group', { name: 'Salas' }, { timeout: 2000 }));
    fireEvent.click(await chips.findByRole('button', {}, { timeout: 2000 }));
    const listbox = await screen.findByRole(
      'listbox',
      { name: 'Horarios de inicio' },
      { timeout: 2000 },
    );
    fireEvent.click(within(listbox).getAllByRole('option')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y agendar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Confirmar los datos de la cita?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await screen.findByText(/Cita agendada con éxito/);
    fireEvent.click(screen.getByRole('button', { name: 'Ir a citas' }));

    expect(await screen.findByText('C31000099')).toBeInTheDocument();
  });

  it('al hacer clic en una fila de cita se abre el diálogo de detalle interactivo (PG-DSN-003-INT)', async () => {
    mockApi(baseHandler(() => ({ status: 200, body: listaDe([cita()]) })));
    renderList();

    await screen.findByText('C26000001');
    const row = screen.getByLabelText('Ver cita C26000001');
    fireEvent.click(row);

    const dialog = await screen.findByRole('dialog', { name: 'Cita C26000001' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Valeria Ku Escalante')).toBeInTheDocument();
    expect(within(dialog).getByText('Victoria Méndez Rosado')).toBeInTheDocument();
    expect(within(dialog).getByText(/Sala A/)).toBeInTheDocument();

    const cancelarBtn = within(dialog).getByRole('button', { name: 'Cancelar cita' });
    expect(cancelarBtn).toBeInTheDocument();

    fireEvent.click(cancelarBtn);
    expect(
      await screen.findByRole('alertdialog', { name: '¿Cancelar la cita C26000001?' }),
    ).toBeInTheDocument();
  });
});
