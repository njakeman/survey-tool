import { render } from 'preact';
import { html } from 'htm/preact';
import { registerSW } from 'virtual:pwa-register';
import { ProbePage } from './probe/ProbePage.js';
import { formatError } from './error-display.js';
import './style.css';

// A blank screen with no console access (no Mac nearby for Web Inspector) is
// undiagnosable in the field. Anything that throws during startup — or later,
// uncaught — renders here instead of leaving #app empty.
function showFatalError(errorLike) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space: pre-wrap; padding: 1rem; color: #b00; font-size: 0.85rem;';
  pre.textContent = `Something went wrong loading the app:\n\n${formatError(errorLike)}`;
  app.appendChild(pre);
}

window.addEventListener('error', (event) => showFatalError(event));
window.addEventListener('unhandledrejection', (event) => showFatalError(event.reason));

try {
  registerSW({ immediate: true });
  render(html`<${ProbePage} />`, document.getElementById('app'));
} catch (error) {
  showFatalError(error);
}
