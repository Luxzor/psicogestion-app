import type { ReactNode } from 'react';

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-hero" aria-label="PsicoGestion UADY">
        <div className="auth-hero__content">
          <p className="auth-kicker">SEAP - UADY</p>
          <h1>PsicoGestion</h1>
          <p>
            Acceso institucional para la gestión segura de procesos psicológicos y académicos.
          </p>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="page-title">
        <div className="auth-panel__header">
          <p className="auth-kicker">Cuenta institucional</p>
          <h2 id="page-title">{title}</h2>
          <p>{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
