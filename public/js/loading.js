import { h } from './util.js';

export function showLoading(root, { title = 'Project openen…', detail = 'Gegevens laden…', backHref = '#/', backLabel = 'Terug naar projecten' } = {}) {
  const status = h('p', { class: 'loading-detail' }, detail);
  const bar = h('i');
  const meter = h('div', { class: 'loading-meter', role: 'progressbar', 'aria-label': title }, bar);
  const node = h('section', { class: 'route-loading', role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' },
    h('div', { class: 'loading-card' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('h2', {}, title), status, meter,
      h('p', { class: 'loading-note' }, 'Je kunt teruggaan terwijl de voorbereiding loopt.'), h('a', { class: 'btn btn-sm', href: backHref }, backLabel)));
  root.replaceChildren(node);
  return { node, update({ label, progress } = {}) {
    if (label) status.textContent = label;
    if (Number.isFinite(progress)) { meter.classList.add('determinate'); meter.setAttribute('aria-valuenow', Math.round(progress * 100)); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); bar.style.width = Math.max(2, progress * 100) + '%'; }
  }, remove: () => node.remove() };
}
