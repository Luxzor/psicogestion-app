import { ChevronLeft, CircleCheck, LoaderCircle, Pencil, Stethoscope, UserX } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { TherapistAvatar } from '../components/TherapistAvatar';
import { useTherapist } from '../hooks/useTerapeutas';
import type { Therapist } from '../types';
import { displayFromIso } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const LIST_PATH = '/inicio/terapeutas';

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** EDT 4.3.5. Vista "Nombre Terapeuta" (RF 2.2.2, PG-DSN-002 5.9). */
export function PerfilTerapeutaPage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: terapeuta, isPending, isError, error } = useTherapist(id, session.token);

  const notFound = isError && isApiError(error) && error.codigo === 'TERAPEUTA_NO_ENCONTRADO';

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
          Terapeutas
        </button>
        <section className="panel">
          <div className="empty">
            <span className="empty__icon">
              <Stethoscope size={44} aria-hidden="true" />
            </span>
            <h2>{notFound ? 'No encontramos a este terapeuta' : 'No pudimos cargar el perfil'}</h2>
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

  return <PerfilTerapeuta terapeuta={terapeuta} session={session} />;
}

function PerfilTerapeuta({ terapeuta, session }: { terapeuta: Therapist; session: Session }) {
  const listPath = terapeuta.activo ? LIST_PATH : `${LIST_PATH}?estado=inactivos`;

  return (
    <div className="page page--narrow">
      <Link to={listPath} className="back-link">
        <ChevronLeft size={16} aria-hidden="true" />
        Terapeutas
      </Link>

      <div className="page-head">
        <div className="page-title">
          <TherapistAvatar
            therapistId={terapeuta.id}
            nombreCompleto={terapeuta.nombre_completo}
            fotoActualizadaEn={terapeuta.foto_actualizada_en}
            accessToken={session.token}
            size="lg"
          />
          <div>
            <div className="page-title__row">
              <h1>{terapeuta.nombre_completo}</h1>
              {terapeuta.activo ? (
                <span className="badge badge--ok">
                  <CircleCheck size={12} aria-hidden="true" />
                  Activo
                </span>
              ) : (
                <span className="badge badge--off">
                  <UserX size={12} aria-hidden="true" />
                  Dado de baja
                </span>
              )}
            </div>
            <p>Perfil del terapeuta</p>
          </div>
        </div>
        {terapeuta.activo ? (
          <div className="page-actions">
            <Link
              to={`${LIST_PATH}/${terapeuta.id}/editar`}
              className="button button--secondary"
              aria-label={`Editar el perfil de ${terapeuta.nombre_completo}`}
            >
              <Pencil size={16} aria-hidden="true" />
              Editar
            </Link>
          </div>
        ) : null}
      </div>

      {!terapeuta.activo ? (
        <FormNotice type="info">
          <span className="notice__with-icon">
            <UserX size={15} aria-hidden="true" />
            Este terapeuta fue dado de baja
            {terapeuta.fecha_baja ? ` el ${displayFromIso(terapeuta.fecha_baja)}` : ''}. Sus datos
            se conservan en el sistema.
          </span>
        </FormNotice>
      ) : null}

      <section className="panel profile">
        <h2 className="sr-only">Datos del terapeuta</h2>
        <dl className="profile__grid">
          <div className="profile__item">
            <dt>Nombre completo</dt>
            <dd>{terapeuta.nombre_completo}</dd>
          </div>
          <div className="profile__item">
            <dt>Fecha de nacimiento</dt>
            <dd>{displayFromIso(terapeuta.fecha_nacimiento)}</dd>
          </div>
          <div className="profile__item">
            <dt>Cédula profesional</dt>
            <dd className="is-mono">{terapeuta.cedula_profesional}</dd>
          </div>
          <div className="profile__item">
            <dt>Teléfono</dt>
            <dd>{terapeuta.telefono}</dd>
          </div>
          <div className="profile__item">
            <dt>Correo electrónico</dt>
            <dd>{terapeuta.correo_electronico}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
