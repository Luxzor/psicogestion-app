import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  CircleCheck,
  LoaderCircle,
  Pencil,
  UserCheck,
  UserRound,
  UserX,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { ActionDialog } from '../components/ActionDialog';
import { FormNotice } from '../components/FormNotice';
import { useFlash } from '../hooks/useFlash';
import { useDischargePatient, usePatient, useRestorePatient } from '../hooks/usePacientes';
import { newIdempotencyKey } from '../idempotency';
import type { PatientProfile } from '../types';
import { displayFromIso, iniciales, SEXO_OPTIONS } from '../validation';
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
  const flashState = useFlash();
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

  return <PerfilPaciente paciente={paciente} session={session} flashState={flashState} />;
}

type DialogKind = 'baja' | 'reactivar' | null;

function PerfilPaciente({
  paciente,
  session,
  flashState,
}: {
  paciente: PatientProfile;
  session: Session;
  flashState: ReturnType<typeof useFlash>;
}) {
  const navigate = useNavigate();
  const { flash, dismiss, show } = flashState;
  const [dialog, setDialog] = useState<DialogKind>(null);

  const listPath = paciente.activo ? LIST_PATH : `${LIST_PATH}?estado=inactivos`;

  return (
    <div className="page page--narrow page--profile">
      <Link to={listPath} className="back-link">
        <ChevronLeft size={16} aria-hidden="true" />
        Pacientes
      </Link>

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

      <section className="panel profile-head">
        <span
          className={`avatar avatar--lg${paciente.activo ? '' : ' is-muted'}`}
          aria-hidden="true"
        >
          {iniciales(paciente.nombre_completo)}
        </span>
        <div className="profile-head__main">
          <h1 aria-label={paciente.nombre_completo}>
            <span>{paciente.nombre_completo}</span>{' '}
            {paciente.activo ? (
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
          </h1>
        </div>
        <div className="profile-head__actions">
          {paciente.activo ? (
            <>
              <Link
                to={`${LIST_PATH}/${paciente.id}/editar`}
                className="button button--secondary"
                aria-label={`Editar el perfil de ${paciente.nombre_completo}`}
              >
                <Pencil size={16} aria-hidden="true" />
                Editar
              </Link>
              <button
                type="button"
                className="button button--danger-soft"
                onClick={() => setDialog('baja')}
              >
                <UserX size={16} aria-hidden="true" />
                Dar de baja
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setDialog('reactivar')}
            >
              <UserCheck size={16} aria-hidden="true" />
              Reactivar paciente
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Datos de identificación</h2>
        <dl className="data-grid">
          <div>
            <dt>Nombre completo</dt>
            <dd>{paciente.nombre_completo}</dd>
          </div>
          <div>
            <dt>Fecha de nacimiento</dt>
            <dd>
              {displayFromIso(paciente.fecha_nacimiento)} <small>({paciente.edad} años)</small>
            </dd>
          </div>
          <div>
            <dt>CURP</dt>
            <dd className="is-mono">{paciente.curp}</dd>
          </div>
          <div>
            <dt>Sexo</dt>
            <dd>{sexoLabel(paciente.sexo)}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{paciente.telefono}</dd>
          </div>
          <div className="is-wide">
            <dt>Correo electrónico</dt>
            <dd className={paciente.correo ? 'is-wide' : 'is-empty is-wide'}>
              {paciente.correo ?? 'No registrado'}
            </dd>
          </div>
        </dl>
      </section>

      {dialog === 'baja' ? (
        <BajaDialog
          paciente={paciente}
          session={session}
          onCancel={() => setDialog(null)}
          onDone={() =>
            navigate(LIST_PATH, {
              state: { flash: { type: 'success', text: 'Paciente dado de baja.' } },
            })
          }
          onStale={(text) => {
            setDialog(null);
            show({ type: 'info', text });
          }}
        />
      ) : null}

      {dialog === 'reactivar' ? (
        <ReactivarDialog
          paciente={paciente}
          session={session}
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            show({ type: 'success', text: 'Paciente reactivado.' });
          }}
          onStale={(text) => {
            setDialog(null);
            show({ type: 'info', text });
          }}
        />
      ) : null}
    </div>
  );
}

type StateDialogProps = {
  paciente: PatientProfile;
  session: Session;
  onCancel: () => void;
  onDone: () => void;
  /** El perfil ya estaba en el estado pedido (por ejemplo, lo cambió otra persona). */
  onStale: (text: string) => void;
};

/**
 * Mientras la operación está en curso se marca como pendiente para que el cierre de sesión pida
 * terminarla primero (UnsavedChangesContext, PG-DSN-002 §5.11), y se libera al cerrar el diálogo.
 */
function usePendingOperation(pending: boolean) {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  useEffect(() => {
    setHasUnsavedChanges(pending);
  }, [pending, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);
}

/**
 * Una llave de idempotencia por intento de confirmación (ADR-13). "Reintentar" reutiliza la misma
 * llave: si el primer intento sí llegó al servidor, el reintento recibe su respuesta original.
 */
function useAttemptKey() {
  const key = useRef<string | null>(null);
  return () => {
    key.current ??= newIdempotencyKey();
    return key.current;
  };
}

const isNetworkError = (error: unknown) => isApiError(error) && error.codigo === 'SIN_CONEXION';

/** EDT 4.3.3. Confirmación de la baja lógica (RF 3.3.1 a RF 3.3.3, PG-DSN-002 §5.6). */
function BajaDialog({ paciente, session, onCancel, onDone, onStale }: StateDialogProps) {
  const discharge = useDischargePatient(paciente.id, session.token);
  const attemptKey = useAttemptKey();
  const [failure, setFailure] = useState<string | null>(null);
  const busy = discharge.isPending;
  usePendingOperation(busy);

  function confirm() {
    setFailure(null);
    discharge.mutate(attemptKey(), {
      onSuccess: onDone,
      onError: (error) => {
        if (isApiError(error) && error.codigo === 'PACIENTE_INACTIVO') {
          onStale('Este paciente ya estaba dado de baja. El perfil no cambió.');
          return;
        }
        setFailure(
          isNetworkError(error)
            ? 'No pudimos dar de baja al paciente porque no hubo conexión con el servidor. El perfil no cambió. Intenta de nuevo.'
            : isApiError(error)
              ? error.mensaje
              : 'No pudimos dar de baja al paciente. El perfil no cambió. Intenta de nuevo.',
        );
      },
    });
  }

  return (
    <ActionDialog
      id="baja-paciente"
      role="alertdialog"
      title={`Dar de baja a ${paciente.nombre_completo}`}
      onEscape={busy ? undefined : onCancel}
      notice={
        failure ? (
          <FormNotice type="error">
            <span>{failure}</span>
          </FormNotice>
        ) : null
      }
      actions={[
        {
          label: 'Cancelar',
          variant: 'secondary',
          initialFocus: true,
          disabled: busy,
          onClick: onCancel,
        },
        {
          label: failure ? 'Reintentar' : 'Dar de baja',
          busyLabel: 'Dando de baja...',
          variant: 'danger',
          busy,
          onClick: confirm,
        },
      ]}
    >
      <p>
        El perfil dejará de aparecer en la lista de pacientes activos. Sus datos se conservarán en
        el sistema.
      </p>
    </ActionDialog>
  );
}

/** EDT 4.3.3. Reactivación desde el perfil: vuelve a la lista de activos con sus datos. */
function ReactivarDialog({ paciente, session, onCancel, onDone, onStale }: StateDialogProps) {
  const restore = useRestorePatient(paciente.id, session.token);
  const attemptKey = useAttemptKey();
  const [failure, setFailure] = useState<string | null>(null);
  const busy = restore.isPending;
  usePendingOperation(busy);

  function confirm() {
    setFailure(null);
    restore.mutate(attemptKey(), {
      onSuccess: onDone,
      onError: (error) => {
        if (isApiError(error) && error.codigo === 'PACIENTE_ACTIVO') {
          onStale('Este paciente ya estaba activo. El perfil no cambió.');
          return;
        }
        setFailure(
          isNetworkError(error)
            ? 'No pudimos reactivar al paciente porque no hubo conexión con el servidor. El perfil no cambió. Intenta de nuevo.'
            : isApiError(error)
              ? error.mensaje
              : 'No pudimos reactivar al paciente. El perfil no cambió. Intenta de nuevo.',
        );
      },
    });
  }

  return (
    <ActionDialog
      id="reactivar-paciente"
      title={`Reactivar a ${paciente.nombre_completo}`}
      onEscape={busy ? undefined : onCancel}
      notice={
        failure ? (
          <FormNotice type="error">
            <span>{failure}</span>
          </FormNotice>
        ) : null
      }
      actions={[
        {
          label: 'Cancelar',
          variant: 'secondary',
          initialFocus: true,
          disabled: busy,
          onClick: onCancel,
        },
        {
          label: failure ? 'Reintentar' : 'Reactivar',
          busyLabel: 'Reactivando...',
          variant: 'primary',
          busy,
          onClick: confirm,
        },
      ]}
    >
      <p>Volverá a la lista de pacientes activos con sus datos anteriores.</p>
    </ActionDialog>
  );
}
