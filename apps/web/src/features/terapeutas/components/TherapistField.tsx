import type { InputHTMLAttributes } from 'react';
import { useRef } from 'react';
import { Calendar, LoaderCircle } from 'lucide-react';
import type { TherapistFieldKey } from '../types';
import { displayFromIso, isoFromDate, parseDisplayDate } from '../validation';

type BaseProps = {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  checking?: boolean;
  optional?: boolean;
  full?: boolean;
  counterMax?: number;
  disabled?: boolean;
  fieldKey: TherapistFieldKey;
  onFieldChange: (field: TherapistFieldKey, value: string) => void;
  onFieldBlur: (field: TherapistFieldKey) => void;
};

type TextProps = BaseProps & {
  kind: 'text';
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

type DateProps = BaseProps & { kind: 'date' };

/** Campo de formulario de terapeuta conforme a PG-DSN-002-INT. */
export function TherapistField(props: TextProps | DateProps) {
  const { id, label, value, error, hint, checking, optional, full, counterMax, disabled } = props;
  const { fieldKey, onFieldChange, onFieldBlur } = props;
  const change = (next: string) => onFieldChange(fieldKey, next);
  const nativeDate = useRef<HTMLInputElement>(null);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const common = {
    id,
    name: id,
    value,
    disabled,
    'aria-invalid': Boolean(error),
    'aria-describedby': `${hintId} ${errorId}`,
    onBlur: () => onFieldBlur(fieldKey),
  };
  const showHint = checking || (!error && Boolean(hint));

  function openCalendar() {
    const input = nativeDate.current;
    if (!input) return;
    const parsed = parseDisplayDate(value);
    if (parsed.iso) input.value = parsed.iso;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  let control;
  if (props.kind === 'date') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    control = (
      <div className="field-input-wrapper">
        <input
          {...common}
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          maxLength={10}
          autoComplete="bday"
          onChange={(event) => change(event.target.value)}
        />
        <button
          type="button"
          className="field-toggle-password"
          aria-label="Abrir calendario"
          disabled={disabled}
          onClick={openCalendar}
        >
          <Calendar size={18} aria-hidden="true" />
        </button>
        <input
          ref={nativeDate}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="field-native-date"
          max={isoFromDate(yesterday)}
          onChange={(event) => {
            if (event.target.value) change(displayFromIso(event.target.value));
          }}
        />
      </div>
    );
  } else {
    control = (
      <input
        {...common}
        type="text"
        {...props.inputProps}
        onChange={(event) => change(event.target.value)}
      />
    );
  }

  return (
    <div className={`field${full ? ' is-full' : ''}`}>
      <span className="field__label">
        <label htmlFor={id}>
          {label}
          {optional ? <span className="field__opt"> (opcional)</span> : null}
        </label>
        {counterMax ? (
          <small id={`${id}-count`} aria-hidden="true">
            {value.length}/{counterMax}
          </small>
        ) : null}
      </span>
      {control}
      <span className="field-hint" id={hintId} hidden={!showHint}>
        {checking ? (
          <span className="field-checking">
            <LoaderCircle size={13} aria-hidden="true" />
            Verificando que no esté registrado...
          </span>
        ) : (
          hint
        )}
      </span>
      <span className="field-error" id={errorId} role="alert">
        {error}
      </span>
    </div>
  );
}
