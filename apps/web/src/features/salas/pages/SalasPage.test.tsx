import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalasPage } from './SalasPage';
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
          ini_minutos: 840,
          fin_minutos: 900,
          paciente: { id: 'pac-1', nombre_completo: 'Valeria Ku' },
          terapeuta: { id: 'ter-1', nombre_completo: 'Victoria Méndez', activo: true },
          sala: { id: 'sala-1', nombre: 'Sala 1' },
        },
      ],
      total_citas: 1,
      bloques_ocupados: 2,
    },
    {
      id: 'sala-2',
      nombre: 'Sala 2',
      activo: true,
      bloques: Array.from({ length: 20 }, (_, i) => ({
        inicio: new Date(Date.UTC(2026, 9, 26, 13, i * 30)).toISOString(),
        estado: 'libre' as const,
      })),
      citas: [],
      total_citas: 0,
      bloques_ocupados: 0,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSalasPage() {
  return render(
    <MemoryRouter initialEntries={['/inicio/salas']}>
      <Routes>
        <Route path="/inicio/salas" element={<SalasPage />} />
        <Route path="/inicio/salas/:id" element={<div data-testid="sala-dia-view" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SalasPage (EDT 5.3.1 y EDT 5.3.2 Visualización de salas)', () => {
  it('renderiza la lista de salas con su estado libre o reservada y bloques (RF 4.3.1, RF 4.3.3)', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalasPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Salas' })).toBeInTheDocument();
    expect(screen.getByText('Cargando...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('2 salas registradas')).toBeInTheDocument();
      expect(screen.getByText('Sala 1')).toBeInTheDocument();
      expect(screen.getByText('Sala 2')).toBeInTheDocument();
    });

    // Sala 1 tiene 2 bloques reservados
    expect(screen.getByText('Reservada')).toBeInTheDocument();
    expect(screen.getByText('1 cita · 2 de 20 bloques')).toBeInTheDocument();

    // Sala 2 está libre
    expect(screen.getByText('Libre')).toBeInTheDocument();
    expect(screen.getByText('Sin citas')).toBeInTheDocument();
  });

  it('permite cambiar la fecha del estado del día usando el selector y botones de navegación', async () => {
    const getDispSpy = vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalasPage();

    await waitFor(() => {
      expect(screen.getByText('2 salas registradas')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: 'Día siguiente' });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(getDispSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('navega a la vista de estado por día al hacer clic en una fila de la sala (RF 4.3.2)', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalasPage();

    await waitFor(() => {
      expect(screen.getByText('Sala 1')).toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /Ver el día de Sala 1/i });
    fireEvent.click(row);

    expect(screen.getByTestId('sala-dia-view')).toBeInTheDocument();
  });

  it('muestra estado vacío cuando no hay salas registradas', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue({
      fecha: '2026-10-26',
      bloques: [],
      salas: [],
    });

    renderSalasPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Aún no hay salas' })).toBeInTheDocument();
      expect(
        screen.getByText(/Usa “Agregar sala” para registrar la primera/i),
      ).toBeInTheDocument();
    });
  });

  it('muestra mensaje de error con botón de reintentar si falla la conexión (RNF 4.2.5)', async () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockRejectedValue(new Error('Network error'));

    renderSalasPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No pudimos cargar las salas' })).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Reintentar/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('abre el diálogo de registro de sala al hacer clic en Agregar sala', () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalasPage();

    const addButtons = screen.getAllByRole('button', { name: /Agregar sala/i });
    fireEvent.click(addButtons[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agregar sala' })).toBeInTheDocument();
  });

  it('abre el diálogo de eliminación de sala al hacer clic en Eliminar sala', () => {
    vi.spyOn(salasApi, 'getDisponibilidad').mockResolvedValue(mockDisponibilidad);

    renderSalasPage();

    const delButton = screen.getByRole('button', { name: /Eliminar sala/i });
    fireEvent.click(delButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Eliminar sala' })).toBeInTheDocument();
  });
});
