import { h } from './util.js';

const STORAGE_KEY = 'ts_editor_panel_widths';
const MIN = { left: 200, right: 248 }, MAX = 520, HANDLE = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function fitPanelWidths(width, preferred) {
  const center = Math.min(320, Math.max(0, width - MIN.left - MIN.right - HANDLE * 2));
  const available = Math.max(MIN.left + MIN.right, width - center - HANDLE * 2);
  let left = clamp(Number(preferred.left) || 264, MIN.left, MAX);
  let right = clamp(Number(preferred.right) || 320, MIN.right, MAX);
  if (left + right > available) {
    const extra = available - MIN.left - MIN.right;
    const desired = left + right - MIN.left - MIN.right;
    left = MIN.left + (left - MIN.left) * extra / desired;
    right = available - left;
  }
  return { left: Math.round(left), right: Math.floor(right), center };
}

export function initEditorPanels(layout, left, center, right, { language = 'nl' } = {}) {
  const defaults = () => {
    const styles = getComputedStyle(layout);
    return { left: parseFloat(styles.getPropertyValue('--default-library-width')) || 264,
      right: parseFloat(styles.getPropertyValue('--default-inspector-width')) || 320 };
  };
  let preferred = defaults(), actual = preferred, drag = null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.right)) preferred = saved;
  } catch {}
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred)); } catch {} };
  const handles = {};

  function resize() {
    if (layout.clientWidth <= 760) return;
    actual = fitPanelWidths(layout.clientWidth, preferred);
    layout.style.setProperty('--library-width', actual.left + 'px');
    layout.style.setProperty('--inspector-width', actual.right + 'px');
    for (const side of ['left', 'right']) {
      const max = Math.min(MAX, layout.clientWidth - actual.center - HANDLE * 2 - actual[side === 'left' ? 'right' : 'left']);
      handles[side].setAttribute('aria-valuenow', actual[side]);
      handles[side].setAttribute('aria-valuemax', Math.floor(max));
      handles[side].setAttribute('aria-valuetext', `${actual[side]} pixels`);
    }
  }

  function change(side, width) {
    const other = side === 'left' ? 'right' : 'left';
    const max = Math.min(MAX, layout.clientWidth - actual.center - HANDLE * 2 - actual[other]);
    preferred = { ...actual, [side]: clamp(width, MIN[side], max) };
    resize();
  }

  function finish() {
    if (!drag) return;
    drag = null;
    layout.classList.remove('resizing-panels');
    save();
  }

  for (const side of ['left', 'right']) {
    const panel = side === 'left' ? left : right;
    const label = `${language === 'en' ? 'Width of' : 'Breedte'} ${(panel.getAttribute('aria-label') || (side === 'left' ? 'bibliotheek' : 'instellingen')).toLowerCase()}`;
    const controlled = panel.querySelector('.panel-body') || panel;
    controlled.id ||= `editor-${side}-panel`;
    const handle = h('div', { class: `panel-resize-handle ${side}`, role: 'separator', tabindex: '0',
      'aria-orientation': 'vertical', 'aria-label': label, 'aria-valuemin': MIN[side],
      'aria-controls': controlled.id,
      title: language === 'en' ? `${label} · drag or use arrow keys · double-click to reset` : `${label} aanpassen · sleep of gebruik de pijltjestoetsen · dubbelklik om te herstellen` });
    handles[side] = handle;
    handle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      drag = { side, startX: event.clientX, width: actual[side], pointer: event.pointerId };
      handle.setPointerCapture(event.pointerId);
      layout.classList.add('resizing-panels');
    };
    handle.onpointermove = (event) => {
      if (!drag || drag.side !== side || event.pointerId !== drag.pointer) return;
      change(side, drag.width + (event.clientX - drag.startX) * (side === 'left' ? 1 : -1));
    };
    handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finish;
    handle.ondblclick = () => { preferred[side] = defaults()[side]; resize(); save(); };
    handle.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * (event.shiftKey ? 32 : 16);
      const width = event.key === 'Home' ? MIN[side] : event.key === 'End' ? MAX : actual[side] + delta;
      change(side, width); save();
    };
  }
  layout.replaceChildren(left, handles.left, center, handles.right, right);
  const observer = new ResizeObserver(resize);
  observer.observe(layout);
  resize();
  return () => { finish(); observer.disconnect(); };
}
