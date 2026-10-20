// Transmission Studio — hash router
import { $, h } from './util.js';
import { logoSvg } from './scenes/renderer.js';
import { previewAudio } from './preview.js';

$('#brand-logo').innerHTML = logoSvg('#fff');

const routes = [
  [/^#?\/?$/, () => import('./views/dashboard.js')],
  [/^#\/library$/, () => import('./views/dashboard.js'), { tab: 'sfx' }],
  [/^#\/project\/(\d+)$/, () => import('./views/editor.js')],
  [/^#\/project\/(\d+)\/scene$/, () => import('./views/scene.js')],
  [/^#\/project\/(\d+)\/export$/, () => import('./views/scene.js')],
];

let cleanup = null, navToken = 0;

async function route() {
  const hash = location.hash || '#/';
  const token = ++navToken;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  previewAudio.stop();
  const root = $('#app');
  for (const [re, load, extra] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const mod = await load();
    if (token !== navToken) return;
    root.replaceChildren();
    $('#topnav').replaceChildren();
    const view = h('div', { class: 'view' });
    root.append(view);
    try {
      cleanup = (await mod.mount(view, { id: m[1] ? Number(m[1]) : null, ...extra })) || null;
    } catch (e) {
      console.error(e);
      window.__lastRouteErr = e;
      view.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Er ging iets mis'), h('p', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Terug naar projecten')));
    }
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);
route();
