import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ApiError } from '../../../auth/api';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import type { Session } from '../../auth/types';
import { ActionDialog } from '../../pacientes/components/ActionDialog';
import { FormNotice } from '../../pacientes/components/FormNotice';
import { citasApi } from '../api';
import { PersonaSelector, type PersonaOption } from '../components/PersonaSelector';
import { citaKeys, disponibilidadKeys, useCita, useSalasActivas } from '../hooks/useCitas';
import { BLOQUES_DEL_DIA, DURACIONES, etiquetaDuracion, minutosAHora } from '../horario';
import type { Cita, CitaEstado, CitaFormValues } from '../types';
import { CITA_ESTADOS } from '../types';
import { diffCitaPayload, mensajeDeError, toCitaFormValues, validateCitaForm } from '../validation';
import '../../pacientes/styles/pacientes.css';
import '../styles/citas.css';

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'codigo' in error && 'mensaje' in error;

/** RF 5.3.1–5.3.6. Carga la cita antes de montar el formulario para no borrar cambios locales. */
export function EditarCitaPage({ session }: { session: Session }) {
  const { id = '' } = useParams<{ id: string }>();
  const detalle = useCita(id, session.token);
  const [guardada, setGuardada] = useState<Cita | null>(null);

  if (guardada) {
    return (
      <div className="page page--narrow">
        <FormNotice type="success">Cita modificada con éxito. Folio {guardada.folio}.</FormNotice>
        <Link to={`/inicio/citas/${guardada.id}`} className="button button--primary">
          Ver cita
        </Link>
      </div>
    );
  }
  if (detalle.isPending) return <div className="page">Cargando la cita...</div>;
  if (detalle.isError) {
    return (
      <div className="page page--narrow">
        <FormNotice type="error">
          No pudimos cargar la cita. Revisa el enlace o la conexión.
        </FormNotice>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void detalle.refetch()}
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (detalle.data.estado !== 'Pendiente') {
    return (
      <div className="page page--narrow">
        <FormNotice type="error">Esta cita ya no está pendiente y no puede modificarse.</FormNotice>
        <Link to={`/inicio/citas/${id}`} className="button button--secondary">
          Ver cita
        </Link>
      </div>
    );
  }
  return (
    <EditarCitaForm
      key={`${id}-${detalle.data.version}`}
      cita={detalle.data}
      session={session}
      onSaved={setGuardada}
    />
  );
}

function EditarCitaForm({
  cita,
  session,
  onSaved,
}: {
  cita: Cita;
  session: Session;
  onSaved: (cita: Cita) => void;
}) {
  const queryClient = useQueryClient();
  const salas = useSalasActivas(session.token);
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const inicial = toCitaFormValues(cita);
  const [values, setValues] = useState<CitaFormValues>(inicial);
  const [paciente, setPaciente] = useState<PersonaOption | null>({
    ...cita.paciente,
    activo: true,
  });
  const [terapeuta, setTerapeuta] = useState<PersonaOption | null>({
    ...cita.terapeuta,
    activo: true,
  });
  const [estado, setEstado] = useState<CitaEstado>(cita.estado);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(diffCitaPayload(cita, values, estado));

  useEffect(() => {
    setHasUnsavedChanges(dirty);
    return () => setHasUnsavedChanges(false);
  }, [dirty, setHasUnsavedChanges]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function change<K extends keyof CitaFormValues>(field: K, value: CitaFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    setNotice('');
  }

  function review() {
    const next = validateCitaForm(values, {
      modo: 'editar',
      inicial,
      paciente: paciente ? { activo: paciente.activo } : null,
      terapeuta: terapeuta ? { activo: terapeuta.activo } : null,
      sala: { activo: true },
    });
    setErrors(next);
    if (Object.keys(next).length) {
      setNotice('Revisa los campos marcados.');
      return;
    }
    if (!dirty) {
      setNotice('No hay cambios para guardar.');
      return;
    }
    const payload = diffCitaPayload(cita, values, estado);
    if (
      estado !== 'Pendiente' &&
      payload &&
      Object.keys(payload).some((key) => key !== 'version' && key !== 'estado')
    ) {
      setNotice('Guarda los cambios de datos antes de cambiar el estatus.');
      return;
    }
    if (estado === 'Vencida' && new Date(cita.fin).getTime() > Date.now()) {
      setNotice('Una cita futura no puede marcarse como vencida.');
      return;
    }
    setNotice('');
    setConfirming(true);
  }

  async function save() {
    const payload = diffCitaPayload(cita, values, estado);
    if (!payload || saving) return;
    setSaving(true);
    try {
      const updated = await citasApi.update(cita.id, payload, session.token);
      queryClient.setQueryData(citaKeys.detalle(cita.id), updated);
      void queryClient.invalidateQueries({ queryKey: citaKeys.todo });
      void queryClient.invalidateQueries({ queryKey: disponibilidadKeys.todo });
      void queryClient.invalidateQueries({ queryKey: ['salas'] });
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
      setHasUnsavedChanges(false);
      onSaved(updated);
    } catch (error) {
      const apiError = isApiError(error) ? error : null;
      setConflict(apiError?.codigo === 'CONFLICTO_VERSION');
      setErrors(apiError?.campos ?? {});
      setNotice(
        apiError
          ? (mensajeDeError(apiError.codigo) ?? apiError.mensaje)
          : 'No se pudo guardar. Tus datos se conservan; reintenta.',
      );
      setConfirming(false);
      if (apiError?.codigo?.endsWith('_OCUPADO'))
        void queryClient.invalidateQueries({ queryKey: disponibilidadKeys.todo });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page page--narrow">
      <Link to={`/inicio/citas/${cita.id}`} className="back-link">
        Volver a la cita
      </Link>
      <div className="page-head">
        <div className="page-title">
          <div>
            <h1>Modificar cita {cita.folio}</h1>
            <p>Corrige los datos y confirma antes de guardar.</p>
          </div>
        </div>
      </div>
      {notice ? (
        <FormNotice type="error">
          {notice}
          {conflict ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: citaKeys.detalle(cita.id) });
              }}
            >
              Ver cambios actuales
            </button>
          ) : null}
        </FormNotice>
      ) : null}
      <form
        className="panel form-panel"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          review();
        }}
      >
        <div className="form-section">
          <h2>Participantes</h2>
          <div className="form-grid">
            <PersonaSelector
              id="e-paciente"
              tipo="paciente"
              label="Paciente"
              placeholder="Busca por nombre"
              value={paciente}
              onChange={(option) => {
                setPaciente(option);
                change('id_paciente', option?.id ?? '');
              }}
              accessToken={session.token}
              error={errors.id_paciente}
              disabled={saving}
            />
            <PersonaSelector
              id="e-terapeuta"
              tipo="terapeuta"
              label="Terapeuta"
              placeholder="Busca por nombre"
              value={terapeuta}
              onChange={(option) => {
                setTerapeuta(option);
                change('id_terapeuta', option?.id ?? '');
              }}
              accessToken={session.token}
              error={errors.id_terapeuta}
              disabled={saving}
            />
          </div>
        </div>
        <div className="form-section">
          <h2>Horario</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="e-sala">Sala</label>
              <select
                id="e-sala"
                value={values.id_sala}
                onChange={(event) => change('id_sala', event.target.value)}
                disabled={saving}
                aria-invalid={Boolean(errors.id_sala)}
              >
                <option value="">Elige una sala</option>
                {!salas.data?.salas.some((s) => s.id === cita.sala.id) ? (
                  <option value={cita.sala.id}>{cita.sala.nombre}</option>
                ) : null}
                {salas.data?.salas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
              {errors.id_sala ? (
                <span className="field-error" role="alert">
                  {errors.id_sala}
                </span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="e-fecha">Fecha</label>
              <input
                id="e-fecha"
                type="date"
                value={values.fecha}
                onChange={(event) => change('fecha', event.target.value)}
                disabled={saving}
                aria-invalid={Boolean(errors.fecha)}
              />
              {errors.fecha ? (
                <span className="field-error" role="alert">
                  {errors.fecha}
                </span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="e-hora">Hora</label>
              <select
                id="e-hora"
                value={values.inicio ?? ''}
                onChange={(event) =>
                  change('inicio', event.target.value ? Number(event.target.value) : null)
                }
                disabled={saving}
                aria-invalid={Boolean(errors.inicio)}
              >
                <option value="">Elige una hora</option>
                {BLOQUES_DEL_DIA.map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {minutosAHora(minutos)}
                  </option>
                ))}
              </select>
              {errors.inicio ? (
                <span className="field-error" role="alert">
                  {errors.inicio}
                </span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="e-duracion">Duración</label>
              <select
                id="e-duracion"
                value={values.duracion}
                onChange={(event) => change('duracion', Number(event.target.value))}
                disabled={saving}
              >
                {DURACIONES.map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {etiquetaDuracion(minutos)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="e-estado">Estatus</label>
              <select
                id="e-estado"
                value={estado}
                onChange={(event) => {
                  setEstado(event.target.value as CitaEstado);
                  setNotice('');
                }}
                disabled={saving}
              >
                {CITA_ESTADOS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Una cita cancelada o vencida queda en solo lectura.
              </span>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="button button--primary" type="submit" disabled={saving}>
            Revisar y guardar
          </button>
        </div>
      </form>
      {confirming ? (
        <ActionDialog
          id="confirmar-cita"
          title="Confirmar modificación"
          onEscape={() => !saving && setConfirming(false)}
          actions={[
            {
              label: 'Volver',
              variant: 'secondary',
              onClick: () => setConfirming(false),
              initialFocus: true,
              disabled: saving,
            },
            {
              label: 'Guardar cambios',
              variant: 'primary',
              onClick: () => void save(),
              busy: saving,
              busyLabel: 'Guardando...',
            },
          ]}
        >
          <p>¿Guardar los cambios de la cita {cita.folio}?</p>
        </ActionDialog>
      ) : null}
    </div>
  );
}
