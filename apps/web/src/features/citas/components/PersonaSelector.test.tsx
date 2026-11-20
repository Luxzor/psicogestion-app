import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patientsApi } from '../../pacientes/api';
import { therapistsApi } from '../../terapeutas/api';
import { PersonaSelector, type PersonaOption } from './PersonaSelector';

/** EDT 5.3.3. Combo de paciente/terapeuta con búsqueda en vivo (RF 2.3.5, CA-5.1-03). */
const pacientes = [
  { id: 'p1', nombre_completo: 'Ana Pérez' },
  { id: 'p2', nombre_completo: 'Beto Ruiz' },
];
const terapeutas = [
  { id: 't1', nombre_completo: 'Carla Díaz', cedula_profesional: '1234567' },
  { id: 't2', nombre_completo: 'Dario Soto', cedula_profesional: '7654321' },
];

const pagina = (datos: unknown[]) => ({ datos, pagina: 1, tamano: 20, total: datos.length });

describe('PersonaSelector', () => {
  const onChange = vi.fn();
  const onBlur = vi.fn();
  let listaPacientes: ReturnType<typeof vi.spyOn>;
  let listaTerapeutas: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    listaPacientes = vi.spyOn(patientsApi, 'list').mockResolvedValue(pagina(pacientes) as never);
    listaTerapeutas = vi
      .spyOn(therapistsApi, 'list')
      .mockResolvedValue(pagina(terapeutas) as never);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function montar(props: Partial<Parameters<typeof PersonaSelector>[0]> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <PersonaSelector
          id="paciente"
          tipo="paciente"
          label="Paciente"
          placeholder="Busca un paciente"
          value={null}
          onChange={onChange}
          onBlur={onBlur}
          accessToken="t"
          {...props}
        />
      </QueryClientProvider>,
    );
  }

  const campo = () => screen.getByRole('combobox');

  it('empieza cerrado y con el placeholder', () => {
    montar();
    expect(campo()).toHaveAttribute('aria-expanded', 'false');
    expect(campo()).toHaveAttribute('placeholder', 'Busca un paciente');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('al enfocar se abre y lista los pacientes activos', async () => {
    montar();
    fireEvent.focus(campo());
    expect(campo()).toHaveAttribute('aria-expanded', 'true');
    const opciones = await screen.findAllByRole('option');
    expect(opciones.map((o) => o.textContent)).toEqual(['Ana Pérez', 'Beto Ruiz']);
    expect(await screen.findByText('2 pacientes')).toBeInTheDocument();
  });

  it('con terapeutas muestra la cédula para distinguir homónimos', async () => {
    montar({ id: 'terapeuta', tipo: 'terapeuta', label: 'Terapeuta' });
    fireEvent.focus(campo());
    const opciones = await screen.findAllByRole('option');
    expect(opciones[0]).toHaveTextContent('Carla Díaz');
    expect(opciones[0]).toHaveTextContent('Cédula: 1234567');
    expect(await screen.findByText('2 terapeutas')).toBeInTheDocument();
  });

  it('al elegir una opción informa la persona y se cierra', async () => {
    montar();
    act(() => campo().focus());
    fireEvent.click(await screen.findByRole('option', { name: /Beto Ruiz/ }));
    expect(onChange).toHaveBeenCalledWith({ id: 'p2', nombre_completo: 'Beto Ruiz', activo: true });
    expect(campo()).toHaveAttribute('aria-expanded', 'false');
  });

  it('cerrado muestra el nombre del valor elegido y ofrece quitarlo', () => {
    const value: PersonaOption = { id: 'p1', nombre_completo: 'Ana Pérez', activo: true };
    montar({ value });
    expect(campo()).toHaveValue('Ana Pérez');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar paciente' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('sin valor no ofrece el botón de quitar', () => {
    montar();
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument();
  });

  it('busca con una pausa de 300 ms y manda el texto como q', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    listaPacientes.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(campo(), { target: { value: ' Ana ' } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(listaPacientes).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(listaPacientes).toHaveBeenCalledWith(
        { pagina: 1, tamano: 20, q: 'Ana' },
        't',
        expect.anything(),
      ),
    );
  });

  it('sin resultados para la búsqueda lo dice con el texto buscado', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    listaPacientes.mockResolvedValue(pagina([]) as never);
    fireEvent.change(campo(), { target: { value: 'Zzz' } });
    expect(
      (await screen.findAllByText('No encontramos ningún paciente con "Zzz".')).length,
    ).toBeGreaterThan(0);
  });

  it('sin personas registradas lo indica', async () => {
    listaPacientes.mockResolvedValue(pagina([]) as never);
    montar();
    fireEvent.focus(campo());
    expect(
      (await screen.findAllByText('No hay pacientes activos registrados.')).length,
    ).toBeGreaterThan(0);
  });

  it('sin terapeutas registrados usa el texto de terapeutas', async () => {
    listaTerapeutas.mockResolvedValue(pagina([]) as never);
    montar({ id: 'terapeuta', tipo: 'terapeuta', label: 'Terapeuta' });
    fireEvent.focus(campo());
    expect(
      (await screen.findAllByText('No hay terapeutas activos registrados.')).length,
    ).toBeGreaterThan(0);
  });

  it('si la consulta falla muestra el error de conexión', async () => {
    listaPacientes.mockRejectedValue(new Error('red'));
    montar();
    fireEvent.focus(campo());
    expect(
      (await screen.findAllByText('No pudimos cargar la lista. Revisa tu conexión.')).length,
    ).toBeGreaterThan(0);
  });

  it('el teclado navega con flechas, elige con Enter y cierra con Escape', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    fireEvent.keyDown(campo(), { key: 'ArrowDown' });
    fireEvent.keyDown(campo(), { key: 'ArrowDown' });
    expect(campo()).toHaveAttribute('aria-activedescendant', 'paciente-o1');
    fireEvent.keyDown(campo(), { key: 'ArrowUp' });
    expect(campo()).toHaveAttribute('aria-activedescendant', 'paciente-o0');
    fireEvent.keyDown(campo(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ id: 'p1', nombre_completo: 'Ana Pérez', activo: true });

    fireEvent.keyDown(campo(), { key: 'ArrowDown' });
    expect(campo()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(campo(), { key: 'Escape' });
    expect(campo()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab cierra la lista', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    fireEvent.keyDown(campo(), { key: 'Tab' });
    expect(campo()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Enter sin opción activa no elige nada', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    fireEvent.keyDown(campo(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('un clic fuera lo cierra', async () => {
    montar();
    fireEvent.focus(campo());
    await screen.findAllByRole('option');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(campo()).toHaveAttribute('aria-expanded', 'false'));
  });

  it('deshabilitado no se abre ni permite quitar el valor', () => {
    montar({
      disabled: true,
      value: { id: 'p1', nombre_completo: 'Ana Pérez', activo: true },
    });
    expect(campo()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quitar paciente' })).toBeDisabled();
    fireEvent.focus(campo());
    expect(campo()).toHaveAttribute('aria-expanded', 'false');
  });

  it('muestra la ayuda y el error asociados al campo', () => {
    montar({ hint: 'Solo pacientes activos', error: 'Elige un paciente.' });
    expect(screen.getByText('Solo pacientes activos')).toBeVisible();
    expect(campo()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Elige un paciente.');
  });

  it('avisa onBlur cuando el foco sale del combo', async () => {
    montar();
    fireEvent.focus(campo());
    fireEvent.blur(campo());
    await waitFor(() => expect(onBlur).toHaveBeenCalled());
  });
});
