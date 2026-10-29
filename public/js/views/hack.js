// Hacked Screen workspace: start background → glitch → "YOU ARE HACKED!" screen, live preview and MP4 export.
import { h, icon, toast, modal, fmtTime, fmtSize } from '../util.js';
import { api, fileUrl } from '../api.js';
import { Player } from '../audio/engine.js';
import { renderCanvasExport, renderCanvasExportMov, exportSupported } from '../export.js';
import { ensureFonts } from '../scenes/renderer.js';
import { createHackScene, normalizeHackOpts, hackSchedule, HACK_BACKGROUNDS, HACK_ENDINGS, DEFAULT_WARNINGS } from '../hack/scene.js';

export async function mount(root, { id, project, exportingView = false }) {
  await ensureFonts();
  project ||= await api.project(id);
  let opts = normalizeHackOpts(project.hack_opts);
  let exports = project.exports || [];
  let scene = null, destroyed = false, raf = 0;
  let exporting = false, exportAbort = null, quality = '1080', fps = 30;
  let format = 'webm';   // compact alpha export by default; opaque backgrounds use MP4
  // Classic "editor" checkerboard (white / light grey) for swatches; the preview uses the .is-transparent CSS class.
  const CHECKER = 'repeating-conic-gradient(#ffffff 0 25%, #c8c8c8 0 50%) 0 0 / 10px 10px';
  const exportFormat = () => (opts.bgMode === 'transparent' ? format : 'mp4');
  let bgImageEl = null, loadedBgUrl = '';

  const player = new Player();
  const status = h('span', { class: 'save-state', role: 'status' }, 'Opgeslagen');
  const title = h('input', { class: 'ed-title', value: project.name, 'aria-label': 'Projectnaam', maxlength: 120 });

  // ---------- persistence ----------
  let saveQueue = Promise.resolve();
  function persist() {
    const payload = { hack_opts: structuredClone(opts), duration: hackSchedule(opts).total, name: title.value.trim() || 'Naamloos' };
    status.textContent = 'Opslaan…'; status.classList.add('saving');
    const task = saveQueue.catch(() => {}).then(() => api.updateProject(id, payload));
    saveQueue = task;
    task.then(
      () => { if (saveQueue === task && !destroyed) { status.textContent = 'Opgeslagen'; status.classList.remove('saving'); } },
      (e) => { status.textContent = 'Opslaan mislukt'; status.classList.remove('saving'); toast(e.message, 'err'); }
    );
    return task;
  }
  title.addEventListener('change', persist);

  async function goToExport(e) {
    e.preventDefault();
    try { await persist(); location.hash = `#/project/${id}/export`; } catch (err) { toast('Opslaan mislukt: ' + err.message, 'err'); }
  }

  // ---------- layout ----------
  const header = h('div', { class: 'ed-head' },
    h('a', { class: 'btn btn-ghost btn-icon', href: exportingView ? `#/project/${id}` : '#/', title: exportingView ? 'Terug naar bewerken' : 'Terug naar projecten' }, icon('back')),
    title, status,
    h('div', { class: 'spacer' }),
    h('nav', { class: 'steps' },
      h('a', { class: exportingView ? '' : 'on', href: `#/project/${id}` }, '1 · Gehackt Scherm'),
      h('span', {}, '›'),
      h('a', { class: exportingView ? 'on' : '', href: `#/project/${id}/export`, onclick: goToExport }, '2 · Export')),
    exportingView ? null : h('a', { class: 'btn btn-primary', id: 'to-export-btn', href: `#/project/${id}/export`, onclick: goToExport }, icon('download'), 'Export'));

  const canvas = h('canvas', { width: 1920, height: 1080, id: 'hack-canvas', 'aria-label': 'Gehackt scherm voorbeeld' });
  const playBtn = h('button', { class: 'btn btn-sm btn-primary', id: 'hack-play-btn', onclick: togglePlay }, icon('play'), 'Afspelen');
  const restartBtn = h('button', { class: 'btn btn-sm btn-ghost', id: 'hack-restart-btn', title: 'Vanaf begin', onclick: () => { stopPlay(); drawAt(0); startPlay(); } }, icon('undo'), 'Opnieuw');
  const scrub = h('input', { type: 'range', min: 0, max: 10, step: 0.01, value: 0, id: 'hack-scrub', 'aria-label': 'Afspeelpositie' });
  const timeLabel = h('span', { class: 'mono' }, '0:00.0 / 0:00.0');
  const phases = h('div', { class: 'hack-phases', id: 'hack-phases', 'aria-label': 'Fases' });
  const playhead = h('i', { class: 'hack-playhead', title: 'Sleep om precies door de tijdlijn te bewegen' });

  scrub.addEventListener('input', () => { stopPlay(); drawAt(+scrub.value); });

  let draggingPhases = false;
  const seekPhasesFromEvent = (e) => {
    if (!scene) return;
    const rect = phases.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    stopPlay();
    drawAt(ratio * scene.schedule.total);
  };
  phases.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !scene) return;
    e.preventDefault();
    draggingPhases = true;
    phases.classList.add('is-dragging');
    try { phases.setPointerCapture(e.pointerId); } catch {}
    seekPhasesFromEvent(e);
  });
  phases.addEventListener('pointermove', (e) => {
    if (!draggingPhases) return;
    seekPhasesFromEvent(e);
  });
  const stopDraggingPhases = (e) => {
    if (!draggingPhases) return;
    draggingPhases = false;
    phases.classList.remove('is-dragging');
    try { phases.releasePointerCapture(e.pointerId); } catch {}
  };
  phases.addEventListener('pointerup', stopDraggingPhases);
  phases.addEventListener('pointercancel', stopDraggingPhases);

  const stageFrame = h('div', { class: 'stage-frame file-stage-frame', onclick: togglePlay }, canvas,
    h('span', { class: 'transparent-badge', 'aria-hidden': 'true' }, h('i', {}), 'TRANSPARANT'));
  const center = h('section', { class: 'center file-work-center' },
    h('section', { class: 'file-preview-section' },
      h('div', { class: 'file-section-heading' },
        h('b', {}, exportingView ? 'Export voorbeeld' : 'Live voorbeeld · Gehackt Scherm'),
        h('span', { class: 'hint' }, 'Spatie = afspelen / pauzeren')),
      stageFrame,
      h('div', { class: 'file-preview-controls' }, playBtn, restartBtn, scrub, timeLabel),
      phases));

  const settingsBody = h('div', { class: 'panel-body', id: 'hack-settings' });
  const right = h('aside', { class: 'panel right file-settings-panel', 'aria-label': 'Instellingen' },
    h('div', { class: 'panel-heading' }, icon(exportingView ? 'download' : 'edit'), exportingView ? 'Export (MP4 / WebM / MOV)' : 'Gehackt Scherm instellingen'),
    settingsBody);

  root.append(h('div', { class: 'editor file-editor hack-editor' }, header, h('div', { class: 'file-export-layout' }, center, right)));

  const expButton = h('button', { class: 'btn btn-primary', id: 'start-export-btn', onclick: startExport });
  const expStatus = h('div', { class: 'hint mono', id: 'exp-status', role: 'status', hidden: true });
  const expProgress = h('progress', { max: 1, value: 0, class: 'file-export-progress', hidden: true });

  // ---------- background image ----------
  function syncBgImage() {
    const url = opts.bgMode === 'image' ? opts.bgImageUrl : '';
    if (!url) { bgImageEl = null; loadedBgUrl = ''; return Promise.resolve(null); }
    if (loadedBgUrl === url && bgImageEl?.complete) return Promise.resolve(bgImageEl);
    loadedBgUrl = url;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { if (loadedBgUrl === url && !destroyed) { bgImageEl = img; rebuildScene(true); } resolve(img); };
      img.onerror = () => { if (loadedBgUrl === url) bgImageEl = null; resolve(null); };
      img.src = url;
    });
  }

  // ---------- preview ----------
  function rebuildScene(keepTime = false) {
    const prevT = keepTime ? +scrub.value : 0;
    stopPlay();
    scene?.dispose();
    scene = createHackScene(canvas, opts, { bgImage: bgImageEl });
    // checkerboard behind the canvas so transparent pixels are visible in the preview
    stageFrame.classList.toggle('is-transparent', opts.bgMode === 'transparent');
    player.load(scene.soundtrack, 0);
    scrub.max = scene.schedule.total;
    paintPhases();
    drawAt(keepTime ? Math.min(prevT, scene.schedule.total) : 0);
  }

  function drawAt(t) {
    if (!scene) return;
    t = Math.max(0, Math.min(scene.schedule.total, t));
    scene.draw(t);
    scrub.value = t;
    timeLabel.textContent = `${fmtTime(t, true)} / ${fmtTime(scene.schedule.total, true)}`;
    playhead.style.left = (t / (scene.schedule.total || 1)) * 100 + '%';
  }

  function paintPhases() {
    const s = scene.schedule, total = s.total || 1;
    const seg = (cls, label, from, to) => to - from > 0.001
      ? h('button', { type: 'button', class: `hack-phase ${cls}`, style: { width: ((to - from) / total) * 100 + '%' }, title: `${label} · ${fmtTime(from, true)}–${fmtTime(to, true)} (sleep om precies te bewegen, dubbelklik voor begin van sectie)`, ondblclick: () => { stopPlay(); drawAt(from + 0.01); } },
          label, h('small', {}, `${(to - from).toFixed(1)}s`))
      : null;
    const bgName = (HACK_BACKGROUNDS.find((b) => b.id === opts.bgMode) || HACK_BACKGROUNDS[0]).name;
    const endName = (HACK_ENDINGS.find((e) => e.id === opts.ending) || HACK_ENDINGS[0]).name;
    phases.replaceChildren(
      ...[seg(`start ${opts.bgMode}`, bgName, 0, s.start),
        seg('glitch', 'Glitch', s.start, s.glitchEnd),
        seg('hacked', 'HACKED', s.glitchEnd, s.hackEnd),
        seg('outro', endName, s.hackEnd, s.total)].filter(Boolean),
      playhead);
  }

  function stopPlay() {
    player.pause();
    cancelAnimationFrame(raf);
    playBtn.replaceChildren(icon('play'), 'Afspelen');
  }

  async function startPlay() {
    if (!scene || exporting) return;
    const from = +scrub.value >= scene.schedule.total - 0.05 ? 0 : +scrub.value;
    try {
      await player.play(from);
      playBtn.replaceChildren(icon('pause'), 'Pauze');
      const loop = () => {
        if (destroyed) return;
        drawAt(player.time);
        if (player.playing) raf = requestAnimationFrame(loop);
        else { drawAt(scene.schedule.total); stopPlay(); }
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      stopPlay();
      toast('Kon voorbeeld niet afspelen: ' + e.message, 'err');
    }
  }

  function togglePlay() { if (player.playing) stopPlay(); else startPlay(); }

  function optionChanged({ keepTime = true, repaint = false } = {}) {
    persist();
    rebuildScene(keepTime);
    if (repaint) paintSettings();
  }

  // ---------- settings ----------
  const numberField = (label, key, { min, max, step = 0.1, hint } = {}) => [
    h('label', { class: 'field' }, label, h('input', {
      class: 'input', type: 'number', min, max, step, value: opts[key], id: `hack-${key}`, disabled: exporting,
      onchange: (e) => { const v = +e.target.value; opts[key] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : opts[key]; e.target.value = opts[key]; optionChanged(); },
    })),
    hint ? h('p', { class: 'hint' }, hint) : null,
  ];
  const textField = (label, key, maxlength, fallback) => h('label', { class: 'field' }, label, h('input', {
    class: 'input', value: opts[key], maxlength, id: `hack-${key}`, disabled: exporting,
    onchange: (e) => { opts[key] = e.target.value.trim() || fallback; e.target.value = opts[key]; optionChanged(); },
  }));
  const toggle = (label, key) => h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', id: `hack-${key}`, checked: Boolean(opts[key]), disabled: exporting, onchange: (e) => { opts[key] = e.target.checked; optionChanged({ repaint: true }); } }),
    h('span', { class: 'track' }), label);

  function uploadBgImage() {
    const fileIn = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
      onchange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const uploaded = await api.uploadImages(id, [file], 'Background');
          if (uploaded?.[0]) {
            opts.bgImageUrl = fileUrl.image(uploaded[0]);
            await syncBgImage();
            optionChanged({ repaint: true });
            toast('Achtergrondafbeelding geüpload!', 'ok');
          }
        } catch (err) { toast('Upload mislukt: ' + err.message, 'err'); }
      },
    });
    document.body.append(fileIn); fileIn.click(); fileIn.remove();
  }

  let bgBeforeTransparent = opts.bgMode === 'transparent' ? 'green' : opts.bgMode;
  function paintSettings() {
    settingsBody.replaceChildren();

    // Master switch: whole video transparent = transparent start + transparent hacked screen (+ ending fades to transparent).
    const fullTransparent = opts.bgMode === 'transparent' && opts.hackTransparent;
    const transparencyCard = h('div', { class: 'insp-card' }, h('h6', {}, 'Transparantie'),
      h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox', id: 'hack-fullTransparent', checked: fullTransparent, disabled: exporting,
          onchange: async (e) => {
            if (e.target.checked) {
              if (opts.bgMode !== 'transparent') bgBeforeTransparent = opts.bgMode;
              opts.bgMode = 'transparent'; opts.hackTransparent = true;
            } else {
              opts.bgMode = bgBeforeTransparent || 'green'; opts.hackTransparent = false;
            }
            await syncBgImage();
            optionChanged({ repaint: true });
          },
        }),
        h('span', { class: 'track' }), 'Hele video transparante achtergrond'),
      h('p', { class: 'hint' }, fullTransparent
        ? 'Alleen de code, het waarschuwingsvenster, pop-ups en glitches zijn zichtbaar — de rest is doorzichtig. "Fade naar zwart" vervaagt nu naar transparant. Exporteer als compacte WebM of MOV.'
        : 'Zet aan om de achtergrond van de héle video doorzichtig te maken (start én gehackt scherm), zodat je hem direct over je eigen beeld legt.'));

    const startCard = h('div', { class: 'insp-card' }, h('h6', {}, '1 · Start'),
      h('div', { class: 'field' }, h('span', {}, 'Begin-achtergrond'),
        h('div', { class: 'hack-bg-choices' }, ...HACK_BACKGROUNDS.map((b) => h('button', {
          type: 'button', class: `hack-bg-choice${opts.bgMode === b.id ? ' on' : ''}`, 'data-bg': b.id, disabled: exporting,
          onclick: async () => { if (b.id !== 'transparent') bgBeforeTransparent = b.id; opts.bgMode = b.id; await syncBgImage(); optionChanged({ repaint: true }); },
        }, h('i', { style: { background: b.id === 'transparent' ? CHECKER : b.id === 'image' ? (opts.bgImageUrl ? `center / cover url("${opts.bgImageUrl}")` : 'repeating-linear-gradient(45deg,#334,#334 4px,#223 4px,#223 8px)') : b.color } }), b.name)))),
      opts.bgMode === 'green' || opts.bgMode === 'blue'
        ? h('p', { class: 'hint' }, 'Effen chroma-key kleur — makkelijk weg te keyen in je video-editor zodat de hack over je beeld heen speelt.')
        : null,
      opts.bgMode === 'transparent'
        ? h('p', { class: 'hint' }, fullTransparent
            ? 'Echte transparantie (alpha) — geen keyen nodig. Kies WebM voor kleine bestanden of MOV voor montage in ProRes.'
            : 'Alleen het begin is transparant; het gehackte scherm heeft een donkere achtergrond. Zet "Hele video transparante achtergrond" aan om alles doorzichtig te maken.')
        : null,
      opts.bgMode === 'image'
        ? h('div', { class: 'field' },
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: exporting, onclick: uploadBgImage }, icon('upload'), opts.bgImageUrl ? 'Andere afbeelding…' : 'Afbeelding uploaden…'),
              opts.bgImageUrl ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: exporting, onclick: () => { opts.bgImageUrl = ''; syncBgImage(); optionChanged({ repaint: true }); } }, icon('trash'), 'Verwijder') : null),
            opts.bgImageUrl
              ? h('label', { class: 'field', style: { marginTop: '6px' } }, `Afbeelding dimmen (${Math.round(opts.bgImageDim * 100)}%)`,
                  h('input', { type: 'range', min: 0, max: 0.85, step: 0.05, value: opts.bgImageDim, disabled: exporting, onchange: (e) => { opts.bgImageDim = +e.target.value; optionChanged({ repaint: true }); } }))
              : h('p', { class: 'hint' }, 'Upload een JPG, PNG of WebP (bijv. een screenshot van een bureaublad).'))
        : null,
      ...numberField('Starttijd vóór de glitch (seconden)', 'startDelay', { min: 0, max: 30, step: 0.1 }));

    const glitchCard = h('div', { class: 'insp-card' }, h('h6', {}, '2 · Glitch'),
      ...numberField('Glitch duur (seconden)', 'glitchDuration', { min: 0.3, max: 10, step: 0.1 }),
      h('label', { class: 'field' }, `Glitch intensiteit (${Math.round(opts.glitchIntensity * 100)}%)`,
        h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: opts.glitchIntensity, id: 'hack-glitchIntensity', disabled: exporting, onchange: (e) => { opts.glitchIntensity = +e.target.value; optionChanged({ repaint: true }); } })),
      toggle('Korte glitches tijdens het gehackte scherm', 'miniGlitches'),
      h('button', { type: 'button', class: 'btn btn-sm', id: 'hack-shuffle', disabled: exporting, onclick: () => { opts.seed = crypto.getRandomValues(new Uint32Array(1))[0]; optionChanged(); } }, icon('spark'), 'Shuffle glitch & code'),
      h('p', { class: 'hint' }, 'Genereert een nieuwe willekeurige variant van de glitches, code en pop-up posities.'));

    const warningsArea = h('textarea', {
      class: 'input file-mono-textarea', id: 'hack-warnings', rows: 6, disabled: exporting,
      onchange: (e) => { opts.warnings = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 24); optionChanged(); },
    });
    warningsArea.value = opts.warnings.join('\n');

    const hackCard = h('div', { class: 'insp-card' }, h('h6', {}, '3 · Gehackt scherm'),
      textField('Titel', 'title', 60, 'YOU ARE HACKED!'),
      textField('Ondertitel (mag leeg)', 'subtitle', 80, ''),
      ...numberField('Duur gehackt scherm (seconden)', 'hackDuration', { min: 1, max: 120, step: 0.5 }),
      h('div', { class: 'hack-color-row' },
        h('label', { class: 'field' }, 'Codekleur', h('input', { type: 'color', id: 'hack-codeColor', value: opts.codeColor, disabled: exporting, onchange: (e) => { opts.codeColor = e.target.value; optionChanged(); } })),
        h('label', { class: 'field' }, 'Waarschuwingskleur', h('input', { type: 'color', id: 'hack-alertColor', value: opts.alertColor, disabled: exporting, onchange: (e) => { opts.alertColor = e.target.value; optionChanged(); } }))),
      h('div', { class: 'hack-toggles' },
        toggle('Waarschuwingsteken', 'warnIcon'),
        toggle('Vliegende code (matrix)', 'matrix'),
        toggle('Voortgangsbalk', 'progress')),
      h('p', { class: 'hint' }, 'Extra\u2019s (maken het scherm drukker):'),
      h('div', { class: 'hack-toggles' },
        toggle('Pop-up waarschuwingen (max. 4)', 'popups'),
        toggle('Terminal-vensters met code', 'terminal'),
        toggle('Geel/zwarte waarschuwingsstrepen', 'hazard')),
      opts.progress ? textField('Tekst voortgangsbalk (mag leeg)', 'progressLabel', 60, '') : null,
      opts.popups ? h('label', { class: 'field' }, 'Pop-up waarschuwingen (1 per regel)', warningsArea) : null,
      opts.popups ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: exporting, onclick: () => { opts.warnings = DEFAULT_WARNINGS.slice(); optionChanged({ repaint: true }); } }, icon('undo'), 'Standaard waarschuwingen') : null);

    const endCard = h('div', { class: 'insp-card' }, h('h6', {}, '4 · Einde'),
      h('div', { class: 'hack-bg-choices hack-end-choices' }, ...HACK_ENDINGS.map((e) => h('button', {
        type: 'button', class: `hack-bg-choice${opts.ending === e.id ? ' on' : ''}`, 'data-ending': e.id, title: e.desc, disabled: exporting,
        onclick: () => { opts.ending = e.id; optionChanged({ repaint: true }); },
      }, h('i', { class: `hack-end-preview ${e.id}` }), e.short))),
      h('p', { class: 'hint' }, (HACK_ENDINGS.find((e) => e.id === opts.ending) || HACK_ENDINGS[0]).desc));

    const soundCard = h('div', { class: 'insp-card' }, h('h6', {}, 'Geluid'),
      toggle('Glitch-, alarm- en pop-up geluiden', 'sounds'),
      opts.sounds ? h('label', { class: 'field' }, `Volume (${Math.round(opts.volume * 100)}%)`,
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: opts.volume, disabled: exporting, 'aria-label': 'Volume', onchange: (e) => { opts.volume = +e.target.value; optionChanged({ repaint: true }); } })) : null);

    const total = hackSchedule(opts).total;
    const fmt = exportFormat();
    expButton.disabled = fmt === 'mp4' && !exportSupported();
    expButton.replaceChildren(icon(exporting ? 'stop' : 'download'), exporting ? 'Annuleren' : fmt === 'mp4' ? 'Exporteer MP4' : `Exporteer ${fmt.toUpperCase()} (transparant)`);
    const exportCard = h('div', { class: 'insp-card' }, h('h6', {}, 'Export'),
      opts.bgMode === 'transparent'
        ? h('label', { class: 'field' }, 'Formaat', h('select', { class: 'select', id: 'hack-format', disabled: exporting, onchange: (e) => { format = e.target.value; paintSettings(); } },
            h('option', { value: 'webm', selected: format === 'webm' }, 'WebM · Klein bestand met transparantie'),
            h('option', { value: 'mov', selected: format === 'mov' }, 'MOV · ProRes 4444 (groot bestand)'),
            h('option', { value: 'mp4', selected: format === 'mp4' }, 'MP4 · H.264 (zwarte achtergrond)')))
        : null,
      h('label', { class: 'field' }, 'Kwaliteit', h('select', { class: 'select', id: 'hack-quality', disabled: exporting, onchange: (e) => { quality = e.target.value; } },
        h('option', { value: '1080', selected: quality === '1080' }, 'Full HD · 1920×1080'),
        h('option', { value: '2160', selected: quality === '2160' }, '4K · 3840×2160'))),
      h('label', { class: 'field' }, 'Framerate', h('select', { class: 'select', id: 'hack-fps', disabled: exporting, onchange: (e) => { fps = +e.target.value; } },
        h('option', { value: 30, selected: fps === 30 }, '30 FPS'),
        h('option', { value: 60, selected: fps === 60 }, '60 FPS'))),
      h('p', { class: 'hint' }, fmt === 'webm'
        ? `Eén compacte WebM-video van ${total.toFixed(1)}s met geluid en transparantie. Niet elk montageprogramma ondersteunt WebM met alpha; kies dan MOV of MP4 met een groene achtergrond om te keyen.`
        : fmt === 'mov'
        ? `Eén MOV-video van ${total.toFixed(1)}s met geluid en alpha-kanaal (transparante pixels). Let op: ProRes-bestanden zijn groot.`
        : `Eén MP4-video van ${total.toFixed(1)}s met geluid.`),
      expProgress, expStatus, expButton,
      fmt === 'mp4' && !exportSupported() ? h('p', { class: 'bt-warn' }, 'WebCodecs video-export vereist Chrome of Edge.') : null);

    const listCard = h('div', { class: 'insp-card' }, h('h6', {}, `📦 Opgeslagen exports (${exports.length})`));
    if (!exports.length) listCard.append(h('p', { class: 'hint' }, 'Je geëxporteerde video’s verschijnen hier met downloadknoppen.'));
    exports.forEach((exp) => listCard.append(h('div', { class: 'export-item' },
      h('div', { class: 'vid-ico' }, icon('film')),
      h('div', { class: 'info' }, h('div', { class: 'name' }, exp.filename), h('div', { class: 'sub' }, `${exp.height}p · ${exp.fps} FPS · ${fmtTime(exp.duration)} · ${fmtSize(exp.size)}`)),
      h('a', { class: 'btn btn-icon btn-sm', href: fileUrl.export(exp), download: exp.filename, title: 'Downloaden' }, icon('download')),
      h('button', {
        class: 'btn btn-icon btn-sm btn-ghost btn-danger', title: 'Verwijderen', disabled: exporting,
        onclick: async () => {
          if (!(await modal({ title: `"${exp.filename}" verwijderen?`, confirm: 'Verwijderen', danger: true }))) return;
          await api.deleteExport(exp.id);
          exports = exports.filter((e) => e.id !== exp.id);
          paintSettings();
          toast('Export verwijderd', 'ok');
        },
      }, icon('trash')))));

    if (exportingView) settingsBody.append(transparencyCard, exportCard, listCard, startCard, glitchCard, hackCard, endCard, soundCard);
    else settingsBody.append(transparencyCard, startCard, glitchCard, hackCard, endCard, soundCard, exportCard, listCard);
  }

  // ---------- export ----------
  async function startExport() {
    if (exporting) { exportAbort?.abort(); return; }
    stopPlay();
    exporting = true;
    exportAbort = new AbortController();
    paintSettings();
    expProgress.hidden = false; expStatus.hidden = false;
    const width = quality === '2160' ? 3840 : 1920, height = quality === '2160' ? 2160 : 1080;
    let rendered = null;
    try {
      await persist();
      await syncBgImage();
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width; outCanvas.height = height;
      rendered = createHackScene(outCanvas, opts, { bgImage: bgImageEl });
      const fmt = exportFormat();
      const result = await (fmt !== 'mp4' ? renderCanvasExportMov : renderCanvasExport)({
        projectId: id, canvas: outCanvas, scene: rendered, soundtrack: rendered.soundtrack,
        duration: rendered.schedule.total, mode: 'hack', format: fmt, width, height, fps, signal: exportAbort.signal,
        onProgress: (p, label) => { expProgress.value = p; expStatus.textContent = label; },
      });
      exports.unshift(result);
      toast(`${fmt.toUpperCase()}-video geëxporteerd en klaar om te downloaden!`, 'ok', 4500);
    } catch (e) {
      toast(e.name === 'AbortError' ? 'Export geannuleerd' : 'Export mislukt: ' + e.message, e.name === 'AbortError' ? 'info' : 'err');
    } finally {
      rendered?.dispose();
      exporting = false; exportAbort = null;
      expProgress.hidden = true; expStatus.hidden = true;
      if (!destroyed) { paintSettings(); drawAt(+scrub.value); }
    }
  }

  const onKey = (e) => {
    if (e.target.closest('input, select, textarea, button, dialog')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  };
  document.addEventListener('keydown', onKey);

  paintSettings();
  rebuildScene(false);
  // Show the moment the hack is fully on screen as the initial still.
  drawAt(Math.min(scene.schedule.total, scene.schedule.glitchEnd + 2.2));
  syncBgImage();

  return () => {
    destroyed = true;
    stopPlay();
    exportAbort?.abort();
    document.removeEventListener('keydown', onKey);
    scene?.dispose();
    player.dispose();
  };
}
