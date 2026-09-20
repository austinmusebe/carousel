import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { logFrontend } from './lib/tauri';

window.addEventListener('error', (e) => {
  logFrontend('ERROR', `Uncaught exception: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
});

window.addEventListener('unhandledrejection', (e) => {
  logFrontend('ERROR', `Unhandled promise rejection: ${e.reason}`);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

