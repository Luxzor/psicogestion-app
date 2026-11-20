import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

describe('DatePicker (Desactivación de domingos y UX)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renderiza el input con el valor inicial y abre el calendario al hacer clic en el botón', () => {
    const handleChange = vi.fn();
    render(
      <div>
        <label htmlFor="test-date">Fecha</label>
        <DatePicker id="test-date" value="2026-11-05" onChange={handleChange} />
      </div>,
    );

    const input = screen.getByLabelText('Fecha');
    expect(input).toHaveValue('2026-11-05');

    // Abre el calendario
    const toggle = screen.getByRole('button', { name: 'Abrir calendario' });
    fireEvent.click(toggle);

    // Debe mostrarse el popover con el mes
    expect(screen.getByRole('dialog', { name: 'Calendario de fecha' })).toBeInTheDocument();
    expect(screen.getByText('Noviembre 2026')).toBeInTheDocument();
  });

  it('desactiva los domingos para que no se les pueda hacer clic', () => {
    const handleChange = vi.fn();
    render(
      <div>
        <label htmlFor="test-date">Fecha</label>
        <DatePicker
          id="test-date"
          value="2026-11-05" // Jueves 5 de nov de 2026
          disableSundays={true}
          onChange={handleChange}
        />
      </div>,
    );

    // Abrir popover
    fireEvent.click(screen.getByRole('button', { name: 'Abrir calendario' }));

    // En noviembre de 2026, los domingos son 1, 8, 15, 22, 29
    // Buscamos el botón del día 8 (domingo)
    const domingo8 = screen.getByRole('button', { name: /^8 de Noviembre de 2026/i });
    expect(domingo8).toBeDisabled();
    expect(domingo8).toHaveAttribute('aria-disabled', 'true');
    expect(domingo8).toHaveClass('dp-cell--sunday');

    // Al intentar hacer clic en el domingo desactivado, no debe llamar a onChange
    fireEvent.click(domingo8);
    expect(handleChange).not.toHaveBeenCalled();

    // Verificamos que un día hábil como el 6 (viernes) esté habilitado
    const viernes6 = screen.getByRole('button', { name: /^6 de Noviembre de 2026/i });
    expect(viernes6).not.toBeDisabled();
    fireEvent.click(viernes6);

    // Debe seleccionar la fecha y cerrar el popover
    expect(handleChange).toHaveBeenCalledWith('2026-11-06');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('permite cambiar de mes con los botones de navegación', () => {
    const handleChange = vi.fn();
    render(
      <div>
        <label htmlFor="test-date">Fecha</label>
        <DatePicker id="test-date" value="2026-11-05" onChange={handleChange} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir calendario' }));
    expect(screen.getByText('Noviembre 2026')).toBeInTheDocument();

    // Navegar al mes siguiente
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByText('Diciembre 2026')).toBeInTheDocument();

    // Navegar de regreso
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByText('Noviembre 2026')).toBeInTheDocument();
  });

  it('permite escribir o cambiar manualmente el valor en el input', () => {
    const handleChange = vi.fn();
    render(
      <div>
        <label htmlFor="test-date">Fecha</label>
        <DatePicker id="test-date" value="2026-11-05" onChange={handleChange} />
      </div>,
    );

    const input = screen.getByLabelText('Fecha');
    fireEvent.change(input, { target: { value: '2026-11-12' } });

    expect(handleChange).toHaveBeenCalledWith('2026-11-12');
  });
});
