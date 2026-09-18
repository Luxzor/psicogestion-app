import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('muestra la pantalla de inicio de sesión', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('no coloca el correo institucional en la URL después del registro', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const payload = url.includes('/auth/refresh')
        ? { access_token: 'token-de-prueba' }
        : { codigo: 'REGISTRO_CREADO', estado: 'pendiente_verificacion' };
      return new Response(JSON.stringify(payload), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/registro']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Ana Perez' } });
    fireEvent.change(screen.getByLabelText('Teléfono (10 dígitos)'), {
      target: { value: '9991234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.change(screen.getByLabelText('Correo institucional UADY'), {
      target: { value: 'ana@uady.mx' },
    });
    fireEvent.change(
      screen.getByLabelText(/^Contraseña/, { selector: '[autocomplete="new-password"]' }),
      {
        target: { value: 'ClaveSegura1!' },
      },
    );
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'ClaveSegura1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByLabelText(/Confirmo que soy titular/i));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Verifica tu correo' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/verificar');
    expect(screen.getByTestId('location')).not.toHaveTextContent('correo=');
  });
});
