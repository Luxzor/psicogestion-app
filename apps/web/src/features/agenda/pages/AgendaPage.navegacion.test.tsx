import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../auth/types';
import { AgendaPage } from './AgendaPage';

/**
 * RF 6.1.2, RF 6.2 (EDT 6.3). Navegación de la agenda con las flechas anterior y siguiente en las
 * tres vistas: el título del rango y la consulta de citas deben seguir a la cuadrícula. Defecto
 * corregido en bugfix/agenda-navegacion-duracion-detalle: en Semana y Mes las flechas movían el
 * calendario pero no actualizaban `fecha`, así que el título y la consulta se quedaban en el
 * rango anterior.
 */
const session: Session = {
  token: 'mock-token',
  user: { nombre_completo: 'Julia Morales Cetina', rol: 'administrador' },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function mockApi() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/v1/citas/agenda')) return json({ citas: [] });
    if (url.includes('/api/v1/salas?estado=activas')) return json({ salas: [] });
    if (url.includes('/api/v1/terapeutas')) {
      return json({ datos: [], total: 0, pagina: 1, tamano: 100 });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Fechas "desde" con las que la agenda consultó citas, en orden. */
const consultasDesde = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes('/api/v1/citas/agenda'))
    .map((url) => new URL(url, 'http://localhost').searchParams.get('desde'));

function renderAgenda() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgendaPage session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgendaPage: navegación con flechas (RF 6.1.2)', () => {
  beforeEach(() => {
    // Jueves 5 de noviembre de 2026, 06:00 en Mérida.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('en la vista Semana, "Semana siguiente" y "Semana anterior" cambian el título y la consulta', async () => {
    const fetchMock = mockApi();
    renderAgenda();

    expect(await screen.findAllByText('Semana del 2 al 7 de noviembre de 2026')).not.toHaveLength(
      0,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    await waitFor(() =>
      expect(screen.getAllByText('Semana del 9 al 14 de noviembre de 2026')).not.toHaveLength(0),
    );
    await waitFor(() => expect(consultasDesde(fetchMock)).toContain('2026-11-09'));

    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await waitFor(() =>
      expect(screen.getAllByText('Semana del 2 al 7 de noviembre de 2026')).not.toHaveLength(0),
    );
  });

  it('en la vista Semana, avanzar dos veces consulta cada semana', async () => {
    const fetchMock = mockApi();
    renderAgenda();
    await screen.findAllByText('Semana del 2 al 7 de noviembre de 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    await waitFor(() => expect(consultasDesde(fetchMock)).toContain('2026-11-09'));
    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    await waitFor(() => expect(consultasDesde(fetchMock)).toContain('2026-11-16'));
    expect(screen.getAllByText('Semana del 16 al 21 de noviembre de 2026')).not.toHaveLength(0);
  });

  it('en la vista Mes, "Mes siguiente" cambia el título y consulta el mes nuevo', async () => {
    const fetchMock = mockApi();
    renderAgenda();
    await screen.findAllByText('Semana del 2 al 7 de noviembre de 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    await waitFor(() => expect(screen.getAllByText('Noviembre de 2026')).not.toHaveLength(0));

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await waitFor(() => expect(screen.getAllByText('Diciembre de 2026')).not.toHaveLength(0));
    await waitFor(() =>
      expect(
        consultasDesde(fetchMock).some(
          (d) => d?.startsWith('2026-11-30') || d?.startsWith('2026-12'),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() => expect(screen.getAllByText('Noviembre de 2026')).not.toHaveLength(0));
  });

  it('en la vista Día, "Día siguiente" consulta el día nuevo', async () => {
    const fetchMock = mockApi();
    renderAgenda();
    await screen.findAllByText('Semana del 2 al 7 de noviembre de 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    await waitFor(() => expect(consultasDesde(fetchMock)).toContain('2026-11-06'));
  });

  it('"Hoy" regresa a la semana actual después de avanzar', async () => {
    mockApi();
    renderAgenda();
    await screen.findAllByText('Semana del 2 al 7 de noviembre de 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    await waitFor(() =>
      expect(screen.getAllByText('Semana del 9 al 14 de noviembre de 2026')).not.toHaveLength(0),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    await waitFor(() =>
      expect(screen.getAllByText('Semana del 2 al 7 de noviembre de 2026')).not.toHaveLength(0),
    );
  });
});
