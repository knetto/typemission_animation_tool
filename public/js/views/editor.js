// Editor: media panel · multitrack timeline · inspector (voice FX, edits)
import { $, h, fmtTime, toast, modal, icon, uid, clamp, debounce, encodeWav } from '../util.js';
import { api, fileUrl } from '../api.js';
import { AudioEngine, Player, SR, defaultTimeline, clipDefaults } from '../audio/engine.js';
import { VOICE_PRESETS } from '../audio/voicefx.js';
import { BUILTIN_SFX, renderBuiltin } from '../audio/sfxlib.js';
import { detectVoiced } from '../audio/dsp.js';
import { previewAudio, createWaveBox } from '../preview.js';
import { sfxStore, sfxId } from '../audio/sfxstore.js';
import { createSfxFolders } from '../audio/sfxui.js';
import {
  QUICK_CATEGORIES,
  cleanFreesoundName,
  shortFreesoundLicense,
  ensureFreesoundImported,
  openFreesoundModal,
  openFreesoundConfigModal,
} from '../audio/freesound.js';
import { initEditorPanels } from '../editor-panels.js';

const TRACK_H = 116;
const PALETTE = ['#4f8cff', '#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185'];
const FX_BY_ID = Object.fromEntries(VOICE_PRESETS.map((p) => [p.id, p]));

export async function mount(root, { id }) {
  const project = await api.project(id);
  if (project.type === 'file') return (await import('./files.js')).mount(root, { id, project });
  if (project.type === 'keyboard') return (await import('./keyboard.js')).mount(root, { id, project });
  let assets = project.assets || [];
  let customSfx = await api.sfx().catch(() => []);
  let tl = normalize(project.timeline);
  const engine = new AudioEngine(resolveUrl);
  const player = new Player();

  let selected = new Set(), playhead = 0, snap = true, raf = 0, mixPcm = null, mixDirty = true, destroyed = false;
  const undo = [], redo = [];
  let clipboard = [], contextMenu = null, menuReturnFocus = null;
  let fxPopup = null, fxTrigger = null;
  let fxPreviewToken = 0, fxPreviewButton = null;
  const openSections = new Set();

  function resolveUrl(src) {
    if (src.type === 'asset') { const a = assets.find((x) => x.id === src.id); if (!a) throw new Error('Audiobestand ontbreekt'); return fileUrl.asset(a); }
    if (src.type === 'sfx') { const s = customSfx.find((x) => x.id === src.id); if (!s) throw new Error('Effect ontbreekt'); return fileUrl.sfx(s); }
    throw new Error('Onbekende bron');
  }
  const trackColor = (t) => PALETTE[tl.tracks.indexOf(t) % PALETTE.length];
  const trackOf = (c) => tl.tracks.find((t) => t.id === c.trackId);
  const contentEnd = () => tl.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const sel = () => tl.clips.filter((c) => selected.has(c.id));

  // ============ layout ============
  const titleIn = h('input', { class: 'ed-title', id: 'project-title', value: project.name, spellcheck: 'false', 'aria-label': 'Projectnaam' });
  let navigatingToExport = false;
  async function goToExport(e) {
    e.preventDefault();
    if (navigatingToExport) return;
    navigatingToExport = true;
    try {
      await api.updateProject(id, { timeline: tl, duration: contentEnd(), name: titleIn.value.trim() || 'Naamloos' });
      location.hash = `#/project/${id}/export`;
    } catch (error) { navigatingToExport = false; toast('Opslaan mislukt: ' + error.message, 'err'); }
  }
  const saveState = h('span', { class: 'save-state', id: 'save-state' }, 'Opgeslagen');
  const head = h('div', { class: 'ed-head' },
    h('a', { class: 'btn btn-ghost btn-icon', href: '#/', title: 'Terug naar projecten', id: 'back-btn' }, icon('back')),
    titleIn, saveState, h('div', { class: 'spacer' }),
    h('nav', { class: 'steps' }, h('a', { class: 'on', href: `#/project/${id}` }, '1 · Audio bewerken'), h('span', {}, '›'), h('a', { href: `#/project/${id}/export`, onclick: goToExport }, '2 · Export')),
    h('a', { class: 'btn btn-primary', href: `#/project/${id}/export`, id: 'to-scene-btn', onclick: goToExport }, icon('download'), 'Export'));

  // left
  const mediaTabs = h('div', { class: 'panel-tabs' });
  const mediaBody = h('div', { class: 'panel-body', id: 'media-body' });
  const left = h('aside', { class: 'panel media-panel', 'aria-label': 'Audiobibliotheek' }, h('div', { class: 'panel-heading' }, icon('wave'), 'Bibliotheek'), mediaTabs, mediaBody);

  // center
  const bigTime = h('div', { class: 'big-time', id: 'big-time' });
  const playBtn = h('button', { class: 'play-btn', id: 'play-btn', title: 'Afspelen (spatie)', onclick: () => togglePlay() }, icon('play'));
  const undoBtn = h('button', { class: 'btn btn-icon btn-ghost', id: 'undo-btn', title: 'Ongedaan maken (Ctrl+Z)', onclick: () => doUndo() }, icon('undo'));
  const redoBtn = h('button', { class: 'btn btn-icon btn-ghost', id: 'redo-btn', title: 'Opnieuw (Ctrl+Shift+Z)', onclick: () => doRedo() }, icon('redo'));
  const snapBtn = h('button', { class: 'btn btn-sm active', id: 'snap-btn', title: 'Lijn blokken automatisch op elkaar uit', 'aria-pressed': 'true', onclick: () => { snap = !snap; snapBtn.classList.toggle('active', snap); snapBtn.setAttribute('aria-pressed', String(snap)); } }, icon('magnet'), 'Uitlijnen');
  const zoomIn = h('input', { type: 'range', min: 20, max: 300, step: 1, value: tl.zoom, id: 'zoom-range', title: 'Zoom' });
  const transport = h('div', { class: 'transport' },
    playBtn,
    h('button', { class: 'btn btn-icon btn-ghost', title: 'Naar begin (Home)', id: 'stop-btn', onclick: () => { stopPlay(); setPlayhead(0); } }, icon('stop')),
    h('div', { class: 'sep' }), undoBtn, redoBtn, h('div', { class: 'sep' }),
    h('button', { class: 'btn btn-sm', id: 'split-btn', title: 'Splitsen bij afspeelkop (S)', onclick: () => splitAtPlayhead() }, icon('split'), 'Splitsen'),
    h('button', { class: 'btn btn-sm', id: 'delete-btn', title: 'Verwijderen (Delete)', onclick: () => deleteSelected() }, icon('trash'), 'Verwijderen'),
    h('div', { class: 'sep' }), snapBtn,
    h('div', { class: 'zoom-ctl' },
      h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Uitzoomen', onclick: () => setZoom(tl.zoom / 1.3) }, icon('zoomout')), zoomIn,
      h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Inzoomen', onclick: () => setZoom(tl.zoom * 1.3) }, icon('zoomin'))));
  const selectionStatus = h('span', { class: 'selection-status' });
  const timelineFooter = h('div', { class: 'timeline-footer' }, selectionStatus, h('span', {}, 'Sleep om te verplaatsen · sleep de randen om in te korten · rechtermuisknop voor acties'));

  const headsInner = h('div', { class: 'tl-heads-inner' });
  const heads = h('div', { class: 'tl-heads' }, h('div', { class: 'ruler-spacer' }, 'Sporen'), headsInner);
  const rulerCv = h('canvas', { height: 30 });
  const ruler = h('div', { class: 'ruler', id: 'ruler' }, rulerCv);
  const lanes = h('div', { class: 'lanes' });
  const playheadEl = h('div', { class: 'playhead' });
  const snapLine = h('div', { class: 'snap-line' });
  const emptyHint = h('div', { class: 'tl-empty' }, h('div', { class: 'empty-audio-icon' }, icon('wave')), h('b', {}, 'Hier begint je audio'), h('p', {}, 'Upload een bestand, neem iets op of sleep audio naar het spoor.'), h('button', { class: 'btn btn-primary', onclick: () => fileIn.click() }, icon('plus'), 'Audio toevoegen'));
  const tlCanvas = h('div', { class: 'tl-canvas' }, ruler, lanes, playheadEl, snapLine);
  const scroller = h('div', { class: 'tl-scroll', id: 'timeline' }, tlCanvas);
  const tlWrap = h('div', { class: 'tl-wrap' }, heads, scroller, emptyHint);
  const center = h('section', { class: 'center' }, h('div', { class: 'preview-strip' }, h('div', { class: 'timeline-heading' }, h('b', {}, 'Tijdlijn'), h('span', {}, 'Maak je verhaal met audio')), bigTime), transport, tlWrap, timelineFooter);

  // right
  const inspector = h('div', { class: 'panel-body', id: 'inspector' });
  const right = h('aside', { class: 'panel right', 'aria-label': 'Clipinstellingen' }, h('div', { class: 'panel-heading' }, icon('edit'), 'Clip bewerken'), inspector);

  const layout = h('div', { class: 'ed-body' }, left, center, right);
  root.append(h('div', { class: 'editor' }, head, layout));
  const disposePanels = initEditorPanels(layout, left, center, right);

  // ============ persistence ============
  const save = async () => {
    saveState.classList.add('saving'); saveState.textContent = 'Opslaan…';
    try { await api.updateProject(id, { timeline: tl, duration: contentEnd() }); saveState.textContent = 'Opgeslagen'; }
    catch (e) { saveState.textContent = 'Opslaan mislukt'; toast(e.message, 'err'); }
    saveState.classList.remove('saving');
  };
  const saveSoon = debounce(save, 700);
  let saveTimer = null;
  const markDirty = () => { saveState.classList.add('saving'); saveState.textContent = 'Wijzigingen…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); };
  titleIn.addEventListener('change', async () => { await api.updateProject(id, { name: titleIn.value.trim() || 'Naamloos' }); toast('Naam opgeslagen', 'ok'); });
  titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleIn.blur(); });

  // ============ history ============
  const snapshot = () => JSON.stringify({ tracks: tl.tracks, clips: tl.clips, selected: [...selected] });
  const restore = (s) => { const o = JSON.parse(s); tl.tracks = o.tracks; tl.clips = o.clips; selected = new Set(o.selected || []); };
  function pushUndo(before) { undo.push(before); if (undo.length > 150) undo.shift(); redo.length = 0; }
  function mutate(fn) { const before = snapshot(); fn(); pushUndo(before); changed(); }
  function changed({ inspectorToo = true } = {}) {
    selected = new Set([...selected].filter((cid) => tl.clips.some((c) => c.id === cid)));
    mixDirty = true;
    if (player.playing) stopPlay();
    renderTimeline();
    if (inspectorToo) renderInspector();
    markDirty();
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
  }
  function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); changed(); toast('Ongedaan gemaakt', 'info', 1200); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); changed(); }

  // ============ clip operations ============
  function makeClip(src, name, trackId, start, duration) {
    return { id: uid(), trackId, src, name, start: Math.max(0, start), offset: 0, duration, ...clipDefaults() };
  }

  async function addSource(src, name, trackId, start) {
    const done = busy('Audio laden…');
    try {
      if (src?.type === 'freesound' && src.item) {
        const row = await ensureFreesoundImported(src.item, {
          category: 'Freesound',
          existingSfx: customSfx,
          onImported: async () => { customSfx = await api.sfx().catch(() => []); },
        });
        src = { type: 'sfx', id: row.id };
        name = sfxStore.getName(row);
      }
      await engine.getSource(src);
      const dur = engine.sourceDuration(src);
      const c = makeClip(src, name, trackId, start, dur);
      mutate(() => tl.clips.push(c));
      selected = new Set([c.id]); renderTimeline(); renderInspector();
      if (mediaTab === 'sfx') renderMedia();
      return c;
    } catch (e) { toast('Kon audio niet laden: ' + e.message, 'err'); }
    finally { done(); }
  }

  const trackEnd = (trackId) => tl.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const trackByKind = (kind) => tl.tracks.find((t) => t.kind === kind) || tl.tracks[0];

  function splitClip(c, t) {
    const l = t - c.start;
    if (l < 0.02 || l > c.duration - 0.02) return null;
    const a = { ...c, duration: l, fadeOut: 0, fadeIn: Math.min(c.fadeIn, l) };
    const b = { ...c, id: uid(), start: t, duration: c.duration - l, fadeIn: 0, fadeOut: Math.min(c.fadeOut, c.duration - l) };
    if (c.reverse) { a.offset = c.offset + (c.duration - l) * c.speed; b.offset = c.offset; }
    else { a.offset = c.offset; b.offset = c.offset + l * c.speed; }
    return [a, b];
  }

  function splitAtPlayhead() {
    const t = playhead;
    let targets = sel().filter((c) => t > c.start && t < c.start + c.duration);
    if (!targets.length) targets = tl.clips.filter((c) => t > c.start && t < c.start + c.duration && (!selected.size));
    if (!targets.length) return toast('Zet de afspeelkop op een clip om te splitsen', 'info');
    mutate(() => {
      for (const c of targets) {
        const r = splitClip(c, t); if (!r) continue;
        tl.clips.splice(tl.clips.indexOf(c), 1, ...r);
        selected.delete(c.id); selected.add(r[1].id);
      }
    });
  }

  function deleteSelected() {
    if (!selected.size) return;
    mutate(() => { tl.clips = tl.clips.filter((c) => !selected.has(c.id)); selected.clear(); });
  }

  function duplicateSelected() {
    const list = sel(); if (!list.length) return;
    const span = Math.max(...list.map((c) => c.start + c.duration)) - Math.min(...list.map((c) => c.start));
    mutate(() => {
      const copies = list.map((c) => ({ ...structuredClone(c), id: uid(), start: c.start + span }));
      tl.clips.push(...copies); selected = new Set(copies.map((c) => c.id));
    });
  }

  function copySelected(cut = false) {
    if (!selected.size) return;
    clipboard = structuredClone(sel());
    if (cut) deleteSelected();
    toast(`${clipboard.length} clip(s) ${cut ? 'geknipt' : 'gekopieerd'} — plak op de afspeelkop`, 'info', 1800);
  }

  function pasteClips(trackId = null, time = playhead) {
    if (!clipboard.length) return;
    const start = Math.min(...clipboard.map((c) => c.start));
    const firstTrack = tl.tracks.findIndex((t) => t.id === clipboard[0].trackId);
    const targetTrack = tl.tracks.findIndex((t) => t.id === trackId);
    const copies = structuredClone(clipboard).map((c) => {
      let idx = tl.tracks.findIndex((t) => t.id === c.trackId);
      if (targetTrack >= 0) idx = targetTrack + (idx >= 0 && firstTrack >= 0 ? idx - firstTrack : 0);
      return { ...c, id: uid(), start: Math.max(0, time) + c.start - start, trackId: tl.tracks[clamp(idx, 0, tl.tracks.length - 1)].id };
    });
    mutate(() => { tl.clips.push(...copies); selected = new Set(copies.map((c) => c.id)); });
  }

  async function renameClip(c = sel()[0]) {
    if (!c) return;
    const name = await modal({ title: 'Clip hernoemen', confirm: 'Opslaan', input: { value: c.name } });
    if (name?.trim() && tl.clips.includes(c)) mutate(() => { c.name = name.trim(); });
  }

  function addTrack() {
    mutate(() => tl.tracks.push({ id: 't_' + uid(), name: `Audio ${tl.tracks.length + 1}`, kind: 'extra', gain: 1, mute: false, solo: false }));
  }

  function closeContextMenu(restoreFocus = false) {
    contextMenu?.remove(); contextMenu = null;
    if (restoreFocus) {
      const target = menuReturnFocus?.isConnected ? menuReturnFocus : [...lanes.querySelectorAll('.clip')].find((el) => el.dataset.id === menuReturnFocus?.dataset.id);
      target?.focus({ preventScroll: true });
    }
  }

  function openContextMenu(e, entries, title) {
    e.preventDefault(); e.stopPropagation(); closeContextMenu(); closeFxPicker();
    menuReturnFocus = e.target.closest('.clip, button') || document.activeElement;
    contextMenu = h('div', { class: 'clip-context-menu', role: 'menu', 'aria-label': title }, h('div', { class: 'context-title' }, title));
    entries.forEach((entry) => {
      if (!entry) return contextMenu.append(h('div', { class: 'context-separator', role: 'separator' }));
      contextMenu.append(h('button', { class: `context-action${entry.danger ? ' danger' : ''}`, role: 'menuitem', disabled: entry.disabled, onclick: () => { closeContextMenu(true); entry.action(); } }, icon(entry.icon || 'edit'), h('span', {}, entry.label), entry.key ? h('kbd', {}, entry.key) : null));
    });
    contextMenu.addEventListener('keydown', (ev) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault(); ev.stopPropagation();
      const buttons = [...contextMenu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? buttons.length - 1 : (index + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    document.body.append(contextMenu);
    const box = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - box.width - 8)) + 'px';
    contextMenu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - box.height - 8)) + 'px';
    contextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function outsideMenu(e) {
    if (contextMenu && !contextMenu.contains(e.target)) closeContextMenu();
    if (fxPopup && !fxPopup.contains(e.target) && !fxTrigger?.contains(e.target)) closeFxPicker();
  }
  document.addEventListener('pointerdown', outsideMenu);
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('resize', closeFxPicker);
  function onPickerScroll(e) { if (fxPopup && !fxPopup.contains(e.target)) positionFxPicker(); }
  document.addEventListener('scroll', onPickerScroll, true);
  scroller.addEventListener('scroll', () => closeContextMenu());

  function clipContext(e, c) {
    if (!selected.has(c.id)) selected = new Set([c.id]);
    setPlayhead(xToTime(e.clientX)); renderTimeline(); renderInspector();
    openContextMenu(e, clipActions(c), selected.size > 1 ? `${selected.size} clips geselecteerd` : c.name);
  }

  function clipActions(c) {
    return [
      { label: 'Clip aanpassen', icon: 'edit', action: () => { inspector.querySelector('input')?.focus(); } },
      { label: 'Hernoemen', action: () => renameClip(c), disabled: selected.size > 1 },
      null,
      { label: 'Knippen', icon: 'split', key: 'Ctrl+X', action: () => copySelected(true) },
      { label: 'Kopiëren', icon: 'copy', key: 'Ctrl+C', action: () => copySelected() },
      { label: 'Plakken', icon: 'copy', key: 'Ctrl+V', disabled: !clipboard.length, action: () => pasteClips(c.trackId) },
      { label: 'Dupliceren', icon: 'copy', key: 'Ctrl+D', action: duplicateSelected },
      null,
      { label: 'Splitsen op deze plek', icon: 'split', key: 'S', disabled: !sel().some((x) => playhead - x.start >= 0.02 && x.start + x.duration - playhead >= 0.02), action: splitAtPlayhead },
      { label: 'Verwijderen', icon: 'trash', key: 'Delete', danger: true, action: deleteSelected },
    ];
  }

  function timelineContext(e, t) {
    const time = xToTime(e.clientX); setPlayhead(time);
    openContextMenu(e, [
      { label: 'Plakken op deze plek', icon: 'copy', key: 'Ctrl+V', disabled: !clipboard.length, action: () => pasteClips(t.id, time) },
      { label: 'Alles selecteren', icon: 'wave', key: 'Ctrl+A', disabled: !tl.clips.length, action: () => { selected = new Set(tl.clips.map((c) => c.id)); renderTimeline(); renderInspector(); } },
      null, { label: 'Spoor toevoegen', icon: 'plus', action: addTrack },
    ], t.name);
  }
  scroller.addEventListener('contextmenu', (e) => timelineContext(e, trackOf(sel()[0] || {}) || tl.tracks[0]));

  async function removeSilence(list = sel()) {
    if (!list.length) return toast('Selecteer eerst een clip', 'info');
    const done = busy('Stiltes zoeken…');
    try {
      const before = snapshot();
      let removedTotal = 0;
      const ordered = [...list].sort((a, b) => b.start - a.start);
      for (const c of ordered) {
        const pcm = await engine.processClip({ ...c, fx: 'none' });
        const regions = detectVoiced(pcm.subarray(0, Math.round(c.duration * SR)), SR);
        if (!regions.length) continue;
        const kept = regions.reduce((s, [a, b]) => s + (b - a), 0);
        const removed = c.duration - kept;
        if (removed < 0.05) continue;
        let cursor = c.start;
        const parts = regions.map(([a, b], i) => {
          const part = { ...c, id: i ? uid() : c.id, start: cursor, duration: b - a, offset: c.reverse ? c.offset + (c.duration - b) * c.speed : c.offset + a * c.speed, fadeIn: i ? 0.015 : Math.max(c.fadeIn, 0.015), fadeOut: i === regions.length - 1 ? Math.max(c.fadeOut, 0.015) : 0.015 };
          cursor += b - a; return part;
        });
        const end = c.start + c.duration;
        tl.clips.forEach((o) => { if (o.trackId === c.trackId && o.id !== c.id && o.start >= end - 1e-6) o.start -= removed; });
        tl.clips.splice(tl.clips.findIndex((o) => o.id === c.id), 1, ...parts);
        parts.forEach((p) => selected.add(p.id));
        removedTotal += removed;
      }
      if (removedTotal > 0) { pushUndo(before); changed(); toast(`${removedTotal.toFixed(1)}s stilte verwijderd`, 'ok'); }
      else toast('Geen stiltes gevonden', 'info');
    } finally { done(); }
  }

  async function bounceSelected() {
    const list = sel(); if (!list.length) return;
    const done = busy('Samenvoegen…');
    try {
      const flat = { ...tl, tracks: tl.tracks.map((t) => ({ ...t, gain: 1, mute: false, solo: false })) };
      const { pcm, offset } = await engine.renderMix(flat, { clipIds: list.map((c) => c.id), ignoreMute: true });
      const file = new File([encodeWav(pcm, SR)], 'samengevoegd.wav', { type: 'audio/wav' });
      const name = list.length === 1 ? `${list[0].name} (bewerkt)` : `Samengevoegd (${list.length} clips)`;
      const [asset] = await api.uploadAssets(id, [file], { kind: 'render', name, duration: (pcm.length / SR).toFixed(3) });
      assets.push(asset); renderMedia();
      const src = { type: 'asset', id: asset.id };
      await engine.getSource(src);
      const c = makeClip(src, name, list[0].trackId, offset, engine.sourceDuration(src));
      mutate(() => { tl.clips = tl.clips.filter((x) => !selected.has(x.id)); tl.clips.push(c); selected = new Set([c.id]); });
      toast('Samengevoegd tot één clip — effecten zijn ingebakken', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { done(); }
  }

  // ============ busy indicator ============
  let busyCount = 0; const busyEl = h('div', { class: 'busy' }, h('span', { class: 'spinner' }), h('span'));
  function busy(msg) { busyCount++; busyEl.lastChild.textContent = msg; tlWrap.append(busyEl); return () => { if (--busyCount <= 0) { busyCount = 0; busyEl.remove(); } }; }

  // ============ timeline rendering ============
  function setZoom(z) {
    const old = tl.zoom, center = (scroller.scrollLeft + scroller.clientWidth / 2) / old;
    tl.zoom = clamp(Math.round(z), 20, 300); zoomIn.value = tl.zoom; fillRange(zoomIn);
    renderTimeline();
    scroller.scrollLeft = center * tl.zoom - scroller.clientWidth / 2;
    saveSoon();
  }
  zoomIn.addEventListener('input', () => setZoom(+zoomIn.value));

  function renderTimeline() {
    const width = Math.max(scroller.clientWidth || 800, (contentEnd() + 20) * tl.zoom);
    tlCanvas.style.width = width + 'px';
    headsInner.replaceChildren();
    lanes.replaceChildren();
    const anySolo = tl.tracks.some((t) => t.solo);
    tl.tracks.forEach((t) => {
      const color = trackColor(t);
      headsInner.append(trackHead(t, color));
      const lane = h('div', { class: `track-lane${(anySolo ? !t.solo : t.mute) ? ' muted' : ''}`, 'data-track': t.id, style: { '--tc': color } });
      lane.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.target === lane) { selected.clear(); setPlayhead(xToTime(e.clientX)); renderTimeline(); renderInspector(); } });
      lane.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.clip')) return;
        timelineContext(e, t);
      });
      lane.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-tsrc')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; lane.classList.add('drop'); } });
      lane.addEventListener('dragleave', () => lane.classList.remove('drop'));
      lane.addEventListener('drop', (e) => {
        e.preventDefault(); lane.classList.remove('drop');
        try { const d = JSON.parse(e.dataTransfer.getData('application/x-tsrc')); addSource(d.src, d.name, t.id, snapTime(xToTime(e.clientX), null)); } catch {}
      });
      tl.clips.filter((c) => c.trackId === t.id).forEach((c) => lane.append(clipEl(c, color)));
      lanes.append(lane);
    });
    headsInner.append(h('button', { class: 'btn btn-sm btn-ghost add-track', id: 'add-track-btn', onclick: addTrack }, icon('plus'), 'Spoor toevoegen'));
    playheadEl.style.height = 30 + tl.tracks.length * TRACK_H + 'px';
    snapLine.style.height = playheadEl.style.height;
    emptyHint.style.display = tl.clips.length ? 'none' : '';
    drawRuler(); placePlayhead();
  }

  function trackHead(t, color) {
    const gain = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: t.gain, title: 'Spoorvolume', 'aria-label': `Volume ${t.name}` });
    fillRange(gain);
    let before = null;
    gain.addEventListener('input', () => { before ||= snapshot(); t.gain = +gain.value; fillRange(gain); });
    gain.addEventListener('change', () => { if (before) pushUndo(before); before = null; changed({ inspectorToo: false }); });
    const name = h('input', { class: 'tname', value: t.name, spellcheck: 'false', 'aria-label': 'Spoornaam' });
    name.addEventListener('change', () => mutate(() => (t.name = name.value.trim() || 'Spoor')));
    return h('div', { class: 'track-head', style: { '--tc': color } }, name,
      h('div', { class: 'tbtns' },
        h('button', { class: `tbtn m${t.mute ? ' on' : ''}`, title: 'Dit spoor dempen', 'aria-pressed': String(t.mute), onclick: () => mutate(() => (t.mute = !t.mute)) }, 'Dempen'),
        h('button', { class: `tbtn s${t.solo ? ' on' : ''}`, title: 'Alleen dit spoor afspelen', 'aria-pressed': String(t.solo), onclick: () => mutate(() => (t.solo = !t.solo)) }, 'Solo'),
      ), h('div', { class: 'track-volume' }, icon('wave'),
        gain,
        tl.tracks.length > 1 ? h('button', { class: 'tbtn', title: 'Spoor verwijderen', onclick: async () => {
          const n = tl.clips.filter((c) => c.trackId === t.id).length;
          if (n && !(await modal({ title: `Spoor "${t.name}" verwijderen?`, body: `${n} clip(s) op dit spoor worden ook verwijderd.`, confirm: 'Verwijderen', danger: true }))) return;
          mutate(() => { tl.tracks = tl.tracks.filter((x) => x !== t); tl.clips = tl.clips.filter((c) => c.trackId !== t.id); });
        } }, '×') : null));
  }

  function clipEl(c, color) {
    const fx = FX_BY_ID[c.fx];
    const flags = [fx && c.fx !== 'none' ? fx.emoji + ' ' + fx.name : '', c.reverse ? '⟲' : '', c.speed !== 1 ? `${c.speed}×` : '', c.pitch ? `${c.pitch > 0 ? '+' : ''}${c.pitch}st` : ''].filter(Boolean).join(' · ');
    const el = h('div', { class: `clip${selected.has(c.id) ? ' sel' : ''}`, 'data-id': c.id, tabindex: '0', role: 'button', 'aria-pressed': String(selected.has(c.id)), 'aria-label': `${c.name}, ${c.duration.toFixed(1)} seconden`, title: `${c.name} · ${c.duration.toFixed(2)}s${flags ? ' · ' + flags : ''}\nSleep om te verplaatsen. Rechtermuisknop voor acties.`, style: { left: c.start * tl.zoom + 'px', width: Math.max(4, c.duration * tl.zoom) + 'px', '--tc': color } },
      h('div', { class: 'clabel' }, h('span', { class: 'clip-name' }, c.name), h('span', { class: 'clip-selected-mark', 'aria-hidden': 'true' }, '✓')),
      h('div', { class: 'clip-meta' }, `${c.duration.toFixed(1)}s`, flags ? h('em', {}, flags) : null),
      h('canvas'),
      c.fadeIn > 0 ? h('div', { class: 'fade in', style: { width: c.fadeIn * tl.zoom + 'px' } }) : null,
      c.fadeOut > 0 ? h('div', { class: 'fade out', style: { width: c.fadeOut * tl.zoom + 'px' } }) : null,
      h('div', { class: 'handle l' }), h('div', { class: 'handle r' }));
    el.addEventListener('pointerdown', (e) => startDrag(e, c, el));
    el.addEventListener('dblclick', (e) => { setPlayhead(xToTime(e.clientX)); });
    el.addEventListener('contextmenu', (e) => clipContext(e, c));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); selected = new Set([c.id]); renderTimeline(); renderInspector(); inspector.querySelector('input')?.focus(); }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const box = el.getBoundingClientRect();
        clipContext({ preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation(), target: el, clientX: box.left + Math.min(box.width / 2, 60), clientY: box.top + 30 }, c);
      }
    });
    const key = engine.clipKey(c);
    if (engine.processedReady.has(key)) requestAnimationFrame(() => drawWave(el, c, color));
    else {
      el.classList.add('processing');
      engine.processClip(c).then(() => { el.classList.remove('processing'); if (el.isConnected) drawWave(el, c, color); }).catch(() => { el.classList.remove('processing'); el.style.borderColor = 'var(--danger)'; });
    }
    return el;
  }

  function drawWave(el, c, color) {
    const cv = el.querySelector('canvas'); if (!cv) return;
    const w = Math.max(2, Math.min(4096, Math.round(c.duration * tl.zoom))), hh = 60;
    cv.width = w; cv.height = hh;
    const pk = engine.clipPeaks(c, Math.max(1, Math.floor(w / 2)));
    if (!pk) return;
    const g = cv.getContext('2d'), mid = hh / 2;
    g.fillStyle = '#e3efff'; g.globalAlpha = 0.78;
    const gain = c.gain * (trackOf(c)?.gain ?? 1);
    for (let b = 0; b < pk.length; b++) {
      const a = Math.max(0.6, Math.min(1, pk[b] * gain) * mid * 0.95);
      g.fillRect(b * 2, mid - a, 1.4, a * 2);
    }
  }

  function drawRuler() {
    const w = scroller.clientWidth || 800, dpr = devicePixelRatio || 1;
    rulerCv.width = w * dpr; rulerCv.height = 30 * dpr; rulerCv.style.width = w + 'px'; rulerCv.style.height = '30px';
    rulerCv.style.left = scroller.scrollLeft + 'px';
    const g = rulerCv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, 30);
    const z = tl.zoom, steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const major = steps.find((s) => s * z >= 70) || 60, minor = major / (major >= 1 ? (major === 15 ? 3 : 5) : 5);
    const t0 = scroller.scrollLeft / z, t1 = t0 + w / z;
    g.font = '11px "Share Tech Mono", monospace'; g.textBaseline = 'top';
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = (t - t0) * z, isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.fillStyle = isMajor ? 'rgba(200,215,255,0.55)' : 'rgba(200,215,255,0.18)';
      g.fillRect(Math.round(x), isMajor ? 14 : 22, 1, isMajor ? 16 : 8);
      if (isMajor) { g.fillStyle = 'rgba(200,215,255,0.7)'; g.fillText(major < 1 ? t.toFixed(major < 0.5 ? 2 : 1) + 's' : fmtTime(Math.round(t)), x + 4, 3); }
    }
    // content end marker
    const ex = (contentEnd() - t0) * z;
    if (ex > 0 && ex < w) { g.fillStyle = 'rgba(139,92,246,0.8)'; g.fillRect(ex, 0, 2, 30); }
  }

  scroller.addEventListener('scroll', () => { headsInner.style.transform = `translateY(${-scroller.scrollTop}px)`; drawRuler(); });
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect(), tAt = (e.clientX - r.left + scroller.scrollLeft) / tl.zoom;
    tl.zoom = clamp(Math.round(tl.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)), 20, 300); zoomIn.value = tl.zoom; fillRange(zoomIn);
    renderTimeline(); scroller.scrollLeft = tAt * tl.zoom - (e.clientX - r.left); saveSoon();
  }, { passive: false });
  const ro = new ResizeObserver(() => renderTimeline()); ro.observe(scroller);

  const xToTime = (clientX) => Math.max(0, (clientX - lanes.getBoundingClientRect().left) / tl.zoom);

  // ruler scrubbing
  ruler.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ruler.setPointerCapture(e.pointerId);
    const wasPlaying = player.playing; if (wasPlaying) player.pause();
    const move = (ev) => setPlayhead(xToTime(ev.clientX));
    move(e);
    const up = () => { ruler.removeEventListener('pointermove', move); ruler.removeEventListener('pointerup', up); if (wasPlaying) startPlay(); };
    ruler.addEventListener('pointermove', move); ruler.addEventListener('pointerup', up);
  });

  // ============ snapping ============
  function snapPoints(exclude) {
    const pts = [0, playhead];
    tl.clips.forEach((c) => { if (!exclude?.has(c.id)) pts.push(c.start, c.start + c.duration); });
    return pts;
  }
  function snapTime(t, exclude, pts = snapPoints(exclude)) {
    if (!snap) return t;
    const thr = 8 / tl.zoom; let best = t, bd = thr;
    for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
    showSnap(best !== t ? best : null);
    return best;
  }
  function showSnap(t) { snapLine.style.display = t === null ? 'none' : 'block'; if (t !== null) snapLine.style.left = t * tl.zoom + 'px'; }

  // ============ drag: move / trim ============
  function startDrag(e, c, el) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.classList.contains('handle') ? (e.target.classList.contains('l') ? 'trimL' : 'trimR') : 'move';
    if (e.shiftKey || e.ctrlKey || e.metaKey) { selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id); }
    else if (!selected.has(c.id) || mode !== 'move') selected = new Set([c.id]);
    lanes.querySelectorAll('.clip').forEach((n) => { n.classList.toggle('sel', selected.has(n.dataset.id)); n.setAttribute('aria-pressed', String(selected.has(n.dataset.id))); });
    renderInspector();
    if (!selected.has(c.id)) return;

    const before = snapshot(), x0 = e.clientX, y0 = e.clientY;
    const group = mode === 'move' ? sel() : [c];
    const orig = new Map(group.map((g) => [g.id, { ...g }]));
    const pts = snapPoints(new Set(group.map((g) => g.id)));
    const minStart = Math.min(...group.map((g) => g.start));
    const laneTop = lanes.getBoundingClientRect().top;
    const trackIdx0 = tl.tracks.findIndex((t) => t.id === c.trackId);
    const srcDur = engine.sourceDuration(c.src) ?? Infinity;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    if (mode !== 'move') e.target.classList.add('on');

    const onMove = (ev) => {
      const dxT = (ev.clientX - x0) / tl.zoom;
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      moved = true; el.classList.add('dragging');
      const o = orig.get(c.id);
      if (mode === 'move') {
        let d = Math.max(-minStart, dxT);
        // snap primary clip start or end
        const s1 = snapTime(o.start + d, null, pts), s2 = snapTime(o.start + o.duration + d, null, pts);
        if (snap) { if (s1 !== o.start + d) d = s1 - o.start; else if (s2 !== o.start + o.duration + d) d = s2 - o.start - o.duration; else showSnap(null); }
        d = Math.max(-minStart, d);
        const ti = clamp(Math.floor((ev.clientY - laneTop) / TRACK_H), 0, tl.tracks.length - 1), dTrack = ti - trackIdx0;
        group.forEach((g) => {
          const og = orig.get(g.id); g.start = og.start + d;
          const gi = clamp(tl.tracks.findIndex((t) => t.id === og.trackId) + dTrack, 0, tl.tracks.length - 1);
          g.trackId = tl.tracks[gi].id;
          const node = lanes.querySelector(`.clip[data-id="${g.id}"]`);
          if (node) { node.style.left = g.start * tl.zoom + 'px'; const lane = lanes.children[gi]; if (node.parentElement !== lane) lane.append(node); }
        });
      } else if (mode === 'trimL') {
        let ns = snapTime(o.start + dxT, null, pts);
        let d = ns - o.start;                                      // + = shrink
        const maxGrow = o.reverse ? (srcDur - o.offset) / o.speed - o.duration : o.offset / o.speed;
        d = clamp(d, -Math.min(maxGrow, o.start), o.duration - 0.05);
        c.start = o.start + d; c.duration = o.duration - d;
        if (!o.reverse) c.offset = o.offset + d * o.speed;
        c.fadeIn = Math.min(c.fadeIn, c.duration);
        el.style.left = c.start * tl.zoom + 'px'; el.style.width = c.duration * tl.zoom + 'px';
      } else {
        let ne = snapTime(o.start + o.duration + dxT, null, pts);
        let d = ne - (o.start + o.duration);                       // + = extend
        const maxGrow = o.reverse ? o.offset / o.speed : (srcDur - o.offset) / o.speed - o.duration;
        d = clamp(d, 0.05 - o.duration, maxGrow);
        c.duration = o.duration + d;
        if (o.reverse) c.offset = o.offset - d * o.speed;
        c.fadeOut = Math.min(c.fadeOut, c.duration);
        el.style.width = c.duration * tl.zoom + 'px';
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging'); showSnap(null);
      if (moved) { pushUndo(before); changed(); }
      else if (!(e.shiftKey || e.ctrlKey || e.metaKey) && mode === 'move') { selected = new Set([c.id]); setPlayheadIfOutside(xToTime(x0), c); renderTimeline(); renderInspector(); }
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  }
  function setPlayheadIfOutside(t, c) { if (!player.playing) setPlayhead(t); }

  // ============ playhead & playback ============
  function setPlayhead(t) {
    playhead = Math.max(0, t);
    placePlayhead();
    if (player.playing) player.play(playhead);
  }
  function placePlayhead() {
    playheadEl.style.transform = `translateX(${playhead * tl.zoom}px)`;
    bigTime.innerHTML = `${fmtTime(playhead, true)} <small>/ ${fmtTime(contentEnd(), true)}</small>`;
    $('#split-btn', transport).disabled = !tl.clips.some((c) => (!selected.size || selected.has(c.id)) && playhead - c.start >= 0.02 && c.start + c.duration - playhead >= 0.02);
  }
  async function ensureMix() {
    if (!mixDirty && mixPcm) return;
    const done = busy('Mixen…');
    try { const { pcm } = await engine.renderMix(tl); mixPcm = pcm; player.load(pcm, 0); mixDirty = false; }
    finally { done(); }
  }
  async function startPlay() {
    if (!tl.clips.length) return toast('Voeg eerst audio toe aan de tijdlijn', 'info');
    try { await ensureMix(); } catch (e) { return toast('Mixen mislukt: ' + e.message, 'err'); }
    if (playhead >= contentEnd() - 0.05) playhead = 0;
    await player.play(playhead).catch(() => {});
    playBtn.replaceChildren(icon('pause'));
    playBtn.title = 'Pauzeren (spatie)';
    cancelAnimationFrame(raf);
    const loop = () => {
      if (destroyed) return;
      if (!player.playing) { playBtn.replaceChildren(icon('play')); playBtn.title = 'Afspelen (spatie)'; return; }
      playhead = player.time; placePlayhead();
      const x = playhead * tl.zoom - scroller.scrollLeft;
      if (x > scroller.clientWidth - 60 || x < 0) scroller.scrollLeft = playhead * tl.zoom - 80;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function stopPlay() { player.pause(); cancelAnimationFrame(raf); playBtn.replaceChildren(icon('play')); playBtn.title = 'Afspelen (spatie)'; }
  function togglePlay() { player.playing ? stopPlay() : startPlay(); }

  // ============ media panel ============
  let mediaTab = 'audio';
  const mTabs = [['audio', '🎙️ Audio'], ['sfx', '🔊 Effecten']].map(([k, l]) => h('button', { class: 'tab', id: `media-tab-${k}`, onclick: () => { mediaTab = k; renderMedia(); } }, l));
  mediaTabs.append(...mTabs);

  const fileIn = h('input', { type: 'file', accept: 'audio/*,video/webm', multiple: true, hidden: true, id: 'asset-file' });
  fileIn.onchange = () => { uploadFiles(fileIn.files); fileIn.value = ''; };
  let uploadTargetFolder = 'Eigen';
  const sfxFileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, id: 'sfx-file' });
  sfxFileIn.onchange = () => { uploadSfx(sfxFileIn.files, uploadTargetFolder); sfxFileIn.value = ''; uploadTargetFolder = 'Eigen'; };
  let sfxQuery = '';
  let sfxFilter = 'all'; // 'all' | 'fav' | 'freesound'
  const fsSide = {
    status: null,
    activeCat: 'popular',
    sort: 'downloads_desc',
    maxDuration: '5',
    page: 1,
    count: 0,
    hasNext: false,
    hasPrev: false,
    loading: false,
    results: [],
  };
  let rec = null;

  async function uploadFiles(files) {
    files = [...files]; if (!files.length) return;
    const done = busy(`${files.length} bestand(en) uploaden…`);
    try {
      const rows = await api.uploadAssets(id, files);
      assets.push(...rows); renderMedia();
      const autoAdd = !tl.clips.length;
      let t = trackEnd(trackByKind('voice').id);
      for (const a of rows) {
        const src = { type: 'asset', id: a.id };
        try {
          await engine.getSource(src);
          const dur = engine.sourceDuration(src);
          a.duration = dur; api.updateAsset(a.id, { duration: dur }).catch(() => {});
          if (autoAdd) { const c = makeClip(src, a.name, trackByKind('voice').id, t, dur); t += dur; tl.clips.push(c); selected.add(c.id); }
        } catch { toast(`"${a.name}" kon niet gedecodeerd worden`, 'err'); }
      }
      if (autoAdd && tl.clips.length) { pushUndo(JSON.stringify({ tracks: tl.tracks, clips: [] })); changed(); }
      renderMedia();
      toast(autoAdd ? 'Geüpload en op de tijdlijn gezet' : 'Geüpload — sleep naar de tijdlijn of klik +', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { done(); }
  }

  async function uploadSfx(files, targetFolder = 'Eigen') {
    files = [...files]; if (!files.length) return;
    const done = busy(`${files.length} effect(en) uploaden…`);
    try {
      const rows = await api.uploadSfx(files, targetFolder);
      for (const r of rows) {
        try {
          const src = { type: 'sfx', id: r.id };
          customSfx.push(r);
          await engine.getSource(src);
          r.duration = engine.sourceDuration(src);
          api.updateSfx(r.id, { duration: r.duration }).catch(() => {});
        } catch {}
      }
      sfxStore.addCustomFolder(targetFolder);
      toast(`${rows.length} effect(en) opgeslagen in "${targetFolder}"`, 'ok');
      renderMedia();
    } catch (e) { toast(e.message, 'err'); }
    finally { done(); }
  }

  async function toggleRecord() {
    if (rec) { rec.recorder.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); }
    catch { return toast('Geen toegang tot de microfoon', 'err'); }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : {});
    const chunks = [];
    rec = { recorder, t0: Date.now(), timer: 0 };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(rec.timer); rec = null; renderMedia();
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 2000) return toast('Opname te kort', 'err');
      const now = new Date(), name = `Opname ${now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
      const done = busy('Opname opslaan…');
      try {
        const [a] = await api.uploadAssets(id, [new File([blob], 'opname.webm', { type: blob.type })], { kind: 'recording', name });
        assets.push(a);
        const src = { type: 'asset', id: a.id };
        await engine.getSource(src);
        a.duration = engine.sourceDuration(src); api.updateAsset(a.id, { duration: a.duration }).catch(() => {});
        renderMedia();
        const voice = trackByKind('voice');
        const c = makeClip(src, name, voice.id, trackEnd(voice.id), a.duration);
        mutate(() => { tl.clips.push(c); selected = new Set([c.id]); });
        toast('Opname toegevoegd aan de tijdlijn', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { done(); }
    };
    recorder.start(250);
    renderMedia();
    rec.timer = setInterval(() => { const el = $('#rec-time'); if (el && rec) el.textContent = fmtTime((Date.now() - rec.t0) / 1000, true); }, 100);
  }

  function mediaItem({ name, sub, badge, cls = '', src, onPlay, onAdd, isFav = false, onFav = null, acts = [], wave = null }) {
    const playB = h('button', { class: 'play', title: 'Voorbeluisteren', 'aria-label': `${name} beluisteren` }, icon('play'));
    playB.addEventListener('statechange', (e) => playB.replaceChildren(icon(e.detail ? 'pause' : 'play')));
    playB.onclick = (e) => { e.stopPropagation(); onPlay(playB); };

    const favB = onFav ? h('button', {
      class: `btn btn-ghost btn-icon btn-fav${isFav ? ' active' : ''}`,
      title: isFav ? 'Verwijder uit favorieten' : 'Als favoriet markeren',
      'aria-pressed': String(isFav),
      'aria-label': isFav ? `${name} uit favorieten verwijderen` : `${name} als favoriet markeren`,
      onclick: (e) => { e.stopPropagation(); onFav(); }
    }, icon(isFav ? 'starFilled' : 'star')) : null;

    const normActs = acts.map((b) => b instanceof HTMLElement ? ({ label: b.title, icon: b.title === 'Verwijderen' ? 'trash' : 'edit', danger: b.title === 'Verwijderen', action: () => b.click() }) : b);

    const waveEl = wave ? createWaveBox({ ...wave, playBtn: playB, compact: true }) : null;

    const item = h('div', { class: `media-item ${cls}${waveEl ? ' has-wave' : ''}`, draggable: 'true', title: `${name}\nSleep naar de tijdlijn of dubbelklik om toe te voegen` },
      waveEl ? null : playB,
      h('div', { class: 'media-item-bottom' },
        h('div', { class: 'info' },
          h('div', { class: 'name' }, name),
          h('div', { class: 'sub' }, badge || null, sub)
        ),
        h('div', { class: 'acts' },
          favB,
          h('button', { class: 'btn btn-ghost btn-icon media-add', title: 'Toevoegen aan tijdlijn', 'aria-label': `${name} toevoegen`, onclick: (e) => { e.stopPropagation(); onAdd(); } }, icon('plus')),
          normActs.length ? h('button', {
            class: 'btn btn-ghost btn-icon media-more',
            title: 'Bestandsopties',
            'aria-label': `Opties voor ${name}`,
            onclick: (e) => openContextMenu(e, normActs, name)
          }, '⋯') : null
        )
      ),
      waveEl
    );

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tsrc', JSON.stringify({ src, name }));
      e.dataTransfer.setData('application/x-sfx-id', JSON.stringify({ src, name }));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    item.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) onAdd(); });
    if (normActs.length) {
      item.addEventListener('contextmenu', (e) => openContextMenu(e, normActs, name));
    }
    return item;
  }

  function renderMedia() {
    mTabs.forEach((b) => b.classList.toggle('active', b.id === `media-tab-${mediaTab}`));
    mediaBody.replaceChildren();
    if (mediaTab === 'audio') {
      const drop = h('button', { class: 'dropzone', id: 'asset-drop', type: 'button', onclick: () => fileIn.click() }, icon('upload'), h('div', {}, h('b', {}, 'Audio uploaden'), h('br'), h('span', {}, 'Kies bestanden of sleep ze hierheen')));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
      drop.addEventListener('drop', (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });
      mediaBody.append(drop, fileIn);
      if (rec) {
        mediaBody.append(h('div', { class: 'rec-panel' },
          h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px' } }, h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 12px var(--danger)', animation: 'recPulse 1s infinite' } }), h('span', { class: 'rec-time', id: 'rec-time' }, fmtTime((Date.now() - rec.t0) / 1000, true))),
          h('button', { class: 'btn btn-record recording', id: 'rec-btn', onclick: toggleRecord }, icon('stop'), 'Stop opname')));
      } else {
        mediaBody.append(h('button', { class: 'btn btn-record', id: 'rec-btn', onclick: toggleRecord }, icon('mic'), 'Opnemen met microfoon'));
      }
      mediaBody.append(h('details', { class: 'record-tip' }, h('summary', {}, 'Tips voor opnemen'), h('p', {}, 'Met een Bluetooth-headset kan het geluid tijdens opnemen tijdelijk minder goed zijn. Na de opname herstelt dit.')));
      mediaBody.append(h('h5', {}, `Projectaudio (${assets.length})`));
      if (!assets.length) mediaBody.append(h('div', { class: 'hint' }, 'Nog geen audio. Upload een bestand of neem iets op.'));
      [...assets].reverse().forEach((a) => {
        const src = { type: 'asset', id: a.id };
        const used = tl.clips.filter((c) => c.src.type === 'asset' && c.src.id === a.id).length;
        mediaBody.append(mediaItem({
          name: a.name, src,
          badge: a.kind === 'recording' ? h('span', { class: 'badge rec' }, 'opname') : a.kind === 'render' ? h('span', { class: 'badge render' }, 'bewerkt') : null,
          sub: `${a.duration ? fmtTime(a.duration, true) : '…'}${used ? ` · ${used}× gebruikt` : ''}`,
          onPlay: (b) => previewAudio.playUrl(fileUrl.asset(a), b),
          onAdd: () => { const t = trackByKind('voice'); addSource(src, a.name, t.id, trackEnd(t.id)); },
          acts: [
            h('button', { class: 'btn btn-ghost btn-icon', title: 'Hernoemen', onclick: async (e) => {
              e.stopPropagation();
              const n = await modal({ title: 'Bestand hernoemen', confirm: 'Opslaan', input: { value: a.name } });
              if (n?.trim()) { Object.assign(a, await api.updateAsset(a.id, { name: n.trim() })); renderMedia(); }
            } }, icon('edit')),
            h('button', { class: 'btn btn-ghost btn-icon', title: 'Verwijderen', onclick: async (e) => {
              e.stopPropagation();
              if (!(await modal({ title: `"${a.name}" verwijderen?`, body: used ? `Dit bestand wordt ${used}× gebruikt op de tijdlijn; die clips verdwijnen ook.` : 'Het bestand wordt definitief verwijderd.', confirm: 'Verwijderen', danger: true }))) return;
              await api.deleteAsset(a.id); assets = assets.filter((x) => x !== a);
              if (used) mutate(() => (tl.clips = tl.clips.filter((c) => !(c.src.type === 'asset' && c.src.id === a.id))));
              renderMedia();
            } }, icon('trash')),
          ],
        }));
      });
    } else {
      const search = h('input', {
        class: 'input',
        type: 'search',
        placeholder: sfxFilter === 'freesound' ? 'Zoek op Freesound…' : 'Zoek effect…',
        value: sfxQuery,
        id: 'media-sfx-search',
        'aria-label': 'Sound effects zoeken'
      });

      const doSideFreesoundSearch = async (page = 1) => {
        if (!fsSide.status) {
          fsSide.status = await api.freesoundStatus().catch(() => ({ configured: false }));
        }
        if (!fsSide.status.configured) {
          paintList();
          return;
        }
        const catObj = QUICK_CATEGORIES.find((c) => c.id === fsSide.activeCat);
        const q = sfxQuery.trim() || catObj?.q || 'sound effect';
        fsSide.loading = true;
        fsSide.page = page;
        paintList();
        try {
          const data = await api.freesoundSearch({
            q,
            sort: fsSide.sort,
            maxDuration: fsSide.maxDuration,
            page,
            pageSize: 15,
          });
          fsSide.results = data.results || [];
          fsSide.count = data.count || 0;
          fsSide.hasNext = Boolean(data.next);
          fsSide.hasPrev = Boolean(data.previous);
        } catch (err) {
          toast(err.message, 'err');
          fsSide.results = [];
        } finally {
          fsSide.loading = false;
          paintList();
        }
      };

      const debouncedFsSearch = debounce(() => {
        if (sfxFilter === 'freesound') {
          if (sfxQuery.trim()) fsSide.activeCat = '';
          else if (!fsSide.activeCat) fsSide.activeCat = 'popular';
          doSideFreesoundSearch(1);
        }
      }, 380);

      search.oninput = () => {
        sfxQuery = search.value;
        if (sfxFilter === 'freesound') debouncedFsSearch();
        else paintList();
      };
      search.onkeydown = (e) => {
        if (e.key === 'Enter' && sfxFilter === 'freesound') {
          e.preventDefault();
          if (sfxQuery.trim()) fsSide.activeCat = '';
          doSideFreesoundSearch(1);
        }
      };

      const newFolderBtn = h('button', {
        class: 'btn btn-sm btn-ghost',
        title: 'Nieuwe map maken',
        id: 'sfx-new-folder-btn',
        onclick: async () => {
          const n = await modal({
            title: 'Nieuwe map maken',
            body: 'Geef een naam op voor je nieuwe effectenmap:',
            confirm: 'Map maken',
            input: { placeholder: 'Bijv. Sci-Fi, Explosies, Voetstappen…' }
          });
          if (n?.trim()) {
            const folderName = n.trim();
            sfxStore.addCustomFolder(folderName);
            sfxStore.setCollapsed(folderName, false);
            sfxQuery = search.value = '';
            sfxFilter = 'all';
            toast(`Map "${folderName}" gemaakt`, 'ok');
            paintList();
          }
        }
      }, icon('folderPlus'), 'Nieuwe map');

      const toggleCollapseBtn = h('button', {
        class: 'btn btn-sm btn-ghost',
        id: 'sfx-collapse-all-btn',
        type: 'button'
      });
      const folders = createSfxFolders(toggleCollapseBtn);

      const uploadBtn = h('button', {
        class: 'btn btn-sm',
        title: 'Eigen effect uploaden (wordt bewaard)',
        id: 'sfx-upload-btn',
        onclick: () => {
          uploadTargetFolder = 'Eigen';
          sfxFileIn.click();
        }
      }, icon('upload'), 'Uploaden');

      const switchToFreesound = async () => {
        sfxFilter = 'freesound';
        search.placeholder = 'Zoek op Freesound…';
        if (!fsSide.status) {
          fsSide.status = await api.freesoundStatus().catch(() => ({ configured: false }));
        }
        if (fsSide.status.configured && !fsSide.results.length && !fsSide.loading) {
          doSideFreesoundSearch(1);
        } else {
          paintList();
        }
      };

      const toolbar = h('div', { class: 'sfx-toolbar' }, search,
        h('div', { class: 'sfx-toolbar-actions' }, uploadBtn, newFolderBtn));
      const list = h('div', { class: 'sfx-library-list' });
      const captionRow = h('div', { class: 'sfx-list-caption' });

      const refreshCustomSfx = async () => {
        customSfx = await api.sfx().catch(() => []);
      };

      const renderFreesoundSideItem = (item) => {
        const displayName = cleanFreesoundName(item.name);
        const localItem = sfxStore.getFreesoundLocal(item.id, customSfx);
        const isSaved = Boolean(localItem && localItem.id);
        const isFav = isSaved && sfxStore.isFavorite({ id: localItem.id });
        const lic = shortFreesoundLicense(item.license);
        const subText = [`${item.duration.toFixed(1)}s`, item.username || 'Freesound', lic].filter(Boolean).join(' · ');

        const handleFav = async () => {
          try {
            const row = await ensureFreesoundImported(item, {
              category: 'Freesound',
              existingSfx: customSfx,
              onImported: refreshCustomSfx,
            });
            const nowFav = sfxStore.toggleFavorite({ id: row.id });
            toast(nowFav ? `"${displayName}" bij Favorieten bewaard` : `"${displayName}" uit Favorieten verwijderd`, 'ok');
            paintList();
          } catch (err) {
            toast(err.message, 'err');
          }
        };

        const handleAdd = async () => {
          const done = busy(`"${displayName}" laden…`);
          try {
            const row = await ensureFreesoundImported(item, {
              category: 'Freesound',
              existingSfx: customSfx,
              onImported: refreshCustomSfx,
            });
            const src = { type: 'sfx', id: row.id };
            const t = trackByKind('sfx');
            await addSource(src, sfxStore.getName(row), t.id, playhead);
            paintList();
          } catch (err) {
            toast(err.message, 'err');
          } finally {
            done();
          }
        };

        const acts = [
          {
            label: isFav ? 'Verwijder uit favorieten' : 'Als favoriet markeren',
            icon: isFav ? 'starFilled' : 'star',
            action: handleFav,
          },
          {
            label: 'Toevoegen aan tijdlijn',
            icon: 'plus',
            action: handleAdd,
          },
          {
            label: isSaved ? 'Verplaatsen naar map…' : 'Opslaan in map…',
            icon: 'folderMove',
            action: async () => {
              const allFolders = [...new Set(['Freesound', ...sfxStore.getCustomFolders(customSfx)])];
              const res = await modal({
                title: `"${displayName}" opslaan in map`,
                body: 'Kies een map of typ een nieuwe:',
                select: {
                  options: allFolders.map((f) => ({ value: f, label: `📁 ${f}` })),
                  value: localItem?.category || 'Freesound'
                },
                input: { placeholder: 'Of typ een nieuwe mapnaam…' },
                confirm: 'Opslaan'
              });
              if (!res) return;
              const target = (typeof res === 'object' ? (res.input?.trim() || res.select) : res).trim() || 'Freesound';
              try {
                const row = await ensureFreesoundImported(item, {
                  category: target,
                  existingSfx: customSfx,
                  onImported: refreshCustomSfx,
                });
                if (row.category !== target) {
                  await api.updateSfx(row.id, { category: target });
                  row.category = target;
                  sfxStore.addCustomFolder(target);
                  await refreshCustomSfx();
                }
                toast(`"${displayName}" opgeslagen in "${target}"`, 'ok');
                paintList();
              } catch (err) {
                toast(err.message, 'err');
              }
            }
          }
        ];

        return mediaItem({
          cls: 'sfx',
          name: displayName,
          src: isSaved ? { type: 'sfx', id: localItem.id } : { type: 'freesound', item },
          badge: isSaved ? h('span', { class: 'badge', title: `Opgeslagen in ${localItem.category || 'Freesound'}` }, 'bewaard') : null,
          sub: [item.username || 'Freesound', lic].filter(Boolean).join(' · '),
          isFav,
          onFav: handleFav,
          onPlay: (b) => previewAudio.playUrl(item.previewUrl, b),
          onAdd: handleAdd,
          acts,
          wave: {
            key: `fs:${item.id}`,
            waveformUrl: item.waveformUrl,
            audioUrl: item.previewUrl,
            duration: item.duration || 0,
          },
        });
      };

      const paintList = () => {
        const q = sfxQuery.trim().toLowerCase();
        const isSearching = Boolean(q);
        search.placeholder = sfxFilter === 'freesound' ? 'Zoek op Freesound (bijv. click, sticker, beep)…' : 'Zoek effect…';
        folders.reset(q);
        const m = (s) => {
          if (!q) return true;
          const dn = sfxStore.getName(s).toLowerCase();
          const orig = (s.name || '').toLowerCase();
          const cat = (s.category || '').toLowerCase();
          return dn.includes(q) || orig.includes(q) || cat.includes(q);
        };

        const addAt = (src, name) => {
          const t = trackByKind('sfx');
          addSource(src, name, t.id, playhead);
        };

        // Render custom sound media item
        const renderCustomItem = (s) => {
          const src = { type: 'sfx', id: s.id };
          const isFav = sfxStore.isFavorite(s);
          const displayName = sfxStore.getName(s);
          const hasCustomName = sfxStore.hasAlias(s) && displayName !== s.name;

          const acts = [
            {
              label: isFav ? 'Verwijder uit favorieten' : 'Als favoriet markeren',
              icon: isFav ? 'starFilled' : 'star',
              action: () => { sfxStore.toggleFavorite(s); paintList(); }
            },
            {
              label: 'Hernoemen',
              icon: 'edit',
              action: async () => {
                const n = await modal({
                  title: 'Effect hernoemen',
                  confirm: 'Opslaan',
                  input: { value: displayName }
                });
                if (n?.trim() && n.trim() !== displayName) {
                  const newName = n.trim();
                  await api.updateSfx(s.id, { name: newName });
                  s.name = newName;
                  sfxStore.setAlias(s, newName);
                  toast('Effect hernoemd', 'ok');
                  paintList();
                }
              }
            },
            {
              label: 'Verplaatsen naar map…',
              icon: 'folderMove',
              action: async () => {
                const allFolders = sfxStore.getCustomFolders(customSfx);
                const res = await modal({
                  title: 'Verplaatsen naar map',
                  body: 'Kies een bestaande map of typ een nieuwe:',
                  select: {
                    options: allFolders.map((f) => ({ value: f, label: `📁 ${f}` })),
                    value: s.category || 'Eigen'
                  },
                  input: { placeholder: 'Of typ een nieuwe mapnaam…' },
                  confirm: 'Verplaatsen'
                });
                if (res) {
                  const target = (typeof res === 'object' ? (res.input?.trim() || res.select) : res).trim();
                  if (target && target !== s.category) {
                    await api.updateSfx(s.id, { category: target });
                    s.category = target;
                    sfxStore.addCustomFolder(target);
                    toast(`Verplaatst naar "${target}"`, 'ok');
                    paintList();
                  }
                }
              }
            },
            {
              label: 'Verwijderen',
              icon: 'trash',
              danger: true,
              action: async () => {
                const ok = await modal({
                  title: `"${displayName}" verwijderen?`,
                  body: 'Het effect wordt definitief verwijderd uit je bibliotheek.',
                  confirm: 'Verwijderen',
                  danger: true
                });
                if (ok) {
                  await api.deleteSfx(s.id);
                  customSfx = customSfx.filter((x) => x.id !== s.id);
                  if (isFav) sfxStore.toggleFavorite(s);
                  sfxStore.resetAlias(s);
                  toast('Effect verwijderd', 'ok');
                  paintList();
                }
              }
            }
          ];

          return mediaItem({
            cls: 'sfx',
            name: displayName,
            src,
            badge: hasCustomName ? h('span', { class: 'badge', title: `Oorspronkelijk: ${s.name}` }, 'aangepast') : null,
            sub: s.category || 'Eigen',
            isFav,
            onFav: () => { sfxStore.toggleFavorite(s); paintList(); },
            onPlay: (b) => previewAudio.playUrl(fileUrl.sfx(s), b),
            onAdd: () => addAt(src, displayName),
            acts,
            wave: {
              key: `sfx:${s.id}`,
              audioUrl: fileUrl.sfx(s),
              duration: s.duration || 0,
            },
          });
        };

        // Render built-in sound media item
        const renderBuiltinItem = (s) => {
          const src = { type: 'builtin', key: s.key };
          const isFav = sfxStore.isFavorite(s);
          const displayName = sfxStore.getName(s);
          const hasAlias = sfxStore.hasAlias(s);

          const acts = [
            {
              label: isFav ? 'Verwijder uit favorieten' : 'Als favoriet markeren',
              icon: isFav ? 'starFilled' : 'star',
              action: () => { sfxStore.toggleFavorite(s); paintList(); }
            },
            {
              label: 'Hernoemen',
              icon: 'edit',
              action: async () => {
                const n = await modal({
                  title: 'Geluid hernoemen',
                  body: 'Pas de weergavenaam aan voor dit geluid:',
                  confirm: 'Opslaan',
                  input: { value: displayName }
                });
                if (n?.trim() && n.trim() !== displayName) {
                  sfxStore.setAlias(s, n.trim());
                  toast('Naam aangepast', 'ok');
                  paintList();
                }
              }
            }
          ];

          if (hasAlias) {
            acts.push({
              label: 'Standaardnaam herstellen',
              icon: 'undo',
              action: () => {
                sfxStore.resetAlias(s);
                toast('Standaardnaam hersteld', 'ok');
                paintList();
              }
            });
          }

          return mediaItem({
            cls: 'sfx',
            name: displayName,
            src,
            badge: hasAlias ? h('span', { class: 'badge', title: `Standaard: ${s.name}` }, 'aangepast') : null,
            sub: s.category,
            isFav,
            onFav: () => { sfxStore.toggleFavorite(s); paintList(); },
            onPlay: async (b) => previewAudio.playPcm(await renderBuiltin(s.key), b),
            onAdd: () => addAt(src, displayName),
            acts,
            wave: {
              key: `builtin:${s.key}`,
              loadPcm: () => renderBuiltin(s.key),
              duration: s.duration || 0,
            },
          });
        };

        // Helper to construct a collapsible folder section
        const buildFolder = ({ key, title, iconName, count, isFavGroup = false, actions = [], children = [], emptyText = '' }) => {
          const folderEl = folders.folder({ key, title, iconName, count, isFavGroup, actions, children, emptyText });
          const head = folderEl.querySelector('.sfx-folder-head');

          // Drag and drop onto folder to move custom sounds
          if (!isFavGroup && !BUILTIN_SFX.some((b) => b.category === key)) {
            head.addEventListener('dragover', (e) => {
              if (e.dataTransfer.types.includes('application/x-sfx-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                folderEl.classList.add('drag-over');
              }
            });
            head.addEventListener('dragleave', (e) => {
              if (!head.contains(e.relatedTarget)) folderEl.classList.remove('drag-over');
            });
            head.addEventListener('drop', async (e) => {
              e.preventDefault();
              folderEl.classList.remove('drag-over');
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/x-sfx-id') || '{}');
                if (data.src?.type === 'sfx') {
                  const s = customSfx.find((x) => x.id === data.src.id);
                  if (s && s.category !== key) {
                    await api.updateSfx(s.id, { category: key });
                    s.category = key;
                    toast(`"${sfxStore.getName(s)}" verplaatst naar "${key}"`, 'ok');
                    paintList();
                  }
                }
              } catch {}
            });
          }

          return folderEl;
        };

        list.replaceChildren();

        // Count total favorites
        const allSounds = [
          ...customSfx.map((s) => ({ ...s, src: { type: 'sfx', id: s.id } })),
          ...BUILTIN_SFX.map((s) => ({ ...s, src: { type: 'builtin', key: s.key } }))
        ];
        const totalFavCount = allSounds.filter((s) => sfxStore.isFavorite(s)).length;

        // Update filter chips in toolbar
        filterBar.replaceChildren(
          h('button', {
            class: `sfx-filter-chip${sfxFilter === 'all' ? ' active' : ''}`,
            'aria-pressed': String(sfxFilter === 'all'),
            onclick: () => { sfxFilter = 'all'; paintList(); }
          }, 'Alles'),
          h('button', {
            class: `sfx-filter-chip fav-chip${sfxFilter === 'fav' ? ' active' : ''}`,
            'aria-pressed': String(sfxFilter === 'fav'),
            onclick: () => { sfxFilter = 'fav'; paintList(); }
          }, icon('starFilled'), `Favorieten (${totalFavCount})`),
          h('button', {
            class: `sfx-filter-chip fs-chip${sfxFilter === 'freesound' ? ' active' : ''}`,
            'aria-pressed': String(sfxFilter === 'freesound'),
            onclick: () => switchToFreesound()
          }, icon('globe'), 'Freesound')
        );

        if (sfxFilter === 'freesound') {
          captionRow.replaceChildren(
            h('span', {}, 'Freesound.org'),
            h('div', { class: 'fs-side-head-btns' },
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                title: 'Freesound API Key & OAuth2 instellingen',
                onclick: () => openFreesoundConfigModal({
                  onSaved: (nextStatus) => {
                    fsSide.status = nextStatus;
                    if (nextStatus.configured) doSideFreesoundSearch(1);
                    else paintList();
                  }
                })
              }, icon('key'), 'API'),
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                title: 'Open groot Freesound overzicht',
                onclick: () => openFreesoundModal({
                  getCustomSfx: () => customSfx,
                  getFolders: () => sfxStore.getCustomFolders(customSfx),
                  onImported: async () => {
                    await refreshCustomSfx();
                    paintList();
                  }
                })
              }, icon('full'))
            )
          );

          const fsSearchIn = h('input', {
            class: 'input fs-side-search-in',
            type: 'search',
            value: sfxQuery,
            placeholder: 'Zoek op Freesound (bijv. kick, click, whoosh)…',
            'aria-label': 'Zoek op Freesound',
            oninput: (e) => {
              sfxQuery = search.value = e.target.value;
            }
          });
          const fsSearchForm = h('form', {
            class: 'fs-side-search-form',
            onsubmit: (e) => {
              e.preventDefault();
              sfxQuery = search.value = fsSearchIn.value;
              if (sfxQuery.trim()) fsSide.activeCat = '';
              doSideFreesoundSearch(1);
            }
          },
            fsSearchIn,
            h('button', { class: 'btn btn-primary btn-sm btn-icon', type: 'submit', title: 'Zoeken op Freesound' }, icon('search'))
          );

          const chipsWrap = h('div', { class: 'fs-side-cats' },
            ...QUICK_CATEGORIES.map((cat) => h('button', {
              class: `sfx-filter-chip${fsSide.activeCat === cat.id && !sfxQuery.trim() ? ' active' : ''}`,
              type: 'button',
              onclick: () => {
                fsSide.activeCat = cat.id;
                sfxQuery = search.value = fsSearchIn.value = '';
                if (cat.sort) fsSide.sort = cat.sort;
                doSideFreesoundSearch(1);
              }
            }, cat.label))
          );

          const sortSel = h('select', {
            class: 'select fs-side-select',
            'aria-label': 'Sorteren',
            onchange: (e) => { fsSide.sort = e.target.value; doSideFreesoundSearch(1); }
          },
            h('option', { value: 'downloads_desc', selected: fsSide.sort === 'downloads_desc' }, 'Populairste'),
            h('option', { value: 'score', selected: fsSide.sort === 'score' }, 'Relevantie'),
            h('option', { value: 'rating_desc', selected: fsSide.sort === 'rating_desc' }, 'Beoordeling'),
            h('option', { value: 'duration_asc', selected: fsSide.sort === 'duration_asc' }, 'Kortste eerst'),
            h('option', { value: 'created_desc', selected: fsSide.sort === 'created_desc' }, 'Nieuwste')
          );

          const durSel = h('select', {
            class: 'select fs-side-select',
            'aria-label': 'Maximale lengte',
            onchange: (e) => { fsSide.maxDuration = e.target.value; doSideFreesoundSearch(1); }
          },
            h('option', { value: '0', selected: fsSide.maxDuration === '0' }, 'Alle lengtes'),
            h('option', { value: '2', selected: fsSide.maxDuration === '2' }, 'Max 2s'),
            h('option', { value: '5', selected: fsSide.maxDuration === '5' }, 'Max 5s'),
            h('option', { value: '10', selected: fsSide.maxDuration === '10' }, 'Max 10s'),
            h('option', { value: '30', selected: fsSide.maxDuration === '30' }, 'Max 30s')
          );

          list.append(
            fsSearchForm,
            chipsWrap,
            h('div', { class: 'fs-side-filters' }, sortSel, durSel)
          );

          if (fsSide.loading) {
            list.append(h('div', { class: 'fs-side-empty' }, h('span', { class: 'spinner' }), h('span', {}, 'Zoeken op Freesound…')));
            return;
          }

          if (fsSide.status && !fsSide.status.configured) {
            list.append(
              h('div', { class: 'fs-side-empty' },
                h('p', {}, 'Koppel je Freesound API Key om hier direct geluiden te zoeken, beluisteren en als favoriet te bewaren.'),
                h('button', {
                  class: 'btn btn-primary btn-sm',
                  type: 'button',
                  onclick: () => openFreesoundConfigModal({
                    onSaved: (nextStatus) => {
                      fsSide.status = nextStatus;
                      if (nextStatus.configured) doSideFreesoundSearch(1);
                    }
                  })
                }, icon('key'), 'API Key instellen')
              )
            );
            return;
          }

          if (!fsSide.results.length) {
            list.append(h('div', { class: 'fs-side-empty' }, 'Geen geluiden gevonden. Probeer een andere zoekterm of categorie.'));
            return;
          }

          const itemsWrap = h('div', { class: 'sfx-folder-body' },
            ...fsSide.results.map(renderFreesoundSideItem)
          );
          list.append(itemsWrap);

          const totalPages = Math.max(1, Math.ceil(fsSide.count / 15));
          list.append(
            h('div', { class: 'fs-side-pager' },
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                disabled: !fsSide.hasPrev || fsSide.page <= 1,
                onclick: () => doSideFreesoundSearch(fsSide.page - 1),
              }, '←'),
              h('span', {}, `Pagina ${fsSide.page}/${totalPages} (${fsSide.count.toLocaleString('nl-NL')})`),
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                disabled: !fsSide.hasNext,
                onclick: () => doSideFreesoundSearch(fsSide.page + 1),
              }, '→')
            )
          );
          return;
        }

        captionRow.replaceChildren(h('span', {}, 'Categorieën'), toggleCollapseBtn);

        let renderedCount = 0;

        // 1. Pinned Favorites section
        const matchingFavs = allSounds.filter((s) => sfxStore.isFavorite(s) && m(s));
        if (sfxFilter === 'fav' || matchingFavs.length > 0) {
          const favChildren = matchingFavs.map((s) => s.src.type === 'sfx' ? renderCustomItem(s) : renderBuiltinItem(s));
          list.append(buildFolder({
            key: '⭐ Favorieten',
            title: 'Favorieten',
            iconName: 'starFilled',
            count: matchingFavs.length,
            isFavGroup: true,
            children: favChildren,
            emptyText: sfxFilter === 'fav'
              ? (q ? 'Geen favorieten gevonden met deze zoekterm' : 'Nog geen favorieten. Klik op het sterretje bij een geluid om het hier toe te voegen!')
              : 'Geen favorieten'
          }));
          renderedCount += matchingFavs.length;
        }

        if (sfxFilter !== 'fav') {
          // 2. Custom Folders
          const customFolders = sfxStore.getCustomFolders(customSfx);
          customFolders.forEach((folderName) => {
            const inFolder = customSfx.filter((s) => (s.category || 'Eigen') === folderName && m(s));
            const allInFolder = customSfx.filter((s) => (s.category || 'Eigen') === folderName);

            if (isSearching && !inFolder.length) return; // Skip empty folders during search

            const actions = [
              h('button', {
                class: 'btn btn-ghost btn-icon',
                title: `Uploaden in "${folderName}"`,
                onclick: (e) => {
                  e.stopPropagation();
                  uploadTargetFolder = folderName;
                  sfxFileIn.click();
                }
              }, icon('plus')),
              h('button', {
                class: 'btn btn-ghost btn-icon',
                title: `Mapopties voor "${folderName}"`,
                onclick: (e) => {
                  e.stopPropagation();
                  openContextMenu(e, [
                    {
                      label: 'Uploaden in deze map',
                      icon: 'upload',
                      action: () => { uploadTargetFolder = folderName; sfxFileIn.click(); }
                    },
                    {
                      label: 'Map hernoemen',
                      icon: 'edit',
                      action: async () => {
                        const n = await modal({
                          title: `Map "${folderName}" hernoemen`,
                          confirm: 'Opslaan',
                          input: { value: folderName }
                        });
                        if (n?.trim() && n.trim() !== folderName) {
                          const newName = n.trim();
                          sfxStore.renameCustomFolder(folderName, newName);
                          for (const s of customSfx.filter((x) => x.category === folderName)) {
                            s.category = newName;
                            api.updateSfx(s.id, { category: newName }).catch(() => {});
                          }
                          toast(`Map hernoemd naar "${newName}"`, 'ok');
                          paintList();
                        }
                      }
                    },
                    folderName !== 'Eigen' ? {
                      label: 'Map verwijderen',
                      icon: 'trash',
                      danger: true,
                      action: async () => {
                        const current = customSfx.filter((x) => x.category === folderName);
                        const ok = await modal({
                          title: `Map "${folderName}" verwijderen?`,
                          body: current.length ? `${current.length} geluid(en) in deze map worden verplaatst naar 'Eigen'.` : 'De lege map wordt verwijderd.',
                          confirm: 'Map verwijderen',
                          danger: true
                        });
                        if (ok) {
                          for (const s of current) {
                            s.category = 'Eigen';
                            api.updateSfx(s.id, { category: 'Eigen' }).catch(() => {});
                          }
                          sfxStore.removeCustomFolder(folderName);
                          toast(`Map "${folderName}" verwijderd`, 'ok');
                          paintList();
                        }
                      }
                    } : null
                  ].filter(Boolean), `Map: ${folderName}`);
                }
              }, icon('more'))
            ];

            list.append(buildFolder({
              key: folderName,
              title: folderName,
              iconName: 'folder',
              count: inFolder.length,
              actions,
              children: inFolder.map(renderCustomItem),
              emptyText: allInFolder.length ? 'Geen effecten die aan de zoekterm voldoen' : 'Upload geluiden met + of sleep geluiden naar deze map'
            }));
            renderedCount += inFolder.length;
          });

          // 3. Built-in categories
          const builtinCategories = [...new Set(BUILTIN_SFX.map((s) => s.category))];
          builtinCategories.forEach((cat) => {
            const inCat = BUILTIN_SFX.filter((s) => s.category === cat && m(s));
            if (!inCat.length) return;

            list.append(buildFolder({
              key: cat,
              title: cat,
              iconName: 'wave',
              count: inCat.length,
              children: inCat.map(renderBuiltinItem)
            }));
            renderedCount += inCat.length;
          });
        }

        if (renderedCount === 0 && sfxFilter !== 'fav') {
          list.append(h('div', { class: 'hint', style: { padding: '16px 8px', textAlign: 'center' } },
            isSearching ? `Geen lokale effecten voor "${sfxQuery}"` : 'Geen effecten gevonden'));
        }

        if (sfxFilter === 'all') {
          list.append(
            h('button', {
              class: 'fs-side-switch-banner',
              type: 'button',
              onclick: () => switchToFreesound()
            },
              icon('globe'),
              h('span', {}, isSearching ? `Zoek "${sfxQuery}" op Freesound.org →` : 'Meer geluiden zoeken op Freesound.org →')
            )
          );
        }
        folders.sync();
      };

      const filterBar = h('div', { class: 'sfx-filter-bar', role: 'group', 'aria-label': 'Effecten filteren' });
      mediaBody.append(h('div', { class: 'sfx-controls' }, toolbar, filterBar, captionRow),
        h('p', { class: 'sfx-help' }, '▶ beluisteren · ★ favoriet · + op tijdlijn'), sfxFileIn, list);
      paintList();
    }
  }

  // ============ inspector ============
  function fillRange(r) { const p = ((r.value - r.min) / (r.max - r.min)) * 100; r.style.setProperty('--p', p + '%'); }

  function slider({ label, min, max, step, value, fmt, apply }) {
    const r = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
    const out = h('output', {}, fmt(value)); fillRange(r);
    let before = null;
    r.addEventListener('input', () => { before ||= snapshot(); apply(+r.value); out.textContent = fmt(+r.value); fillRange(r); });
    r.addEventListener('change', () => { if (before) pushUndo(before); before = null; changed(); });
    r.addEventListener('dblclick', () => { const def = { Volume: 1, Snelheid: 1, Toonhoogte: 0, 'Fade in': 0, 'Fade out': 0, Intensiteit: 1 }[label]; if (def === undefined) return; before ||= snapshot(); r.value = def; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    return h('div', { class: 'slider-row', title: 'Dubbelklik = reset' }, h('span', {}, label), r, out);
  }

  function inspectorSection(key, label, ...children) {
    const section = h('details', { class: 'insp-card inspector-section', open: openSections.has(key) }, h('summary', {}, label), h('div', { class: 'section-content' }, ...children));
    section.addEventListener('toggle', () => { if (!section.isConnected) return; section.open ? openSections.add(key) : openSections.delete(key); });
    return section;
  }

  function closeFxPicker(restoreFocus = false) {
    if (fxPopup?.contains(fxPreviewButton)) stopFxPreview();
    fxPopup?.close();
    fxPopup?.remove(); fxPopup = null;
    fxTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus === true && fxTrigger?.isConnected) fxTrigger.focus({ preventScroll: true });
    fxTrigger = null;
  }

  function positionFxPicker() {
    // The dialog is centered by CSS and stays independent of inspector width.
    if (fxPopup && !fxTrigger?.isConnected) closeFxPicker();
  }

  function stopFxPreview() {
    fxPreviewToken++;
    if (fxPreviewButton) previewAudio.stop();
    fxPreviewButton = null;
  }

  function voicePreviewButton(label, getClip) {
    const button = h('button', { class: 'btn btn-sm fx-preview-btn', type: 'button' }, icon('play'), label);
    button.addEventListener('statechange', (e) => button.replaceChildren(icon(e.detail ? 'pause' : 'play'), label));
    button.onclick = async () => {
      if (button.classList.contains('playing')) { stopFxPreview(); return; }
      stopFxPreview();
      const token = fxPreviewToken;
      fxPreviewButton = button;
      const clip = getClip();
      button.disabled = true;
      button.replaceChildren(h('span', { class: 'spinner' }), 'Laden…');
      try {
        // Audition the first six seconds of this clip without changing it.
        const pcm = await engine.processClip({ ...clip, duration: Math.min(6, clip.duration) });
        if (token === fxPreviewToken && button.isConnected) await previewAudio.playPcm(pcm, button);
      } catch (error) { if (token === fxPreviewToken) toast(error.message, 'err'); }
      finally {
        button.disabled = button.dataset.unavailable === 'true';
        button.replaceChildren(icon(button.classList.contains('playing') ? 'pause' : 'play'), label);
      }
    };
    return button;
  }

  function openFxPicker(trigger, clips) {
    if (fxPopup) { closeFxPicker(true); return; }
    closeContextMenu(); fxTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const currentFx = clips[0].fx;
    let draftFx = currentFx, draftAmount = clips[0].fxAmount ?? 1;
    let category = currentFx === 'none' ? 'Populair' : (FX_BY_ID[currentFx]?.group || 'Populair'), query = '';
    const search = h('input', { class: 'input fx-search', type: 'search', placeholder: 'Zoek een stemeffect…', 'aria-label': 'Zoek een stemeffect' });
    const categories = h('div', { class: 'fx-categories', 'aria-label': 'Effectcategorieën' });
    const choices = h('div', { class: 'fx-choices', role: 'group', 'aria-label': 'Stemeffecten' });
    const groupNames = [...new Set(VOICE_PRESETS.map((p) => p.group))];
    const categoryButtons = ['Populair', 'Alles', ...groupNames].map((group) => h('button', {
      class: 'fx-category', 'aria-pressed': String(group === category), onclick: () => {
        category = group;
        categoryButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.textContent === category)));
        choices.scrollTop = 0;
        paintChoices();
      },
    }, group));
    categories.append(...categoryButtons);
    const selectionName = h('h3');
    const selectionDescription = h('p', { class: 'fx-selected-description' });
    const selectionIcon = h('span', { class: 'fx-selected-icon', 'aria-hidden': 'true' });
    const resultsLabel = h('span', { class: 'fx-results-label', 'aria-live': 'polite' });
    const draftStatus = h('span', { class: 'fx-draft-status', 'aria-live': 'polite' });
    const strength = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: draftAmount, 'aria-label': 'Sterkte van het voorbeeld' });
    const strengthValue = h('output');
    const originalPreview = voicePreviewButton('Origineel', () => ({ ...clips[0], fx: 'none' }));
    const effectPreview = voicePreviewButton('Met effect', () => ({ ...clips[0], fx: draftFx, fxAmount: draftAmount }));
    const applyButton = h('button', { class: 'btn btn-primary btn-sm', id: 'fx-apply-btn', type: 'button', onclick: () => {
      if (clips.some((clip) => !tl.clips.includes(clip))) { closeFxPicker(); return; }
      const id = draftFx, amount = draftAmount;
      closeFxPicker();
      if (clips.some((clip) => clip.fx !== id || clip.fxAmount !== amount)) mutate(() => clips.forEach((clip) => { clip.fx = id; clip.fxAmount = amount; }));
      $('#voice-fx-select', inspector)?.focus({ preventScroll: true });
    } }, clips.length > 1 ? `Toepassen op ${clips.length} clips` : 'Effect toepassen');
    function updateDraft() {
      const selectedPreset = FX_BY_ID[draftFx] || FX_BY_ID.none;
      selectionName.textContent = selectedPreset.name;
      selectionDescription.textContent = selectedPreset.desc;
      selectionIcon.textContent = selectedPreset.emoji;
      strength.value = draftAmount;
      fillRange(strength);
      strengthValue.textContent = Math.round(draftAmount * 100) + '%';
      strength.disabled = draftFx === 'none';
      strength.closest('.fx-strength-section').hidden = draftFx === 'none';
      effectPreview.disabled = draftFx === 'none';
      effectPreview.dataset.unavailable = String(draftFx === 'none');
      applyButton.disabled = clips.every((clip) => clip.fx === draftFx && (clip.fxAmount ?? 1) === draftAmount);
      draftStatus.textContent = applyButton.disabled ? 'Je clip is nog niet gewijzigd.' : 'Pas toe om deze klank te bewaren.';
    }
    strength.oninput = () => { stopFxPreview(); draftAmount = Number(strength.value); updateDraft(); };
    const paintChoices = () => {
      const scrollTop = choices.scrollTop;
      choices.replaceChildren();
      const matching = VOICE_PRESETS.filter((p) => (category === 'Alles' || (category === 'Populair' ? p.popular : p.group === category)) && `${p.name} ${p.group} ${p.desc}`.toLowerCase().includes(query.toLowerCase().trim())).sort((a, b) => groupNames.indexOf(a.group) - groupNames.indexOf(b.group));
      resultsLabel.textContent = `${matching.length} ${matching.length === 1 ? 'klank' : 'klanken'}${query ? ` voor “${query}”` : ` · ${category}`}`;
      if (!matching.length) choices.append(h('div', { class: 'fx-no-results' }, 'Geen effecten gevonden. Probeer een andere zoekterm.'));
      let lastGroup = null;
      matching.forEach((preset) => {
        if (category === 'Alles' && lastGroup !== preset.group) { lastGroup = preset.group; choices.append(h('div', { class: 'fx-category-heading' }, preset.group)); }
        choices.append(h('button', {
          class: `fx-choice${preset.id === draftFx ? ' selected' : ''}`, 'data-fx': preset.id, 'aria-pressed': String(preset.id === draftFx), onclick: () => {
            stopFxPreview();
            draftFx = preset.id;
            draftAmount = preset.id === currentFx ? (clips[0].fxAmount ?? 1) : 1;
            paintChoices();
            choices.querySelector(`[data-fx="${preset.id}"]`)?.focus({ preventScroll: true });
          },
        }, h('span', { class: 'fx-choice-icon', 'aria-hidden': 'true' }, preset.emoji), h('span', { class: 'fx-choice-text' }, h('b', {}, preset.name), h('span', {}, preset.desc)), h('span', { class: 'fx-choice-check', 'aria-hidden': 'true' }, preset.id === draftFx ? '✓' : '')));
      });
      choices.scrollTop = scrollTop;
      updateDraft();
    };
    search.addEventListener('input', () => { query = search.value; category = query ? 'Alles' : category; categoryButtons.forEach(button => button.setAttribute('aria-pressed', String(button.textContent === category))); choices.scrollTop = 0; paintChoices(); });
    fxPopup = h('dialog', { class: 'fx-picker-popup', id: 'fx-picker-popup', 'aria-labelledby': 'fx-picker-title' },
      h('div', { class: 'fx-picker-header' },
        h('div', {}, h('h2', { id: 'fx-picker-title' }, 'Geef je stem een andere klank'),
          h('p', { class: 'fx-picker-intro' }, 'Kies een effect, vergelijk het met je opname en pas het toe wanneer je tevreden bent.')),
        h('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'Stemeffectmenu sluiten', onclick: () => closeFxPicker(true) }, '×')),
      h('div', { class: 'fx-picker-body' },
        h('div', { class: 'fx-browser' }, search, categories, resultsLabel, choices),
        h('aside', { class: 'fx-audition', 'aria-label': 'Geselecteerde klank en voorbeeld' },
          h('span', { class: 'fx-panel-label' }, 'Geselecteerde klank'), selectionIcon, selectionName, selectionDescription,
          h('div', { class: 'fx-strength-section' },
            h('label', { class: 'fx-strength' }, h('span', {}, 'Sterkte'), strength, strengthValue),
            h('div', { class: 'fx-strength-labels' }, h('span', {}, 'Subtiel'), h('span', {}, 'Volledig'))),
          h('div', { class: 'fx-preview-section' }, h('b', {}, 'Vergelijk je stem'),
            h('span', { class: 'fx-preview-hint' }, `Eerste ${Math.min(6, clips[0].duration).toFixed(1)} seconden van “${clips[0].name}”.`),
            h('div', { class: 'fx-compare' }, originalPreview, effectPreview)))),
      h('div', { class: 'fx-picker-footer' }, draftStatus,
        h('div', {}, h('button', { class: 'btn btn-ghost', onclick: () => closeFxPicker(true) }, 'Annuleren'), applyButton)));
    fxPopup.addEventListener('cancel', (event) => { event.preventDefault(); closeFxPicker(true); });
    fxPopup.addEventListener('click', (event) => {
      const dialog = event.currentTarget;
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeFxPicker(true);
    });
    fxPopup.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFxPicker(true); return; }
      if (e.key === 'Tab') return;
      if (e.target === strength || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      if (e.target === search && !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...choices.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      const columns = getComputedStyle(choices).gridTemplateColumns.split(' ').length;
      const step = e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : e.key === 'ArrowRight' ? 1 : -1;
      const next = e.key === 'Home' ? 0 : e.key === 'End' || (e.key === 'ArrowUp' && index < 0) ? buttons.length - 1 : index < 0 ? 0 : clamp(index + step, 0, buttons.length - 1);
      buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: 'nearest' });
    });
    paintChoices(); document.body.append(fxPopup);
    fxPopup.showModal();
    search.focus({ preventScroll: true });
  }

  function renderInspector() {
    stopFxPreview();
    closeFxPicker();
    inspector.replaceChildren();
    const list = sel();
    selectionStatus.textContent = list.length ? `${list.length} clip${list.length > 1 ? 's' : ''} geselecteerd` : `${tl.clips.length} clip${tl.clips.length !== 1 ? 's' : ''} · ${tl.tracks.length} spoor${tl.tracks.length > 1 ? 'en' : ''}`;
    selectionStatus.classList.toggle('has-selection', !!list.length);
    $('#delete-btn', transport).disabled = !list.length;
    if (!list.length) {
      inspector.append(h('div', { class: 'insp-empty' }, h('div', { class: 'empty-audio-icon' }, icon('edit')), h('b', {}, 'Jouw audio, jouw verhaal'), h('p', {}, 'Klik op een audioblok om het volume, de timing of een stemeffect aan te passen.')),
        h('div', { class: 'editing-tip' }, h('b', {}, 'Snel bewerken'), h('p', {}, 'Sleep een blok om het te verplaatsen. Gebruik de randen om het begin of einde in te korten.'), h('p', {}, 'Klik met rechts op een blok voor alle bewerkingen.')),
        inspectorSection('keys', 'Sneltoetsen', h('div', { class: 'kbd-list' }, ...[['Afspelen / pauze', 'Spatie'], ['Splitsen', 'S'], ['Verwijderen', 'Delete'], ['Kopiëren / plakken', 'Ctrl+C / V'], ['Knippen', 'Ctrl+X'], ['Dupliceren', 'Ctrl+D'], ['Ongedaan maken', 'Ctrl+Z'], ['Opnieuw', 'Ctrl+Shift+Z'], ['Alles selecteren', 'Ctrl+A'], ['Meerdere selecteren', 'Shift+klik'], ['Zoomen', 'Ctrl+scroll']].map(([a, k]) => h('div', {}, h('span', {}, a), h('kbd', {}, k))))));
      return;
    }
    const c = list[0], multi = list.length > 1;
    const each = (fn) => list.forEach(fn);
    const name = h('input', { class: 'input clip-title-input', value: c.name, 'aria-label': 'Clipnaam' });
    name.addEventListener('change', () => mutate(() => { c.name = name.value.trim() || c.name; }));
    const trackSelect = h('select', { class: 'select', 'aria-label': 'Spoor', onchange: (e) => mutate(() => each((x) => { x.trackId = e.target.value; })) }, ...tl.tracks.map((t) => h('option', { value: t.id, selected: t.id === c.trackId }, t.name)));
    inspector.append(h('div', { class: 'insp-card selected-clip-card', style: { '--tc': trackColor(trackOf(c)) } },
      h('div', { class: 'selection-badge' }, '✓ ', multi ? `${list.length} clips geselecteerd` : 'Clip geselecteerd'),
      multi ? h('b', {}, `${list.length} audioblokken`) : name,
      h('div', { class: 'clip-stats' }, h('span', {}, 'Start', h('b', {}, fmtTime(c.start, true))), h('span', {}, 'Lengte', h('b', {}, `${c.duration.toFixed(2)}s`))),
      multi ? h('div', { class: 'hint' }, 'Wijzigingen gelden voor de hele selectie. De waarden zijn van de eerste clip.') : null,
      h('label', { class: 'field-label' }, 'Spoor', trackSelect),
      slider({ label: 'Volume', min: 0, max: 2, step: 0.01, value: c.gain, fmt: (v) => Math.round(v * 100) + '%', apply: (v) => each((x) => (x.gain = v)) }),
      h('button', { class: 'btn btn-sm', id: 'preview-clip-btn', onclick: async (e) => {
        const b = e.currentTarget; const done = busy('Voorbeeld renderen…');
        try { const { pcm } = await engine.renderMix(tl, { clipIds: list.map((x) => x.id), ignoreMute: true }); await previewAudio.playPcm(pcm, b); } catch (err) { toast(err.message, 'err'); } finally { done(); }
      } }, icon('play'), 'Selectie beluisteren'),
      h('button', { class: 'btn btn-sm btn-ghost', id: 'clip-actions-btn', onclick: (e) => openContextMenu(e, clipActions(c), multi ? `${list.length} clips geselecteerd` : c.name) }, 'Meer acties', '⋯')));

    // voice FX
    const fxCard = h('div', { class: 'insp-card voice-effect-card' }, h('div', { class: 'voice-effect-heading' }, h('h6', {}, 'Stemeffect'), h('span', {}, multi ? `${list.length} clips` : 'Deze clip')));
    const preset = FX_BY_ID[c.fx] || FX_BY_ID.none;
    const mixedFx = list.some((clip) => clip.fx !== c.fx);
    const fxSelect = h('button', { class: 'fx-picker-trigger', id: 'voice-fx-select', type: 'button', 'aria-label': 'Stemeffect kiezen', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'fx-picker-popup', onclick: (e) => openFxPicker(e.currentTarget, list) },
      h('span', { class: 'fx-choice-icon', 'aria-hidden': 'true' }, mixedFx ? '🎛️' : preset.emoji), h('span', { class: 'fx-choice-text' }, h('b', {}, mixedFx ? 'Verschillende effecten' : preset.name), h('span', {}, mixedFx ? 'Kies een klank voor alle geselecteerde clips' : `${preset.group} · Effect kiezen`)), h('span', { class: 'fx-picker-chevron', 'aria-hidden': 'true' }, '›'));
    const currentPreview = voicePreviewButton('Met effect', () => ({ ...c }));
    currentPreview.disabled = c.fx === 'none';
    fxCard.append(fxSelect, h('div', { class: 'hint' }, FX_BY_ID[c.fx]?.desc || 'Kies een effect voor deze clip.'),
      h('div', { class: 'fx-compare' }, voicePreviewButton('Origineel', () => ({ ...c, fx: 'none' })), currentPreview));
    if (c.fx !== 'none') {
      fxCard.append(slider({ label: 'Sterkte', min: 0, max: 1, step: 0.05, value: c.fxAmount ?? 1, fmt: (v) => Math.round(v * 100) + '%', apply: (v) => each((x) => (x.fxAmount = v)) }),
        h('button', { class: 'btn btn-sm btn-ghost', id: 'fx-reset-btn', onclick: () => mutate(() => each((clip) => { clip.fx = 'none'; clip.fxAmount = 1; })) }, 'Effect verwijderen'));
    }
    if (c.fx !== 'none') fxCard.append(h('button', { class: 'btn btn-sm btn-ghost', id: 'fx-track-btn', onclick: () => {
      const tracks = new Set(list.map((x) => x.trackId));
      mutate(() => tl.clips.forEach((x) => { if (tracks.has(x.trackId)) { x.fx = c.fx; x.fxAmount = c.fxAmount; } }));
      toast(`"${FX_BY_ID[c.fx]?.name}" toegepast op het hele spoor`, 'ok');
    } }, 'Toepassen op hele spoor'));
    inspector.append(fxCard);
    const startInput = h('input', { class: 'input', type: 'number', min: 0, step: 0.01, value: c.start.toFixed(2), 'aria-label': 'Starttijd in seconden', onchange: (e) => {
      const value = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(value) && value >= 0) mutate(() => { const delta = value - c.start; each((x) => { x.start = Math.max(0, x.start + delta); }); });
    } });
    inspector.append(inspectorSection('timing', 'Timing & overgangen', h('label', { class: 'field-label' }, 'Starttijd (seconden)', startInput),
      h('div', { class: 'hint' }, 'Kort een clip in door de linker- of rechterrand op de tijdlijn te slepen.'),
      slider({ label: 'Fade in', min: 0, max: Math.min(5, c.duration), step: 0.01, value: c.fadeIn, fmt: (v) => v.toFixed(2) + 's', apply: (v) => each((x) => (x.fadeIn = Math.min(v, x.duration))) }),
      slider({ label: 'Fade out', min: 0, max: Math.min(5, c.duration), step: 0.01, value: c.fadeOut, fmt: (v) => v.toFixed(2) + 's', apply: (v) => each((x) => (x.fadeOut = Math.min(v, x.duration))) })));
    inspector.append(inspectorSection('advanced', 'Meer bewerkingen',
      slider({ label: 'Snelheid', min: 0.5, max: 2, step: 0.05, value: c.speed, fmt: (v) => v.toFixed(2) + '×', apply: (v) => each((x) => { const srcLen = x.duration * x.speed; x.speed = v; x.duration = srcLen / v; x.fadeIn = Math.min(x.fadeIn, x.duration); x.fadeOut = Math.min(x.fadeOut, x.duration); }) }),
      slider({ label: 'Toonhoogte', min: -12, max: 12, step: 1, value: c.pitch, fmt: (v) => (v > 0 ? '+' : '') + v + ' st', apply: (v) => each((x) => (x.pitch = v)) }),
      h('button', { class: `btn btn-sm${c.reverse ? ' active' : ''}`, id: 'reverse-btn', 'aria-pressed': String(c.reverse), onclick: () => { const reverse = !c.reverse; mutate(() => each((x) => (x.reverse = reverse))); } }, '⟲ Achterstevoren afspelen'),
      h('button', { class: 'btn btn-sm', id: 'remove-silence-btn', onclick: () => removeSilence().catch((e) => toast(e.message, 'err')) }, 'Stiltes verwijderen'),
      h('button', { class: 'btn btn-sm', id: 'bounce-btn', title: 'Maak één audiobestand van de selectie, inclusief effecten', onclick: bounceSelected }, 'Samenvoegen tot één clip')));
  }

  // ============ keyboard ============
  function onKey(e) {
    if (fxPopup) return;
    if (e.target.closest('button, summary') && [' ', 'Enter'].includes(e.key)) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if ($('.modal-overlay')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (contextMenu) { if (k === 'escape') { e.preventDefault(); closeContextMenu(true); } return; }
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 's' && !mod) { e.preventDefault(); splitAtPlayhead(); }
    else if ((k === 'delete' || k === 'backspace') && selected.size) { e.preventDefault(); deleteSelected(); }
    else if (k === 'z' && mod && e.shiftKey) { e.preventDefault(); doRedo(); }
    else if (k === 'z' && mod) { e.preventDefault(); doUndo(); }
    else if (k === 'y' && mod) { e.preventDefault(); doRedo(); }
    else if (k === 'c' && mod && selected.size) { e.preventDefault(); copySelected(); }
    else if (k === 'x' && mod && selected.size) { e.preventDefault(); copySelected(true); }
    else if (k === 'v' && mod && clipboard.length) { e.preventDefault(); pasteClips(); }
    else if (k === 'd' && mod) { e.preventDefault(); duplicateSelected(); }
    else if (k === 'a' && mod) { e.preventDefault(); selected = new Set(tl.clips.map((c) => c.id)); renderTimeline(); renderInspector(); }
    else if (k === 'escape') { selected.clear(); renderTimeline(); renderInspector(); }
    else if (k === 'home') { setPlayhead(0); }
    else if (k === 'end') { setPlayhead(contentEnd()); }
    else if (k === 'arrowleft') { e.preventDefault(); setPlayhead(playhead - (e.shiftKey ? 0.1 : 1)); }
    else if (k === 'arrowright') { e.preventDefault(); setPlayhead(playhead + (e.shiftKey ? 0.1 : 1)); }
    else if (k === '+' || k === '=') setZoom(tl.zoom * 1.3);
    else if (k === '-') setZoom(tl.zoom / 1.3);
  }
  document.addEventListener('keydown', onKey);

  // ============ init ============
  fillRange(zoomIn);
  renderMedia(); renderTimeline(); renderInspector();
  undoBtn.disabled = true; redoBtn.disabled = true;
  saveState.classList.remove('saving'); saveState.textContent = 'Opgeslagen';
  clearTimeout(saveTimer);
  // backfill durations for uploads that weren't measured yet
  assets.filter((a) => !a.duration).forEach(async (a) => {
    try { const src = { type: 'asset', id: a.id }; await engine.getSource(src); a.duration = engine.sourceDuration(src); api.updateAsset(a.id, { duration: a.duration }); if (!destroyed) renderMedia(); } catch {}
  });
  tl.clips.forEach((c) => engine.getSource(c.src).catch(() => {}));

  return () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', outsideMenu);
    window.removeEventListener('resize', closeContextMenu);
    window.removeEventListener('resize', closeFxPicker);
    document.removeEventListener('scroll', onPickerScroll, true);
    closeFxPicker();
    closeContextMenu();
    disposePanels();
    ro.disconnect(); stopPlay(); cancelAnimationFrame(raf);
    player.dispose();
    if (rec) { try { rec.recorder.stop(); } catch {} }
    if (saveTimer) { clearTimeout(saveTimer); api.updateProject(id, { timeline: tl, duration: contentEnd() }).catch(() => {}); }
  };
}

function normalize(t) {
  const d = defaultTimeline();
  if (!t || !Array.isArray(t.tracks) || !t.tracks.length) return d;
  // Replace the old untouched starter layout; preserve all edited projects.
  const oldStarter = ['t_voice', 't_sfx', 't_music'];
  const oldNames = ['Stem', 'Sound effects', 'Muziek / extra'];
  if (!t.clips?.length && t.tracks.length === 3 && t.tracks.every((track, i) => track.id === oldStarter[i] && track.name === oldNames[i] && track.gain === (i === 2 ? 0.8 : 1) && !track.mute && !track.solo)) return { ...d, zoom: t.zoom || d.zoom };
  return { ...d, ...t, clips: (t.clips || []).map((c) => ({ ...clipDefaults(), ...c })) };
}
