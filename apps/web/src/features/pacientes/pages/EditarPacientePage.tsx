import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, Pencil, RotateCw, UserRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { patientsApi } from '../api';
import { ActionDialog } from '../components/ActionDialog';
import { FormNotice } from '../components/FormNotice';
import { PatientFormFields } from '../components/PatientFormFields';
import { usePatientForm } from '../hooks/usePatientForm';
import { useSyncPatientProfile, usePatient, useUpdatePatient } from '../hooks/usePacientes';
import type { FieldKey, PatientProfile } from '../types';
import { changedFields, diffPayload, toFormValues } from '../validation';
import '../styles/pacientes.css';

const LIST_PATH = '/inicio/pacientes';

const FIELD_LABELS: Record<FieldKey, string> = {
  nombre: 'Nombre completo',
  curp: 'CURP',
  sexo: 'Sexo',
  fechaNacimiento: 'Fecha de nacimiento',
  telefono: 'Teléfono',
  correo: 'Correo electrónico',
};

const VERSION_CONFLICT_MESSAGE =
  'Otra persona actualizó este perfil mientras lo editabas. Revisa los cambios y guarda de nuevo.';

const isApiError = (error: unknown): error is ApiError & { version_actual?: number } =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** EDT 4.3.2. Edición del paciente (RF 3.2.4–3.2.6, PG-DSN-002 §5.6). */
export function EditarPacientePage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: paciente, isPending, isError, error } = usePatient(id, session.token);

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
    const notFound = isApiError(error) && error.codigo === 'PACIENTE_NO_ENCONTRADO';
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

  // Un paciente dado de baja no se edita: primero hay que reactivarlo (EDT 4.3.3).
  if (!paciente.activo) {
    return (
      <div className="page page--narrow">
        <Link to={`${LIST_PATH}/${paciente.id}`} className="back-link">
          <ChevronLeft size={16} aria-hidden="true" />
          {paciente.nombre_completo}
        </Link>
        <section className="panel">
          <div className="empty">
            <span className="empty__icon">
              <UserRound size={44} aria-hidden="true" />
            </span>
            <h2>Este paciente está dado de baja</h2>
            <p>
              Sus datos se conservan, pero no pueden editarse mientras el perfil esté inactivo.
              Reactívalo desde su perfil para volver a editarlo.
            </p>
            <Link to={`${LIST_PATH}/${paciente.id}`} className="button button--primary">
              Ir al perfil
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // El formulario se monta con el perfil ya cargado para partir de los valores correctos.
  return <EditarPacienteForm paciente={paciente} session={session} />;
}

function EditarPacienteForm({ paciente, session }: { paciente: PatientProfile; session: Session }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [version, setVersion] = useState(paciente.version);
  const [conflictFields, setConflictFields] = useState<FieldKey[]>([]);

  const initialValues = useMemo(() => toFormValues(paciente), [paciente]);
  const updatePatient = useUpdatePatient(paciente.id, session.token);
  const syncProfile = useSyncPatientProfile(paciente.id);

  const form = usePatientForm({
    accessToken: session.token,
    initialValues,
    excluirId: paciente.id,
    // La edad mínima de 7 años se mide contra la fecha de registro, no contra hoy (§4.5).
    registrationDate: paciente.fecha_registro,
    busy: saving,
  });

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form.notice && form.notice.kind !== 'resumen') noticeRef.current?.focus();
  }, [form.notice]);

  const profilePath = `${LIST_PATH}/${paciente.id}`;

  function finish() {
    form.clearUnsavedChanges();
    navigate(profilePath, { state: { flash: { type: 'success', text: 'Cambios guardados.' } } });
  }

  /**
   * Conflicto de versión (ADR-10): se recarga el perfil vigente y se reaplica encima lo que el
   * usuario capturó, señalando qué campos cambió también la otra persona. Si tras recargar ya no
   * hay diferencias, el guardado anterior sí se aplicó y se trata como éxito.
   */
  async function handleVersionConflict() {
    const fresh = await patientsApi.getById(paciente.id, session.token);
    syncProfile(fresh);

    const freshValues = toFormValues(fresh);
    const mine = form.getValues();
    const myChanges = changedFields(form.initialValues, mine);
    const theirChanges = changedFields(form.initialValues, freshValues);

    const merged = { ...freshValues };
    for (const field of myChanges) merged[field] = mine[field];

    if (!changedFields(freshValues, merged).length) {
      finish();
      return;
    }

    form.rebase(freshValues, merged);
    setVersion(fresh.version);
    setConflictFields(theirChanges);
    const alsoChanged = theirChanges.map((field) => FIELD_LABELS[field]).join(', ');
    form.setNotice({
      kind: 'error',
      text: alsoChanged
        ? `${VERSION_CONFLICT_MESSAGE} También cambió: ${alsoChanged}.`
        : VERSION_CONFLICT_MESSAGE,
    });
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
    if (!form.validateAll()) return;

    const changes = diffPayload(form.initialValues, form.getValues());
    if (!Object.keys(changes).length) {
      form.setNotice({ kind: 'error', text: 'No hay cambios por guardar.' });
      return;
    }

    setSaving(true);
    form.setNotice(null);
    setConflictFields([]);
    try {
      await updatePatient.mutateAsync({ ...changes, version });
      finish();
    } catch (error) {
      if (isApiError(error) && error.codigo === 'CONFLICTO_VERSION') {
        try {
          await handleVersionConflict();
          return;
        } catch {
          form.setNotice({
            kind: 'red',
            text: 'No pudimos conectar con el servidor. Tus datos siguen en el formulario. Intenta guardar de nuevo.',
          });
          return;
        } finally {
          setSaving(false);
        }
      }
      setSaving(false);
      if (!isApiError(error)) {
        form.setNotice({
          kind: 'error',
          text: 'No fue posible guardar los cambios. Inténtalo de nuevo.',
        });
        return;
      }
      if (error.codigo === 'SIN_CONEXION' || error.codigo === 'ERROR_INTERNO') {
        form.setNotice({
          kind: 'red',
          text: 'No pudimos conectar con el servidor. Tus datos siguen en el formulario. Intenta guardar de nuevo.',
        });
        return;
      }
      if (error.campos && Object.keys(error.campos).length) {
        form.applyServerFields(error.campos);
        return;
      }
      form.setNotice({ kind: 'error', text: error.mensaje });
    }
  }

  function cancel() {
    if (form.dirty) setConfirmLeave(true);
    else navigate(profilePath);
  }

  function leaveWithoutSaving() {
    setConfirmLeave(false);
    form.clearUnsavedChanges();
    navigate(profilePath);
  }

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={cancel} disabled={saving}>
        <ChevronLeft size={16} aria-hidden="true" />
        {paciente.nombre_completo}
      </button>
      <div className="page-head page-head--form">
        <div className="page-title">
          <span className="page-title__icon">
            <Pencil size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>Editar paciente</h1>
            <p>Cambia solo los campos que necesites actualizar.</p>
          </div>
        </div>
      </div>

      {form.notice ? (
        <FormNotice
          ref={noticeRef}
          type="error"
          actions={
            form.notice.kind === 'red' ? (
              <button type="button" className="button button--primary" onClick={() => submit()}>
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </button>
            ) : undefined
          }
        >
          {form.notice.text}
        </FormNotice>
      ) : null}

      <form className="panel form-panel" onSubmit={submit} noValidate>
        <PatientFormFields form={form} />

        {conflictFields.length ? (
          <p className="form-conflict" role="status">
            Los campos que actualizó la otra persona son:{' '}
            {conflictFields.map((field) => FIELD_LABELS[field]).join(', ')}. Revisa que tus cambios
            sigan siendo correctos.
          </p>
        ) : null}

        <div className="form-actions">
          <span className="form-actions__status" aria-live="polite">
            {form.dirty ? 'Hay cambios sin guardar.' : ''}
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={cancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button type="submit" className="button button--primary" disabled={saving || !form.dirty}>
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                Guardando...
              </>
            ) : (
              'Guardar cambios'
            )}
          </button>
        </div>
      </form>

      {confirmLeave ? (
        <ActionDialog
          id="salir-sin-guardar"
          title="¿Salir sin guardar?"
          onEscape={() => setConfirmLeave(false)}
          actions={[
            {
              label: 'Seguir editando',
              variant: 'secondary',
              initialFocus: true,
              onClick: () => setConfirmLeave(false),
            },
            { label: 'Salir sin guardar', variant: 'primary', onClick: leaveWithoutSaving },
          ]}
        >
          <p>
            Tienes cambios sin guardar. Si sales ahora, lo que capturaste en este formulario se
            perderá.
          </p>
        </ActionDialog>
      ) : null}
    </div>
  );
}
