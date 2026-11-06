import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import type { DashboardSummary } from '../../citas/types';
import { DashboardHomePage } from './DashboardHomePage';

const sessionMock: Session = {
  token: 'mock-token',
  user: {
    nombre_completo: 'Julia Morales Cetina',
    rol: 'administrador',
  },
};

const mockSummary: DashboardSummary = {
  citas_hoy: [
    {
      id: 'cita-1',
      folio: 'C26000001',
      estado: 'Pendiente',
      inicio: '2026-11-05T15:00:00Z', // 09:00 en Mérida
      fin: '2026-11-05T16:00:00Z', // 10:00 en Mérida
      duracion_bloques: 2,
      paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku Escalante' },
      terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado' },
      sala: { id: 'sala-1', nombre: 'Sala 1' },
      cancelada_en: null,
      fecha_registro: '2026-11-01',
      version: 1,
    },
    {
      id: 'cita-2',
      folio: 'C26000002',
      estado: 'Pendiente',
      inicio: '2026-11-05T17:00:00Z', // 11:00 en Mérida
      fin: '2026-11-05T18:00:00Z', // 12:00 en Mérida
      duracion_bloques: 2,
      paciente: { id: 'pac-2', nombre_completo: 'David Pérez Novelo' },
      terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado' },
      sala: { id: 'sala-2', nombre: 'Sala 2' },
      cancelada_en: null,
      fecha_registro: '2026-11-01',
      version: 1,
    },
  ],
  citas_pendientes_hoy: 2,
  citas_pendientes_total: 12,
  salas_totales: 4,
  salas_libres_hoy: 2,
  pacientes_totales: 28,
  terapeutas_activos: 6,
};

function mockApi(summary = mockSummary) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/v1/citas/dashboard/resumen')) {
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/salas?estado=activas')) {
      return new Response(
        JSON.stringify({
          salas: [
            { id: 'sala-1', nombre: 'Sala 1', activo: true, version: 1 },
            { id: 'sala-2', nombre: 'Sala 2', activo: true, version: 1 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <MemoryRouter>
          <DashboardHomePage session={sessionMock} />
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );
}

describe('DashboardHomePage (RF 7.1.1, RF 7.2.1–7.2.6)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('muestra el saludo personalizado con el primer nombre y la clínica', async () => {
    mockApi();
    renderComponent();

    expect(
      await screen.findByRole('heading', { level: 1, name: /¡Hola, Julia!/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Clínica SEAP/i)).toBeInTheDocument();
  });

  it('muestra los 4 accesos rápidos con sus contadores y enlaces (RF 7.2)', async () => {
    mockApi();
    renderComponent();

    const cardCitas = await screen.findByRole('link', { name: /Citas[\s\S]*12[\s\S]*pendientes/i });
    expect(cardCitas).toHaveAttribute('href', '/inicio/citas');

    const cardSalas = screen.getByRole('link', { name: /Salas[\s\S]*4[\s\S]*registradas/i });
    expect(cardSalas).toHaveAttribute('href', '/inicio/salas');

    const cardPacientes = screen.getByRole('link', {
      name: /Pacientes[\s\S]*28[\s\S]*registrados/i,
    });
    expect(cardPacientes).toHaveAttribute('href', '/inicio/pacientes');

    const cardTerapeutas = screen.getByRole('link', { name: /Terapeutas[\s\S]*6[\s\S]*activos/i });
    expect(cardTerapeutas).toHaveAttribute('href', '/inicio/terapeutas');
  });

  it('renderiza la lista de citas de hoy con pacientes, terapeutas y salas', async () => {
    mockApi();
    renderComponent();

    expect(await screen.findByText('Valeria Ku Escalante')).toBeInTheDocument();
    expect(screen.getByText('David Pérez Novelo')).toBeInTheDocument();
    expect(screen.getByText('2 pendientes de 2 programadas')).toBeInTheDocument();

    const verEnCitasBtn = screen.getByRole('button', { name: /Ver en Citas/i });
    expect(verEnCitasBtn).toBeInTheDocument();
  });

  it('abre el diálogo de detalle al hacer clic en una fila de cita', async () => {
    mockApi();
    renderComponent();

    const fila = await screen.findByRole('button', { name: /Ver cita C26000001/i });
    fireEvent.click(fila);

    const dialog = await screen.findByRole('dialog', { name: /Cita C26000001/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Valeria Ku Escalante')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay citas para hoy', async () => {
    mockApi({
      ...mockSummary,
      citas_hoy: [],
      citas_pendientes_hoy: 0,
    });
    renderComponent();

    expect(await screen.findByText('No hay citas para hoy')).toBeInTheDocument();
    expect(
      screen.getByText('Cuando se agende una cita para hoy aparecerá aquí.'),
    ).toBeInTheDocument();
  });

  it('cuenta con el botón flotante (FAB) para agendar cita', () => {
    mockApi();
    renderComponent();

    const fab = screen.getByRole('link', { name: /Agendar cita/i });
    expect(fab).toHaveAttribute('href', '/inicio/citas/nueva');
  });
});
