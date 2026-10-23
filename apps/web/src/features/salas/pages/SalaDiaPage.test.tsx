import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalaDiaPage } from './SalaDiaPage';
import { salasApi } from '../api';
import type { Disponibilidad } from '../types';

const mockDisponibilidad: Disponibilidad = {
  fecha: '2026-10-26',
  bloques: Array.from({ length: 20 }, (_, i) => ({
    inicio: new Date(Date.UTC(2026, 9, 26, 13, i * 30)).toISOString(),
    fin: new Date(Date.UTC(2026, 9, 26, 13, (i + 1) * 30)).toISOString(),
  })),
  salas: [
    {
      id: 'sala-1',
      nombre: 'Sala 1',
      activo: true,
      bloques: Array.from({ length: 20 }, (_, i) => ({
        inicio: new Date(Date.UTC(2026, 9, 26, 13, i * 30)).toISOString(),
        estado: i === 2 || i === 3 ? ('reservada' as const) : ('libre' as const),
        folio: i === 2 || i === 3 ? 'C26000001' : undefined,
      })),
      citas: [
        {
          id: 'cita-1',
          folio: 'C26000001',
          estado: 'Pendiente',
          inicio: '2026-10-26T14:00:00.000Z',
          fin: '2026-10-26T15:00:00.000Z',
          ini_minutos: 480, // 08:00
          fin_minutos: 540, // 09:00
          paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku' },
          terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez', activo: true },
          sala: { id: 'sala-1', nombre: 'Sala 1' },
        },
      ],
      total_citas: 1,
      bloques_ocupados: 2,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSalaDia(salaId = 'sala-1', fecha = '2026-10-26') {
  return render(
    <MemoryRouter initialEntries={[`/inicio/salas/${salaId}?fecha=${fecha}`]}>
      <Routes>
        <Route path="/inicio/salas/:id" element={<SalaDiaPage />} />
        <Route path="/inicio/salas" element={<div data-testid="salas-list" />} />
        <Route path="/inicio/citas" element={<div data-testid="citas-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SalaDiaPage (EDT 5.3.2 Estado de sala por día)', () => {
  it('renderiza el detalle de la sala, KPIs y los 20 bloques de 7:00 a 17:00 (CA-4.3-02)', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalaDia();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Sala 1' })).toBeInTheDocument();
      expect(screen.getByText(/Estado por día/i)).toBeInTheDocument();
    });

    // KPIs
    expect(screen.getAllByText('Reservada').length).toBe(2);
    expect(screen.getByText('de 20')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    // Bloque ocupado con cita
    expect(screen.getByText('08:00 – 09:00')).toBeInTheDocument();
    expect(screen.getByText('Valeria Ku')).toBeInTheDocument();
    expect(screen.getByText('C26000001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver cita' })).toBeInTheDocument();

    // Bloque libre
    expect(screen.getByText('07:00 – 07:30')).toBeInTheDocument();
    expect(screen.getByText('07:30 – 08:00')).toBeInTheDocument();
  });

  it('permite abrir el diálogo de detalle de cita al hacer clic en Ver cita', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalaDia();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ver cita' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ver cita' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Cita C26000001' })).toBeInTheDocument();
    expect(within(dialog).getByText('Valeria Ku')).toBeInTheDocument();
    expect(within(dialog).getByText('Victoria Méndez')).toBeInTheDocument();

    // Cerrar
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('permite regresar a la lista de salas con el enlace de regreso', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalaDia();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Salas/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Salas/i }));
    expect(screen.getByTestId('salas-list')).toBeInTheDocument();
  });
});
