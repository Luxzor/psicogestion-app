import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import './styles.css';
import './features/auth/styles/auth.css';
import './features/auth/styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Transición suave de salida para la pantalla de carga (Splash Screen)
const splashEl = document.getElementById('splash-screen');
if (splashEl) {
  const progressBar = document.getElementById('splash-progress');
  if (progressBar) {
    progressBar.style.animation = 'none';
    progressBar.style.width = '100%';
  }
  setTimeout(() => {
    splashEl.classList.add('splash-fade-out');
    setTimeout(() => {
      splashEl.remove();
    }, 450);
  }, 400);
}
