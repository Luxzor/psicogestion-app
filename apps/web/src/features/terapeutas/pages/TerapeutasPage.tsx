import { useEffect, useState } from 'react';
import { UserPlus, UserSquare2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FormNotice } from '../../pacientes/components/FormNotice';
import type { Flash } from '../types';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const FLASH_DURATION_MS = 7000;

/**
 * Punto de entrada del módulo de terapeutas. En la EDT 4.3.4 ofrece el registro y muestra la
 * confirmación del guardado; la lista con búsqueda y filtros se implementa en la EDT 4.3.5.
 */
export function TerapeutasPage() {
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

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <UserSquare2 size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Terapeutas</h1>
            <p>Registra a los terapeutas que colaboran en la clínica.</p>
          </div>
        </div>
      </div>

      {flash ? (
        <FormNotice type={flash.type} onClose={() => setFlash(null)}>
          {flash.text}
        </FormNotice>
      ) : null}

      <section className="panel">
        <div className="empty">
          <span className="empty__icon">
            <UserSquare2 size={44} aria-hidden="true" />
          </span>
          <h2>Consulta de terapeutas</h2>
          <p>
            El listado y el perfil de los terapeutas estarán disponibles en la siguiente entrega.
            Usa “Añadir terapeuta” para registrar uno nuevo.
          </p>
        </div>
      </section>

      <Link to="/inicio/terapeutas/nuevo" className="button button--primary fab">
        <UserPlus size={18} aria-hidden="true" />
        Añadir terapeuta
      </Link>
    </div>
  );
}
