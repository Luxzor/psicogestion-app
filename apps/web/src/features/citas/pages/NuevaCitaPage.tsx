import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarPlus,
  ChevronLeft,
  Clock,
  LoaderCircle,
  RotateCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { ActionDialog } from '../../pacientes/components/ActionDialog';
import { FormNotice } from '../../pacientes/components/FormNotice';
import type { Session } from '../../auth/types';
import { fLarga, fMedia } from '../../salas/validation';
import { citasApi } from '../api';
import { PersonaSelector, type PersonaOption } from '../components/PersonaSelector';
import { SalaHorarioGrid, type SalaHorarioValue } from '../components/SalaHorarioGrid';
import { citaKeys, disponibilidadKeys } from '../hooks/useCitas';
import { newIdempotencyKey } from '../idempotency';
import {
  DURACION_POR_DEFECTO,
  etiquetaDuracion,
  hoyEnClinica,
  minutosAHora,
  toInicioIso,
} from '../horario';
import type { CitaCreada, CitaFormErrors } from '../types';
import { CITA_EXITO, mensajeDeError, validateCitaForm } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/citas.css';

const LIST_PATH = '/inicio/citas';

type Notice = { kind: 'error' | 'red'; text: string };

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

const estadoAsignable = (persona: PersonaOption | null) =>
  persona ? { activo: persona.activo } : null;

/**
 * RF 5.1.1–5.1.15, RF 2.3.5 (EDT 5.3.3). Pantalla de agendar cita (PG-DSN-003 5.4; maqueta
 * PG-DSN-003-INT). Ruta /inicio/citas/nueva.
 */
export function NuevaCitaPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setHasUnsavedChanges } = useUnsavedChanges();

  const [paciente, setPaciente] = useState<PersonaOption | null>(null);
  const [terapeuta, setTerapeuta] = useState<PersonaOption | null>(null);
  const [fecha, setFecha] = useState(hoyEnClinica());
  const [duracion, setDuracion] = useState<number>(DURACION_POR_DEFECTO);
  const [horario, setHorario] = useState<SalaHorarioValue>({ salaId: '', inicio: null });
  const [errors, setErrors] = useState<CitaFormErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exito, setExito] = useState<CitaCreada | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  function keyFor(fingerprint: string) {
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newIdempotencyKey() };
    }
    return attempt.current.key;
  }

  const dirty =
    Boolean(paciente || terapeuta || horario.salaId || horario.inicio != null) || saving;

  // UnsavedChangesContext: confirmación al salir y beforeunload mientras haya algo capturado.
  useEffect(() => {
    setHasUnsavedChanges(dirty);
  }, [dirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const fechaIsoValida = Boolean(toInicioIso(fecha, 0));
  const values = {
    id_paciente: paciente?.id ?? '',
    id_terapeuta: terapeuta?.id ?? '',
    id_sala: horario.salaId,
    fecha,
    inicio: horario.inicio,
    duracion,
  };

  function revisar() {
    if (saving) return;
    const nextErrors = validateCitaForm(values, {
      modo: 'nuevo',
      paciente: estadoAsignable(paciente),
      terapeuta: estadoAsignable(terapeuta),
      sala: horario.salaId ? { activo: true } : null,
    });
    setErrors(nextErrors);
    const total = Object.keys(nextErrors).length;
    if (total) {
      setNotice({
        kind: 'error',
        text:
          total === 1
            ? 'Hay 1 dato por corregir. Revisa el mensaje junto al campo.'
            : `Hay ${total} datos por corregir. Revisa los mensajes junto a cada campo.`,
      });
      return;
    }
    setNotice(null);
    setConfirming(true);
  }

  async function confirmar() {
    if (saving) return;
    if (horario.inicio == null) return;
    const inicio = toInicioIso(fecha, horario.inicio);
    if (!inicio) return;
    const payload = {
      id_paciente: values.id_paciente,
      id_terapeuta: values.id_terapeuta,
      id_sala: values.id_sala,
      inicio,
      duracion_bloques: duracion / 30,
    };
    const key = keyFor(JSON.stringify(payload));
    setSaving(true);
    setNotice(null);
    try {
      const result = await citasApi.create(payload, session.token, key);
      void queryClient.invalidateQueries({ queryKey: citaKeys.listas });
      setHasUnsavedChanges(false);
      setSaving(false);
      setExito(result.cita);
    } catch (error) {
      setSaving(false);
      if (!isApiError(error)) {
        setNotice({ kind: 'error', text: 'No fue posible agendar la cita. Inténtalo de nuevo.' });
        return;
      }
      if (error.codigo === 'SIN_CONEXION' || error.codigo === 'ERROR_INTERNO') {
        setNotice({ kind: 'red', text: CITA_EXITO.errorConexion });
        return;
      }
      if (
        error.codigo === 'SALA_OCUPADA' ||
        error.codigo === 'TERAPEUTA_OCUPADO' ||
        error.codigo === 'PACIENTE_OCUPADO'
      ) {
        const mensaje = mensajeDeError(error.codigo) ?? error.mensaje;
        setErrors((prev) => ({ ...prev, inicio: mensaje }));
        setHorario((current) => ({ ...current, inicio: null }));
        void queryClient.invalidateQueries({ queryKey: disponibilidadKeys.todo });
        setNotice({ kind: 'error', text: mensaje });
        return;
      }
      if (error.codigo === 'PACIENTE_INACTIVO_NO_ASIGNABLE') {
        setErrors((prev) => ({
          ...prev,
          id_paciente: mensajeDeError(error.codigo) ?? error.mensaje,
        }));
        setNotice({ kind: 'error', text: error.mensaje });
        return;
      }
      if (error.codigo === 'TERAPEUTA_INACTIVO_NO_ASIGNABLE') {
        setErrors((prev) => ({
          ...prev,
          id_terapeuta: mensajeDeError(error.codigo) ?? error.mensaje,
        }));
        setNotice({ kind: 'error', text: error.mensaje });
        return;
      }
      if (error.codigo === 'SALA_INACTIVA') {
        setErrors((prev) => ({ ...prev, id_sala: mensajeDeError(error.codigo) ?? error.mensaje }));
        setHorario({ salaId: '', inicio: null });
        void queryClient.invalidateQueries({ queryKey: disponibilidadKeys.todo });
        setNotice({ kind: 'error', text: error.mensaje });
        return;
      }
      if (error.codigo === 'CITA_EN_EL_PASADO' || error.codigo === 'HORARIO_INVALIDO') {
        setErrors((prev) => ({ ...prev, inicio: mensajeDeError(error.codigo) ?? error.mensaje }));
        setNotice({ kind: 'error', text: error.mensaje });
        return;
      }
      if (error.campos && Object.keys(error.campos).length) {
        setErrors((prev) => ({ ...prev, ...error.campos }));
        setNotice({ kind: 'error', text: error.mensaje });
        return;
      }
      setNotice({ kind: 'error', text: error.mensaje });
    }
  }

  function reiniciar() {
    setPaciente(null);
    setTerapeuta(null);
    setFecha(hoyEnClinica());
    setDuracion(DURACION_POR_DEFECTO);
    setHorario({ salaId: '', inicio: null });
    setErrors({});
    setNotice(null);
    setExito(null);
    attempt.current = null;
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

  function onFechaChange(next: string) {
    setFecha(next);
    setErrors((prev) => ({ ...prev, fecha: undefined }));
    setHorario((current) => ({ ...current, inicio: null }));
  }

  if (exito) {
    return (
      <div className="page page--narrow">
        <section className="panel success-card" aria-live="polite">
          <div className="success-card__icon">
            <CalendarCheck size={28} aria-hidden="true" />
          </div>
          <h1>{CITA_EXITO.agendada(exito.folio)}</h1>
          <p>La cita quedó registrada con estatus Pendiente.</p>
          <dl className="data-grid">
            <div>
              <dt>Paciente</dt>
              <dd>{exito.paciente.nombre_completo}</dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd>{exito.terapeuta.nombre_completo}</dd>
            </div>
            <div>
              <dt>Sala</dt>
              <dd>{exito.sala.nombre}</dd>
            </div>
          </dl>
          {exito.confirmacion.enviada ? (
            <FormNotice type="success">
              Se envió la confirmación a {exito.confirmacion.destino}.
            </FormNotice>
          ) : exito.confirmacion.motivo === 'sin_correo' ? (
            <FormNotice type="info">{CITA_EXITO.sinCorreo}</FormNotice>
          ) : (
            <FormNotice type="error">{CITA_EXITO.falloCorreo}</FormNotice>
          )}
          <div className="success-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => navigate(LIST_PATH)}
            >
              Ir a citas
            </button>
            <button type="button" className="button button--primary" onClick={reiniciar}>
              <CalendarPlus size={16} aria-hidden="true" />
              Agendar otra cita
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <button type="button" className="back-link" onClick={cancel} disabled={saving}>
        <ChevronLeft size={16} aria-hidden="true" />
        Citas
      </button>

      <div className="page-head page-head--form">
        <div className="page-title">
          <span className="page-title__icon">
            <CalendarPlus size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>Agendar cita</h1>
            <p>Elige al paciente y al terapeuta, después la sala y un horario libre.</p>
          </div>
        </div>
      </div>

      {notice ? (
        <FormNotice
          ref={noticeRef}
          type="error"
          actions={
            notice.kind === 'red' ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void confirmar()}
              >
                <RotateCw size={15} aria-hidden="true" />
                Reintentar
              </button>
            ) : undefined
          }
        >
          {notice.text}
        </FormNotice>
      ) : null}

      <div className="cita-layout">
        <form
          className="panel form-panel"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            revisar();
          }}
        >
          <div className="form-section">
            <h2>Participantes</h2>
            <div className="form-grid">
              <PersonaSelector
                id="f-paciente"
                tipo="paciente"
                label="Paciente"
                placeholder="Busca por nombre"
                hint="Solo aparecen pacientes activos."
                error={errors.id_paciente}
                value={paciente}
                onChange={setPaciente}
                accessToken={session.token}
                disabled={saving}
              />
              <PersonaSelector
                id="f-terapeuta"
                tipo="terapeuta"
                label="Terapeuta"
                placeholder="Busca por nombre"
                hint="Solo aparecen terapeutas activos."
                error={errors.id_terapeuta}
                value={terapeuta}
                onChange={setTerapeuta}
                accessToken={session.token}
                disabled={saving}
              />
            </div>
          </div>

          <div className="form-section">
            <h2>Fecha</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="f-fecha">Fecha</label>
                <input
                  id="f-fecha"
                  type="date"
                  min={hoyEnClinica()}
                  value={fecha}
                  disabled={saving}
                  aria-invalid={Boolean(errors.fecha)}
                  aria-describedby="f-fecha-hint f-fecha-error"
                  onChange={(event) => onFechaChange(event.target.value)}
                />
                <span className="field-hint" id="f-fecha-hint">
                  Hoy o una fecha posterior. La clínica no atiende en domingo.
                </span>
                <span className="field-error" id="f-fecha-error" role="alert">
                  {errors.fecha}
                </span>
              </div>
            </div>
          </div>

          <SalaHorarioGrid
            fecha={fecha}
            fechaValida={fechaIsoValida}
            duracion={duracion}
            onDuracionChange={(minutos) => {
              setDuracion(minutos);
              setErrors((prev) => ({ ...prev, inicio: undefined }));
            }}
            idPaciente={paciente?.id}
            idTerapeuta={terapeuta?.id}
            value={horario}
            onChange={(next) => {
              setHorario(next);
              setErrors((prev) => ({ ...prev, inicio: undefined, id_sala: undefined }));
            }}
            error={errors.inicio ?? errors.id_sala}
            accessToken={session.token}
          />

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
                'Revisar y agendar'
              )}
            </button>
          </div>
        </form>

        <aside className="panel summary" aria-live="polite">
          <h2>Resumen de la cita</h2>
          <div className={`summary__when${horario.inicio != null ? '' : ' is-empty'}`}>
            {horario.inicio != null ? (
              <>
                <b>{fMedia(fecha)}</b>
                <span>
                  {minutosAHora(horario.inicio)} a {minutosAHora(horario.inicio + duracion)} ·{' '}
                  {etiquetaDuracion(duracion)}
                </span>
              </>
            ) : (
              <b>Fecha y hora por elegir</b>
            )}
          </div>
          <dl className="data-grid">
            <div>
              <dt>Estatus</dt>
              <dd>
                <span className="badge badge--pend">
                  <Clock size={12} aria-hidden="true" />
                  Pendiente
                </span>
              </dd>
            </div>
            <div>
              <dt>Paciente</dt>
              <dd className={paciente ? '' : 'is-empty'}>
                {paciente?.nombre_completo ?? 'Sin elegir'}
              </dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd className={terapeuta ? '' : 'is-empty'}>
                {terapeuta?.nombre_completo ?? 'Sin elegir'}
              </dd>
            </div>
            <div>
              <dt>Folio</dt>
              <dd className="is-empty">Se genera al guardar</dd>
            </div>
          </dl>
        </aside>
      </div>

      {confirming ? (
        <ActionDialog
          id="confirmar-cita"
          title="¿Confirmar los datos de la cita?"
          onEscape={saving ? undefined : () => setConfirming(false)}
          actions={[
            {
              label: 'Cancelar',
              variant: 'secondary',
              initialFocus: true,
              disabled: saving,
              onClick: () => setConfirming(false),
            },
            {
              label: 'Confirmar',
              busyLabel: 'Agendando...',
              variant: 'primary',
              busy: saving,
              onClick: () => {
                setConfirming(false);
                void confirmar();
              },
            },
          ]}
        >
          <p>Revisa que los datos sean correctos. Al confirmar se generará el folio.</p>
          <dl className="data-grid">
            <div>
              <dt>Paciente</dt>
              <dd>{paciente?.nombre_completo}</dd>
            </div>
            <div>
              <dt>Terapeuta</dt>
              <dd>{terapeuta?.nombre_completo}</dd>
            </div>
            <div>
              <dt>Sala</dt>
              <dd>{horario.salaNombre}</dd>
            </div>
            <div className="is-wide">
              <dt>Fecha</dt>
              <dd>{fLarga(fecha)}</dd>
            </div>
            <div>
              <dt>Horario</dt>
              <dd>
                {horario.inicio != null
                  ? `${minutosAHora(horario.inicio)} a ${minutosAHora(horario.inicio + duracion)}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>Estatus</dt>
              <dd>
                <span className="badge badge--pend">Pendiente</span>
              </dd>
            </div>
          </dl>
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
          <p>Tienes datos capturados que se perderán. ¿Quieres salir sin agendar esta cita?</p>
        </ActionDialog>
      ) : null}
    </div>
  );
}
