import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  CircleCheck,
  LoaderCircle,
  Pencil,
  Stethoscope,
  UserCheck,
  UserX,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { ActionDialog } from '../../pacientes/components/ActionDialog';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { useFlash } from '../../pacientes/hooks/useFlash';
import { newIdempotencyKey } from '../../pacientes/idempotency';
import { TherapistAvatar } from '../components/TherapistAvatar';
import { useDischargeTherapist, useRestoreTherapist, useTherapist } from '../hooks/useTerapeutas';
import type { Therapist } from '../types';
import { displayFromIso } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const LIST_PATH = '/inicio/terapeutas';

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** EDT 4.3.5. Vista "Nombre Terapeuta" (RF 2.2.2, PG-DSN-002 §5.9). */
export function PerfilTerapeutaPage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const flashState = useFlash();
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

  return <PerfilTerapeuta terapeuta={terapeuta} session={session} flashState={flashState} />;
}

type DialogKind = 'baja' | 'reactivar' | null;

function PerfilTerapeuta({
  terapeuta,
  session,
  flashState,
}: {
  terapeuta: Therapist;
  session: Session;
  flashState: ReturnType<typeof useFlash>;
}) {
  const navigate = useNavigate();
  const { flash, dismiss, show } = flashState;
  const [dialog, setDialog] = useState<DialogKind>(null);

  const listPath = terapeuta.activo ? LIST_PATH : `${LIST_PATH}?estado=inactivos`;

  return (
    <div className="page page--narrow page--profile">
      <Link to={listPath} className="back-link">
        <ChevronLeft size={16} aria-hidden="true" />
        Terapeutas
      </Link>

      {flash ? (
        <FormNotice type={flash.type} onClose={dismiss}>
          {flash.text}
        </FormNotice>
      ) : null}

      {!terapeuta.activo ? (
        <FormNotice type="info">
          <span className="notice__with-icon">
            <UserX size={15} aria-hidden="true" />
            Este terapeuta fue dado de baja
            {terapeuta.fecha_baja ? ` el ${displayFromIso(terapeuta.fecha_baja)}` : ''}. Sus datos
            y su fotografía se conservan en el sistema.
          </span>
        </FormNotice>
      ) : null}

      <section className="panel profile-head">
        <TherapistAvatar
          therapistId={terapeuta.id}
          nombreCompleto={terapeuta.nombre_completo}
          fotoActualizadaEn={terapeuta.foto_actualizada_en}
          accessToken={session.token}
          size="xl"
        />
        <div className="profile-head__main">
          <h1 aria-label={terapeuta.nombre_completo}>
            <span>{terapeuta.nombre_completo}</span>{' '}
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
          </h1>
        </div>
        <div className="profile-head__actions">
          {terapeuta.activo ? (
            <>
              <Link
                to={`${LIST_PATH}/${terapeuta.id}/editar`}
                className="button button--secondary"
                aria-label={`Editar el perfil de ${terapeuta.nombre_completo}`}
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
              Reactivar terapeuta
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Datos del terapeuta</h2>
        <dl className="data-grid">
          <div>
            <dt>Nombre completo</dt>
            <dd>{terapeuta.nombre_completo}</dd>
          </div>
          <div>
            <dt>Fecha de nacimiento</dt>
            <dd>{displayFromIso(terapeuta.fecha_nacimiento)}</dd>
          </div>
          <div>
            <dt>Cédula profesional</dt>
            <dd className="is-mono">{terapeuta.cedula_profesional}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{terapeuta.telefono}</dd>
          </div>
          <div className="is-wide">
            <dt>Correo electrónico</dt>
            <dd>{terapeuta.correo_electronico}</dd>
          </div>
        </dl>
      </section>

      {dialog === 'baja' ? (
        <BajaDialog
          terapeuta={terapeuta}
          session={session}
          onCancel={() => setDialog(null)}
          onDone={() =>
            navigate(LIST_PATH, {
              state: { flash: { type: 'success', text: 'Terapeuta dado de baja.' } },
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
          terapeuta={terapeuta}
          session={session}
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            show({ type: 'success', text: 'Terapeuta reactivado.' });
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
  terapeuta: Therapist;
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

/** EDT 4.3.5. Confirmación de la baja lógica (RF 2.3.1 a RF 2.3.3, PG-DSN-001 §5.9). */
function BajaDialog({ terapeuta, session, onCancel, onDone, onStale }: StateDialogProps) {
  const discharge = useDischargeTherapist(terapeuta.id, session.token);
  const attemptKey = useAttemptKey();
  const [failure, setFailure] = useState<string | null>(null);
  const busy = discharge.isPending;
  usePendingOperation(busy);

  function confirm() {
    setFailure(null);
    discharge.mutate(attemptKey(), {
      onSuccess: onDone,
      onError: (error) => {
        if (isApiError(error) && error.codigo === 'TERAPEUTA_INACTIVO') {
          onStale('Este terapeuta ya estaba dado de baja. El perfil no cambió.');
          return;
        }
        setFailure(
          isNetworkError(error)
            ? 'No pudimos dar de baja al terapeuta porque no hubo conexión con el servidor. El perfil no cambió. Intenta de nuevo.'
            : isApiError(error)
              ? error.mensaje
              : 'No pudimos dar de baja al terapeuta. El perfil no cambió. Intenta de nuevo.',
        );
      },
    });
  }

  return (
    <ActionDialog
      id="baja-terapeuta"
      role="alertdialog"
      title={`Dar de baja a ${terapeuta.nombre_completo}`}
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
        Dejará de aparecer en la lista de terapeutas activos y no podrá asignarse a nuevas citas.
        Sus datos se conservarán.
      </p>
    </ActionDialog>
  );
}

/** EDT 4.3.5. Reactivación desde el perfil (RF 2.3.4). */
function ReactivarDialog({ terapeuta, session, onCancel, onDone, onStale }: StateDialogProps) {
  const restore = useRestoreTherapist(terapeuta.id, session.token);
  const attemptKey = useAttemptKey();
  const [failure, setFailure] = useState<string | null>(null);
  const busy = restore.isPending;
  usePendingOperation(busy);

  function confirm() {
    setFailure(null);
    restore.mutate(attemptKey(), {
      onSuccess: onDone,
      onError: (error) => {
        if (isApiError(error) && error.codigo === 'TERAPEUTA_ACTIVO') {
          onStale('Este terapeuta ya estaba activo. El perfil no cambió.');
          return;
        }
        setFailure(
          isNetworkError(error)
            ? 'No pudimos reactivar al terapeuta porque no hubo conexión con el servidor. El perfil no cambió. Intenta de nuevo.'
            : isApiError(error)
              ? error.mensaje
              : 'No pudimos reactivar al terapeuta. El perfil no cambió. Intenta de nuevo.',
        );
      },
    });
  }

  return (
    <ActionDialog
      id="reactivar-terapeuta"
      title={`Reactivar a ${terapeuta.nombre_completo}`}
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
      <p>Volverá a la lista de terapeutas activos.</p>
    </ActionDialog>
  );
}
