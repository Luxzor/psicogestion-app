import { useCallback, useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { patientsApi } from '../api';
import type { FieldKey, PatientFormValues } from '../types';
import { normalizeInput, validateField } from '../validation';

export const PATIENT_FIELDS: FieldKey[] = [
  'nombre',
  'curp',
  'sexo',
  'fechaNacimiento',
  'telefono',
  'correo',
];

const UNIQUE_FIELDS = ['curp', 'telefono'] as const;

/** Traducción de los nombres de campo del servidor a los del formulario. */
const SERVER_FIELDS: Record<string, FieldKey> = {
  nombre_completo: 'nombre',
  curp: 'curp',
  sexo: 'sexo',
  fecha_nacimiento: 'fechaNacimiento',
  telefono: 'telefono',
  correo: 'correo',
};

export const EMPTY_PATIENT_FORM: PatientFormValues = {
  nombre: '',
  curp: '',
  sexo: '',
  fechaNacimiento: '',
  telefono: '',
  correo: '',
};

const UNIQUENESS_DELAY_MS = 400;

export type PatientFormErrors = Partial<Record<FieldKey, string>>;
export type PatientFormNotice = { kind: 'resumen' | 'red' | 'error'; text: string } | null;

export type UsePatientFormOptions = {
  accessToken: string;
  /** Valores con los que arranca el formulario; la edición los prellena con el perfil. */
  initialValues?: PatientFormValues;
  /** Excluye al propio paciente de la verificación de unicidad al editar (RF 3.2.5). */
  excluirId?: string;
  /**
   * Fecha contra la que se mide la edad mínima. Al editar es la fecha de registro del paciente,
   * no hoy (PG-DSN-002 §4.5). Si se omite, se usa el día actual.
   */
  registrationDate?: string;
  /** Suciedad ajena a los campos, como la casilla de consentimiento del registro. */
  extraDirty?: boolean;
  /** Operación en curso; cuenta como operación activa para el cierre de sesión (§5.11). */
  busy?: boolean;
};

export const patientFieldId = (field: FieldKey) => `paciente-${field}`;

const isUniqueField = (field: FieldKey): field is (typeof UNIQUE_FIELDS)[number] =>
  (UNIQUE_FIELDS as readonly FieldKey[]).includes(field);

const summaryText = (count: number) =>
  count === 1
    ? 'Hay 1 campo por corregir. Revisa el mensaje junto al campo.'
    : `Hay ${count} campos por corregir. Revisa los mensajes junto a cada campo.`;

/**
 * Comportamiento común de los formularios de paciente (PG-DSN-002 §5.3): validación al salir del
 * campo y al enviar, unicidad anticipada tras 400 ms, resumen de errores con foco en el primero,
 * aviso de falla de red y registro de la operación en curso para el cierre de sesión.
 *
 * Lo propio de cada pantalla (el alta con Idempotency-Key y reactivación, o la edición con PATCH
 * y versión) vive en la página; aquí solo está lo que ambas comparten.
 */
export function usePatientForm(options: UsePatientFormOptions) {
  const { accessToken, excluirId, registrationDate, extraDirty = false, busy = false } = options;
  const initialValues = options.initialValues ?? EMPTY_PATIENT_FORM;

  const { setHasUnsavedChanges } = useUnsavedChanges();
  const [values, setValues] = useState<PatientFormValues>(initialValues);
  const [formatErrors, setFormatErrors] = useState<PatientFormErrors>({});
  const [remoteErrors, setRemoteErrors] = useState<PatientFormErrors>({});
  const [checking, setChecking] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [notice, setNotice] = useState<PatientFormNotice>(null);

  // Los valores con los que arrancó el formulario: contra ellos se mide si está sucio. Van en
  // estado y no en una referencia porque se leen durante el render.
  const [initialSnapshot] = useState(initialValues);

  const valuesRef = useRef(values);
  const formatErrorsRef = useRef(formatErrors);
  const remoteErrorsRef = useRef(remoteErrors);
  const timers = useRef<Partial<Record<FieldKey, ReturnType<typeof setTimeout>>>>({});
  const controllers = useRef<Partial<Record<FieldKey, AbortController>>>({});

  const dirty =
    extraDirty || PATIENT_FIELDS.some((field) => values[field] !== initialSnapshot[field]);
  const errorOf = (field: FieldKey) => formatErrors[field] || remoteErrors[field] || '';

  const applyFormatErrors = (next: PatientFormErrors) => {
    formatErrorsRef.current = next;
    setFormatErrors(next);
  };
  const applyRemoteErrors = (next: PatientFormErrors) => {
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

  const focusField = (field: FieldKey) => document.getElementById(patientFieldId(field))?.focus();

  function showFieldErrors(format: PatientFormErrors, remote: PatientFormErrors) {
    const withErrors = PATIENT_FIELDS.filter((field) => format[field] || remote[field]);
    setNotice({ kind: 'resumen', text: summaryText(withErrors.length) });
    if (withErrors[0]) focusField(withErrors[0]);
  }

  /** Unicidad anticipada tras 400 ms sin escribir (RNF 3.1.3). El servidor decide al guardar. */
  const scheduleUniqueness = useCallback(
    (field: FieldKey, next: PatientFormValues) => {
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
        // excluir_id solo viaja cuando hay un paciente que excluir: el alta manda el cuerpo
        // mínimo que espera el contrato.
        const scope = excluirId ? { excluir_id: excluirId } : {};
        const body =
          field === 'curp'
            ? { campo: 'curp' as const, valor: value, ...scope }
            : {
                campo: 'telefono' as const,
                valor: value,
                curp: valuesRef.current.curp || undefined,
                ...scope,
              };
        patientsApi
          .checkAvailability(body, accessToken, controller.signal)
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

  function handleChange(field: FieldKey, raw: string) {
    const value = normalizeInput(field, raw);
    const next = { ...valuesRef.current, [field]: value };
    valuesRef.current = next;
    setValues(next);
    applyRemoteErrors({ ...remoteErrorsRef.current, [field]: '' });

    const shouldValidateNow =
      Boolean(formatErrorsRef.current[field]) ||
      field === 'sexo' ||
      (field === 'fechaNacimiento' && value.length === 10);
    const nextFormatErrors = shouldValidateNow
      ? { ...formatErrorsRef.current, [field]: validateField(field, next, registrationDate) }
      : formatErrorsRef.current;
    if (shouldValidateNow) applyFormatErrors(nextFormatErrors);

    scheduleUniqueness(field, next);
    if (field === 'curp' && next.telefono) scheduleUniqueness('telefono', next);

    if (notice?.kind === 'resumen') {
      const remaining = PATIENT_FIELDS.filter(
        (key) => nextFormatErrors[key] || (key !== field && remoteErrorsRef.current[key]),
      );
      if (!remaining.length) setNotice(null);
    }
  }

  function handleBlur(field: FieldKey) {
    applyFormatErrors({
      ...formatErrorsRef.current,
      [field]: validateField(field, valuesRef.current, registrationDate),
    });
  }

  /** Valida todos los campos; si hay errores muestra el resumen y enfoca el primero. */
  function validateAll() {
    const current = valuesRef.current;
    const nextFormat: PatientFormErrors = {};
    PATIENT_FIELDS.forEach((field) => {
      nextFormat[field] = validateField(field, current, registrationDate);
    });
    applyFormatErrors(nextFormat);
    if (PATIENT_FIELDS.some((field) => nextFormat[field] || remoteErrorsRef.current[field])) {
      showFieldErrors(nextFormat, remoteErrorsRef.current);
      return false;
    }
    return true;
  }

  /** Pinta junto a cada campo los errores que devolvió el servidor; indica si reconoció alguno. */
  function applyServerFields(campos: Record<string, string>) {
    const nextRemote: PatientFormErrors = { ...remoteErrorsRef.current };
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

  /** Props que necesita PatientField para un campo; lo visual lo pone PatientFormFields. */
  const fieldProps = (field: FieldKey) => ({
    id: patientFieldId(field),
    value: values[field],
    error: errorOf(field),
    checking: Boolean(checking[field]),
    fieldKey: field,
    onFieldChange: handleChange,
    onFieldBlur: handleBlur,
  });

  return {
    values,
    /** Valores más recientes, sin esperar al siguiente render. */
    getValues: () => valuesRef.current,
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

export type PatientFormApi = ReturnType<typeof usePatientForm>;
