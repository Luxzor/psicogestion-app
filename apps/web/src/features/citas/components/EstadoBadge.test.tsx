import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EstadoBadge } from './EstadoBadge';

/** Etiqueta de estado de una cita (RF 5.2.2): texto y clase por estado. */
afterEach(cleanup);

describe('EstadoBadge', () => {
  it.each([
    ['Pendiente', 'badge--pend'],
    ['Cancelada', 'badge--canc'],
    ['Vencida', 'badge--venc'],
  ] as const)('muestra %s con la clase %s', (estado, clase) => {
    render(<EstadoBadge estado={estado} />);
    const badge = screen.getByText(estado);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain(clase);
  });

  it('cada estado usa una clase distinta', () => {
    const clases = (['Pendiente', 'Cancelada', 'Vencida'] as const).map((estado) => {
      const { container, unmount } = render(<EstadoBadge estado={estado} />);
      const clase = container.firstElementChild?.className ?? '';
      unmount();
      return clase;
    });
    expect(new Set(clases).size).toBe(3);
  });

  it('el ícono es decorativo (aria-hidden) y no se lee como parte del texto', () => {
    const { container } = render(<EstadoBadge estado="Pendiente" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Pendiente').textContent).toBe('Pendiente');
  });
});
