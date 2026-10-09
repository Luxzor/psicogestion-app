import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, RotateCw, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { patientsApi } from '../api';
import { ActionDialog } from '../components/ActionDialog';
import { FormNotice } from '../components/FormNotice';
import { PatientField } from '../components/PatientField';
import type { FieldKey, Flash, InactivePatient, PatientFormValues } from '../types';
import {
  displayFromIso,
  NAME_MAX,
  normalizeInput,
  SEXO_OPTIONS,
  toPayload,
  validateField,
} from '../validation';
import '../styles/pacientes.css';

const FIELDS: FieldKey[] = ['nombre', 'curp', 'sexo', 'fechaNacimiento', 'telefono', 'correo'];
const UNIQUE_FIELDS = ['curp', 'telefono'] as const;
const SERVER_FIELDS: Record<string, FieldKey> = {
  nombre_completo: 'nombre',
  curp: 'curp',
  sexo: 'sexo',
  fecha_nacimiento: 'fechaNacimiento',
  telefono: 'telefono',
  correo: 'correo',
};
const EMPTY: PatientFormValues = {
  nombre: '',
  curp: '',
  sexo: '',
  fechaNacimiento: '',
  telefono: '',
  correo: '',
};
const UNIQUENESS_DELAY_MS = 400;
const LIST_PATH = '/inicio/pacientes';

type Errors = Partial<Record<FieldKey, string>>;
type FormNoticeState = { kind: 'resumen' | 'red' | 'error'; text: string } | null;
type Reactivation = { patient: InactivePatient; busy: boolean; error?: string };
type PatientApiError = ApiError & { paciente?: InactivePatient };

const fieldId = (field: FieldKey) => `paciente-${field}`;
const isUniqueField = (field: FieldKey): field is (typeof UNIQUE_FIELDS)[number] =>
  (UNIQUE_FIELDS as readonly FieldKey[]).includes(field);
const isApiError = (error: unknown): error is PatientApiError =>
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

/** EDT 4.3.1. Registro de paciente (PG-DSN-002-INT, pantalla /pacientes/nuevo). */
export function RegistroPacientePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const [values, setValues] = useState<PatientFormValues>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [formatErrors, setFormatErrors] = useState<Errors>({});
  const [remoteErrors, setRemoteErrors] = useState<Errors>({});
  const [checking, setChecking] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [notice, setNotice] = useState<FormNoticeState>(null);
  const [saving, setSaving] = useState(false);
  const [reactivation, setReactivation] = useState<Reactivation | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const valuesRef = useRef(values);
  const noticeRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Partial<Record<FieldKey, ReturnType<typeof setTimeout>>>>({});
  const controllers = useRef<Partial<Record<FieldKey, AbortController>>>({});
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const reactivationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const dirty = consent || FIELDS.some((field) => values[field] !== '');
  const errorOf = (field: FieldKey) => formatErrors[field] || remoteErrors[field] || '';

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

  const focusField = (field: FieldKey) => document.getElementById(fieldId(field))?.focus();

  /** Unicidad anticipada tras 400 ms sin escribir (RNF 3.1.3). El servidor decide al guardar. */
  const scheduleUniqueness = useCallback(
    (field: FieldKey, next: PatientFormValues) => {
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
        const body =
          field === 'curp'
            ? { campo: 'curp' as const, valor: value }
            : {
                campo: 'telefono' as const,
                valor: value,
                curp: valuesRef.current.curp || undefined,
              };
        patientsApi
          .checkAvailability(body, session.token, controller.signal)
          .then((result) => {
            if (valuesRef.current[field] !== value) return;
            setRemoteErrors((current) => ({
              ...current,
              [field]: result.disponible ? '' : (result.mensaje ?? 'Este dato ya está registrado.'),
            }));
          })
          .catch(() => {
            // Si la verificación anticipada falla, el servidor vuelve a validar al guardar.
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

  function handleChange(field: FieldKey, raw: string) {
    const value = normalizeInput(field, raw);
    const next = { ...valuesRef.current, [field]: value };
    valuesRef.current = next;
    setValues(next);
    setRemoteErrors((current) => ({ ...current, [field]: '' }));

    const shouldValidateNow =
      Boolean(formatErrors[field]) ||
      field === 'sexo' ||
      (field === 'fechaNacimiento' && value.length === 10);
    const nextFormatErrors = shouldValidateNow
      ? { ...formatErrors, [field]: validateField(field, next) }
      : formatErrors;
    if (shouldValidateNow) setFormatErrors(nextFormatErrors);

    scheduleUniqueness(field, next);
    if (field === 'curp' && next.telefono) scheduleUniqueness('telefono', next);

    if (notice?.kind === 'resumen') {
      const remaining = FIELDS.filter(
        (key) => nextFormatErrors[key] || (key !== field && remoteErrors[key]),
      );
      if (!remaining.length) setNotice(null);
    }
  }

  function handleBlur(field: FieldKey) {
    setFormatErrors((current) => ({
      ...current,
      [field]: validateField(field, valuesRef.current),
    }));
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

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
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

    const payload = toPayload(current, consent);
    const key = keyFor(attempt, JSON.stringify(payload));
    setSaving(true);
    setNotice(null);
    try {
      await patientsApi.register(payload, session.token, key);
      finish({ type: 'success', text: 'Paciente registrado.' });
    } catch (error) {
      setSaving(false);
      if (!isApiError(error)) {
        setNotice({
          kind: 'error',
          text: 'No fue posible guardar al paciente. Inténtalo de nuevo.',
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
      if (error.codigo === 'PACIENTE_DADO_DE_BAJA' && error.paciente) {
        setReactivation({ patient: error.paciente, busy: false });
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

  async function confirmReactivation() {
    if (!reactivation || reactivation.busy) return;
    const payload = toPayload(valuesRef.current, consent);
    const key = keyFor(
      reactivationAttempt,
      `${reactivation.patient.id}:${JSON.stringify(payload)}`,
    );
    setReactivation({ ...reactivation, busy: true, error: undefined });
    try {
      await patientsApi.reactivate(reactivation.patient.id, payload, session.token, key);
      finish({ type: 'success', text: 'Paciente reactivado.' });
    } catch (error) {
      const text = isApiError(error)
        ? error.mensaje
        : 'No fue posible reactivar al paciente. Inténtalo de nuevo.';
      setReactivation({ ...reactivation, busy: false, error: text });
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

  const field = (key: FieldKey) => ({
    id: fieldId(key),
    value: values[key],
    error: errorOf(key),
    checking: Boolean(checking[key]),
    fieldKey: key,
  });

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={cancel} disabled={saving}>
        <ChevronLeft size={16} aria-hidden="true" />
        Pacientes
      </button>
      <div className="page-head page-head--form">
        <div className="page-title">
          <span className="page-title__icon">
            <UserPlus size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>Nuevo paciente</h1>
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
            ) : undefined
          }
        >
          {notice.text}
        </FormNotice>
      ) : null}

      <form className="panel form-panel" onSubmit={submit} noValidate>
        <div className="form-section">
          <h2>Datos de identificación</h2>
          <div className="form-grid">
            <PatientField
              {...field('nombre')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="text"
              label="Nombre completo"
              full
              counterMax={NAME_MAX}
              inputProps={{ maxLength: NAME_MAX, autoComplete: 'name' }}
            />
            <PatientField
              {...field('curp')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="text"
              label="CURP"
              hint="18 caracteres; se convierte a mayúsculas."
              inputProps={{
                maxLength: 18,
                autoComplete: 'off',
                autoCapitalize: 'characters',
                spellCheck: false,
                className: 'is-mono',
              }}
            />
            <PatientField
              {...field('sexo')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="select"
              label="Sexo"
              placeholder="Selecciona una opción"
              options={SEXO_OPTIONS}
            />
            <PatientField
              {...field('fechaNacimiento')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="date"
              label="Fecha de nacimiento"
              hint="dd/mm/aaaa"
            />
            <PatientField
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
            <PatientField
              {...field('correo')}
              onFieldChange={handleChange}
              onFieldBlur={handleBlur}
              kind="text"
              label="Correo electrónico"
              optional
              inputProps={{
                type: 'email',
                maxLength: 100,
                autoComplete: 'email',
                spellCheck: false,
                placeholder: 'nombre@dominio.mx',
              }}
            />
          </div>
        </div>

        <div className="form-section">
          <h2>Consentimiento</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              El paciente autoriza el tratamiento de sus datos personales conforme al aviso de
              privacidad. <span className="field__opt">(opcional)</span>
            </span>
          </label>
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
                Guardando...
              </>
            ) : (
              'Guardar paciente'
            )}
          </button>
        </div>
      </form>

      {reactivation ? (
        <ActionDialog
          id="reactivar-paciente"
          role="alertdialog"
          title="Este CURP pertenece a un paciente dado de baja"
          onEscape={reactivation.busy ? undefined : () => setReactivation(null)}
          notice={
            reactivation.error ? <FormNotice type="error">{reactivation.error}</FormNotice> : null
          }
          actions={[
            {
              label: 'Cancelar',
              variant: 'secondary',
              initialFocus: true,
              disabled: reactivation.busy,
              onClick: () => setReactivation(null),
            },
            {
              label: 'Reactivar',
              busyLabel: 'Reactivando...',
              variant: 'primary',
              busy: reactivation.busy,
              onClick: () => void confirmReactivation(),
            },
          ]}
        >
          <p>
            Este CURP pertenece a <strong>{reactivation.patient.nombre_completo}</strong>
            {reactivation.patient.fecha_baja
              ? `, dado de baja el ${displayFromIso(reactivation.patient.fecha_baja)}`
              : ', dado de baja'}
            . ¿Reactivar su perfil con los datos que capturaste? Los datos anteriores se
            reemplazarán.
          </p>
        </ActionDialog>
      ) : null}

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
