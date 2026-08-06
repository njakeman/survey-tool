import { render } from 'preact';
import { html } from 'htm/preact';
import { registerSW } from 'virtual:pwa-register';
import { ProbePage } from './probe/ProbePage.js';
import './style.css';

registerSW({ immediate: true });

render(html`<${ProbePage} />`, document.getElementById('app'));
