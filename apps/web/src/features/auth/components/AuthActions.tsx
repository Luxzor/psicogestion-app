import type { ReactNode } from 'react';

export function AuthActions({ children }: { children: ReactNode }) {
  return <div className="auth-actions">{children}</div>;
}

export function SubmitButton({ children, busy }: { children: ReactNode; busy: boolean }) {
  return (
    <button className="button button--primary" type="submit" disabled={busy}>
      {children}
    </button>
  );
}
