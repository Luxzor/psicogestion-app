import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { sessionWithToken } from './features/auth/session';
import { queryClient } from './lib/queryClient';

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

  it('redirige a iniciar sesión cuando la sesión expira y el refresh falla (CA-3.2-05)', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshCalls++;
        if (refreshCalls === 1) {
          // Sesión inicial al montar
          return new Response(JSON.stringify({ access_token: 'token-valido' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // El intento de refresco posterior falla (sesión expirada de verdad)
        return new Response(
          JSON.stringify({ codigo: 'SESION_INVALIDA', mensaje: 'Sesión expirada' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/pacientes')) {
        // La petición a pacientes devuelve 401 porque el token expiró
        return new Response(
          JSON.stringify({ codigo: 'SESION_INVALIDA', mensaje: 'Token expirado' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/inicio/pacientes']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    // Al detectar el 401 y fallar el refresh, se redirige inmediatamente a iniciar sesión
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/iniciar-sesion');
  });

  it('conserva el nombre del usuario al renovar el token a los 14 minutos (DEF-005 ITER04)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    try {
      let refreshCalls = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/auth/refresh')) {
          refreshCalls += 1;
          // Al montar no hay cookie de sesión; el refresco proactivo sí la tiene.
          return refreshCalls === 1
            ? new Response(JSON.stringify({ codigo: 'SESION_INVALIDA', mensaje: 'Sin sesión' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
              })
            : new Response(JSON.stringify({ access_token: 'token-renovado' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
        }
        if (url.includes('/auth/login')) {
          return new Response(
            JSON.stringify({
              access_token: 'token-inicial',
              usuario: { nombre_completo: 'Ana Lucía Pech Canul', rol: 'administrativo' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ codigo: 'ERROR_INTERNO', mensaje: 'x' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/iniciar-sesion']}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(refreshCalls).toBe(1));
      fireEvent.change(screen.getByLabelText('Correo institucional o teléfono'), {
        target: { value: 'ana.pech@correo.uady.mx' },
      });
      fireEvent.change(screen.getByLabelText('Contraseña', { selector: 'input' }), {
        target: { value: 'ClaveSegura1!' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      expect(await screen.findAllByText('Ana Lucía Pech Canul')).not.toHaveLength(0);

      await vi.advanceTimersByTimeAsync(14 * 60 * 1000);

      await waitFor(() => expect(refreshCalls).toBe(2));
      // Deja que la respuesta del refresco actualice la sesión antes de revisar la pantalla.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.getAllByText('Ana Lucía Pech Canul')).not.toHaveLength(0);
      expect(screen.queryByText('Usuario')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sessionWithToken reemplaza solo el token y conserva el usuario', () => {
    const user = { nombre_completo: 'Ana Lucía Pech Canul', rol: 'administrativo' };
    expect(sessionWithToken({ token: 'viejo', user }, 'nuevo')).toEqual({ token: 'nuevo', user });
    expect(sessionWithToken(null, 'nuevo')).toEqual({ token: 'nuevo' });
  });
});
