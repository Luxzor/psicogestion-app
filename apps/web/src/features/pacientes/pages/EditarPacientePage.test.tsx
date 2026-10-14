import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import { usePatient } from '../hooks/usePacientes';
import { EditarPacientePage } from './EditarPacientePage';

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

const patient = {
  id: '5f0b4a6e-2c1d-4b8e-9f3a-7d6c5b4a3f21',
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  edad: 17,
  telefono: '9996402218',
  correo: null as string | null,
  consentimiento: false,
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-08',
  version: 1,
  updated_at: '2026-10-08T12:00:00.000Z',
};

/**
 * Doble del perfil: muestra el teléfono y el correo leídos de la caché (para comprobar que no se
 * recargan) y el aviso de confirmación que llega en el estado de la navegación, igual que hace
 * la pantalla real (PerfilPacientePage con useFlash).
 */
function PerfilStub() {
  const { data } = usePatient(patient.id, 'token-de-prueba');
  const flash = (useLocation().state as { flash?: { text: string } } | null)?.flash;
  return (
    <div>
      <h1>Perfil del paciente</h1>
      {flash ? <p>{flash.text}</p> : null}
      <p>Teléfono: {data?.telefono}</p>
      <p>Correo: {data?.correo ?? 'sin correo'}</p>
    </div>
  );
}

function renderPage(initialProfile: typeof patient = patient, staleTime = 0) {
  // Igual que lib/queryClient.ts (ADR-12): staleTime > 0 evita que, al navegar al perfil justo
  // después de guardar, TanStack Query lo vuelva a pedir y deshaga la actualización optimista
  // que dejó el PATCH en caché.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/inicio/pacientes/${initialProfile.id}/editar`]}>
          <UnsavedChangesProvider>
            <Routes>
              <Route path="/inicio/pacientes" element={<h1>Pacientes</h1>} />
              <Route path="/inicio/pacientes/:id" element={<PerfilStub />} />
              <Route
                path="/inicio/pacientes/:id/editar"
                element={<EditarPacientePage session={{ token: 'token-de-prueba' }} />}
              />
            </Routes>
          </UnsavedChangesProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const patchesTo = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PATCH');
const getsTo = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(`/pacientes/${patient.id}`) &&
      !String(url).includes('validaciones') &&
      (!init || (init as RequestInit).method === undefined),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('edición de paciente (EDT 4.3.2)', () => {
  it('el botón "Guardar cambios" está deshabilitado sin diferencias', async () => {
    mockApi(() => ({ status: 200, body: { paciente: patient } }));
    renderPage();

    await screen.findByLabelText('Teléfono');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('el PATCH envía solo el campo modificado más la versión (RNF 3.2.2, ADR-10)', async () => {
    const fetchMock = mockApi((url) =>
      url.includes('/validaciones')
        ? { status: 200, body: { disponible: true } }
        : url.includes('/pacientes/') && !url.includes('editar')
          ? { status: 200, body: { paciente: patient } }
          : { status: 500 },
    );
    // El PATCH se maneja por separado abajo para distinguirlo del GET inicial.
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if ((init as RequestInit)?.method === 'PATCH') {
        return json(200, {
          codigo: 'PACIENTE_ACTUALIZADO',
          paciente: { ...patient, telefono: '9991112222', version: 2 },
        });
      }
      if (url.includes('/validaciones')) return json(200, { disponible: true });
      return json(200, { paciente: patient });
    });
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();

    fireEvent.change(telefono, { target: { value: '9991112222' } });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    const [, init] = patchesTo(fetchMock)[0];
    expect(JSON.parse(String(init?.body))).toEqual({ telefono: '9991112222', version: 1 });
  });

  it('muestra un 409 de unicidad junto al campo (CURP o teléfono de otro paciente)', async () => {
    mockApi((url, init) => {
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if ((init as RequestInit)?.method === 'PATCH') {
        return {
          status: 409,
          body: {
            codigo: 'TELEFONO_EN_USO',
            mensaje: 'Este teléfono ya está registrado en otro paciente.',
            campos: { telefono: 'Este teléfono ya está registrado en otro paciente.' },
          },
        };
      }
      return { status: 200, body: { paciente: patient } };
    });
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9998887777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este teléfono ya está registrado en otro paciente.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveFocus();
  });

  it('conserva los datos ante una falla de red (CA-3.2-06) y reintenta', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/validaciones')) return json(200, { disponible: true });
      if ((init as RequestInit)?.method !== 'PATCH') return json(200, { paciente: patient });
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return json(200, {
        codigo: 'PACIENTE_ACTUALIZADO',
        paciente: { ...patient, telefono: '9995554444', version: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9995554444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText(/Tus datos siguen en el formulario/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('9995554444');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
  });

  it('un conflicto de versión reaplica mis cambios y señala lo que cambió la otra persona', async () => {
    let patchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/validaciones')) return json(200, { disponible: true });
      if ((init as RequestInit)?.method === 'PATCH') {
        patchCalls += 1;
        if (patchCalls === 1) {
          return json(409, {
            codigo: 'CONFLICTO_VERSION',
            mensaje: 'Conflicto',
            version_actual: 2,
          });
        }
        return json(200, {
          codigo: 'PACIENTE_ACTUALIZADO',
          paciente: {
            ...patient,
            telefono: '9991112222',
            correo: 'otra.pestana@gmail.com',
            version: 3,
          },
        });
      }
      // Primera consulta: perfil original. Segunda (tras el conflicto): la otra pestaña ya
      // cambió el correo.
      return json(200, {
        paciente:
          patchCalls === 0 ? patient : { ...patient, correo: 'otra.pestana@gmail.com', version: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText(/Otra persona actualizó este perfil mientras lo editabas/),
    ).toBeInTheDocument();
    expect(screen.getByText(/También cambió: Correo electrónico/)).toBeInTheDocument();
    // Mi cambio se conserva encima del perfil recargado.
    expect(screen.getByLabelText('Teléfono')).toHaveValue('9991112222');
    // Y el valor que cambió la otra persona ya está cargado.
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveValue('otra.pestana@gmail.com');

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(patchCalls).toBe(2);
  });

  it('un conflicto sin diferencias restantes se trata como éxito (respuesta perdida)', async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/validaciones')) return json(200, { disponible: true });
      if ((init as RequestInit)?.method === 'PATCH') {
        return json(409, { codigo: 'CONFLICTO_VERSION', mensaje: 'Conflicto', version_actual: 2 });
      }
      gets += 1;
      // La primera carga trae el perfil original; el GET de recarga tras el conflicto ya
      // muestra el cambio aplicado, porque la respuesta de aquel primer PATCH se perdió.
      return gets === 1
        ? json(200, { paciente: patient })
        : json(200, { paciente: { ...patient, telefono: '9991112222', version: 2 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9991112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(patchesTo(fetchMock)).toHaveLength(1); // no se reintentó un segundo PATCH
  });

  it('la respuesta del PATCH actualiza el detalle en caché sin volver a pedirlo (CA-3.2-04)', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/validaciones')) return { status: 200, body: { disponible: true } };
      if ((init as RequestInit)?.method === 'PATCH') {
        return {
          status: 200,
          body: {
            codigo: 'PACIENTE_ACTUALIZADO',
            paciente: { ...patient, telefono: '9991112222', correo: 'nuevo@gmail.com', version: 2 },
          },
        };
      }
      return { status: 200, body: { paciente: patient } };
    });
    renderPage(patient, 30_000);

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9991112222' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/), {
      target: { value: 'nuevo@gmail.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');

    const getsAlDetalleAntesDeNavegar = getsTo(fetchMock).length;

    // La navegación al perfil lee el detalle de la caché que dejó el PATCH, sin volver a
    // pedirlo al servidor (RNF 3.2.5, ADR-12).
    expect(await screen.findByRole('heading', { name: 'Perfil del paciente' })).toBeInTheDocument();
    expect(screen.getByText('Teléfono: 9991112222')).toBeInTheDocument();
    expect(screen.getByText('Correo: nuevo@gmail.com')).toBeInTheDocument();
    expect(getsTo(fetchMock)).toHaveLength(getsAlDetalleAntesDeNavegar);
  });

  it('pide confirmación al salir con cambios sin guardar', async () => {
    mockApi(() => ({ status: 200, body: { paciente: patient } }));
    renderPage();

    const telefono = await screen.findByLabelText('Teléfono');
    fireEvent.change(telefono, { target: { value: '9991112222' } });

    fireEvent.click(screen.getByRole('button', { name: patient.nombre_completo }));

    const dialog = screen.getByRole('dialog', { name: '¿Salir sin guardar?' });
    expect(within(dialog).getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
  });
});
