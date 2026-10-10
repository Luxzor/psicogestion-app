import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, RotateCw, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { ActionDialog } from '../../pacientes/components/ActionDialog';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { therapistsApi } from '../api';
import { PhotoUploader } from '../components/PhotoUploader';
import { TherapistField } from '../components/TherapistField';
import type { Flash, PhotoData, TherapistFieldKey, TherapistFormValues } from '../types';
import { NAME_MAX, normalizeInput, toPayload, validateField, validatePhoto } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/terapeutas.css';

const FIELDS: TherapistFieldKey[] = ['nombre', 'telefono', 'correo', 'fechaNacimiento', 'cedula'];
const UNIQUE_FIELDS = ['telefono', 'correo', 'cedula'] as const;

const SERVER_FIELDS: Record<string, TherapistFieldKey> = {
  nombre_completo: 'nombre',
  telefono: 'telefono',
  correo_electronico: 'correo',
  correo: 'correo',
  fecha_nacimiento: 'fechaNacimiento',
  cedula_profesional: 'cedula',
  cedula: 'cedula',
};

const EMPTY: TherapistFormValues = {
  nombre: '',
  telefono: '',
  correo: '',
  fechaNacimiento: '',
  cedula: '',
};

const UNIQUENESS_DELAY_MS = 400;
const LIST_PATH = '/inicio/terapeutas';

type Errors = Partial<Record<TherapistFieldKey, string>>;
type FormNoticeState = {
  kind: 'resumen' | 'red' | 'error' | 'foto';
  text: string;
} | null;

const fieldId = (field: TherapistFieldKey) => `terapeuta-${field}`;
const isUniqueField = (field: TherapistFieldKey): field is (typeof UNIQUE_FIELDS)[number] =>
  (UNIQUE_FIELDS as readonly TherapistFieldKey[]).includes(field);

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const summaryText = (count: number) =>
  count === 1
    ? 'Hay 1 campo por corregir. Revisa el mensaje junto al campo.'
    : `Hay ${count} campos por corregir. Revisa los mensajes junto a cada campo.`;

/** EDT 4.3.4. Registro de terapeuta (PG-DSN-002-INT, pantalla /terapeutas/nuevo). */
export function RegistroTerapeutaPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { setHasUnsavedChanges } = useUnsavedChanges();

  const [values, setValues] = useState<TherapistFormValues>(EMPTY);
  const [formatErrors, setFormatErrors] = useState<Errors>({});
  const [remoteErrors, setRemoteErrors] = useState<Errors>({});
  const [checking, setChecking] = useState<Partial<Record<TherapistFieldKey, boolean>>>({});
  const [notice, setNotice] = useState<FormNoticeState>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Estado de la fotografía
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [photoError, setPhotoError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [savedTherapistId, setSavedTherapistId] = useState<string | null>(null);

  const valuesRef = useRef(values);
  const photoRef = useRef(photo);
  const noticeRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Partial<Record<TherapistFieldKey, ReturnType<typeof setTimeout>>>>({});
  const controllers = useRef<Partial<Record<TherapistFieldKey, AbortController>>>({});
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const dirty = Boolean(photo) || FIELDS.some((field) => values[field] !== '');
  const errorOf = (field: TherapistFieldKey) => formatErrors[field] || remoteErrors[field] || '';

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    photoRef.current = photo;
  }, [photo]);

  useEffect(() => {
    setHasUnsavedChanges(dirty || saving);
  }, [dirty, saving, setHasUnsavedChanges]);

  useEffect(() => {
    const pendingTimers = timers.current;
    const pendingControllers = controllers.current;
    return () => {
      setHasUnsavedChanges(false);
      Object.values(pendingTimers).forEach((timer) => clearTimeout(timer));
      Object.values(pendingControllers).forEach((controller) => controller?.abort());
      if (photoRef.current?.previewUrl) {
        URL.revokeObjectURL(photoRef.current.previewUrl);
      }
    };
  }, [setHasUnsavedChanges]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (notice && notice.kind !== 'resumen') noticeRef.current?.focus();
  }, [notice]);

  const focusField = (field: TherapistFieldKey) => {
    setTimeout(() => {
      document.getElementById(fieldId(field))?.focus();
    }, 0);
  };

  /** Unicidad anticipada tras 400 ms sin escribir (RNF 2.1.4). */
  const scheduleUniqueness = useCallback(
    (field: TherapistFieldKey, next: TherapistFormValues) => {
      if (!isUniqueField(field)) return;
      clearTimeout(timers.current[field]);
      controllers.current[field]?.abort();
      setChecking((current) => ({ ...current, [field]: false }));
      if (validateField(field, next)) return;

      const value = next[field];
      timers.current[field] = setTimeout(() => {
        const controller = new AbortController();
        controllers.current[field] = controller;
        setChecking((current) => ({ ...current, [field]: true }));

        therapistsApi
          .checkAvailability({ campo: field, valor: value }, session.token, controller.signal)
          .then((result) => {
            if (valuesRef.current[field] !== value) return;
            setRemoteErrors((current) => ({
              ...current,
              [field]: result.disponible ? '' : (result.mensaje ?? 'Este dato ya está registrado.'),
            }));
          })
          .catch(() => {
            // Si la verificación previa falla, el servidor vuelve a validar al guardar.
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setChecking((current) => ({ ...current, [field]: false }));
            }
          });
      }, UNIQUENESS_DELAY_MS);
    },
    [session.token],
  );

  function handleChange(field: TherapistFieldKey, raw: string) {
    const value = normalizeInput(field, raw);
    const next = { ...valuesRef.current, [field]: value };
    valuesRef.current = next;
    setValues(next);
    setRemoteErrors((current) => ({ ...current, [field]: '' }));

    const shouldValidateNow =
      Boolean(formatErrors[field]) || (field === 'fechaNacimiento' && value.length === 10);
    const nextFormatErrors = shouldValidateNow
      ? { ...formatErrors, [field]: validateField(field, next) }
      : formatErrors;
    if (shouldValidateNow) setFormatErrors(nextFormatErrors);

    scheduleUniqueness(field, next);

    if (notice?.kind === 'resumen') {
      const remaining = FIELDS.filter(
        (key) => nextFormatErrors[key] || (key !== field && remoteErrors[key]),
      );
      if (!remaining.length) setNotice(null);
    }
  }

  function handleBlur(field: TherapistFieldKey) {
    setFormatErrors((current) => ({
      ...current,
      [field]: validateField(field, valuesRef.current),
    }));
  }

  async function handlePhotoSelect(file: File) {
    setPhotoError('');
    const validation = await validatePhoto(file);
    if (validation.error) {
      setPhotoError(validation.error);
      return;
    }

    if (photo?.previewUrl) {
      URL.revokeObjectURL(photo.previewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setPhoto({
      file,
      previewUrl,
      name: file.name,
      width: validation.width || 0,
      height: validation.height || 0,
      size: file.size,
    });
  }

  function handlePhotoRemove() {
    if (photo?.previewUrl) {
      URL.revokeObjectURL(photo.previewUrl);
    }
    setPhoto(null);
    setPhotoError('');
  }

  function showFieldErrors(nextFormat: Errors, nextRemote: Errors) {
    const withErrors = FIELDS.filter((field) => nextFormat[field] || nextRemote[field]);
    setNotice({ kind: 'resumen', text: summaryText(withErrors.length) });
    if (withErrors[0]) focusField(withErrors[0]);
  }

  function keyFor(ref: typeof attempt, fingerprint: string) {
    if (ref.current?.fingerprint !== fingerprint) {
      ref.current = { fingerprint, key: newIdempotencyKey() };
    }
    return ref.current.key;
  }

  function finish(flash: Flash) {
    setHasUnsavedChanges(false);
    navigate(LIST_PATH, { state: { flash } });
  }

  async function uploadPhotoStep(therapistId: string, photoData: PhotoData) {
    setUploadProgress(0);
    try {
      await therapistsApi.uploadPhoto(therapistId, photoData.file, session.token, (percent) =>
        setUploadProgress(percent),
      );
      finish({ type: 'success', text: 'Terapeuta registrado.' });
    } catch {
      setSaving(false);
      setUploadProgress(null);
      setNotice({
        kind: 'foto',
        text: 'Los datos del terapeuta se guardaron. Falta cargar la fotografía.',
      });
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;

    // Si ya se creó el terapeuta y solo falta la fotografía:
    if (savedTherapistId && photo) {
      setSaving(true);
      setNotice(null);
      await uploadPhotoStep(savedTherapistId, photo);
      return;
    }

    const current = valuesRef.current;
    const nextFormat: Errors = {};
    FIELDS.forEach((field) => {
      nextFormat[field] = validateField(field, current);
    });
    setFormatErrors(nextFormat);
    if (FIELDS.some((field) => nextFormat[field] || remoteErrors[field])) {
      showFieldErrors(nextFormat, remoteErrors);
      return;
    }

    const payload = toPayload(current);
    const key = keyFor(attempt, JSON.stringify(payload));
    setSaving(true);
    setNotice(null);

    try {
      const result = await therapistsApi.register(payload, session.token, key);
      const newTherapistId = result.terapeuta.id;
      setSavedTherapistId(newTherapistId);

      // Si se cargó fotografía, proceder al segundo paso (PG-DSN-002 5.8):
      if (photo) {
        await uploadPhotoStep(newTherapistId, photo);
      } else {
        finish({ type: 'success', text: 'Terapeuta registrado.' });
      }
    } catch (error) {
      setSaving(false);
      if (!isApiError(error)) {
        setNotice({
          kind: 'error',
          text: 'No fue posible guardar al terapeuta. Inténtalo de nuevo.',
        });
        return;
      }
      if (error.codigo === 'SIN_CONEXION' || error.codigo === 'ERROR_INTERNO') {
        setNotice({
          kind: 'red',
          text: 'No pudimos conectar con el servidor. Tus datos siguen en el formulario. Intenta guardar de nuevo.',
        });
        return;
      }
      if (error.campos && Object.keys(error.campos).length) {
        const nextRemote: Errors = { ...remoteErrors };
        Object.entries(error.campos).forEach(([serverField, message]) => {
          const field = SERVER_FIELDS[serverField];
          if (field) nextRemote[field] = message;
        });
        setRemoteErrors(nextRemote);
        showFieldErrors(nextFormat, nextRemote);
        return;
      }
      setNotice({ kind: 'error', text: error.mensaje });
    }
  }

  function cancel() {
    if (dirty) setConfirmLeave(true);
    else navigate(LIST_PATH);
  }

  function leaveWithoutSaving() {
    setConfirmLeave(false);
    setHasUnsavedChanges(false);
    navigate(LIST_PATH);
  }

  const field = (key: TherapistFieldKey) => ({
    id: fieldId(key),
    value: values[key],
    error: errorOf(key),
    checking: Boolean(checking[key]),
    fieldKey: key,
    disabled: Boolean(savedTherapistId),
  });

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={cancel} disabled={saving}>
        <ChevronLeft size={16} aria-hidden="true" />
        Terapeutas
      </button>

      <div className="page-head page-head--form">
        <div className="page-title">
          <span className="page-title__icon">
            <UserPlus size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>Nuevo terapeuta</h1>
            <p>Todos los campos son obligatorios, salvo los marcados como opcionales.</p>
          </div>
        </div>
      </div>

      {notice ? (
        <FormNotice
          ref={noticeRef}
          type="error"
          actions={
            notice.kind === 'red' ? (
              <button type="button" className="button button--primary" onClick={() => submit()}>
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </button>
            ) : notice.kind === 'foto' ? (
              <>
                <button type="button" className="button button--primary" onClick={() => submit()}>
                  <RotateCw size={15} aria-hidden="true" />
                  Reintentar
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => finish({ type: 'success', text: 'Terapeuta registrado.' })}
                >
                  Continuar sin fotografía
                </button>
              </>
            ) : undefined
          }
        >
          {notice.text}
        </FormNotice>
      ) : null}

      <form className="panel form-panel" onSubmit={submit} noValidate>
        <div className="form-section">
          <h2>
            Fotografía <span className="field__opt">(opcional)</span>
          </h2>
          <PhotoUploader
            photo={photo}
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
              {...field('nombre')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="text"
              label="Nombre completo"
              full
              counterMax={NAME_MAX}
              inputProps={{ maxLength: NAME_MAX, autoComplete: 'name' }}
            />
            <TherapistField
              {...field('telefono')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
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
              {...field('correo')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
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
              {...field('fechaNacimiento')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="date"
              label="Fecha de nacimiento"
              hint="dd/mm/aaaa"
            />
            <TherapistField
              {...field('cedula')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
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

        <div className="form-actions">
          <span className="form-actions__status" aria-live="polite" />
          <button
            type="button"
            className="button button--secondary"
            onClick={cancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button type="submit" className="button button--primary" disabled={saving}>
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                {uploadProgress !== null ? 'Cargando fotografía...' : 'Guardando...'}
              </>
            ) : (
              'Guardar terapeuta'
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
