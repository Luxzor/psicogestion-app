import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, Pencil, RotateCw, Stethoscope } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { ActionDialog } from '../../pacientes/components/ActionDialog';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { therapistsApi } from '../api';
import { PhotoUploader } from '../components/PhotoUploader';
import { TherapistField } from '../components/TherapistField';
import { useSyncTherapistProfile, useTherapist, useUpdateTherapist } from '../hooks/useTerapeutas';
import { useTherapistForm } from '../hooks/useTherapistForm';
import { useTherapistPhoto } from '../hooks/useTherapistPhoto';
import type { PhotoData, Therapist, TherapistFieldKey } from '../types';
import { NAME_MAX, changedFields, diffPayload, toFormValues, validatePhoto } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const LIST_PATH = '/inicio/terapeutas';

const FIELD_LABELS: Record<TherapistFieldKey, string> = {
  nombre: 'Nombre completo',
  telefono: 'Teléfono',
  correo: 'Correo electrónico',
  fechaNacimiento: 'Fecha de nacimiento',
  cedula: 'Cédula profesional',
};

const VERSION_CONFLICT_MESSAGE =
  'Otra persona actualizó este perfil mientras lo editabas. Revisa los cambios y guarda de nuevo.';

const NETWORK_NOTICE =
  'No pudimos conectar con el servidor. Tus datos siguen en el formulario. Intenta guardar de nuevo.';

const isApiError = (error: unknown): error is ApiError & { version_actual?: number } =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** EDT 4.3.5. Edición del terapeuta (RF 2.2.3–2.2.5, PG-DSN-002 §5.9). */
export function EditarTerapeutaPage({ session }: { session: Session }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: terapeuta, isPending, isError, error } = useTherapist(id, session.token);

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
    const notFound = isApiError(error) && error.codigo === 'TERAPEUTA_NO_ENCONTRADO';
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

  // Un terapeuta dado de baja no se edita: primero hay que reactivarlo.
  if (!terapeuta.activo) {
    return (
      <div className="page page--narrow">
        <Link to={`${LIST_PATH}/${terapeuta.id}`} className="back-link">
          <ChevronLeft size={16} aria-hidden="true" />
          {terapeuta.nombre_completo}
        </Link>
        <section className="panel">
          <div className="empty">
            <span className="empty__icon">
              <Stethoscope size={44} aria-hidden="true" />
            </span>
            <h2>Este terapeuta está dado de baja</h2>
            <p>
              Sus datos se conservan, pero no pueden editarse mientras el perfil esté inactivo.
              Reactívalo desde su perfil para volver a editarlo.
            </p>
            <Link to={`${LIST_PATH}/${terapeuta.id}`} className="button button--primary">
              Ir al perfil
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // El formulario se monta con el perfil ya cargado para partir de los valores correctos.
  return <EditarTerapeutaForm terapeuta={terapeuta} session={session} />;
}

function EditarTerapeutaForm({ terapeuta, session }: { terapeuta: Therapist; session: Session }) {
  const navigate = useNavigate();
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [conflictFields, setConflictFields] = useState<TherapistFieldKey[]>([]);
  const [profile, setProfile] = useState(terapeuta);
  // true cuando los datos del PATCH ya se guardaron (o no había que guardarlos) y solo falta
  // resolver la fotografía: un reintento no vuelve a enviar el PATCH.
  const [patchDone, setPatchDone] = useState(false);

  // Fotografía: archivo local nuevo, o marca de "quitar la guardada" (RF 2.2.3, §5.9).
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const existingPhotoUrl = useTherapistPhoto(
    profile.id,
    'perfil',
    profile.foto_actualizada_en,
    session.token,
  );

  const initialValues = useMemo(() => toFormValues(terapeuta), [terapeuta]);
  const updateTherapist = useUpdateTherapist(terapeuta.id, session.token);
  const syncProfile = useSyncTherapistProfile(terapeuta.id);

  const form = useTherapistForm({
    accessToken: session.token,
    initialValues,
    excluirId: terapeuta.id,
    // "Anterior a la fecha de registro" se mide contra la fecha de registro, no contra hoy (§4.5).
    registrationDate: terapeuta.fecha_registro,
    busy: saving,
  });

  const hasPhotoChange = Boolean(photo) || removeExisting;

  useEffect(() => {
    setHasUnsavedChanges(form.dirty || hasPhotoChange || saving);
  }, [form.dirty, hasPhotoChange, saving, setHasUnsavedChanges]);

  useEffect(
    () => () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    },
    [photo],
  );

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form.notice && form.notice.kind !== 'resumen') noticeRef.current?.focus();
  }, [form.notice]);

  const profilePath = `${LIST_PATH}/${terapeuta.id}`;

  function finish() {
    form.clearUnsavedChanges();
    setHasUnsavedChanges(false);
    navigate(profilePath, { state: { flash: { type: 'success', text: 'Cambios guardados.' } } });
  }

  async function runPhotoStep() {
    try {
      let updated: Therapist;
      if (photo) {
        const result = await therapistsApi.uploadPhoto(
          profile.id,
          photo.file,
          session.token,
          (percent) => setUploadProgress(percent),
        );
        updated = result.terapeuta;
      } else {
        await therapistsApi.deletePhoto(profile.id, session.token);
        updated = { ...profile, foto_perfil: null, foto_actualizada_en: null };
      }
      setProfile(updated);
      syncProfile(updated);
      finish();
    } catch {
      setSaving(false);
      setUploadProgress(null);
      form.setNotice({
        kind: 'foto',
        text: 'Los cambios se guardaron, pero no fue posible actualizar la fotografía.',
      });
    }
  }

  /**
   * Conflicto de versión (ADR-10): se recarga el perfil vigente y se reaplica encima lo que el
   * usuario capturó. Si tras recargar ya no hay diferencias de texto, ese PATCH ya se aplicó
   * antes y se trata como éxito; si además había un cambio de fotografía pendiente, se continúa
   * con ese paso.
   */
  async function handleVersionConflict(hasPhotoChanges: boolean) {
    const fresh = await therapistsApi.getById(terapeuta.id, session.token);
    setProfile(fresh);
    syncProfile(fresh);

    const freshValues = toFormValues(fresh);
    const mine = form.getValues();
    const myChanges = changedFields(form.initialValues, mine);
    const theirChanges = changedFields(form.initialValues, freshValues);

    const merged = { ...freshValues };
    for (const field of myChanges) merged[field] = mine[field];

    if (!changedFields(freshValues, merged).length) {
      setPatchDone(true);
      if (hasPhotoChanges) {
        await runPhotoStep();
      } else {
        finish();
      }
      return;
    }

    form.rebase(freshValues, merged);
    setConflictFields(theirChanges);
    const alsoChanged = theirChanges.map((field) => FIELD_LABELS[field]).join(', ');
    form.setNotice({
      kind: 'error',
      text: alsoChanged
        ? `${VERSION_CONFLICT_MESSAGE} También cambió: ${alsoChanged}.`
        : VERSION_CONFLICT_MESSAGE,
    });
    setSaving(false);
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;

    // Reintento tras una foto fallida: los datos ya se guardaron (o no había que guardarlos).
    if (patchDone) {
      setSaving(true);
      form.setNotice(null);
      await runPhotoStep();
      return;
    }

    if (form.dirty && !form.validateAll()) return;

    const changes = form.dirty ? diffPayload(form.initialValues, form.getValues()) : {};
    const hasTextChanges = Object.keys(changes).length > 0;

    if (!hasTextChanges && !hasPhotoChange) {
      form.setNotice({ kind: 'error', text: 'No hay cambios por guardar.' });
      return;
    }

    setSaving(true);
    form.setNotice(null);
    setConflictFields([]);

    if (!hasTextChanges) {
      setPatchDone(true);
      await runPhotoStep();
      return;
    }

    try {
      const updated = await updateTherapist.mutateAsync({ ...changes, version: profile.version });
      setProfile(updated);
      setPatchDone(true);
    } catch (error) {
      if (isApiError(error) && error.codigo === 'CONFLICTO_VERSION') {
        try {
          await handleVersionConflict(hasPhotoChange);
        } catch {
          setSaving(false);
          form.setNotice({ kind: 'red', text: NETWORK_NOTICE });
        }
        return;
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
        form.setNotice({ kind: 'red', text: NETWORK_NOTICE });
        return;
      }
      if (error.campos && Object.keys(error.campos).length) {
        form.applyServerFields(error.campos);
        return;
      }
      form.setNotice({ kind: 'error', text: error.mensaje });
      return;
    }

    if (hasPhotoChange) {
      await runPhotoStep();
    } else {
      finish();
    }
  }

  async function handlePhotoSelect(file: File) {
    setPhotoError('');
    const validation = await validatePhoto(file);
    if (validation.error) {
      setPhotoError(validation.error);
      return;
    }

    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);

    const previewUrl = URL.createObjectURL(file);
    setPhoto({
      file,
      previewUrl,
      name: file.name,
      width: validation.width || 0,
      height: validation.height || 0,
      size: file.size,
    });
    setRemoveExisting(false);
  }

  function handlePhotoRemove() {
    if (photo) {
      if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
      setPhotoError('');
      return;
    }
    setRemoveExisting(true);
  }

  function cancel() {
    if (form.dirty || hasPhotoChange) setConfirmLeave(true);
    else navigate(profilePath);
  }

  function leaveWithoutSaving() {
    setConfirmLeave(false);
    form.clearUnsavedChanges();
    setHasUnsavedChanges(false);
    navigate(profilePath);
  }

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={cancel} disabled={saving}>
        <ChevronLeft size={16} aria-hidden="true" />
        {terapeuta.nombre_completo}
      </button>
      <div className="page-head page-head--form">
        <div className="page-title">
          <span className="page-title__icon">
            <Pencil size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>Editar terapeuta</h1>
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
            ) : form.notice.kind === 'foto' ? (
              <>
                <button type="button" className="button button--primary" onClick={() => submit()}>
                  <RotateCw size={15} aria-hidden="true" />
                  Reintentar
                </button>
                <button type="button" className="button button--secondary" onClick={finish}>
                  Continuar sin cambiar la fotografía
                </button>
              </>
            ) : undefined
          }
        >
          {form.notice.text}
        </FormNotice>
      ) : null}

      <form className="panel form-panel" onSubmit={submit} noValidate>
        <div className="form-section">
          <h2>Fotografía</h2>
          <PhotoUploader
            photo={photo}
            existingPreviewUrl={removeExisting ? null : existingPhotoUrl}
            error={photoError}
            uploadProgress={uploadProgress}
            disabled={saving}
            onPhotoSelect={handlePhotoSelect}
            onPhotoRemove={handlePhotoRemove}
          />
        </div>

        <div className="form-section">
          <h2>Datos del terapeuta</h2>
          <div className="form-grid">
            <TherapistField
              {...form.fieldProps('nombre')}
              kind="text"
              label="Nombre completo"
              full
              counterMax={NAME_MAX}
              inputProps={{ maxLength: NAME_MAX, autoComplete: 'name' }}
            />
            <TherapistField
              {...form.fieldProps('telefono')}
              kind="text"
              label="Teléfono"
              hint="10 dígitos, sin espacios."
              inputProps={{
                type: 'tel',
                maxLength: 10,
                inputMode: 'numeric',
                autoComplete: 'tel',
                placeholder: '9991234567',
              }}
            />
            <TherapistField
              {...form.fieldProps('correo')}
              kind="text"
              label="Correo electrónico"
              inputProps={{
                type: 'email',
                maxLength: 100,
                autoComplete: 'email',
                spellCheck: false,
                placeholder: 'nombre@dominio.mx',
              }}
            />
            <TherapistField
              {...form.fieldProps('fechaNacimiento')}
              kind="date"
              label="Fecha de nacimiento"
              hint="dd/mm/aaaa"
            />
            <TherapistField
              {...form.fieldProps('cedula')}
              kind="text"
              label="Cédula profesional"
              hint="Solo dígitos, 7 u 8."
              inputProps={{
                maxLength: 8,
                inputMode: 'numeric',
                autoComplete: 'off',
                placeholder: '7845213',
              }}
            />
          </div>
        </div>

        {conflictFields.length ? (
          <p className="form-conflict" role="status">
            Los campos que actualizó la otra persona son:{' '}
            {conflictFields.map((field) => FIELD_LABELS[field]).join(', ')}. Revisa que tus cambios
            sigan siendo correctos.
          </p>
        ) : null}

        <div className="form-actions">
          <span className="form-actions__status" aria-live="polite">
            {form.dirty || hasPhotoChange ? 'Hay cambios sin guardar.' : ''}
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={cancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={saving || !(form.dirty || hasPhotoChange)}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                {uploadProgress !== null ? 'Cargando fotografía...' : 'Guardando...'}
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
