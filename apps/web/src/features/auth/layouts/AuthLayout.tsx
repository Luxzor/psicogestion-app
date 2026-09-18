import type { ReactNode } from 'react';
import panelUrl from '../../../../assets/gradient-panel.jpg';
import darkLogoUrl from '../../../../assets/PsicoGestión_dark.png';
import lightLogoUrl from '../../../../assets/PsicoGestión_light.png';
import seapDarkLogoUrl from '../../../../assets/logo_seap_dark.png';

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="Acceso PsicoGestion">
        <div className="auth-visual" aria-hidden="true">
          <img className="auth-visual__image" src={panelUrl} alt="" />
          <img className="auth-visual__seap" src={seapDarkLogoUrl} alt="" />
          <div className="auth-visual__copy">
            <img className="auth-visual__logo" src={darkLogoUrl} alt="" />
            <span>Gestión institucional segura para la atención psicológica.</span>
          </div>
        </div>

        <div className="auth-panel" aria-labelledby="page-title">
          <img className="auth-logo" src={lightLogoUrl} alt="PsicoGestión" />
          <div className="auth-panel__header">
            <h2 id="page-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
