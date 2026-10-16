import type { PatientFormApi } from '../hooks/usePatientForm';
import { NAME_MAX, SEXO_OPTIONS } from '../validation';
import { PatientField } from './PatientField';

/**
 * Campos de identificación del paciente (PG-DSN-002 §5.5 y §5.6). Los comparten el registro y la
 * edición: el orden y las etiquetas siguen el de la ERS (RF 3.1.2 a 3.1.13).
 */
export function PatientFormFields({ form }: { form: PatientFormApi }) {
  return (
    <div className="form-section">
      <h2>Datos de identificación</h2>
      <div className="form-grid">
        <PatientField
          {...form.fieldProps('nombre')}
          kind="text"
          label="Nombre completo"
          full
          counterMax={NAME_MAX}
          inputProps={{ maxLength: NAME_MAX, autoComplete: 'name' }}
        />
        <PatientField
          {...form.fieldProps('curp')}
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
          {...form.fieldProps('sexo')}
          kind="select"
          label="Sexo"
          placeholder="Selecciona una opción"
          options={SEXO_OPTIONS}
        />
        <PatientField
          {...form.fieldProps('fechaNacimiento')}
          kind="date"
          label="Fecha de nacimiento"
          hint="dd/mm/aaaa"
        />
        <PatientField
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
        <PatientField
          {...form.fieldProps('correo')}
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
  );
}
