import { createRoot } from 'react-dom/client';
import { LangProvider } from '@/lib/i18n';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <LangProvider>
    <App />
  </LangProvider>
);
