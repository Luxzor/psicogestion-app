import { useCallback, useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { therapistsApi } from '../api';
import type { TherapistFieldKey, TherapistFormValues } from '../types';
import { EDITABLE_FIELDS, normalizeInput, validateField } from '../validation';

const UNIQUE_FIELDS = ['telefono', 'correo', 'cedula'] as const;

/** Traducción de los nombres de campo del servidor a los del formulario. */
const SERVER_FIELDS: Record<string, TherapistFieldKey> = {
  nombre_completo: 'nombre',
  telefono: 'telefono',
  correo_electronico: 'correo',
  correo: 'correo',
  fecha_nacimiento: 'fechaNacimiento',
  cedula_profesional: 'cedula',
  cedula: 'cedula',
};

export const EMPTY_THERAPIST_FORM: TherapistFormValues = {
  nombre: '',
  telefono: '',
  correo: '',
  fechaNacimiento: '',
  cedula: '',
};

const UNIQUENESS_DELAY_MS = 400;

export type TherapistFormErrors = Partial<Record<TherapistFieldKey, string>>;
export type TherapistFormNotice = { kind: 'resumen' | 'red' | 'error' | 'foto'; text: string } | null;

export type UseTherapistFormOptions = {
  accessToken: string;
  /** Valores con los que arranca el formulario; la edición los prellena con el perfil. */
  initialValues?: TherapistFormValues;
  /** Excluye al propio terapeuta de la verificación de unicidad al editar (RF 2.2.4). */
  excluirId?: string;
  /**
   * Fecha contra la que se mide "anterior a la fecha de registro" (RF 2.1.9). Al editar es la
   * fecha de registro del terapeuta, no hoy (mismo criterio que PG-DSN-002 §4.5 para pacientes).
   */
  registrationDate?: string;
  /** Operación en curso; cuenta como operación activa para el cierre de sesión (§5.11). */
  busy?: boolean;
};

export const therapistFieldId = (field: TherapistFieldKey) => `terapeuta-${field}`;

const isUniqueField = (field: TherapistFieldKey): field is (typeof UNIQUE_FIELDS)[number] =>
  (UNIQUE_FIELDS as readonly TherapistFieldKey[]).includes(field);

const summaryText = (count: number) =>
  count === 1
    ? 'Hay 1 campo por corregir. Revisa el mensaje junto al campo.'
    : `Hay ${count} campos por corregir. Revisa los mensajes junto a cada campo.`;

/**
 * Comportamiento común de la edición de terapeuta (PG-DSN-002 §5.9): validación al salir del
 * campo y al enviar, unicidad anticipada tras 400 ms, resumen de errores con foco en el primero,
 * y registro de la operación en curso para el cierre de sesión. El registro (EDT 4.3.4) no usa
 * este hook: tiene su propia lógica dentro de RegistroTerapeutaPage y no se tocó.
 */
export function useTherapistForm(options: UseTherapistFormOptions) {
  const { accessToken, excluirId, registrationDate, busy = false } = options;
  const initialValues = options.initialValues ?? EMPTY_THERAPIST_FORM;

  const { setHasUnsavedChanges } = useUnsavedChanges();
  const [values, setValues] = useState<TherapistFormValues>(initialValues);
  const [formatErrors, setFormatErrors] = useState<TherapistFormErrors>({});
  const [remoteErrors, setRemoteErrors] = useState<TherapistFormErrors>({});
  const [checking, setChecking] = useState<Partial<Record<TherapistFieldKey, boolean>>>({});
  const [notice, setNotice] = useState<TherapistFormNotice>(null);

  // Los valores con los que arrancó el formulario: contra ellos se mide si está sucio.
  const [initialSnapshot, setInitialSnapshot] = useState(initialValues);

  const valuesRef = useRef(values);
  const formatErrorsRef = useRef(formatErrors);
  const remoteErrorsRef = useRef(remoteErrors);
  const timers = useRef<Partial<Record<TherapistFieldKey, ReturnType<typeof setTimeout>>>>({});
  const controllers = useRef<Partial<Record<TherapistFieldKey, AbortController>>>({});

  const dirty = EDITABLE_FIELDS.some((field) => values[field] !== initialSnapshot[field]);
  const errorOf = (field: TherapistFieldKey) => formatErrors[field] || remoteErrors[field] || '';

  const applyFormatErrors = (next: TherapistFormErrors) => {
    formatErrorsRef.current = next;
    setFormatErrors(next);
  };
  const applyRemoteErrors = (next: TherapistFormErrors) => {
    remoteErrorsRef.current = next;
    setRemoteErrors(next);
  };

  useEffect(() => {
    setHasUnsavedChanges(dirty || busy);
  }, [dirty, busy, setHasUnsavedChanges]);

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

  const focusField = (field: TherapistFieldKey) =>
    document.getElementById(therapistFieldId(field))?.focus();

  function showFieldErrors(format: TherapistFormErrors, remote: TherapistFormErrors) {
    const withErrors = EDITABLE_FIELDS.filter((field) => format[field] || remote[field]);
    setNotice({ kind: 'resumen', text: summaryText(withErrors.length) });
    if (withErrors[0]) focusField(withErrors[0]);
  }

  /** Unicidad anticipada tras 400 ms sin escribir (RNF 2.1.4). El servidor decide al guardar. */
  const scheduleUniqueness = useCallback(
    (field: TherapistFieldKey, next: TherapistFormValues) => {
      if (!isUniqueField(field)) return;
      clearTimeout(timers.current[field]);
      controllers.current[field]?.abort();
      setChecking((current) => ({ ...current, [field]: false }));
      if (validateField(field, next, registrationDate)) return;

      const value = next[field];
      timers.current[field] = setTimeout(() => {
        const controller = new AbortController();
        controllers.current[field] = controller;
        setChecking((current) => ({ ...current, [field]: true }));
        const scope = excluirId ? { excluir_id: excluirId } : {};
        therapistsApi
          .checkAvailability({ campo: field, valor: value, ...scope }, accessToken, controller.signal)
          .then((result) => {
            if (valuesRef.current[field] !== value) return;
            applyRemoteErrors({
              ...remoteErrorsRef.current,
              [field]: result.disponible ? '' : (result.mensaje ?? 'Este dato ya está registrado.'),
            });
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
    [accessToken, excluirId, registrationDate],
  );

  function handleChange(field: TherapistFieldKey, raw: string) {
    const value = normalizeInput(field, raw);
    const next = { ...valuesRef.current, [field]: value };
    valuesRef.current = next;
    setValues(next);
    applyRemoteErrors({ ...remoteErrorsRef.current, [field]: '' });

    const shouldValidateNow =
      Boolean(formatErrorsRef.current[field]) ||
      (field === 'fechaNacimiento' && value.length === 10);
    const nextFormatErrors = shouldValidateNow
      ? { ...formatErrorsRef.current, [field]: validateField(field, next, registrationDate) }
      : formatErrorsRef.current;
    if (shouldValidateNow) applyFormatErrors(nextFormatErrors);

    scheduleUniqueness(field, next);

    if (notice?.kind === 'resumen') {
      const remaining = EDITABLE_FIELDS.filter(
        (key) => nextFormatErrors[key] || (key !== field && remoteErrorsRef.current[key]),
      );
      if (!remaining.length) setNotice(null);
    }
  }

  function handleBlur(field: TherapistFieldKey) {
    applyFormatErrors({
      ...formatErrorsRef.current,
      [field]: validateField(field, valuesRef.current, registrationDate),
    });
  }

  /** Valida todos los campos; si hay errores muestra el resumen y enfoca el primero. */
  function validateAll() {
    const current = valuesRef.current;
    const nextFormat: TherapistFormErrors = {};
    EDITABLE_FIELDS.forEach((field) => {
      nextFormat[field] = validateField(field, current, registrationDate);
    });
    applyFormatErrors(nextFormat);
    if (EDITABLE_FIELDS.some((field) => nextFormat[field] || remoteErrorsRef.current[field])) {
      showFieldErrors(nextFormat, remoteErrorsRef.current);
      return false;
    }
    return true;
  }

  /** Pinta junto a cada campo los errores que devolvió el servidor; indica si reconoció alguno. */
  function applyServerFields(campos: Record<string, string>) {
    const nextRemote: TherapistFormErrors = { ...remoteErrorsRef.current };
    let recognized = false;
    Object.entries(campos).forEach(([serverField, message]) => {
      const field = SERVER_FIELDS[serverField];
      if (field) {
        nextRemote[field] = message;
        recognized = true;
      }
    });
    applyRemoteErrors(nextRemote);
    showFieldErrors(formatErrorsRef.current, nextRemote);
    return recognized;
  }

  /** Props que necesita TherapistField para un campo. */
  const fieldProps = (field: TherapistFieldKey) => ({
    id: therapistFieldId(field),
    value: values[field],
    error: errorOf(field),
    checking: Boolean(checking[field]),
    fieldKey: field,
    onFieldChange: handleChange,
    onFieldBlur: handleBlur,
  });

  /**
   * Reajusta el punto de partida y los valores visibles. Lo usa la edición tras un conflicto de
   * versión: se recarga el perfil vigente y se reaplica encima lo que el usuario había
   * capturado (PG-DSN-002 §5.9).
   */
  function rebase(nextInitial: TherapistFormValues, nextValues: TherapistFormValues) {
    setInitialSnapshot(nextInitial);
    valuesRef.current = nextValues;
    setValues(nextValues);
  }

  return {
    values,
    /** Valores más recientes, sin esperar al siguiente render. */
    getValues: () => valuesRef.current,
    initialValues: initialSnapshot,
    rebase,
    dirty,
    notice,
    setNotice,
    errorOf,
    fieldProps,
    handleChange,
    handleBlur,
    validateAll,
    applyServerFields,
    clearUnsavedChanges: () => setHasUnsavedChanges(false),
  };
}

export type TherapistFormApi = ReturnType<typeof useTherapistForm>;
