// Shared helpers: DOM, formatting, toasts, WAV encoding, modal dialogs
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function syncRangeFill(el) {
  if (!el || el.type !== 'range') return;
  const min = el.min !== '' && Number.isFinite(+el.min) ? +el.min : 0;
  const max = el.max !== '' && Number.isFinite(+el.max) ? +el.max : 100;
  const val = el.value !== '' && Number.isFinite(+el.value) ? +el.value : min;
  const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
  el.style.setProperty('--p', `${pct.toFixed(2)}%`);
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [property, value] of Object.entries(v)) {
        if (property.startsWith('--')) el.style.setProperty(property, value);
        else el.style[property] = value;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const proto = HTMLInputElement.prototype;
    const valDesc = Object.getOwnPropertyDescriptor(proto, 'value');
    const maxDesc = Object.getOwnPropertyDescriptor(proto, 'max');
    if (valDesc?.set && maxDesc?.set) {
      Object.defineProperty(el, 'value', {
        get() { return valDesc.get.call(this); },
        set(v) { valDesc.set.call(this, v); syncRangeFill(this); },
      });
      Object.defineProperty(el, 'max', {
        get() { return maxDesc.get.call(this); },
        set(v) { maxDesc.set.call(this, v); syncRangeFill(this); },
      });
    }
    el.addEventListener('input', () => syncRangeFill(el));
    el.addEventListener('change', () => syncRangeFill(el));
    syncRangeFill(el);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtTime(sec, withMs = false) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(Math.floor((sec % 1) * 10))}` : base;
}

export function fmtDate(s) {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'zojuist';
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- toasts ----------
export function toast(msg, type = 'info', ms = 3200) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = h('div', { id: 'toasts' }); document.body.append(wrap); }
  const icon = { info: 'ℹ️', ok: '✅', err: '⚠️' }[type] || '';
  const t = h('div', { class: `toast toast-${type}` }, h('span', {}, icon), h('span', {}, msg));
  wrap.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- modal prompt / confirm ----------
export function modal({ title, body, confirm = 'OK', cancel = 'Annuleren', danger = false, input = null, select = null }) {
  return new Promise((resolve) => {
    const field = input ? h('input', { class: 'input', type: input.type || 'text', value: input.value ?? '', placeholder: input.placeholder || '', step: input.step, min: input.min }) : null;
    let sel = null;
    if (select) {
      sel = h('select', { class: 'select' },
        ...(select.options || []).map((opt) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const lbl = typeof opt === 'string' ? opt : opt.label;
          return h('option', { value: val, selected: val === select.value }, lbl);
        })
      );
    }
    const close = (v) => { overlay.classList.add('out'); setTimeout(() => overlay.remove(), 200); resolve(v); };
    const ok = () => {
      if (field && sel) return close({ input: field.value, select: sel.value });
      if (sel) return close(sel.value);
      if (field) return close(field.value);
      return close(true);
    };
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => e.target === overlay && close(null) },
      h('div', { class: 'modal glass' },
        h('h3', {}, title),
        body ? h('p', { class: 'muted' }, body) : null,
        sel ? h('div', { style: { marginBottom: field ? '12px' : '0' } }, sel) : null,
        field,
        h('div', { class: 'modal-actions' },
          cancel ? h('button', { class: 'btn btn-ghost', onclick: () => close(null) }, cancel) : null,
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: ok }, confirm))));
    document.body.append(overlay);
    if (field) { field.focus(); field.select(); field.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(null); }); }
    else if (sel) { sel.focus(); }
  });
}

// ---------- WAV ----------
export function encodeWav(channels, sampleRate) {
  const chs = Array.isArray(channels) ? channels : [channels];
  const n = chs[0].length, nc = chs.length;
  const ab = new ArrayBuffer(44 + n * nc * 2), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const s = Math.max(-1, Math.min(1, chs[c][i])); v.setInt16(o, s * 32767, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

export function iconSvg(name) {
  const p = {
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4.5" width="4.5" height="15" rx="1.2" fill="currentColor"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1.2" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    split: '<path d="M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 17v3h16v-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    zoomin: '<circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 8v6M8 11h6M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    zoomout: '<circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11h6M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    magnet: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" stroke-width="2" fill="none"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 9h18M3 15h18M8 5v14M16 5v14" stroke="currentColor" stroke-width="1.5"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="currentColor"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
    starFilled: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>',
    folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
    folderPlus: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v6M9 14h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    folderMove: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10 14h7m-2-2l2 2-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    chevronDown: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    chevronRight: '<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    more: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>',
    collapse: '<path d="M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    expand: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M6 9h2M10 9h2M14 9h2M18 9h0M6 12.5h2M10 12.5h2M14 12.5h2M18 12.5h0M8 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  }[name] || '';
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${p}</svg>`;
}

export const icon = (name) => h('span', { class: 'ico', html: iconSvg(name) });
