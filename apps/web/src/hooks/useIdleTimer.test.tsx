import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleTimer } from './useIdleTimer';
import { IdleWarningDialog } from '../components/IdleWarningDialog';

describe('useIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('no activa temporizador si enabled es false', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({
        enabled: false,
        idleTimeoutMs: 1000,
        countdownSeconds: 5,
        onTimeout,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('muestra aviso a los 28 minutos y ejecuta onTimeout al agotarse los 2 minutos', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({
        enabled: true,
        idleTimeoutMs: 1000,
        countdownSeconds: 2,
        onTimeout,
      }),
    );

    expect(result.current.showWarning).toBe(false);

    // Pasa el tiempo de inactividad
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(result.current.remainingSeconds).toBe(2);

    // Pasa 1 segundo de cuenta regresiva
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remainingSeconds).toBe(1);

    // Pasa el último segundo: se ejecuta onTimeout y se cierra el aviso
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(result.current.showWarning).toBe(false);
  });

  it('actividad de usuario antes del aviso resetea el temporizador de inactividad', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({
        enabled: true,
        idleTimeoutMs: 2000,
        countdownSeconds: 5,
        onTimeout,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.showWarning).toBe(false);

    // Actividad de usuario
    act(() => {
      window.dispatchEvent(new MouseEvent('mousedown'));
    });

    // Pasan 1000 ms más (si no se hubiese reseteado, habrían pasado 2500 ms y se habría mostrado el aviso)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.showWarning).toBe(false);
  });

  it('stayActive resetea el aviso y reanuda la cuenta normal', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({
        enabled: true,
        idleTimeoutMs: 1000,
        countdownSeconds: 10,
        onTimeout,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.showWarning).toBe(true);

    // Usuario pulsa "Seguir trabajando"
    act(() => {
      result.current.stayActive();
    });

    expect(result.current.showWarning).toBe(false);
    expect(result.current.remainingSeconds).toBe(10);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('IdleWarningDialog', () => {
  it('muestra el tiempo restante y llama a onStayActive al pulsar Seguir trabajando', () => {
    const onStayActive = vi.fn();
    render(<IdleWarningDialog remainingSeconds={119} onStayActive={onStayActive} />);

    expect(screen.getByRole('alertdialog', { name: 'Sesión por expirar' })).toBeInTheDocument();
    expect(screen.getByText(/Tu sesión se cerrará en 1:59 por inactividad/)).toBeInTheDocument();
    expect(screen.getByText('1:59')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Seguir trabajando' });
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(onStayActive).toHaveBeenCalledTimes(1);
  });
});

