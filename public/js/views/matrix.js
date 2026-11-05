// Matrix / Hacking Code Loop workspace: falling green numbers/code on black, transparent, greenscreen, or bluescreen.
// Seamless loop preview + export as loopable video (MP4 / WebM / MOV) or animated GIF (.gif).
import { h, icon, toast, modal, fmtTime, fmtSize } from '../util.js';
import { api, fileUrl } from '../api.js';
import { Player } from '../audio/engine.js';
import { renderCanvasExport, renderCanvasExportMov, exportSupported } from '../export.js';
import { ensureFonts } from '../scenes/renderer.js';
import {
  createMatrixScene,
  normalizeMatrixOpts,
  matrixSchedule,
  MATRIX_BACKGROUNDS,
  MATRIX_CHARSETS,
  MATRIX_FLOW_MODES,
  MATRIX_COLOR_PRESETS,
} from '../matrix/scene.js';

export async function mount(root, { id, project, exportingView = false }) {
  await ensureFonts();
  project ||= await api.project(id);
  let opts = normalizeMatrixOpts(project.matrix_opts);
  let exports = project.exports || [];
  let scene = null, destroyed = false, raf = 0;
  let exporting = false, exportAbort = null;
  let quality = '1080';
  let fps = 30;
  // Format: 'mp4' | 'gif' | 'webm' | 'mov'
  let format = opts.bgMode === 'transparent' ? 'webm' : 'mp4';
  const CHECKER = 'repeating-conic-gradient(#ffffff 0 25%, #c8c8c8 0 50%) 0 0 / 10px 10px';

  const player = new Player();
  player.el.loop = true;

  const status = h('span', { class: 'save-state', role: 'status' }, 'Opgeslagen');
  const title = h('input', { class: 'ed-title', value: project.name, 'aria-label': 'Projectnaam', maxlength: 120 });

  // ---------- persistence ----------
  let saveQueue = Promise.resolve();
  function persist() {
    const payload = {
      matrix_opts: structuredClone(opts),
      duration: matrixSchedule(opts).total,
      name: title.value.trim() || 'Naamloos',
    };
    status.textContent = 'Opslaan…'; status.classList.add('saving');
    const task = saveQueue.catch(() => { }).then(() => api.updateProject(id, payload));
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
      h('a', { class: exportingView ? '' : 'on', href: `#/project/${id}` }, '1 · Hacking Code Loop'),
      h('span', {}, '›'),
      h('a', { class: exportingView ? 'on' : '', href: `#/project/${id}/export`, onclick: goToExport }, '2 · Export (Video / GIF)')),
    exportingView ? null : h('a', { class: 'btn btn-primary', id: 'to-export-btn', href: `#/project/${id}/export`, onclick: goToExport }, icon('download'), 'Export'));

  const canvas = h('canvas', { width: 1920, height: 1080, id: 'matrix-canvas', 'aria-label': 'Hacking code loop voorbeeld' });
  const playBtn = h('button', { class: 'btn btn-sm btn-primary', id: 'matrix-play-btn', onclick: togglePlay }, icon('play'), 'Afspelen (Loop)');
  const restartBtn = h('button', { class: 'btn btn-sm btn-ghost', id: 'matrix-restart-btn', title: 'Vanaf begin', onclick: () => { stopPlay(); drawAt(0); startPlay(); } }, icon('undo'), 'Opnieuw');
  const scrub = h('input', { type: 'range', min: 0, max: opts.duration, step: 0.01, value: 0, id: 'matrix-scrub', 'aria-label': 'Afspeelpositie' });
  const timeLabel = h('span', { class: 'mono' }, '0:00.0 / 0:00.0');
  const loopBadge = h('span', { class: 'matrix-loop-pill', title: 'Begin en einde sluiten exact op elkaar aan voor een naadloze loop' }, '∞ NAADLOZE LOOP');

  scrub.addEventListener('input', () => { stopPlay(); drawAt(+scrub.value); });

  const stageFrame = h('div', { class: 'stage-frame file-stage-frame', onclick: togglePlay }, canvas,
    h('span', { class: 'transparent-badge', 'aria-hidden': 'true' }, h('i', {}), 'TRANSPARANT'));
  const center = h('section', { class: 'center file-work-center' },
    h('section', { class: 'file-preview-section' },
      h('div', { class: 'file-section-heading' },
        h('b', {}, exportingView ? 'Export voorbeeld · Hacking Code Loop' : 'Live voorbeeld · Vallende Hacking Code'),
        h('div', { class: 'row', style: { gap: '10px' } }, loopBadge, h('span', { class: 'hint' }, 'Spatie = afspelen / pauzeren'))),
      stageFrame,
      h('div', { class: 'file-preview-controls' }, playBtn, restartBtn, scrub, timeLabel)));

  const settingsBody = h('div', { class: 'panel-body', id: 'matrix-settings' });
  const right = h('aside', { class: 'panel right file-settings-panel', 'aria-label': 'Instellingen' },
    h('div', { class: 'panel-heading' }, icon(exportingView ? 'download' : 'matrix'), exportingView ? 'Export (Loop-video / GIF)' : 'Hacking Code instellingen'),
    settingsBody);

  root.append(h('div', { class: 'editor file-editor hack-editor matrix-editor' }, header, h('div', { class: 'file-export-layout' }, center, right)));

  const expButton = h('button', { class: 'btn btn-primary', id: 'start-export-btn', onclick: startExport });
  const expStatus = h('div', { class: 'hint mono', id: 'exp-status', role: 'status', hidden: true });
  const expProgress = h('progress', { max: 1, value: 0, class: 'file-export-progress', hidden: true });

  // ---------- preview ----------
  function rebuildScene(keepTime = false) {
    const prevT = keepTime ? +scrub.value : 0;
    const wasPlaying = player.playing;
    stopPlay();
    scene?.dispose();
    scene = createMatrixScene(canvas, opts);
    stageFrame.classList.toggle('is-transparent', opts.bgMode === 'transparent');
    player.load(scene.soundtrack, 0);
    player.el.loop = true;
    scrub.max = scene.schedule.total;
    drawAt(keepTime ? Math.min(prevT, scene.schedule.total) : 0);
    if (wasPlaying) startPlay();
  }

  function drawAt(t) {
    if (!scene) return;
    const total = scene.schedule.total || 1;
    const wrapped = ((t % total) + total) % total;
    scene.draw(wrapped);
    scrub.value = wrapped;
    timeLabel.textContent = `${fmtTime(wrapped, true)} / ${fmtTime(total, true)}`;
  }

  function stopPlay() {
    player.pause();
    cancelAnimationFrame(raf);
    playBtn.replaceChildren(icon('play'), 'Afspelen (Loop)');
  }

  async function startPlay() {
    if (!scene || exporting) return;
    const total = scene.schedule.total || 1;
    const from = +scrub.value >= total - 0.02 ? 0 : +scrub.value;
    try {
      player.el.loop = true;
      await player.play(from);
      playBtn.replaceChildren(icon('pause'), 'Pauze');
      const loop = () => {
        if (destroyed) return;
        drawAt(player.time);
        if (player.playing) raf = requestAnimationFrame(loop);
        else stopPlay();
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
  const toggle = (label, key) => h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', id: `matrix-${key}`, checked: Boolean(opts[key]), disabled: exporting, onchange: (e) => { opts[key] = e.target.checked; optionChanged({ repaint: true }); } }),
    h('span', { class: 'track' }), label);

  let bgBeforeTransparent = opts.bgMode === 'transparent' ? 'black' : opts.bgMode;

  function syncDefaultFormatForBg(prevBg, nextBg) {
    if (nextBg === 'transparent' && format === 'mp4') {
      format = 'webm';
    } else if (prevBg === 'transparent' && nextBg !== 'transparent' && format === 'webm') {
      format = 'mp4';
    }
  }

  function paintSettings() {
    settingsBody.replaceChildren();

    // 1. Background card (Black, Transparent, Greenscreen, Bluescreen)
    const isTransparent = opts.bgMode === 'transparent';
    const bgCard = h('div', { class: 'insp-card' }, h('h6', {}, '1 · Achtergrond'),
      h('div', { class: 'hack-bg-choices' }, ...MATRIX_BACKGROUNDS.map((b) => h('button', {
        type: 'button',
        class: `hack-bg-choice${opts.bgMode === b.id ? ' on' : ''}`,
        'data-bg': b.id,
        disabled: exporting,
        onclick: () => {
          const prev = opts.bgMode;
          if (b.id !== 'transparent') bgBeforeTransparent = b.id;
          opts.bgMode = b.id;
          syncDefaultFormatForBg(prev, b.id);
          optionChanged({ repaint: true });
        },
      }, h('i', { style: { background: b.id === 'transparent' ? CHECKER : b.color } }), b.name))),
      h('label', { class: 'toggle', style: { marginTop: '6px' } },
        h('input', {
          type: 'checkbox',
          id: 'matrix-transparent-toggle',
          checked: isTransparent,
          disabled: exporting,
          onchange: (e) => {
            const prev = opts.bgMode;
            if (e.target.checked) {
              if (opts.bgMode !== 'transparent') bgBeforeTransparent = opts.bgMode;
              opts.bgMode = 'transparent';
            } else {
              opts.bgMode = bgBeforeTransparent || 'black';
            }
            syncDefaultFormatForBg(prev, opts.bgMode);
            optionChanged({ repaint: true });
          },
        }),
        h('span', { class: 'track' }), 'Transparante achtergrond (alpha)'),
      h('p', { class: 'hint' },
        opts.bgMode === 'black'
          ? 'Klassiek donker scherm — direct klaar als achtergrond of losse hack-loop.'
          : opts.bgMode === 'transparent'
            ? 'Alleen de vallende cijfers zijn zichtbaar. Exporteer als transparante GIF, WebM of MOV om direct over je video te leggen.'
            : opts.bgMode === 'green'
              ? 'Effen chroma-key groen (#00b140) met donker schaduwrandje rond de cijfers — makkelijk weg te keyen in elke video-editor.'
              : 'Effen chroma-key blauw (#0047bb) — ideaal voor groene cijfers omdat blauw maximaal contrasteert met felgroene code!'));

    // 2. Code & Falling Numbers card
    const codeCard = h('div', { class: 'insp-card' }, h('h6', {}, '2 · Vallende Cijfers & Stijl'),
      h('label', { class: 'field' }, 'Tekens (wat valt er naar beneden?)',
        h('select', {
          class: 'select',
          id: 'matrix-charset',
          disabled: exporting,
          onchange: (e) => { opts.charset = e.target.value; optionChanged({ repaint: true }); },
        }, ...MATRIX_CHARSETS.map((c) => h('option', { value: c.id, selected: opts.charset === c.id }, c.name)))),
      opts.charset === 'custom'
        ? h('label', { class: 'field' }, 'Eigen tekens',
          h('input', {
            class: 'input mono',
            id: 'matrix-customChars',
            value: opts.customChars,
            maxlength: 64,
            placeholder: 'bijv. 0123456789',
            disabled: exporting,
            onchange: (e) => { opts.customChars = e.target.value.trim() || '0123456789'; e.target.value = opts.customChars; optionChanged(); },
          }))
        : null,
      h('div', { class: 'field' }, h('span', {}, 'Beweging'),
        h('div', { class: 'matrix-flow-choices' }, ...MATRIX_FLOW_MODES.map((m) => h('button', {
          type: 'button',
          class: `hack-bg-choice${opts.flowMode === m.id ? ' on' : ''}`,
          disabled: exporting,
          title: m.desc,
          onclick: () => { opts.flowMode = m.id; optionChanged({ repaint: true }); },
        }, m.name)))),
      h('div', { class: 'field' }, h('span', {}, 'Kleur van de cijfers'),
        h('div', { class: 'matrix-color-bar' },
          h('input', {
            type: 'color',
            id: 'matrix-codeColor',
            value: opts.codeColor,
            disabled: exporting,
            onchange: (e) => { opts.codeColor = e.target.value; optionChanged({ repaint: true }); },
          }),
          h('div', { class: 'matrix-color-presets' }, ...MATRIX_COLOR_PRESETS.map((p) => h('button', {
            type: 'button',
            class: `matrix-color-chip${opts.codeColor.toLowerCase() === p.color.toLowerCase() ? ' on' : ''}`,
            title: p.name,
            disabled: exporting,
            onclick: () => { opts.codeColor = p.color; optionChanged({ repaint: true }); },
          }, h('i', { style: { background: p.color } }), p.name))))),
      h('label', { class: 'field' }, `Lettergrootte (${opts.fontSize} px)`,
        h('input', {
          type: 'range', min: 14, max: 64, step: 2, value: opts.fontSize, id: 'matrix-fontSize', disabled: exporting,
          onchange: (e) => { opts.fontSize = +e.target.value; optionChanged({ repaint: true }); },
        })),
      h('label', { class: 'field' }, `Dichtheid (${Math.round(opts.density * 100)}%)`,
        h('input', {
          type: 'range', min: 0.15, max: 1, step: 0.05, value: opts.density, id: 'matrix-density', disabled: exporting,
          onchange: (e) => { opts.density = +e.target.value; optionChanged({ repaint: true }); },
        })),
      h('label', { class: 'field' }, `Valsnelheid (${opts.speed.toFixed(1)}×)`,
        h('input', {
          type: 'range', min: 0.3, max: 3, step: 0.1, value: opts.speed, id: 'matrix-speed', disabled: exporting,
          onchange: (e) => { opts.speed = +e.target.value; optionChanged({ repaint: true }); },
        })),
      h('label', { class: 'field' }, `Staartlengte (${Math.round(opts.trailLength * 100)}%)`,
        h('input', {
          type: 'range', min: 0.2, max: 1, step: 0.05, value: opts.trailLength, id: 'matrix-trailLength', disabled: exporting,
          onchange: (e) => { opts.trailLength = +e.target.value; optionChanged({ repaint: true }); },
        })),
      h('div', { class: 'hack-toggles' },
        toggle('Oplichtend voorste cijfer (kop)', 'brightHead'),
        toggle('Neon gloed rond cijfers', 'glow'),
        toggle('Subtiele CRT scanlines', 'scanlines')),
      h('button', {
        type: 'button',
        class: 'btn btn-sm',
        id: 'matrix-shuffle',
        disabled: exporting,
        onclick: () => { opts.seed = crypto.getRandomValues(new Uint32Array(1))[0]; optionChanged(); },
      }, icon('spark'), 'Shuffle kolommen & cijfers'));

    // 3. Loop Duration & Sound card
    const quickDurations = [2, 3, 4, 5, 6, 8, 10];
    const loopCard = h('div', { class: 'insp-card' }, h('h6', {}, '3 · Loop-duur & Geluid'),
      h('div', { class: 'field' }, h('span', {}, 'Lengte van de loop (seconden)'),
        h('div', { class: 'matrix-dur-row' },
          ...quickDurations.map((d) => h('button', {
            type: 'button',
            class: `btn btn-sm ${Math.abs(opts.duration - d) < 0.05 ? 'btn-primary' : 'btn-ghost'}`,
            disabled: exporting,
            onclick: () => { opts.duration = d; optionChanged({ keepTime: false, repaint: true }); },
          }, `${d}s`)),
          h('input', {
            class: 'input matrix-dur-input',
            type: 'number',
            min: 1,
            max: 30,
            step: 0.5,
            value: opts.duration,
            id: 'matrix-duration',
            disabled: exporting,
            onchange: (e) => {
              const v = +e.target.value;
              opts.duration = Number.isFinite(v) ? Math.max(1, Math.min(30, v)) : opts.duration;
              e.target.value = opts.duration;
              optionChanged({ keepTime: false, repaint: true });
            },
          }))),
      h('p', { class: 'hint' }, 'Het laatste frame sluit wiskundig exact aan op het eerste frame — je kunt de video of GIF eindeloos achter elkaar herhalen zonder sprong.'),
      toggle('Digitale data-geluidjes (alleen bij video-export)', 'sounds'),
      opts.sounds
        ? h('label', { class: 'field' }, `Volume (${Math.round(opts.volume * 100)}%)`,
          h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: opts.volume, disabled: exporting, 'aria-label': 'Volume',
            onchange: (e) => { opts.volume = +e.target.value; optionChanged({ repaint: true }); },
          }))
        : null);

    // 4. Export card (Loopable Video OR Animated GIF)
    const total = matrixSchedule(opts).total;
    const isGif = format === 'gif';
    if (isGif && fps > 30) fps = 20;

    const btnLabel = exporting
      ? 'Annuleren'
      : format === 'gif'
        ? `Exporteer Loop GIF (${opts.bgMode === 'transparent' ? 'transparant' : opts.bgMode})`
        : format === 'mp4'
          ? 'Exporteer Loop MP4'
          : `Exporteer Loop ${format.toUpperCase()}${opts.bgMode === 'transparent' ? ' (transparant)' : ''}`;

    expButton.disabled = format === 'mp4' && !exportSupported();
    expButton.replaceChildren(icon(exporting ? 'stop' : 'download'), btnLabel);

    const exportCard = h('div', { class: 'insp-card' }, h('h6', {}, '4 · Export (Loop-video of GIF)'),
      h('div', { class: 'field' }, h('span', {}, 'Wat wil je exporteren?'),
        h('div', { class: 'matrix-export-tabs' },
          h('button', {
            type: 'button',
            class: `hack-bg-choice${format !== 'gif' ? ' on' : ''}`,
            disabled: exporting,
            onclick: () => {
              if (format === 'gif') format = opts.bgMode === 'transparent' ? 'webm' : 'mp4';
              if (fps < 24) fps = 30;
              paintSettings();
            },
          }, icon('film'), 'Loop-video'),
          h('button', {
            type: 'button',
            class: `hack-bg-choice${format === 'gif' ? ' on' : ''}`,
            disabled: exporting,
            onclick: () => {
              format = 'gif';
              if (fps > 25) fps = 20;
              if (quality === '2160') quality = '720';
              paintSettings();
            },
          }, icon('image'), 'Loopende GIF'))),
      h('label', { class: 'field' }, 'Bestandsformaat',
        h('select', {
          class: 'select',
          id: 'matrix-format',
          disabled: exporting,
          onchange: (e) => {
            format = e.target.value;
            if (format === 'gif' && fps > 30) fps = 20;
            if (format === 'gif' && quality === '2160') quality = '720';
            paintSettings();
          },
        },
          h('option', { value: 'gif', selected: format === 'gif' }, opts.bgMode === 'transparent' ? 'GIF · Eindeloos loopende animatie (transparant)' : 'GIF · Eindeloos loopende animatie (.gif)'),
          opts.bgMode !== 'transparent'
            ? h('option', { value: 'mp4', selected: format === 'mp4' }, 'MP4 · Loop-video H.264 (meest compatibel)')
            : null,
          h('option', { value: 'webm', selected: format === 'webm' }, opts.bgMode === 'transparent' ? 'WebM · Loop-video met transparantie (klein bestand)' : 'WebM · Loop-video VP9'),
          h('option', { value: 'mov', selected: format === 'mov' }, opts.bgMode === 'transparent' ? 'MOV · ProRes 4444 met transparantie (montage)' : 'MOV · ProRes 4444 (montage)'),
          opts.bgMode === 'transparent'
            ? h('option', { value: 'mp4', selected: format === 'mp4' }, 'MP4 · H.264 (vervangt transparant door zwart)')
            : null)),
      h('label', { class: 'field' }, 'Resolutie',
        h('select', {
          class: 'select',
          id: 'matrix-quality',
          disabled: exporting,
          onchange: (e) => { quality = e.target.value; paintSettings(); },
        },
          isGif ? h('option', { value: '480', selected: quality === '480' }, 'Compact GIF · 854×480 (snel & klein)') : null,
          h('option', { value: '720', selected: quality === '720' }, 'HD · 1280×720'),
          h('option', { value: '1080', selected: quality === '1080' }, 'Full HD · 1920×1080'),
          !isGif ? h('option', { value: '2160', selected: quality === '2160' }, '4K · 3840×2160') : null)),
      h('label', { class: 'field' }, 'Framerate',
        h('select', {
          class: 'select',
          id: 'matrix-fps',
          disabled: exporting,
          onchange: (e) => { fps = +e.target.value; paintSettings(); },
        },
          isGif ? h('option', { value: 15, selected: fps === 15 }, '15 FPS (klein GIF-bestand)') : null,
          isGif ? h('option', { value: 20, selected: fps === 20 }, '20 FPS (aanbevolen voor GIF)') : null,
          h('option', { value: 24, selected: fps === 24 }, '24 FPS'),
          h('option', { value: 30, selected: fps === 30 }, '30 FPS'),
          !isGif ? h('option', { value: 60, selected: fps === 60 }, '60 FPS (extra vloeiend)') : null)),
      h('p', { class: 'hint' },
        format === 'gif'
          ? `Naadloos loopende GIF van ${total.toFixed(1)}s (${Math.ceil(total * fps)} frames)${opts.bgMode === 'transparent' ? ' met transparante achtergrond' : ''}. Ideaal voor presentaties, websites of overlays.`
          : format === 'webm'
            ? `Naadloze WebM loop-video van ${total.toFixed(1)}s${opts.bgMode === 'transparent' ? ' met alpha-transparantie' : ''}.`
            : format === 'mov'
              ? `Naadloze ProRes 4444 MOV loop-video van ${total.toFixed(1)}s${opts.bgMode === 'transparent' ? ' met alpha-kanaal' : ''} voor professionele montage.`
              : `Naadloze MP4 loop-video van ${total.toFixed(1)}s. Zet je videospeler of montage-tijdlijn op "Loop / Repeat" voor eindeloos vallende cijfers.`),
      expProgress, expStatus, expButton,
      format === 'mp4' && !exportSupported() ? h('p', { class: 'bt-warn' }, 'WebCodecs MP4-export vereist Chrome of Edge (of kies GIF / WebM).') : null);

    const listCard = h('div', { class: 'insp-card' }, h('h6', {}, `📦 Opgeslagen exports (${exports.length})`));
    if (!exports.length) listCard.append(h('p', { class: 'hint' }, 'Je geëxporteerde loop-video’s en GIFs verschijnen hier met downloadknoppen.'));
    exports.forEach((exp) => {
      const isGifExp = exp.filename?.endsWith('.gif');
      listCard.append(h('div', { class: 'export-item' },
        h('div', { class: 'vid-ico' }, icon(isGifExp ? 'image' : 'film')),
        h('div', { class: 'info' },
          h('div', { class: 'name' }, exp.filename),
          h('div', { class: 'sub' }, `${exp.height}p · ${exp.fps} FPS · ${fmtTime(exp.duration)} · ${fmtSize(exp.size)}`)),
        h('a', { class: 'btn btn-icon btn-sm', href: fileUrl.export(exp), download: exp.filename, title: 'Downloaden' }, icon('download')),
        h('button', {
          class: 'btn btn-icon btn-sm btn-ghost btn-danger',
          title: 'Verwijderen',
          disabled: exporting,
          onclick: async () => {
            if (!(await modal({ title: `"${exp.filename}" verwijderen?`, confirm: 'Verwijderen', danger: true }))) return;
            await api.deleteExport(exp.id);
            exports = exports.filter((e) => e.id !== exp.id);
            paintSettings();
            toast('Export verwijderd', 'ok');
          },
        }, icon('trash'))));
    });

    if (exportingView) settingsBody.append(exportCard, listCard, bgCard, codeCard, loopCard);
    else settingsBody.append(bgCard, codeCard, loopCard, exportCard, listCard);
  }

  // ---------- export ----------
  function resolutionDims(q) {
    if (q === '480') return { width: 854, height: 480 };
    if (q === '720') return { width: 1280, height: 720 };
    if (q === '2160') return { width: 3840, height: 2160 };
    return { width: 1920, height: 1080 };
  }

  async function startExport() {
    if (exporting) { exportAbort?.abort(); return; }
    stopPlay();
    exporting = true;
    exportAbort = new AbortController();
    paintSettings();
    expProgress.hidden = false; expStatus.hidden = false;
    const { width, height } = resolutionDims(quality);
    let rendered = null;
    try {
      await persist();
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width; outCanvas.height = height;
      const isTransparentGif = format === 'gif' && opts.bgMode === 'transparent';
      // When exporting MP4 while bgMode is 'transparent', fall back to black so H.264 has a clean background
      const exportOpts = format === 'mp4' && opts.bgMode === 'transparent' ? { ...opts, bgMode: 'black' } : opts;
      rendered = createMatrixScene(outCanvas, exportOpts, { forGifTransparent: isTransparentGif });
      const audioTrack = format === 'gif' || !opts.sounds ? new Float32Array(Math.ceil(rendered.schedule.total * 44100)) : rendered.soundtrack;

      const result = await (format !== 'mp4'
        ? renderCanvasExportMov({
          projectId: id,
          canvas: outCanvas,
          scene: rendered,
          soundtrack: format === 'gif' || !opts.sounds ? null : rendered.soundtrack,
          duration: rendered.schedule.total,
          mode: 'matrix',
          format,
          transparent: opts.bgMode === 'transparent',
          width,
          height,
          fps,
          signal: exportAbort.signal,
          onProgress: (p, label) => { expProgress.value = p; expStatus.textContent = label; },
        })
        : renderCanvasExport({
          projectId: id,
          canvas: outCanvas,
          scene: rendered,
          soundtrack: audioTrack,
          duration: rendered.schedule.total,
          mode: 'matrix',
          width,
          height,
          fps,
          signal: exportAbort.signal,
          onProgress: (p, label) => { expProgress.value = p; expStatus.textContent = label; },
        }));

      exports.unshift(result);
      toast(`${format.toUpperCase()} loop geëxporteerd en klaar om te downloaden!`, 'ok', 4500);
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
  drawAt(0.8);

  return () => {
    destroyed = true;
    stopPlay();
    exportAbort?.abort();
    document.removeEventListener('keydown', onKey);
    scene?.dispose();
    player.dispose();
  };
}

