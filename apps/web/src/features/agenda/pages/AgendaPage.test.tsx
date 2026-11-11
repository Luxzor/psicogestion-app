import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../auth/types';
import type { Cita } from '../../citas/types';
import { AgendaPage } from './AgendaPage';

const sessionMock: Session = {
  token: 'mock-token',
  user: {
    nombre_completo: 'Julia Morales Cetina',
    rol: 'administrador',
  },
};

const mockCitas: Cita[] = [
  {
    id: 'cita-1',
    folio: 'C26000001',
    estado: 'Pendiente',
    inicio: '2026-11-05T15:00:00Z', // 09:00 Mérida
    fin: '2026-11-05T16:00:00Z', // 10:00 Mérida
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
    estado: 'Vencida',
    inicio: '2026-11-05T17:00:00Z', // 11:00 Mérida
    fin: '2026-11-05T18:00:00Z', // 12:00 Mérida
    duracion_bloques: 2,
    paciente: { id: 'pac-2', nombre_completo: 'David Pérez Novelo' },
    terapeuta: { id: 'ter-2', nombre_completo: 'Esteban Solís Lara' },
    sala: { id: 'sala-2', nombre: 'Sala 2' },
    cancelada_en: null,
    fecha_registro: '2026-11-01',
    version: 1,
  },
];

function mockApi(citas = mockCitas) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/v1/citas/agenda')) {
      return new Response(JSON.stringify({ citas }), {
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
    if (url.includes('/api/v1/terapeutas')) {
      return new Response(
        JSON.stringify({
          datos: [
            { id: 'ter-1', nombre_completo: 'Victoria Méndez Rosado', activo: true },
            { id: 'ter-2', nombre_completo: 'Esteban Solís Lara', activo: true },
          ],
          total: 2,
          pagina: 1,
          tamano: 100,
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
      <MemoryRouter>
        <AgendaPage session={sessionMock} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgendaPage (RF 6.1, RF 6.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renderiza la barra de navegación, rango y selector de vistas (RF 6.1.2)', async () => {
    mockApi();
    renderComponent();

    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Día' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mes' })).toBeInTheDocument();
  });

  it('permite alternar vistas entre Día, Semana y Mes (RNF 6.1)', async () => {
    mockApi();
    renderComponent();

    const btnDia = await screen.findByRole('button', { name: 'Día' });
    const btnMes = screen.getByRole('button', { name: 'Mes' });

    fireEvent.click(btnDia);
    expect(btnDia).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(btnMes);
    expect(btnMes).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra los filtros de salas con sus nombres y contadores (RF 6.1.1)', async () => {
    mockApi();
    renderComponent();

    const salaGroup = await screen.findByRole('group', { name: 'Salas' });
    const chipSala1 = await within(salaGroup).findByRole('button', { name: /Sala 1/i });
    const chipSala2 = within(salaGroup).getByRole('button', { name: /Sala 2/i });

    expect(chipSala1).toBeInTheDocument();
    expect(chipSala2).toBeInTheDocument();

    // Toggle ocultar sala
    fireEvent.click(chipSala1);
    expect(chipSala1).toHaveAttribute('aria-pressed', 'false');

    // Botón Quitar filtros aparece al filtrar
    const btnQuitar = screen.getByRole('button', { name: 'Quitar filtros' });
    expect(btnQuitar).toBeInTheDocument();
    fireEvent.click(btnQuitar);
    expect(chipSala1).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra los 20 horarios de 30 minutos de 07:00 a 17:00 en Horarios del día (RF 6.2.2, RF 6.2.3)', async () => {
    mockApi();
    renderComponent();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Horarios del día' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /Horarios de 30 minutos/i })).toBeInTheDocument();
    expect(screen.getAllByText('07:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('16:30').length).toBeGreaterThan(0);
  });

  it('muestra aviso si se navega a domingo: la clínica no abre los domingos', async () => {
    mockApi();
    renderComponent();

    const inputFecha = await screen.findByLabelText('Ir a una fecha');
    // 2026-11-08 es domingo
    fireEvent.change(inputFecha, { target: { value: '2026-11-08' } });

    expect(await screen.findByText(/La clínica no abre los domingos/i)).toBeInTheDocument();
  });

  it('abre el diálogo de detalle al hacer clic en una cita ocupada del panel lateral', async () => {
    mockApi();
    renderComponent();

    // El 2026-11-05 tiene la cita-1 en Sala 1
    const chips = await screen.findAllByRole('button', { name: /Valeria Ku Escalante/i });
    expect(chips.length).toBeGreaterThan(0);
    fireEvent.click(chips[0]);

    const dialog = await screen.findByRole('dialog', { name: /Cita C26000001/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Valeria Ku Escalante')).toBeInTheDocument();
  });

  it('permite imprimir la vista actual invocando window.print (RF 6.2.4)', async () => {
    mockApi();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderComponent();

    const btnImprimir = await screen.findByRole('button', { name: /Imprimir agenda/i });
    fireEvent.click(btnImprimir);

    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('cuenta con el botón flotante (FAB) para agendar cita', () => {
    mockApi();
    renderComponent();

    const fab = screen.getByRole('link', { name: /Agendar cita/i });
    expect(fab).toHaveAttribute('href', '/inicio/citas/nueva');
  });
});
