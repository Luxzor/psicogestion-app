import { useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FormNotice } from '../components/FormNotice';
import type { Flash } from '../types';
import '../styles/pacientes.css';

const FLASH_DURATION_MS = 7000;

/**
 * Punto de entrada del módulo de pacientes. En la EDT 4.3.1 ofrece el registro y muestra la
 * confirmación del guardado; la lista con búsqueda y filtros se implementa en la EDT 4.3.2.
 */
export function PacientesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState<Flash | null>(
    () => (location.state as { flash?: Flash } | null)?.flash ?? null,
  );

  useEffect(() => {
    if ((location.state as { flash?: Flash } | null)?.flash) {
      // Se limpia el estado para que el aviso no reaparezca al recargar o regresar.
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
            <Users size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Pacientes</h1>
            <p>Registra a los pacientes que atiende la clínica.</p>
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
            <Users size={44} aria-hidden="true" />
          </span>
          <h2>Consulta de pacientes</h2>
          <p>
            El listado y el perfil de los pacientes estarán disponibles en la siguiente entrega. Usa
            “Añadir paciente” para registrar uno nuevo.
          </p>
        </div>
      </section>

      <Link to="/inicio/pacientes/nuevo" className="button button--primary fab">
        <UserPlus size={18} aria-hidden="true" />
        Añadir paciente
      </Link>
    </div>
  );
}
