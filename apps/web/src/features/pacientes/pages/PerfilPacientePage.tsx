import { ChevronLeft, LoaderCircle, Pencil, UserRound, UserX } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { FormNotice } from '../components/FormNotice';
import { useFlash } from '../hooks/useFlash';
import { usePatient } from '../hooks/usePacientes';
import { displayFromIso, SEXO_OPTIONS } from '../validation';
import '../styles/pacientes.css';

const LIST_PATH = '/inicio/pacientes';

const sexoLabel = (sexo: string) =>
  SEXO_OPTIONS.find((option) => option.value === sexo)?.label ?? sexo;

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** EDT 4.3.2. Vista "Nombre Paciente" (RF 3.2.2–3.2.3, PG-DSN-002 §5.6). */
export function PerfilPacientePage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { flash, dismiss } = useFlash();
  const { data: paciente, isPending, isError, error } = usePatient(id, session.token);

  const notFound = isError && isApiError(error) && error.codigo === 'PACIENTE_NO_ENCONTRADO';

  if (isPending) {
    return (
      <div className="page page--narrow">
        <p className="loading" role="status">
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
          Cargando el perfil...
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page page--narrow">
        <button type="button" className="back-link" onClick={() => navigate(LIST_PATH)}>
          <ChevronLeft size={16} aria-hidden="true" />
          Pacientes
        </button>
        <section className="panel">
          <div className="empty">
            <span className="empty__icon">
              <UserRound size={44} aria-hidden="true" />
            </span>
            <h2>{notFound ? 'No encontramos a este paciente' : 'No pudimos cargar el perfil'}</h2>
            <p>
              {notFound
                ? 'El perfil que buscas no existe o se escribió una dirección incorrecta.'
                : isApiError(error)
                  ? error.mensaje
                  : 'Revisa tu conexión e inténtalo de nuevo.'}
            </p>
            <Link to={LIST_PATH} className="button button--primary">
              Volver a la lista
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <Link to={LIST_PATH} className="back-link">
        <ChevronLeft size={16} aria-hidden="true" />
        Pacientes
      </Link>

      <div className="page-head">
        <div className="page-title">
          <span className="page-title__icon">
            <UserRound size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>{paciente.nombre_completo}</h1>
            <p>Perfil del paciente</p>
          </div>
        </div>
        {paciente.activo ? (
          <Link
            to={`${LIST_PATH}/${paciente.id}/editar`}
            className="button button--secondary"
            aria-label={`Editar el perfil de ${paciente.nombre_completo}`}
          >
            <Pencil size={16} aria-hidden="true" />
            Editar
          </Link>
        ) : null}
      </div>

      {flash ? (
        <FormNotice type={flash.type} onClose={dismiss}>
          {flash.text}
        </FormNotice>
      ) : null}

      {!paciente.activo ? (
        <FormNotice type="info">
          <span className="notice__with-icon">
            <UserX size={15} aria-hidden="true" />
            Este paciente fue dado de baja
            {paciente.fecha_baja ? ` el ${displayFromIso(paciente.fecha_baja)}` : ''}. Sus datos se
            conservan en el sistema.
          </span>
        </FormNotice>
      ) : null}

      <section className="panel profile">
        <h2 className="sr-only">Datos del paciente</h2>
        <dl className="profile__grid">
          <div className="profile__item">
            <dt>Nombre completo</dt>
            <dd>{paciente.nombre_completo}</dd>
          </div>
          <div className="profile__item">
            <dt>Fecha de nacimiento</dt>
            <dd>
              {displayFromIso(paciente.fecha_nacimiento)}{' '}
              <span className="profile__muted">({paciente.edad} años)</span>
            </dd>
          </div>
          <div className="profile__item">
            <dt>CURP</dt>
            <dd className="is-mono">{paciente.curp}</dd>
          </div>
          <div className="profile__item">
            <dt>Sexo</dt>
            <dd>{sexoLabel(paciente.sexo)}</dd>
          </div>
          <div className="profile__item">
            <dt>Teléfono</dt>
            <dd>{paciente.telefono}</dd>
          </div>
          <div className="profile__item">
            <dt>Correo electrónico</dt>
            <dd>{paciente.correo ?? <span className="profile__muted">No registrado</span>}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
