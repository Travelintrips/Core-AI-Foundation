import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { LangProvider } from '@/lib/i18n';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <HelmetProvider>
    <LangProvider>
      <App />
    </LangProvider>
  </HelmetProvider>
);
