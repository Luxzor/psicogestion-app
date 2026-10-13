import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Flash } from '../types';

const FLASH_DURATION_MS = 7000;

/**
 * Aviso de confirmación que viaja en el estado de la navegación ("Paciente registrado",
 * "Cambios guardados"). Se limpia del historial para que no reaparezca al recargar o al volver.
 */
export function useFlash() {
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState<Flash | null>(
    () => (location.state as { flash?: Flash } | null)?.flash ?? null,
  );

  useEffect(() => {
    if ((location.state as { flash?: Flash } | null)?.flash) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return { flash, dismiss: () => setFlash(null) };
}
