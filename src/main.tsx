import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import i18n from './i18n';
import { syncDocumentLanguage } from './utils/syncDocumentLanguage';
import { syncDocumentTheme } from './utils/syncDocumentTheme';
import App from './App.tsx';
import { AppDialogProvider } from './components/AppDialogProvider';
import './index.css';
import { registerDevBuiltinAgentReset } from './dev/resetBuiltinAgents';
import { DesktopOnlyNotice } from './components/DesktopOnlyNotice';
import { shouldRenderFullApp } from './utils/appRuntimeGate';
import logoUrl from './assets/LOGO.png';

registerDevBuiltinAgentReset();
syncDocumentLanguage(i18n);
syncDocumentTheme();

const canRunFullApp = shouldRenderFullApp();

document.title = 'Spoor';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = logoUrl;
if (!favicon.parentNode) document.head.appendChild(favicon);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDialogProvider>
      {canRunFullApp ? <App /> : <DesktopOnlyNotice />}
    </AppDialogProvider>
  </StrictMode>,
);
