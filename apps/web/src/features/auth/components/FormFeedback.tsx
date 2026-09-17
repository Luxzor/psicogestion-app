import type { Notice } from '../types';

export function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      className={`notice ${notice.type}`}
      role={notice.type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {notice.text}
    </p>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="field-error" role="alert">
      {message}
    </span>
  );
}
