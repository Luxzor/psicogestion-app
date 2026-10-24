import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { toInicioIso } from '../horario';
import { CITA_MENSAJES } from '../validation';
import { NuevaCitaPage } from './NuevaCitaPage';

/**
 * EDT 5.3.3. Pruebas de "Agendar cita", con el patrón de RegistroPacientePage.test.tsx:
 * vi.stubGlobal('fetch', ...) y MemoryRouter + UnsavedChangesProvider + QueryClientProvider.
 * salasApi.getDisponibilidad se simula por fetch, no por el módulo; no se toca ninguna prueba de
 * features/salas.
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

const FECHA = '2031-05-12'; // lunes lejano, sin filtros de domingo ni de pasado
const SALA_ID = 'sala-1';
const PACIENTE = {
  id: 'paciente-1',
  nombre_completo: 'Valeria Ku Escalante',
  telefono: '9996402218',
  edad: 17,
  activo: true,
};
const TERAPEUTA = {
  id: 'terapeuta-1',
  nombre_completo: 'Victoria Méndez Rosado',
  cedula_profesional: '7845213',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  foto_actualizada_en: null,
  activo: true,
};

const bloquesLibres = () =>
  Array.from({ length: 20 }, (_, i) => ({
    inicio: toInicioIso(FECHA, 420 + i * 30)!,
    estado: 'libre' as const,
  }));

const disponibilidad = () => ({
  fecha: FECHA,
  bloques: bloquesLibres().map((b) => ({ inicio: b.inicio, fin: b.inicio })),
  salas: [
    {
      id: SALA_ID,
      nombre: 'Sala A',
      activo: true,
      bloques: bloquesLibres(),
      citas: [],
      total_citas: 0,
      bloques_ocupados: 0,
    },
  ],
});

const citaCreada = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'cita-1',
  folio: 'C31000001',
  estado: 'Pendiente',
  inicio: toInicioIso(FECHA, 420),
  fin: toInicioIso(FECHA, 450),
  duracion_bloques: 1,
  paciente: { id: PACIENTE.id, nombre_completo: PACIENTE.nombre_completo },
  terapeuta: { id: TERAPEUTA.id, nombre_completo: TERAPEUTA.nombre_completo },
  sala: { id: SALA_ID, nombre: 'Sala A' },
  cancelada_en: null,
  fecha_registro: '2031-05-01',
  version: 1,
  confirmacion: { enviada: true, destino: 'v***@example.com' },
  ...overrides,
});

/** Responde las listas de pacientes/terapeutas y la disponibilidad; `onPost` decide el alta. */
function baseHandler(onPost: (init: RequestInit) => { status: number; body?: unknown }): Handler {
  return (url, init) => {
    if (url.includes('/api/v1/pacientes')) {
      return { status: 200, body: { datos: [PACIENTE], pagina: 1, tamano: 20, total: 1 } };
    }
    if (url.includes('/api/v1/terapeutas')) {
      return { status: 200, body: { datos: [TERAPEUTA], pagina: 1, tamano: 20, total: 1 } };
    }
    if (url.includes('/api/v1/salas/disponibilidad')) {
      return { status: 200, body: disponibilidad() };
    }
    if (url.endsWith('/api/v1/citas') && init.method === 'POST') {
      const result = onPost(init);
      // La API envuelve el alta en { codigo: 'CITA_REGISTRADA', cita }; los errores van tal cual.
      if (result.status >= 200 && result.status < 300) {
        return { status: result.status, body: { codigo: 'CITA_REGISTRADA', cita: result.body } };
      }
      return result;
    }
    return { status: 500 };
  };
}

function CitasListStub() {
  return <h1>Citas</h1>;
}
function DetalleStub() {
  const { pathname } = useLocation();
  return <h1>Detalle de {pathname}</h1>;
}
/** Expone el contexto compartido para comprobar que la pantalla bloquea el cierre de sesión. */
function UnsavedFlag() {
  const { hasUnsavedChanges } = useUnsavedChanges();
  return <p data-testid="unsaved-flag">{String(hasUnsavedChanges)}</p>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/inicio/citas/nueva']}>
        <UnsavedChangesProvider>
          <UnsavedFlag />
          <Routes>
            <Route path="/inicio/citas" element={<CitasListStub />} />
            <Route
              path="/inicio/citas/nueva"
              element={<NuevaCitaPage session={{ token: 'token-de-prueba' }} />}
            />
            <Route path="/inicio/citas/:id" element={<DetalleStub />} />
          </Routes>
        </UnsavedChangesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Paciente, terapeuta, sala y el primer horario libre; deja el formulario listo para enviar. */
async function completarFormulario() {
  // La fecha por omisión es "hoy" real; se cambia a FECHA para que los bloques de la
  // disponibilidad simulada (fechados en FECHA) no aparezcan como ya pasados.
  fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: FECHA } });

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
  const [primeraHora] = within(listbox).getAllByRole('option');
  fireEvent.click(primeraHora);
}

async function completarYRevisar() {
  await completarFormulario();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar y agendar' }));
}

async function completarYConfirmar() {
  await completarYRevisar();
  const dialog = await screen.findByRole('dialog', { name: '¿Confirmar los datos de la cita?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('agendar cita (RF 5.1.1-5.1.15, RF 2.3.5)', () => {
  it('los selectores de paciente y terapeuta solo listan activos (RF 2.3.5, CA-5.1-03)', async () => {
    const fetchMock = mockApi(baseHandler(() => ({ status: 201, body: citaCreada() })));
    renderPage();

    fireEvent.focus(screen.getByLabelText('Paciente'));
    fireEvent.focus(screen.getByLabelText('Terapeuta'));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/pacientes'))).toBe(
        true,
      ),
    );
    const pacientesUrl = String(
      fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/pacientes'))?.[0],
    );
    const terapeutasUrl = String(
      fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/terapeutas'))?.[0],
    );
    // Ninguna llamada pide inactivos: el servidor ya filtra a activos por omisión.
    expect(pacientesUrl).not.toContain('estado=inactivos');
    expect(terapeutasUrl).not.toContain('estado=inactivos');
  });

  it('el estatus es fijo, de solo lectura, siempre Pendiente (RF 5.1.5, RF 5.1.7)', async () => {
    mockApi(baseHandler(() => ({ status: 201, body: citaCreada() })));
    renderPage();

    const resumen = screen.getByText('Resumen de la cita').closest('aside')!;
    expect(within(resumen).getByText('Pendiente')).toBeInTheDocument();
    expect(within(resumen).queryByRole('combobox', { name: /estatus/i })).not.toBeInTheDocument();
    expect(within(resumen).queryByRole('button', { name: /cancelada|vencida/i })).toBeNull();
  });

  it('el diálogo de confirmación abre con el foco en Cancelar (RF 5.1.10)', async () => {
    mockApi(baseHandler(() => ({ status: 201, body: citaCreada() })));
    renderPage();
    await completarYRevisar();

    const dialog = await screen.findByRole('dialog', { name: '¿Confirmar los datos de la cita?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('muestra el folio y el mensaje de éxito tal como lo devuelve la API (RF 5.1.13)', async () => {
    mockApi(baseHandler(() => ({ status: 201, body: citaCreada({ folio: 'C31000118' }) })));
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText('Cita agendada con éxito. Folio C31000118.'),
    ).toBeInTheDocument();
  });

  it('avisa que se envió la confirmación con el correo enmascarado (CA-5.1-05)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 201,
        body: citaCreada({ confirmacion: { enviada: true, destino: 'v***@example.com' } }),
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText('Se envió la confirmación a v***@example.com.'),
    ).toBeInTheDocument();
  });

  it('avisa que no se envió la confirmación por falta de correo (RF 5.1.15, CA-5.1-05)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 201,
        body: citaCreada({ confirmacion: { enviada: false, motivo: 'sin_correo' } }),
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText(
        'El paciente no tiene correo registrado: no se envió la confirmación.',
      ),
    ).toBeInTheDocument();
  });

  it('avisa que la cita se guardó pero falló el envío del correo (ADR-22, CA-5.1-05)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 201,
        body: citaCreada({ confirmacion: { enviada: false, motivo: 'fallo_envio' } }),
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText('La cita se guardó, pero no se pudo enviar la confirmación.'),
    ).toBeInTheDocument();
  });

  it('en un conflicto de sala, avisa y conserva paciente, terapeuta y fecha (CA-5.1-04)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 409,
        body: {
          codigo: 'SALA_OCUPADA',
          mensaje: CITA_MENSAJES.SALA_OCUPADA,
          campos: { inicio: CITA_MENSAJES.SALA_OCUPADA },
        },
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText(CITA_MENSAJES.SALA_OCUPADA, { selector: '.notice__body' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Valeria Ku Escalante');
    expect(screen.getByLabelText('Terapeuta')).toHaveValue('Victoria Méndez Rosado');
    expect(screen.getByLabelText('Fecha')).toHaveValue(FECHA);
  });

  it('en un conflicto de terapeuta, avisa y conserva los demás datos (CA-5.1-04)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 409,
        body: { codigo: 'TERAPEUTA_OCUPADO', mensaje: CITA_MENSAJES.TERAPEUTA_OCUPADO },
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText(CITA_MENSAJES.TERAPEUTA_OCUPADO, { selector: '.notice__body' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Valeria Ku Escalante');
  });

  it('en un conflicto de paciente, avisa y conserva los demás datos (CA-5.1-04)', async () => {
    mockApi(
      baseHandler(() => ({
        status: 409,
        body: { codigo: 'PACIENTE_OCUPADO', mensaje: CITA_MENSAJES.PACIENTE_OCUPADO },
      })),
    );
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText(CITA_MENSAJES.PACIENTE_OCUPADO, { selector: '.notice__body' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Terapeuta')).toHaveValue('Victoria Méndez Rosado');
  });

  it('conserva los datos capturados ante una falla de red y reintenta con la misma llave (CA-5.1-06)', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/pacientes')) {
        return json(200, { datos: [PACIENTE], pagina: 1, tamano: 20, total: 1 });
      }
      if (url.includes('/api/v1/terapeutas')) {
        return json(200, { datos: [TERAPEUTA], pagina: 1, tamano: 20, total: 1 });
      }
      if (url.includes('/api/v1/salas/disponibilidad')) {
        return json(200, disponibilidad());
      }
      if (url.endsWith('/api/v1/citas') && init?.method === 'POST') {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return json(201, { codigo: 'CITA_REGISTRADA', cita: citaCreada() });
      }
      return json(500);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await completarYConfirmar();

    expect(
      await screen.findByText('No se pudo guardar. Tus datos se conservan; reintenta.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Valeria Ku Escalante');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText(/Cita agendada con éxito/)).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          String(url).endsWith('/api/v1/citas') && (init as RequestInit)?.method === 'POST',
      )
      .map(([, init]) => new Headers((init as RequestInit)?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('bloquea el cierre de sesión mientras haya datos capturados sin guardar', async () => {
    mockApi(baseHandler(() => ({ status: 201, body: citaCreada() })));
    renderPage();

    expect(screen.getByTestId('unsaved-flag')).toHaveTextContent('false');

    fireEvent.focus(screen.getByLabelText('Paciente'));
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Valeria' } });
    fireEvent.click(await screen.findByText('Valeria Ku Escalante', {}, { timeout: 2000 }));

    expect(screen.getByTestId('unsaved-flag')).toHaveTextContent('true');
  });

  it('pide confirmación antes de salir con datos capturados, igual que al cancelar', async () => {
    mockApi(baseHandler(() => ({ status: 201, body: citaCreada() })));
    renderPage();
    fireEvent.focus(screen.getByLabelText('Paciente'));
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Valeria' } });
    fireEvent.click(await screen.findByText('Valeria Ku Escalante', {}, { timeout: 2000 }));

    fireEvent.click(screen.getByRole('button', { name: 'Citas' }));

    const dialog = await screen.findByRole('dialog', { name: '¿Salir sin guardar?' });
    expect(within(dialog).getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
  });
});
