import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, RotateCw, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import type { Session } from '../../auth/types';
import { patientsApi } from '../api';
import { ActionDialog } from '../components/ActionDialog';
import { FormNotice } from '../components/FormNotice';
import { PatientFormFields } from '../components/PatientFormFields';
import { usePatientForm } from '../hooks/usePatientForm';
import type { Flash, InactivePatient } from '../types';
import { displayFromIso, toPayload } from '../validation';
import '../styles/pacientes.css';

const LIST_PATH = '/inicio/pacientes';

type Reactivation = { patient: InactivePatient; busy: boolean; error?: string };
type PatientApiError = ApiError & { paciente?: InactivePatient };

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

/** EDT 4.3.1. Registro de paciente (PG-DSN-002-INT, pantalla /pacientes/nuevo). */
export function RegistroPacientePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reactivation, setReactivation] = useState<Reactivation | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const form = usePatientForm({
    accessToken: session.token,
    extraDirty: consent,
    busy: saving,
  });

  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const reactivationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  // El hook mantiene el estado del aviso; el elemento, y por tanto su foco, son de la pantalla.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form.notice && form.notice.kind !== 'resumen') noticeRef.current?.focus();
  }, [form.notice]);

  function keyFor(ref: typeof attempt, fingerprint: string) {
    if (ref.current?.fingerprint !== fingerprint) {
      ref.current = { fingerprint, key: newIdempotencyKey() };
    }
    return ref.current.key;
  }

  function finish(flash: Flash) {
    form.clearUnsavedChanges();
    navigate(LIST_PATH, { state: { flash } });
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
    if (!form.validateAll()) return;

    const payload = toPayload(form.getValues(), consent);
    const key = keyFor(attempt, JSON.stringify(payload));
    setSaving(true);
    form.setNotice(null);
    try {
      await patientsApi.register(payload, session.token, key);
      finish({ type: 'success', text: 'Paciente registrado.' });
    } catch (error) {
      setSaving(false);
      if (!isApiError(error)) {
        form.setNotice({
          kind: 'error',
          text: 'No fue posible guardar al paciente. Inténtalo de nuevo.',
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
      if (error.codigo === 'PACIENTE_DADO_DE_BAJA' && error.paciente) {
        setReactivation({ patient: error.paciente, busy: false });
        return;
      }
      if (error.campos && Object.keys(error.campos).length) {
        form.applyServerFields(error.campos);
        return;
      }
      form.setNotice({ kind: 'error', text: error.mensaje });
    }
  }

  async function confirmReactivation() {
    if (!reactivation || reactivation.busy) return;
    const payload = toPayload(form.getValues(), consent);
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
    if (form.dirty) setConfirmLeave(true);
    else navigate(LIST_PATH);
  }

  function leaveWithoutSaving() {
    setConfirmLeave(false);
    form.clearUnsavedChanges();
    navigate(LIST_PATH);
  }

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
