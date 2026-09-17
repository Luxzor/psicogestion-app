import type { ReactNode } from 'react';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="card" aria-labelledby="page-title">
        <p className="brand">SEAP · UADY</p>
        <h1 id="page-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}
