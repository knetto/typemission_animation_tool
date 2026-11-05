// Keyboard Sticker Animation workspace: interactive QWERTY / AZERTY / QWERTZ selector,
// 5 finger-lane colors, live canvas preview, and per-key batch MP4 export.
import { h, icon, toast, modal, fmtTime, fmtSize } from '../util.js';
import { api, fileUrl } from '../api.js';
import { Player } from '../audio/engine.js';
import {
  FINGERS,
  KEYBOARD_THEMES,
  STICKER_STYLES,
  BACKGROUND_MODES,
  BOARD_MODES,
  MASK_MODES,
  UNITY_CONTENT_MODES,
  UNITY_TARGET_SCOPES,
  UNITY_SIZE_SCOPES,
  normalizeUnityExportSettings,
  UNITY_EXPORT_FORMATS,
  KEYBOARD_LAYOUTS,
  getLayout,
  getFlatKeys,
  defaultSelectedKeys,
  normalizeKeyboardOpts,
  findKeyIdsByInput,
  keyExportSlug,
} from '../keyboard/model.js';
import { createKeyboardScene } from '../keyboard/renderer.js';
import {
  buildZipBlob,
  resolveUnityTargets,
  renderUnityTargetSprites,
  generateUnityCSharpScript,
  generateUnityEditorScript,
  generateUnityReadme,
  unityClipTiming,
  unityFrameTime,
  unityFrameSize,
  sliceUnityAudio,
} from '../keyboard/unity-export.js';
import { renderCanvasExport, renderCanvasExportMov, exportSupported } from '../export.js';
import { ensureFonts, logoSvg } from '../scenes/renderer.js';
import { initEditorPanels } from '../editor-panels.js';

export async function mount(root, { id, project, exportingView = false }) {
  await ensureFonts();
  project ||= await api.project(id);
  let opts = normalizeKeyboardOpts(project.keyboard_opts);
  let exports = project.exports || [];
  let scene = null, destroyed = false, raf = 0, playAllMode = false;
  let exporting = false, exportAbort = null, quality = '1080', fps = 30, exportScope = 'all';
  let unityFormat = opts.unityExport.format,
    unityContentMode = opts.unityExport.contentMode,
    unityTargetScope = opts.unityExport.targetScope,
    unitySizeScope = opts.unityExport.sizeScope,
    unityCellSize = opts.unityExport.cellSize,
    unityFps = opts.unityExport.fps,
    unityTrimDelays = opts.unityExport.trimDelays,
    unityIncludeBurst = opts.unityExport.includeBurst,
    unityIncludePress = opts.unityExport.includePress,
    unityPreviewIsolated = false;
  let unityPreviewSlug = '';

  function getUnityTargets() {
    return resolveUnityTargets(opts, unityTargetScope, { sizeScope: unitySizeScope, contentMode: unityContentMode });
  }

  function unitySettingsChanged() {
    opts.unityExport = {
      format: unityFormat, contentMode: unityContentMode, targetScope: unityTargetScope,
      sizeScope: unitySizeScope, cellSize: unityCellSize, fps: unityFps,
      trimDelays: unityTrimDelays, includeBurst: unityIncludeBurst, includePress: unityIncludePress,
    };
    persist();
    if (unityPreviewIsolated) rebuildScene(false);
    paintSettings();
  }
  let bgImageEl = null, loadedBgUrl = '';

  function syncBgImage() {
    const url = opts.bgImageUrl || '';
    if (!url) {
      bgImageEl = null;
      loadedBgUrl = '';
      return Promise.resolve(null);
    }
    if (loadedBgUrl === url && bgImageEl && bgImageEl.complete) {
      return Promise.resolve(bgImageEl);
    }
    loadedBgUrl = url;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (loadedBgUrl === url && !destroyed) {
          bgImageEl = img;
          rebuildScene(true);
        }
        resolve(img);
      };
      img.onerror = () => {
        if (loadedBgUrl === url) bgImageEl = null;
        resolve(null);
      };
      img.src = url;
    });
  }

  const player = new Player();
  const status = h('span', { class: 'save-state', role: 'status' }, 'Opgeslagen');
  const title = h('input', { class: 'ed-title', value: project.name, 'aria-label': 'Projectnaam', maxlength: 120 });

  let saveQueue = Promise.resolve();
  function persist() {
    const payload = {
      keyboard_opts: structuredClone(opts),
      duration: (opts.startDelay + opts.duration + opts.endDelay) * Math.max(1, opts.selectedKeys.length),
      name: title.value.trim() || 'Naamloos',
    };
    status.textContent = 'Opslaan…';
    status.classList.add('saving');
    const task = saveQueue.catch(() => {}).then(() => api.updateProject(id, payload));
    saveQueue = task;
    task.then(
      () => {
        if (saveQueue === task && !destroyed) {
          status.textContent = 'Opgeslagen';
          status.classList.remove('saving');
        }
      },
      (e) => {
        status.textContent = 'Opslaan mislukt';
        status.classList.remove('saving');
        toast(e.message, 'err');
      }
    );
    return task;
  }

  title.addEventListener('change', persist);

  async function goToExport(e) {
    e.preventDefault();
    try {
      await persist();
      location.hash = `#/project/${id}/export`;
    } catch (err) {
      toast('Opslaan mislukt: ' + err.message, 'err');
    }
  }

  const exportLink = h('a', {
    class: 'btn btn-primary',
    id: 'to-scene-btn',
    href: `#/project/${id}/export`,
    onclick: goToExport,
  }, icon('download'), 'Export');

  const header = h('div', { class: 'ed-head' },
    h('a', {
      class: 'btn btn-ghost btn-icon',
      href: exportingView ? `#/project/${id}` : '#/',
      title: exportingView ? 'Terug naar toetsenbord' : 'Terug naar projecten',
    }, icon('back')),
    title,
    status,
    h('div', { class: 'spacer' }),
    h('nav', { class: 'steps' },
      h('a', { class: exportingView ? '' : 'on', href: `#/project/${id}` }, '1 · Toetsenbord & Stickers'),
      h('span', {}, '›'),
      h('a', { class: exportingView ? 'on' : '', href: `#/project/${id}/export`, onclick: goToExport }, '2 · Export')),
    exportingView ? null : exportLink
  );

  // Left panel: Layout selector + Quick select + 5 Finger colors
  const leftBody = h('div', { class: 'panel-body', id: 'kb-left-panel' });
  const left = h('aside', { class: 'panel media-panel kb-left-aside', 'aria-label': 'Toetsenbord & Vingerbanen' },
    h('div', { class: 'panel-heading' }, icon('keyboard'), 'Indeling & Vingerbanen'),
    leftBody
  );

  // Center panel: Interactive keyboard grid + Live animation preview
  const kbGridWrap = h('div', { class: 'kb-grid-wrap', id: 'kb-grid-wrap' });
  const kbSelectionSummary = h('span', { class: 'hint', id: 'kb-selection-summary' });
  const kbSelectorSection = h('section', { class: 'kb-selector-section', 'aria-label': 'Voorbeeld toetsenbord' },
    h('div', { class: 'file-section-heading' },
      h('div', {},
        h('b', {}, 'Voorbeeld Toetsenbord — Klik op toetsen om te selecteren'),
        h('div', { class: 'hint' }, 'Geselecteerde toetsen krijgen een gekleurde sticker op basis van hun vingerbaan en worden als losse MP4 geëxporteerd.')),
      kbSelectionSummary),
    kbGridWrap
  );

  const canvas = h('canvas', { width: 1920, height: 1080, id: 'kb-canvas', 'aria-label': 'Sticker animatie voorbeeld' });
  canvas.style.objectFit = 'contain';
  const prevKeyBtn = h('button', { class: 'btn btn-sm btn-ghost', title: 'Vorige geselecteerde toets', onclick: () => stepPreviewKey(-1) }, '◀ Vorige');
  const playBtn = h('button', { class: 'btn btn-sm btn-primary', id: 'kb-play-btn', onclick: () => togglePlay(false) }, icon('play'), 'Speel toets');
  const playAllBtn = h('button', { class: 'btn btn-sm', id: 'kb-play-all-btn', title: 'Speel alle geselecteerde toetsen achter elkaar af', onclick: () => togglePlay(true) }, icon('film'), 'Speel selectie');
  const nextKeyBtn = h('button', { class: 'btn btn-sm btn-ghost', title: 'Volgende geselecteerde toets', onclick: () => stepPreviewKey(1) }, 'Volgende ▶');
  const scrub = h('input', { type: 'range', min: 0, max: 3, step: 0.02, value: 0, id: 'kb-scrub', 'aria-label': 'Afspeelpositie' });
  const timeLabel = h('span', { class: 'mono' }, '0:00.0 / 0:03.0');
  const activePreviewTitle = h('span', { class: 'kb-preview-pill', id: 'kb-active-preview-label' });
  const selectedChipsWrap = h('div', { class: 'kb-selected-chips', id: 'kb-selected-chips' });

  const stageFrame = h(
    'div',
    { class: 'stage-frame file-stage-frame kb-stage-frame', onclick: () => togglePlay(false) },
    h('span', { class: 'transparent-badge' }, h('i'), 'TRANSPARANTE ALPHA'),
    canvas
  );

  const previewSection = h('section', { class: 'file-preview-section kb-preview-section' },
    h('div', { class: 'file-section-heading' },
      h('b', {}, exportingView ? 'Export voorbeeld per toets' : 'Live Sticker-animatie Voorbeeld'),
      activePreviewTitle),
    stageFrame,
    h('div', { class: 'file-preview-controls kb-preview-controls' }, prevKeyBtn, playBtn, playAllBtn, nextKeyBtn, scrub, timeLabel),
    h('div', { class: 'kb-chips-block' },
      h('div', { class: 'hint' }, 'Klik om de animatie te bekijken · sleep op een toets om van plek te wisselen (⇄) of sleep ertussen om ertussen te plaatsen (⇥):'),
      selectedChipsWrap)
  );

  const center = h('section', { class: 'center file-work-center kb-work-center' },
    exportingView ? null : kbSelectorSection,
    previewSection
  );

  // Right panel: Animation settings & Batch Export
  const settingsBody = h('div', { class: 'panel-body', id: 'kb-settings' });
  const right = h('aside', { class: 'panel right file-settings-panel kb-settings-panel', 'aria-label': 'Sticker & Export instellingen' },
    h('div', { class: 'panel-heading' }, icon(exportingView ? 'download' : 'edit'), exportingView ? 'Exportinstellingen' : 'Sticker-animatie'),
    settingsBody
  );

  const layout = h('div', { class: exportingView ? 'file-export-layout' : 'ed-body file-editor-body' },
    ...(exportingView ? [center, right] : [left, center, right])
  );
  root.append(h('div', { class: 'editor file-editor kb-editor' }, header, layout));
  const disposePanels = exportingView ? () => {} : initEditorPanels(layout, left, center, right);

  const expButton = h('button', { class: 'btn btn-primary', id: 'start-export-btn', onclick: startExport });
  const expStatus = h('div', { class: 'hint mono', id: 'exp-status', role: 'status', hidden: true });
  const expProgress = h('progress', { max: 1, value: 0, class: 'file-export-progress', hidden: true });

  // Switch layout while preserving equivalent selected categories/letters
  function setLayout(newLayout) {
    if (exporting || opts.layout === newLayout) return;
    const oldKeys = getFlatKeys(opts.layout);
    const oldSelectedSet = new Set(opts.selectedKeys);
    const oldSelectedObjs = oldKeys.filter((k) => oldSelectedSet.has(k.id));
    const hadAllLetters = oldKeys.filter((k) => k.kind === 'letter').every((k) => oldSelectedSet.has(k.id));

    opts.layout = newLayout;
    const nextKeys = getFlatKeys(newLayout);
    if (hadAllLetters) {
      const nextSelected = new Set(nextKeys.filter((k) => k.kind === 'letter').map((k) => k.id));
      for (const ok of oldSelectedObjs) {
        if (ok.kind !== 'letter') {
          const match = nextKeys.find((nk) => nk.id === ok.id || nk.label === ok.label);
          if (match) nextSelected.add(match.id);
        }
      }
      opts.selectedKeys = [...nextSelected];
    } else {
      const nextSelected = [];
      for (const ok of oldSelectedObjs) {
        const match = nextKeys.find((nk) => nk.label.toUpperCase() === ok.label.toUpperCase() || nk.id === ok.id);
        if (match && !nextSelected.includes(match.id)) nextSelected.push(match.id);
      }
      opts.selectedKeys = nextSelected.length ? nextSelected : defaultSelectedKeys(newLayout);
    }
    if (!opts.selectedKeys.includes(opts.previewKey)) {
      opts.previewKey = opts.selectedKeys[0] || nextKeys[0].id;
    }
    optionChanged({ playPreview: true });
  }

  function selectByFilter(predicate, additive = false) {
    if (exporting) return;
    const flat = getFlatKeys(opts.layout);
    const matched = flat.filter(predicate).map((k) => k.id);
    if (additive) {
      const current = new Set(opts.selectedKeys);
      const allAlreadyIn = matched.every((id) => current.has(id));
      if (allAlreadyIn) {
        opts.selectedKeys = opts.selectedKeys.filter((id) => !matched.includes(id));
      } else {
        opts.selectedKeys = [...new Set([...opts.selectedKeys, ...matched])];
      }
    } else {
      opts.selectedKeys = matched;
    }
    if (opts.selectedKeys.length && !opts.selectedKeys.includes(opts.previewKey)) {
      opts.previewKey = opts.selectedKeys[0];
    }
    optionChanged({ playPreview: false });
  }

  function toggleKeySelection(keyId) {
    if (exporting) return;
    const idx = opts.selectedKeys.indexOf(keyId);
    if (idx >= 0) {
      opts.selectedKeys.splice(idx, 1);
      if (opts.previewKey === keyId && opts.selectedKeys.length) {
        opts.previewKey = opts.selectedKeys[Math.min(idx, opts.selectedKeys.length - 1)];
      }
    } else {
      opts.selectedKeys.push(keyId);
      opts.previewKey = keyId;
    }
    optionChanged({ playPreview: idx < 0 });
  }

  function setPreviewKey(keyId, autoPlay = true) {
    if (!keyId || exporting) return;
    opts.previewKey = keyId;
    unityPreviewSlug = '';
    persist();
    paintKeyboardGrid();
    paintSelectedChips();
    rebuildScene(false);
    paintSettings();
    if (autoPlay) startPlay(false);
  }

  function stepPreviewKey(dir) {
    const list = opts.selectedKeys.length ? opts.selectedKeys : getFlatKeys(opts.layout).map((k) => k.id);
    if (!list.length) return;
    const curIdx = Math.max(0, list.indexOf(opts.previewKey));
    const nextIdx = (curIdx + dir + list.length) % list.length;
    setPreviewKey(list[nextIdx], true);
  }

  function getPreStickeredIdsFor(keyId) {
    if (!opts.cumulativeStickers) return [];
    const idx = opts.selectedKeys.indexOf(keyId);
    return idx > 0 ? opts.selectedKeys.slice(0, idx) : [];
  }

  function buildPreviewScene(keyId) {
    const isTransparentPreview = opts.bgMode === 'transparent' || unityPreviewIsolated;
    stageFrame.classList.toggle('is-transparent', isTransparentPreview);
    const spriteMode =
      unityPreviewIsolated && unityContentMode !== 'full_board' ? unityContentMode : null;
    const previewOpts =
      unityPreviewIsolated && unityContentMode === 'full_board'
        ? { ...opts, bgMode: 'transparent' }
        : opts;
    const targets = unityPreviewIsolated ? getUnityTargets() : [];
    const target = targets.find((t) => t.slug === unityPreviewSlug) || targets.find((t) => t.keyId === keyId) || targets[0];
    if (target) unityPreviewSlug = target.slug;
    const rendered = createKeyboardScene(canvas, target?.keyId || keyId, previewOpts, {
      preStickeredIds: getPreStickeredIdsFor(target?.keyId || keyId),
      bgImage: bgImageEl,
      spriteMode,
      colorOverride: target?.colorOverride || null,
      includeBurst: unityPreviewIsolated ? unityIncludeBurst : true,
      includePress: unityPreviewIsolated ? unityIncludePress : true,
    });
    const size = unityPreviewIsolated ? unityFrameSize(rendered.spriteBox, unityContentMode, unityCellSize) : { cellWidth: 1920, cellHeight: 1080 };
    canvas.width = size.cellWidth;
    canvas.height = size.cellHeight;
    if (!unityPreviewIsolated) return rendered;
    const timing = unityClipTiming(rendered.schedule, { contentMode: unityContentMode, trimStillDelays: unityTrimDelays, fps: unityFps });
    return {
      ...rendered,
      schedule: { ...rendered.schedule, total: timing.duration, peelEnd: rendered.schedule.peelEnd - timing.tStart },
      soundtrack: sliceUnityAudio(rendered.soundtrack, timing),
      draw: (t) => rendered.draw(unityFrameTime(timing, Math.min(timing.frameCount - 1, Math.floor(t * unityFps + 1e-7)))),
    };
  }

  function rebuildScene(keepTime = false) {
    const prevT = keepTime ? +scrub.value : 0;
    stopPlay();
    scene?.dispose();
    scene = buildPreviewScene(opts.previewKey);
    player.load(scene.soundtrack, 0);
    scrub.step = unityPreviewIsolated ? String(1 / unityFps) : '0.02';
    scrub.max = scene.schedule.total;
    const defaultStartT =
      unityPreviewIsolated && unityContentMode === 'sticker_only'
        ? scene.schedule.peelEnd
        : 0;
    drawAt(keepTime ? Math.min(prevT, scene.schedule.total) : defaultStartT);
    updateActivePreviewBadge();
  }

  function updateActivePreviewBadge() {
    if (!scene?.targetKey) return;
    const tk = scene.targetKey;
    const fInfo = FINGERS.find((f) => f.id === tk.finger) || FINGERS[0];
    const target = unityPreviewIsolated ? getUnityTargets().find((t) => t.slug === unityPreviewSlug) : null;
    const col = target?.colorOverride || opts.fingerColors[tk.finger] || fInfo.defaultColor;
    activePreviewTitle.replaceChildren(
      h('span', { class: 'kb-dot', style: { background: col } }),
      h('b', {}, target?.label || `Toets "${tk.label}"`),
      ...(!target ? [h('span', {}, ` · ${fInfo.name}`)] : [])
    );
  }

  function drawAt(t) {
    if (!scene) return;
    t = Math.max(0, Math.min(scene.schedule.total, t));
    scene.draw(t);
    scrub.value = t;
    timeLabel.textContent = `${fmtTime(t, true)} / ${fmtTime(scene.schedule.total, true)}`;
  }

  function stopPlay() {
    player.pause();
    cancelAnimationFrame(raf);
    playAllMode = false;
    playBtn.replaceChildren(icon('play'), 'Speel toets');
    playAllBtn.replaceChildren(icon('film'), 'Speel selectie');
  }

  async function startPlay(allSequence = false) {
    if (!scene) return;
    stopPlay();
    playAllMode = allSequence;
    if (allSequence) {
      playAllBtn.replaceChildren(icon('pause'), 'Pauze');
    } else {
      playBtn.replaceChildren(icon('pause'), 'Pauze');
    }
    try {
      await player.play(0);
      const loop = () => {
        if (destroyed) return;
        drawAt(player.time);
        if (player.playing) {
          raf = requestAnimationFrame(loop);
        } else if (playAllMode && opts.selectedKeys.length > 1) {
          const idx = opts.selectedKeys.indexOf(opts.previewKey);
          if (idx >= 0 && idx < opts.selectedKeys.length - 1) {
            opts.previewKey = opts.selectedKeys[idx + 1];
            paintKeyboardGrid();
            paintSelectedChips();
            scene = buildPreviewScene(opts.previewKey);
            player.load(scene.soundtrack, 0);
            updateActivePreviewBadge();
            player.play(0).then(() => {
              raf = requestAnimationFrame(loop);
            }).catch(() => stopPlay());
            return;
          }
          stopPlay();
        } else {
          stopPlay();
        }
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      stopPlay();
      toast('Kon preview niet afspelen: ' + e.message, 'err');
    }
  }

  function togglePlay(allSequence = false) {
    if (player.playing) {
      const wasAll = playAllMode;
      stopPlay();
      if (wasAll !== allSequence) startPlay(allSequence);
      return;
    }
    startPlay(allSequence);
  }

  scrub.addEventListener('input', () => {
    stopPlay();
    drawAt(+scrub.value);
  });

  function optionChanged({ playPreview = false, keepTime = false } = {}) {
    persist();
    paintLeft();
    paintKeyboardGrid();
    paintSelectedChips();
    paintSettings();
    rebuildScene(keepTime);
    if (playPreview) startPlay(false);
  }

  // Paint Left Panel
  function paintLeft() {
    if (exportingView) return;
    leftBody.replaceChildren();

    // 1. Layout choice (QWERTY / AZERTY / QWERTZ)
    const layoutCard = h('div', { class: 'insp-card' },
      h('h6', {}, '⌨️ Toetsenbord-indeling'),
      h('div', { class: 'kb-layout-choices', role: 'group', 'aria-label': 'Toetsenbord-indeling' },
        ...Object.values(KEYBOARD_LAYOUTS).map((lay) =>
          h('button', {
            type: 'button',
            class: `kb-layout-btn${opts.layout === lay.id ? ' on' : ''}`,
            'data-layout': lay.id,
            'aria-pressed': String(opts.layout === lay.id),
            onclick: () => setLayout(lay.id),
          },
          h('b', {}, lay.name),
          h('small', {}, lay.subtitle))
        )
      )
    );

    // 2. Quick select & Extra characters input
    const flat = getFlatKeys(opts.layout);
    const selSet = new Set(opts.selectedKeys);
    const allLettersOn = flat.filter((k) => k.kind === 'letter').every((k) => selSet.has(k.id));
    const allNumbersOn = flat.filter((k) => k.kind === 'number').every((k) => selSet.has(k.id));
    const allSymbolsOn = flat.filter((k) => k.kind === 'symbol').every((k) => selSet.has(k.id));

    const extraInput = h('input', {
      class: 'input',
      id: 'kb-extra-chars-input',
      placeholder: 'Bijv. .,?!@ of spatie',
      'aria-label': 'Extra karakters snel selecteren',
    });
    const addExtraChars = () => {
      const ids = findKeyIdsByInput(opts.layout, extraInput.value);
      if (!ids.length) return toast('Geen bijbehorende toetsen gevonden op dit toetsenbord', 'info');
      opts.selectedKeys = [...new Set([...opts.selectedKeys, ...ids])];
      opts.previewKey = ids[0];
      extraInput.value = '';
      toast(`${ids.length} toets(en) toegevoegd aan selectie`, 'ok');
      optionChanged({ playPreview: true });
    };
    extraInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addExtraChars();
      }
    });

    const selectCard = h('div', { class: 'insp-card' },
      h('h6', {}, '🎯 Toetsen selecteren'),
      h('div', { class: 'kb-quick-btns' },
        h('button', {
          type: 'button',
          class: `btn btn-sm${allLettersOn ? ' active' : ''}`,
          onclick: () => selectByFilter((k) => k.kind === 'letter', true),
        }, 'Letters (A–Z)'),
        h('button', {
          type: 'button',
          class: `btn btn-sm${allNumbersOn ? ' active' : ''}`,
          onclick: () => selectByFilter((k) => k.kind === 'number', true),
        }, 'Cijfers (0–9)'),
        h('button', {
          type: 'button',
          class: `btn btn-sm${allSymbolsOn ? ' active' : ''}`,
          onclick: () => selectByFilter((k) => k.kind === 'symbol', true),
        }, 'Leestekens'),
        h('button', {
          type: 'button',
          class: 'btn btn-sm',
          onclick: () => selectByFilter(() => true, false),
        }, 'Alles'),
        h('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost',
          onclick: () => selectByFilter(() => false, false),
        }, 'Wissen')
      ),
      h('label', { class: 'field' },
        'Extra karakters typen om aan te vinken',
        h('div', { class: 'row' },
          extraInput,
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: addExtraChars }, '+ Selecteer')
        )
      )
    );

    // 3. 5 Finger-lane colors (links & rechts zelfde kleur)
    const fingerRows = FINGERS.map((f) => {
      const col = opts.fingerColors[f.id] || f.defaultColor;
      const colorInput = h('input', {
        type: 'color',
        value: col,
        class: 'kb-color-picker',
        'aria-label': `Kleur voor ${f.name}`,
        oninput: (e) => {
          opts.fingerColors[f.id] = e.target.value.toLowerCase();
          hexSpan.textContent = opts.fingerColors[f.id].toUpperCase();
          persist();
          paintKeyboardGrid();
          paintSelectedChips();
          rebuildScene(true);
        },
      });
      const hexSpan = h('span', { class: 'mono kb-color-hex' }, col.toUpperCase());
      return h('div', { class: 'kb-finger-row' },
        colorInput,
        h('div', { class: 'kb-finger-info' },
          h('b', {}, f.name),
          h('small', {}, f.desc)
        ),
        hexSpan
      );
    });

    const colorsCard = h('div', { class: 'insp-card' },
      h('h6', {}, '🖐️ Vingerbanen (6 kleuren)'),
      h('p', { class: 'hint' }, 'Wijsvinger is opgesplitst in links & rechts; overige vingers delen hun kleur. Pas ze hieronder vrij aan:'),
      ...fingerRows
    );

    leftBody.append(layoutCard, selectCard, colorsCard);
  }

  let activeCtxMenu = null;
  function closeKeyContextMenu() {
    if (activeCtxMenu) {
      activeCtxMenu.cleanup();
      activeCtxMenu = null;
    }
  }

  function openKeyContextMenu(e, keyId) {
    e.preventDefault();
    e.stopPropagation();
    closeKeyContextMenu();
    if (exporting) return;

    const flat = getFlatKeys(opts.layout);
    const keyObj = flat.find((k) => k.id === keyId);
    if (!keyObj) return;

    const fInfo = FINGERS.find((f) => f.id === keyObj.finger) || FINGERS[0];
    const col = opts.fingerColors[keyObj.finger] || fInfo.defaultColor;
    const isSelected = opts.selectedKeys.includes(keyId);
    const selIdx = opts.selectedKeys.indexOf(keyId);
    const selSet = new Set(opts.selectedKeys);

    const laneKeys = flat.filter((k) => k.finger === keyObj.finger);
    const allLaneSelected = laneKeys.every((k) => selSet.has(k.id));
    const rowKeys = flat.filter((k) => k.rowIndex === keyObj.rowIndex);
    const allRowSelected = rowKeys.every((k) => selSet.has(k.id));

    const item = (label, icoNode, action, { disabled = false, danger = false } = {}) =>
      h('button', {
        type: 'button',
        class: `kb-ctx-item${danger ? ' danger' : ''}`,
        disabled,
        onclick: () => {
          closeKeyContextMenu();
          action();
        },
      },
      h('span', { class: 'kb-ctx-ico' }, icoNode),
      h('span', { class: 'kb-ctx-label' }, label));

    const menuEl = h('div', {
      class: 'kb-ctx-menu',
      role: 'menu',
      style: { '--fc': col },
      oncontextmenu: (ev) => ev.preventDefault(),
    },
    h('div', { class: 'kb-ctx-head' },
      h('span', { class: 'kb-chip-dot', style: { background: col } }),
      h('b', {}, keyObj.label),
      h('span', { class: 'kb-ctx-meta' }, fInfo.shortName || fInfo.name)
    ),
    h('div', { class: 'kb-ctx-sep' }),
    item('Speel voorbeeld', icon('play'), () => setPreviewKey(keyId, true)),
    item(
      isSelected ? 'Deselecteer' : 'Selecteer',
      icon(isSelected ? 'trash' : 'check'),
      () => toggleKeySelection(keyId),
      { danger: isSelected }
    ),
    item('Alleen deze toets', '◎', () => {
      opts.selectedKeys = [keyId];
      opts.previewKey = keyId;
      optionChanged({ playPreview: true });
    }),
    isSelected && opts.selectedKeys.length > 1
      ? h('div', { class: 'kb-ctx-group' },
          item('Zet vooraan (#1)', '↑', () => insertSelectedKey(selIdx, 0), { disabled: selIdx === 0 }),
          item('Zet achteraan', '↓', () => insertSelectedKey(selIdx, opts.selectedKeys.length), {
            disabled: selIdx === opts.selectedKeys.length - 1,
          })
        )
      : null,
    h('div', { class: 'kb-ctx-sep' }),
    item(
      allLaneSelected ? 'Deselecteer baan' : 'Selecteer baan',
      '🖐',
      () => selectByFilter((k) => k.finger === keyObj.finger, true)
    ),
    item(
      allRowSelected ? `Deselecteer rij ${keyObj.rowIndex + 1}` : `Selecteer rij ${keyObj.rowIndex + 1}`,
      '↔',
      () => selectByFilter((k) => k.rowIndex === keyObj.rowIndex, true)
    ),
    item('Kleur aanpassen…', icon('edit'), () => {
      const picker = h('input', {
        type: 'color',
        value: col,
        style: { position: 'fixed', left: `${e.clientX}px`, top: `${e.clientY}px`, opacity: '0', pointerEvents: 'none' },
        oninput: (ev) => {
          opts.fingerColors[keyObj.finger] = ev.target.value.toLowerCase();
          persist();
          paintLeft();
          paintKeyboardGrid();
          paintSelectedChips();
          rebuildScene(true);
        },
        onchange: () => picker.remove(),
        onblur: () => picker.remove(),
      });
      document.body.append(picker);
      picker.click();
    }),
    h('div', { class: 'kb-ctx-sep' }),
    item(`Exporteer "${keyObj.label}"`, icon('film'), () => {
      opts.previewKey = keyId;
      exportScope = 'single';
      optionChanged({ playPreview: false });
      startExport();
    }));

    document.body.append(menuEl);
    const rect = menuEl.getBoundingClientRect();
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8));
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;

    const onOutsidePointer = (ev) => {
      if (!menuEl.contains(ev.target)) closeKeyContextMenu();
    };
    const onEsc = (ev) => {
      if (ev.key === 'Escape') closeKeyContextMenu();
    };
    const onScrollOrResize = () => closeKeyContextMenu();

    setTimeout(() => {
      window.addEventListener('pointerdown', onOutsidePointer, true);
      window.addEventListener('keydown', onEsc, true);
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize, true);
    }, 0);

    activeCtxMenu = {
      cleanup() {
        window.removeEventListener('pointerdown', onOutsidePointer, true);
        window.removeEventListener('keydown', onEsc, true);
        window.removeEventListener('scroll', onScrollOrResize, true);
        window.removeEventListener('resize', onScrollOrResize, true);
        menuEl.remove();
      },
    };
  }

  // Paint Interactive Keyboard Grid in Center
  function paintKeyboardGrid() {
    const layoutObj = getLayout(opts.layout);
    const selSet = new Set(opts.selectedKeys);
    const flat = getFlatKeys(opts.layout);
    kbSelectionSummary.textContent = `${opts.selectedKeys.length} van ${flat.length} toetsen geselecteerd voor export`;
    kbGridWrap.classList.toggle('no-shine', opts.stickerShine === false);

    kbGridWrap.replaceChildren(
      ...layoutObj.rows.map((row, rIdx) => {
        const prevRowIso = rIdx > 0 ? layoutObj.rows[rIdx - 1]?.find((k) => k.isoEnter) : null;
        return h('div', { class: 'kb-row' },
          ...row.map((key) => {
            const isSelected = selSet.has(key.id);
            const isPreview = opts.previewKey === key.id;
            const isModifier = key.kind === 'special' && key.id !== 'space';
            const col = opts.fingerColors[key.finger] || '#456d74';
            const fInfo = FINGERS.find((f) => f.id === key.finger) || FINGERS[0];
            const displayLabel = key.canvasLabel !== undefined ? key.canvasLabel : (key.blankKey ? '' : key.label);
            return h('button', {
              type: 'button',
              class: `kb-key${isSelected ? ' selected' : ''}${isPreview ? ' previewing' : ''}${isModifier ? ' modifier' : ''}${key.homing ? ' homing' : ''}${key.isoEnter ? ' iso-enter' : ''}`,
              'data-key-id': key.id,
              'aria-pressed': String(isSelected),
              title: `${key.label}${key.sub ? ' / ' + key.sub : ''} (${fInfo.name}) — Klik om te selecteren · Rechtermuisklik voor afspelen & opties`,
              style: { '--kw': key.w, '--fc': col },
              onclick: () => toggleKeySelection(key.id),
              oncontextmenu: (e) => openKeyContextMenu(e, key.id),
            },
            key.isoEnter
              ? h('span', {
                  class: 'kb-iso-shape',
                  'aria-hidden': 'true',
                  html: `<svg viewBox="0 0 60 81" preserveAspectRatio="none"><path d="M6,0 H54 A6,6 0 0 1 60,6 V75 A6,6 0 0 1 54,81 H26 A6,6 0 0 1 20,75 V38 H6 A6,6 0 0 1 0,32 V6 A6,6 0 0 1 6,0 Z"/></svg>`,
                })
              : null,
            key.spyIcon
              ? h('span', { class: 'kb-key-main kb-key-spy-logo', 'aria-label': 'Spy', html: logoSvg('currentColor') })
              : h('span', { class: 'kb-key-main' }, displayLabel),
            isSelected ? h('span', { class: 'kb-key-check', 'aria-hidden': 'true' }, '✓') : null);
          }),
          prevRowIso
            ? h('div', {
                class: 'kb-iso-spacer',
                style: { '--kw': prevRowIso.wBottom || 1 },
                'aria-hidden': 'true',
              })
            : null
        );
      })
    );
  }

  function swapSelectedKeys(fromIndex, targetIndex) {
    if (exporting) return;
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;
    if (fromIndex >= opts.selectedKeys.length || targetIndex >= opts.selectedKeys.length) return;
    const reordered = [...opts.selectedKeys];
    const tmp = reordered[fromIndex];
    reordered[fromIndex] = reordered[targetIndex];
    reordered[targetIndex] = tmp;
    opts.selectedKeys = reordered;
    persist();
    paintSelectedChips();
    if (opts.cumulativeStickers) rebuildScene(true);
  }

  function insertSelectedKey(fromIndex, insertBeforeIndex) {
    if (exporting) return;
    if (fromIndex < 0 || fromIndex >= opts.selectedKeys.length) return;
    const clampedTarget = Math.max(0, Math.min(opts.selectedKeys.length, insertBeforeIndex));
    if (clampedTarget === fromIndex || clampedTarget === fromIndex + 1) return;
    const reordered = [...opts.selectedKeys];
    const [moved] = reordered.splice(fromIndex, 1);
    const adjustedIndex = clampedTarget > fromIndex ? clampedTarget - 1 : clampedTarget;
    reordered.splice(adjustedIndex, 0, moved);
    opts.selectedKeys = reordered;
    persist();
    paintSelectedChips();
    if (opts.cumulativeStickers) rebuildScene(true);
  }

  function findChipDropAction(clientX, clientY, chipRecords, fromIndex) {
    const wrapRect = selectedChipsWrap.getBoundingClientRect();
    if (
      clientX < wrapRect.left - 28 ||
      clientX > wrapRect.right + 28 ||
      clientY < wrapRect.top - 28 ||
      clientY > wrapRect.bottom + 28
    ) {
      return null;
    }

    // Find chips on the same visual row as the pointer
    let minDy = Infinity;
    const withDy = chipRecords.map((item) => {
      const { rect } = item;
      const dy =
        clientY >= rect.top - 6 && clientY <= rect.bottom + 6
          ? 0
          : Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (dy < minDy) minDy = dy;
      return { ...item, dy };
    });

    if (minDy > 26) return null;
    const rowChips = withDy.filter((item) => Math.abs(item.dy - minDy) <= 10);
    if (!rowChips.length) return null;

    // 1. Check if pointer is directly over a chip on this row
    for (const item of rowChips) {
      const { rect, index } = item;
      if (clientX >= rect.left && clientX <= rect.right) {
        if (index === fromIndex) return null;
        const ratio = (clientX - rect.left) / Math.max(1, rect.width);
        // Left edge -> insert before this chip
        if (ratio < 0.26) {
          const insertBeforeIndex = index;
          if (insertBeforeIndex === fromIndex || insertBeforeIndex === fromIndex + 1) return null;
          return {
            type: 'insert',
            insertBeforeIndex,
            indicatorIndex: index,
            indicatorSide: 'before',
          };
        }
        // Right edge -> insert after this chip
        if (ratio > 0.74) {
          const insertBeforeIndex = index + 1;
          if (insertBeforeIndex === fromIndex || insertBeforeIndex === fromIndex + 1) return null;
          return {
            type: 'insert',
            insertBeforeIndex,
            indicatorIndex: index,
            indicatorSide: 'after',
          };
        }
        // Center zone -> swap places with this chip
        return {
          type: 'swap',
          targetIndex: index,
          indicatorIndex: index,
          targetLabel: item.label,
        };
      }
    }

    // 2. Pointer is in the gap between chips (or before first / after last chip in the row)
    const first = rowChips[0];
    if (clientX < first.rect.left) {
      const insertBeforeIndex = first.index;
      if (insertBeforeIndex === fromIndex || insertBeforeIndex === fromIndex + 1) return null;
      return {
        type: 'insert',
        insertBeforeIndex,
        indicatorIndex: first.index,
        indicatorSide: 'before',
      };
    }

    const last = rowChips[rowChips.length - 1];
    if (clientX > last.rect.right) {
      const insertBeforeIndex = last.index + 1;
      if (insertBeforeIndex === fromIndex || insertBeforeIndex === fromIndex + 1) return null;
      return {
        type: 'insert',
        insertBeforeIndex,
        indicatorIndex: last.index,
        indicatorSide: 'after',
      };
    }

    for (let i = 0; i < rowChips.length - 1; i++) {
      const leftChip = rowChips[i];
      const rightChip = rowChips[i + 1];
      if (clientX >= leftChip.rect.right && clientX <= rightChip.rect.left) {
        const insertBeforeIndex = rightChip.index;
        if (insertBeforeIndex === fromIndex || insertBeforeIndex === fromIndex + 1) return null;
        return {
          type: 'insert',
          insertBeforeIndex,
          indicatorIndex: rightChip.index,
          indicatorSide: 'before',
        };
      }
    }

    return null;
  }

  // Paint Selected Keys Chip Strip
  function paintSelectedChips() {
    const flat = getFlatKeys(opts.layout);
    const byId = Object.fromEntries(flat.map((k) => [k.id, k]));
    selectedChipsWrap.replaceChildren();
    if (!opts.selectedKeys.length) {
      selectedChipsWrap.append(h('span', { class: 'hint' }, 'Geen toetsen geselecteerd — klik op toetsen op het toetsenbord hierboven.'));
      return;
    }

    opts.selectedKeys.forEach((keyId, index) => {
      const k = byId[keyId];
      if (!k) return;
      const col = opts.fingerColors[k.finger] || '#3b82f6';
      const active = opts.previewKey === keyId;
      const chip = h('button', {
        type: 'button',
        class: `kb-chip${active ? ' active' : ''}`,
        'data-chip-key': keyId,
        'data-chip-index': String(index),
        style: { '--fc': col },
        title: `Toets ${k.label} (#${index + 1}) — Klik voor voorbeeld · Sleep om te verplaatsen · Rechtermuisklik voor opties`,
        oncontextmenu: (e) => openKeyContextMenu(e, keyId),
        onpointerdown: (e) => {
          if (exporting || e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          let isDragging = false;
          let ghostEl = null;
          let ghostBadgeEl = null;
          let currentAction = null;

          const clearIndicators = () => {
            selectedChipsWrap
              .querySelectorAll('.swap-target, .insert-before, .insert-after')
              .forEach((el) => el.classList.remove('swap-target', 'insert-before', 'insert-after'));
          };

          const onPointerMove = (moveEvt) => {
            const dx = moveEvt.clientX - startX;
            const dy = moveEvt.clientY - startY;
            if (!isDragging && Math.hypot(dx, dy) >= 5) {
              isDragging = true;
              chip.classList.add('dragging');
              ghostBadgeEl = h('span', { class: 'kb-chip-ghost-mode' }, 'Verslepen');
              ghostEl = h('div', {
                class: 'kb-chip kb-chip-ghost',
                style: { '--fc': col },
              },
              h('i', { class: 'kb-chip-dot', style: { background: col } }),
              h('b', {}, k.label),
              ghostBadgeEl);
              document.body.append(ghostEl);
            }

            if (!isDragging) return;

            if (ghostEl) {
              ghostEl.style.left = `${moveEvt.clientX + 12}px`;
              ghostEl.style.top = `${moveEvt.clientY + 12}px`;
            }

            const chipEls = [...selectedChipsWrap.querySelectorAll('.kb-chip')];
            const chipRecords = chipEls.map((el, idx) => ({
              el,
              index: idx,
              label: el.querySelector('b')?.textContent || '',
              rect: el.getBoundingClientRect(),
            }));

            clearIndicators();
            currentAction = findChipDropAction(moveEvt.clientX, moveEvt.clientY, chipRecords, index);

            if (currentAction) {
              const targetEl = chipEls[currentAction.indicatorIndex];
              if (currentAction.type === 'swap' && targetEl) {
                targetEl.classList.add('swap-target');
                if (ghostBadgeEl) ghostBadgeEl.textContent = `⇄ Wissel met ${currentAction.targetLabel}`;
              } else if (currentAction.type === 'insert' && targetEl) {
                targetEl.classList.add(currentAction.indicatorSide === 'before' ? 'insert-before' : 'insert-after');
                if (ghostBadgeEl) ghostBadgeEl.textContent = '⇥ Tussenvoegen';
              }
            } else if (ghostBadgeEl) {
              ghostBadgeEl.textContent = 'Verslepen';
            }
          };

          const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            chip.classList.remove('dragging');
            clearIndicators();
            if (ghostEl) {
              ghostEl.remove();
              ghostEl = null;
            }

            if (!isDragging) {
              setPreviewKey(keyId, true);
              return;
            }

            if (currentAction) {
              if (currentAction.type === 'swap') {
                swapSelectedKeys(index, currentAction.targetIndex);
              } else if (currentAction.type === 'insert') {
                insertSelectedKey(index, currentAction.insertBeforeIndex);
              }
            }
          };

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        },
      },
      h('i', { class: 'kb-chip-dot', style: { background: col } }),
      h('b', {}, k.label));
      selectedChipsWrap.append(chip);
    });
  }

  const toggleControl = (label, key, idAttr) =>
    h('label', { class: 'toggle' },
      h('input', {
        type: 'checkbox',
        id: idAttr,
        checked: Boolean(opts[key]),
        disabled: exporting,
        onchange: (e) => {
          opts[key] = e.target.checked;
          optionChanged({ keepTime: true });
        },
      }),
      h('span', { class: 'track' }),
      label
    );

  // Paint Right Settings & Batch Export Panel
  function paintSettings() {
    settingsBody.replaceChildren();

    const styleCard = h('div', { class: 'insp-card' },
      h('h6', {}, '✨ Sticker-animatie stijl'),
      h('div', { class: 'kb-style-choices' },
        ...Object.entries(STICKER_STYLES).map(([key, st]) =>
          h('button', {
            type: 'button',
            class: `kb-layout-btn${opts.stickerStyle === key ? ' on' : ''}`,
            'data-sticker-style': key,
            disabled: exporting,
            onclick: () => {
              opts.stickerStyle = key;
              optionChanged({ playPreview: true });
            },
          },
          h('b', {}, st.name),
          h('small', {}, st.desc))
        )
      ),
      h('label', { class: 'field' },
        'Toetsenbord thema',
        h('select', {
          class: 'select',
          disabled: exporting,
          onchange: (e) => {
            opts.theme = e.target.value;
            optionChanged({ keepTime: true });
          },
        },
        ...Object.entries(KEYBOARD_THEMES).map(([k, th]) =>
          h('option', { value: k, selected: opts.theme === k }, th.name)
        ))
      ),
      h('label', { class: 'field' },
        'Achtergrond achter toetsenbord',
        h('select', {
          class: 'select',
          id: 'kb-bg-mode',
          disabled: exporting,
          onchange: (e) => {
            opts.bgMode = e.target.value;
            optionChanged({ keepTime: true });
          },
        },
        ...Object.entries(BACKGROUND_MODES).map(([k, bm]) =>
          h('option', { value: k, selected: opts.bgMode === k }, `${bm.name} — ${bm.desc}`)
        ))
      ),
      opts.bgMode === 'greenscreen'
        ? h('label', { class: 'field' },
            'Chroma-key kleur',
            h('div', { class: 'row' },
              h('input', {
                type: 'color',
                value: opts.greenscreenColor || '#00ff00',
                class: 'kb-color-picker',
                disabled: exporting,
                oninput: (e) => {
                  opts.greenscreenColor = e.target.value.toLowerCase();
                  persist();
                  rebuildScene(true);
                },
              }),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.greenscreenColor = '#00ff00';
                  optionChanged({ keepTime: true });
                },
              }, 'Helder groen (#00FF00)'),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.greenscreenColor = '#00b140';
                  optionChanged({ keepTime: true });
                },
              }, 'Studio groen'),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.greenscreenColor = '#0047bb';
                  optionChanged({ keepTime: true });
                },
              }, 'Bluescreen')
            )
          )
        : null,
      opts.bgMode === 'custom' || opts.bgMode === 'masked'
        ? h('label', { class: 'field' },
            opts.bgMode === 'masked' ? 'Kleur buiten masker' : 'Eigen achtergrondkleur',
            h('div', { class: 'row' },
              h('input', {
                type: 'color',
                value: opts.bgColor || '#0f172a',
                class: 'kb-color-picker',
                disabled: exporting,
                oninput: (e) => {
                  opts.bgColor = e.target.value.toLowerCase();
                  persist();
                  rebuildScene(true);
                },
              }),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.bgColor = '#000000';
                  optionChanged({ keepTime: true });
                },
              }, 'Zwart'),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.bgColor = '#ffffff';
                  optionChanged({ keepTime: true });
                },
              }, 'Wit'),
              h('button', {
                type: 'button',
                class: 'btn btn-sm',
                disabled: exporting,
                onclick: () => {
                  opts.bgColor = '#00ff00';
                  optionChanged({ keepTime: true });
                },
              }, 'Groen')
            )
          )
        : null,
      opts.bgMode === 'masked'
        ? h('label', { class: 'field' },
            'Masker-vorm (Mask)',
            h('select', {
              class: 'select',
              id: 'kb-mask-mode',
              disabled: exporting,
              onchange: (e) => {
                opts.maskMode = e.target.value;
                optionChanged({ keepTime: true });
              },
            },
            ...Object.entries(MASK_MODES).map(([k, mm]) =>
              h('option', { value: k, selected: opts.maskMode === k }, `${mm.name} — ${mm.desc}`)
            ))
          )
        : null,
      h('label', { class: 'field' },
        'Toetsenbord-plaat (onder de toetsen)',
        h('select', {
          class: 'select',
          id: 'kb-board-mode',
          disabled: exporting,
          onchange: (e) => {
            opts.boardMode = e.target.value;
            optionChanged({ keepTime: true });
          },
        },
        ...Object.entries(BOARD_MODES).map(([k, bm]) =>
          h('option', { value: k, selected: opts.boardMode === k }, `${bm.name} — ${bm.desc}`)
        ))
      ),
      opts.boardMode === 'custom'
        ? h('label', { class: 'field' },
            'Eigen kleur toetsenbord-plaat',
            h('div', { class: 'row' },
              h('input', {
                type: 'color',
                value: opts.boardColor || '#0d1324',
                class: 'kb-color-picker',
                disabled: exporting,
                oninput: (e) => {
                  opts.boardColor = e.target.value.toLowerCase();
                  persist();
                  rebuildScene(true);
                },
              }),
              h('span', { class: 'mono kb-color-hex' }, (opts.boardColor || '#0d1324').toUpperCase())
            )
          )
        : null,
      opts.bgMode === 'image' || opts.bgMode === 'masked' || opts.boardMode === 'image'
        ? h('div', { class: 'field' },
            h('span', {}, 'Achtergrond- / Masker-afbeelding'),
            h('div', { class: 'row' },
              h('button', {
                type: 'button',
                class: 'btn btn-sm btn-primary',
                disabled: exporting,
                onclick: () => {
                  const fileIn = h('input', {
                    type: 'file',
                    accept: 'image/*',
                    hidden: true,
                    onchange: async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const uploaded = await api.uploadImages(id, [file], 'Background');
                        if (uploaded?.[0]) {
                          opts.bgImageUrl = fileUrl.image(uploaded[0]);
                          await syncBgImage();
                          optionChanged({ keepTime: true });
                          toast('Achtergrondafbeelding geüpload!', 'ok');
                        }
                      } catch (err) {
                        toast('Upload mislukt: ' + err.message, 'err');
                      }
                    },
                  });
                  document.body.append(fileIn);
                  fileIn.click();
                  fileIn.remove();
                },
              }, icon('upload'), opts.bgImageUrl ? 'Andere afbeelding kiezen…' : 'Afbeelding uploaden…'),
              opts.bgImageUrl
                ? h('button', {
                    type: 'button',
                    class: 'btn btn-sm btn-ghost',
                    disabled: exporting,
                    onclick: () => {
                      opts.bgImageUrl = '';
                      bgImageEl = null;
                      loadedBgUrl = '';
                      optionChanged({ keepTime: true });
                    },
                  }, icon('trash'), 'Verwijder')
                : null
            ),
            opts.bgImageUrl
              ? h('label', { class: 'field', style: { marginTop: '6px' } },
                  `Afbeelding dimmen (${Math.round(opts.bgImageDim * 100)}%)`,
                  h('input', {
                    type: 'range',
                    min: 0,
                    max: 0.85,
                    step: 0.05,
                    value: opts.bgImageDim,
                    disabled: exporting,
                    onchange: (e) => {
                      opts.bgImageDim = +e.target.value;
                      optionChanged({ keepTime: true });
                    },
                  })
                )
              : null
          )
        : null,
      h('label', { class: 'field' },
        `Start-vertraging / still frame (${Math.round(opts.startDelay * 1000)} ms · ${opts.startDelay.toFixed(2)}s)`,
        h('div', { class: 'row' },
          h('input', {
            type: 'range',
            min: 0,
            max: 3,
            step: 0.05,
            value: opts.startDelay,
            disabled: exporting,
            id: 'kb-start-delay-range',
            onchange: (e) => {
              opts.startDelay = Math.max(0, Math.min(5, +e.target.value || 0));
              optionChanged({ keepTime: false });
            },
          }),
          h('input', {
            type: 'number',
            class: 'input',
            min: 0,
            max: 5000,
            step: 50,
            value: Math.round(opts.startDelay * 1000),
            disabled: exporting,
            id: 'kb-start-delay-ms',
            title: 'Start-vertraging in milliseconden (ms)',
            style: { width: '92px', flexShrink: 0 },
            onchange: (e) => {
              opts.startDelay = Math.max(0, Math.min(5, (+e.target.value || 0) / 1000));
              optionChanged({ keepTime: false });
            },
          })
        )
      ),
      h('label', { class: 'field' },
        `Eind-vertraging / still frame (${Math.round(opts.endDelay * 1000)} ms · ${opts.endDelay.toFixed(2)}s)`,
        h('div', { class: 'row' },
          h('input', {
            type: 'range',
            min: 0,
            max: 3,
            step: 0.05,
            value: opts.endDelay,
            disabled: exporting,
            id: 'kb-end-delay-range',
            onchange: (e) => {
              opts.endDelay = Math.max(0, Math.min(5, +e.target.value || 0));
              optionChanged({ keepTime: false });
            },
          }),
          h('input', {
            type: 'number',
            class: 'input',
            min: 0,
            max: 5000,
            step: 50,
            value: Math.round(opts.endDelay * 1000),
            disabled: exporting,
            id: 'kb-end-delay-ms',
            title: 'Eind-vertraging in milliseconden (ms)',
            style: { width: '92px', flexShrink: 0 },
            onchange: (e) => {
              opts.endDelay = Math.max(0, Math.min(5, (+e.target.value || 0) / 1000));
              optionChanged({ keepTime: false });
            },
          })
        )
      ),
      h('label', { class: 'field' },
        `Animatie-duur (${opts.duration.toFixed(1)}s · totaal ${(opts.startDelay + opts.duration + opts.endDelay).toFixed(2)}s)`,
        h('input', {
          type: 'range',
          min: 1.5,
          max: 6,
          step: 0.5,
          value: opts.duration,
          disabled: exporting,
          onchange: (e) => {
            opts.duration = +e.target.value;
            optionChanged({ keepTime: false });
          },
        })
      ),
      toggleControl('Lege gekleurde sticker (bedekt letter)', 'blankSticker', 'kb-blank-sticker'),
      h('p', { class: 'hint' }, 'Standaard voor blind typen: de gekleurde sticker plakt over de letter heen zodat de toets leeg is.'),
      toggleControl('Subtiele glans op stickers (Shine)', 'stickerShine', 'kb-sticker-shine'),
      toggleControl('Camera-inzoomen op actieve toets', 'cameraZoom', 'kb-camera-zoom'),
      toggleControl('Toon vingerbanen op toetsen', 'showLaneGuide', 'kb-lane-guide'),
      toggleControl('Toon toets- & vinger-badge bovenin', 'showKeyBadge', 'kb-key-badge'),
      toggleControl('Cumulatief (vorige toetsen al beplakt)', 'cumulativeStickers', 'kb-cumulative'),
      toggleControl('Satisfying sticker- & toetsgeluiden', 'sounds', 'kb-sounds'),
      opts.sounds
        ? h('label', { class: 'field' },
            'Geluidsvolume',
            h('input', {
              type: 'range',
              min: 0,
              max: 1,
              step: 0.05,
              value: opts.volume,
              disabled: exporting,
              onchange: (e) => {
                opts.volume = +e.target.value;
                optionChanged({ keepTime: true });
              },
            })
          )
        : null
    );

    const exportCount = exportScope === 'single' ? 1 : opts.selectedKeys.length;
    expButton.disabled = (!opts.selectedKeys.length && exportScope === 'all') || !exportSupported();
    expButton.replaceChildren(
      icon(exporting ? 'stop' : 'film'),
      exporting
        ? 'Export annuleren'
        : exportScope === 'single'
          ? `Exporteer 1 MP4 (toets "${scene?.targetKey?.label || opts.previewKey.toUpperCase()}")`
          : `Exporteer ${opts.selectedKeys.length} losse MP4's`
    );

    const exportCard = h('div', { class: 'insp-card' },
      h('h6', {}, '🎬 Exporteer MP4 per toets'),
      h('div', { class: 'seg' },
        h('button', {
          type: 'button',
          class: exportScope === 'all' ? 'on' : '',
          disabled: exporting,
          onclick: () => { exportScope = 'all'; paintSettings(); },
        }, `Alle geselecteerde (${opts.selectedKeys.length})`),
        h('button', {
          type: 'button',
          class: exportScope === 'single' ? 'on' : '',
          disabled: exporting,
          onclick: () => { exportScope = 'single'; paintSettings(); },
        }, 'Alleen huidige toets (1)')
      ),
      h('label', { class: 'field' },
        'Kwaliteit',
        h('select', {
          class: 'select',
          disabled: exporting,
          onchange: (e) => { quality = e.target.value; },
        },
        h('option', { value: '1080', selected: quality === '1080' }, '1080p Full HD (1920×1080)'),
        h('option', { value: '2160', selected: quality === '2160' }, '4K Ultra HD (3840×2160)'))
      ),
      h('label', { class: 'field' },
        'Framerate',
        h('select', {
          class: 'select',
          disabled: exporting,
          onchange: (e) => { fps = +e.target.value; },
        },
        h('option', { value: 30, selected: fps === 30 }, '30 FPS'),
        h('option', { value: 60, selected: fps === 60 }, '60 FPS'))
      ),
      h('p', { class: 'hint' },
        exportScope === 'single'
          ? `Exporteert 1 MP4-video van ${(opts.startDelay + opts.duration + opts.endDelay).toFixed(2)}s voor de huidige voorbeeldtoets.`
          : `Maakt voor elke geselecteerde toets een aparte MP4-video (${exportCount} bestanden van elk ${(opts.startDelay + opts.duration + opts.endDelay).toFixed(2)}s).`
      ),
      expProgress,
      expStatus,
      expButton,
      !opts.selectedKeys.length ? h('p', { class: 'bt-warn' }, 'Selecteer eerst minimaal één toets op het toetsenbord.') : null,
      !exportSupported() ? h('p', { class: 'bt-warn' }, 'WebCodecs video-export vereist Chrome of Edge.') : null
    );

    // Unity Sprite & Effect Export Card (multiple options: Sprite Sheet PNG, Frame Sequence ZIP, Transparent WebM/MOV, C# Script)
    const unityTargets = getUnityTargets();
    const unityColorCount = new Set(unityTargets.map((target) => target.colorOverride)).size;
    const unitySizeCount = new Set(unityTargets.map((target) => target.sizeId)).size;
    const unityBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary',
        id: 'start-unity-export-btn',
        onclick: startUnityExport,
        disabled: !exporting && !unityTargets.length,
      },
      icon(exporting ? 'stop' : 'download'),
      exporting
        ? 'Export annuleren'
        : `Exporteer voor Unity (${unityTargets.length} ${unityTargets.length === 1 ? 'animatie' : 'animaties'})`
    );

    const unityCard = h(
      'div',
      { class: 'insp-card' },
      h('h6', {}, '🕹️ Unity Sprite & Effect Export'),
      h(
        'p',
        { class: 'hint' },
        'Kies je kleuren en toetsformaten. Je krijgt elke benodigde animatie op een transparante achtergrond, met de echte vorm en beweging van de toets.'
      ),
      h(
        'label',
        { class: 'field' },
        '1. Unity Export-formaat',
        h(
          'select',
          {
            class: 'select',
            id: 'kb-unity-format',
            disabled: exporting,
            onchange: (e) => {
              unityFormat = e.target.value;
              unitySettingsChanged();
            },
          },
          ...Object.entries(UNITY_EXPORT_FORMATS).map(([k, fmt]) =>
            h('option', { value: k, selected: unityFormat === k }, fmt.name)
          )
        ),
        h('small', { class: 'hint' }, UNITY_EXPORT_FORMATS[unityFormat]?.desc || '')
      ),
      h(
        'label',
        { class: 'field' },
        '2. Wat renderen in de Sprite?',
        h(
          'select',
          {
            class: 'select',
            id: 'kb-unity-content-mode',
            disabled: exporting,
            onchange: (e) => {
              unityContentMode = e.target.value;
              unitySettingsChanged();
            },
          },
          ...Object.entries(UNITY_CONTENT_MODES).map(([k, cm]) =>
            h('option', { value: k, selected: unityContentMode === k }, cm.name)
          )
        ),
        h('small', { class: 'hint' }, UNITY_CONTENT_MODES[unityContentMode]?.desc || '')
      ),
      h(
        'label',
        { class: 'field' },
        '3. Welke kleuren of toetsen?',
        h(
          'select',
          {
            class: 'select',
            id: 'kb-unity-target-scope',
            disabled: exporting,
            onchange: (e) => {
              unityTargetScope = e.target.value;
              unitySettingsChanged();
            },
          },
          ...Object.entries(UNITY_TARGET_SCOPES).map(([k, ts]) =>
            h(
              'option',
              { value: k, selected: unityTargetScope === k },
              k === 'selected_keys' ? `${ts.name} (${opts.selectedKeys.length})` : ts.name
            )
          )
        ),
        h('small', { class: 'hint' }, UNITY_TARGET_SCOPES[unityTargetScope]?.desc || '')
      ),
      ['current_key', 'selected_keys'].includes(unityTargetScope) ? null : h(
        'label', { class: 'field' }, '4. Welke toetsformaten?',
        h('select', {
          class: 'select', id: 'kb-unity-size-scope', disabled: exporting,
          onchange: (e) => { unitySizeScope = e.target.value; unitySettingsChanged(); },
        }, ...Object.entries(UNITY_SIZE_SCOPES).map(([value, info]) =>
          h('option', { value, selected: unitySizeScope === value }, info.name))),
        h('small', { class: 'hint' }, UNITY_SIZE_SCOPES[unitySizeScope].desc)
      ),
      h('div', { class: 'hint', role: 'status', id: 'kb-unity-summary' },
        unityTargets.length
          ? `${unityTargets.length} ${unityTargets.length === 1 ? 'animatie' : 'animaties'} · ${unityColorCount} ${unityColorCount === 1 ? 'kleur' : 'kleuren'} · ${unitySizeCount} ${unitySizeCount === 1 ? 'toetsformaat' : 'toetsformaten'}. Elke variant heeft een eigen bestand; brede toetsen behouden hun verhoudingen.`
          : 'Selecteer eerst toetsen op het toetsenbord, of kies alle kleuren en alle toetsformaten.'
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'label',
          { class: 'field', style: { flex: 1 } },
          'Resolutie (inclusief effectruimte)',
          h(
            'select',
            {
              class: 'select',
              id: 'kb-unity-cell-size',
              disabled: exporting,
              onchange: (e) => {
                unityCellSize = +e.target.value;
                unitySettingsChanged();
              },
            },
            h('option', { value: 256, selected: unityCellSize === 256 }, 'Standaard (1×)'),
            h('option', { value: 384, selected: unityCellSize === 384 }, 'Scherp (1,5×)'),
            h('option', { value: 512, selected: unityCellSize === 512 }, 'Extra scherp (2×)')
          )
        ),
        h(
          'label',
          { class: 'field', style: { flex: 1 } },
          'Sprite FPS',
          h(
            'select',
            {
              class: 'select',
              id: 'kb-unity-fps',
              disabled: exporting,
              onchange: (e) => {
                unityFps = +e.target.value;
                unitySettingsChanged();
              },
            },
            h('option', { value: 24, selected: unityFps === 24 }, '24 FPS'),
            h('option', { value: 30, selected: unityFps === 30 }, '30 FPS'),
            h('option', { value: 60, selected: unityFps === 60 }, '60 FPS')
          )
        )
      ),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          id: 'kb-unity-trim-delays',
          checked: unityTrimDelays,
          disabled: exporting,
          onchange: (e) => {
            unityTrimDelays = e.target.checked;
            unitySettingsChanged();
          },
        }),
        h('span', { class: 'track' }),
        'Alleen actie-frames (knip start/eind pauze weg)'
      ),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          id: 'kb-unity-include-burst',
          checked: unityIncludeBurst,
          disabled: exporting,
          onchange: (e) => {
            unityIncludeBurst = e.target.checked;
            unitySettingsChanged();
          },
        }),
        h('span', { class: 'track' }),
        'Sparkle-burst effect meenemen'
      ),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          id: 'kb-unity-include-press',
          checked: unityIncludePress,
          disabled: exporting,
          onchange: (e) => {
            unityIncludePress = e.target.checked;
            unitySettingsChanged();
          },
        }),
        h('span', { class: 'track' }),
        'Toets-indrukbeweging meenemen'
      ),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          id: 'kb-unity-preview-isolated',
          checked: unityPreviewIsolated,
          disabled: exporting,
          onchange: (e) => {
            unityPreviewIsolated = e.target.checked;
            rebuildScene(false);
            paintSettings();
          },
        }),
        h('span', { class: 'track' }),
        'Toon exact exportvoorbeeld (met gekozen FPS en timing)'
      ),
      unityPreviewIsolated && unityTargets.length ? h('label', { class: 'field' }, 'Variant in het exportvoorbeeld',
        h('select', {
          class: 'select', id: 'kb-unity-preview-target', disabled: exporting,
          onchange: (e) => { unityPreviewSlug = e.target.value; rebuildScene(false); paintSettings(); },
        }, ...unityTargets.map((target) => h('option', { value: target.slug, selected: target.slug === unityPreviewSlug }, target.label)))
      ) : null,
      unityFormat === 'spritesheet_png' && unityTargets.length > 1
        ? h('small', { class: 'hint' }, 'Meerdere sheets worden samen als één ZIP gedownload.') : null,
      h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', disabled: exporting,
        onclick: () => {
          const defaults = normalizeUnityExportSettings();
          unityFormat = defaults.format; unityContentMode = defaults.contentMode;
          unityTargetScope = defaults.targetScope; unitySizeScope = defaults.sizeScope;
          unityCellSize = defaults.cellSize; unityFps = defaults.fps;
          unityTrimDelays = defaults.trimDelays; unityIncludeBurst = defaults.includeBurst;
          unityIncludePress = defaults.includePress;
          unitySettingsChanged();
        },
      }, 'Herstel exportinstellingen'),
      unityBtn
    );

    const exportsListCard = h('div', { class: 'insp-card' },
      h('div', { class: 'file-section-heading', style: { marginBottom: '4px' } },
        h('h6', {}, `📦 Opgeslagen exports (${exports.length})`),
        exports.length > 1
          ? h('button', {
              type: 'button',
              class: 'btn btn-sm btn-ghost',
              disabled: exporting,
              onclick: downloadAllExports,
            }, icon('download'), 'Download alles')
          : null
      )
    );

    if (!exports.length) {
      exportsListCard.append(h('p', { class: 'hint' }, 'Je geëxporteerde toets-video’s verschijnen hier met downloadknoppen.'));
    } else {
      exports.forEach((exp) => {
        exportsListCard.append(
          h('div', { class: 'export-item' },
            h('div', { class: 'vid-ico' }, icon('film')),
            h('div', { class: 'info' },
              h('div', { class: 'name' }, exp.filename),
              h('div', { class: 'sub' }, `${exp.height}p · ${exp.fps} FPS · ${fmtTime(exp.duration)} · ${fmtSize(exp.size)}`)
            ),
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
            }, icon('trash'))
          )
        );
      });
    }

    if (exportingView) {
      settingsBody.append(unityCard, exportCard, styleCard, exportsListCard);
    } else {
      settingsBody.append(styleCard, unityCard, exportCard, exportsListCard);
    }
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  async function startUnityExport() {
    if (exporting) {
      exportAbort?.abort();
      return;
    }
    const targets = getUnityTargets();
    if (!targets.length) return toast('Geen toetsen of vingerkleuren gevonden om te exporteren', 'err');

    stopPlay();
    exporting = true;
    exportAbort = new AbortController();
    paintSettings();
    expProgress.hidden = false;
    expStatus.hidden = false;

    try {
      await persist();
      await syncBgImage();

      // Option A: Transparent Video (.webm VP9 with Alpha or .mov ProRes 4444 with Alpha)
      if (unityFormat === 'webm_alpha' || unityFormat === 'mov_alpha') {
        const vidFormat = unityFormat === 'webm_alpha' ? 'webm' : 'mov';
        const spriteMode = unityContentMode === 'full_board' ? null : unityContentMode;
        const effectiveOpts =
          unityContentMode === 'full_board' ? { ...opts, bgMode: 'transparent' } : opts;

        for (let i = 0; i < targets.length; i++) {
          if (exportAbort.signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
          const target = targets[i];
          const probeCanvas = document.createElement('canvas');
          probeCanvas.width = 256;
          probeCanvas.height = 256;
          const probe = createKeyboardScene(probeCanvas, target.keyId, effectiveOpts, {
            bgImage: bgImageEl,
            spriteMode,
            colorOverride: target.colorOverride,
            includeBurst: unityIncludeBurst,
            includePress: unityIncludePress,
            preStickeredIds: getPreStickeredIdsFor(target.keyId),
          });
          const frameSize = unityFrameSize(probe.spriteBox, unityContentMode, unityCellSize);
          const outW = Math.ceil(frameSize.cellWidth / 2) * 2;
          const outH = Math.ceil(frameSize.cellHeight / 2) * 2;
          probe.dispose();

          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW;
          outCanvas.height = outH;
          const rendered = createKeyboardScene(outCanvas, target.keyId, effectiveOpts, {
            bgImage: bgImageEl,
            spriteMode,
            colorOverride: target.colorOverride,
            includeBurst: unityIncludeBurst,
            includePress: unityIncludePress,
            preStickeredIds: getPreStickeredIdsFor(target.keyId),
          });
          const timing = unityClipTiming(rendered.schedule, { contentMode: unityContentMode, trimStillDelays: unityTrimDelays, fps: unityFps });
          const clipScene = {
            ...rendered,
            draw: (t) => rendered.draw(unityFrameTime(timing, Math.min(timing.frameCount - 1, Math.round(t * unityFps)))),
          };
          const result = await renderCanvasExportMov({
            projectId: id,
            canvas: outCanvas,
            scene: clipScene,
            soundtrack: sliceUnityAudio(rendered.soundtrack, timing),
            duration: timing.duration,
            mode: 'keyboard',
            format: vidFormat,
            transparent: true,
            width: outW,
            height: outH,
            fps: unityFps,
            signal: exportAbort.signal,
            onProgress: (p, label) => {
              expProgress.value = (i + p) / targets.length;
              expStatus.textContent = `Unity ${vidFormat.toUpperCase()} ${i + 1}/${targets.length} (${target.label}) · ${label}`;
            },
          });
          rendered.dispose();
          exports.unshift(result);
          paintSettings();
        }
        toast(`Transparante ${vidFormat.toUpperCase()}-export(s) klaar voor Unity VideoPlayer!`, 'ok', 4500);
        return;
      }

      // Option B: Sprite Sheet PNG(s) and/or PNG Frame Sequences + WAV + Unity C# Script
      const assetsOnly = unityFormat === 'spritesheet_audio_zip';
      const wantSpriteSheet =
        assetsOnly || unityFormat === 'spritesheet_zip' || unityFormat === 'both_zip' || unityFormat === 'spritesheet_png';
      const wantFrames = unityFormat === 'frames_zip' || unityFormat === 'both_zip';

      const zipEntries = [];
      const metaList = [];
      let sharedWavBlob = null;

      for (let i = 0; i < targets.length; i++) {
        if (exportAbort.signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
        const target = targets[i];
        expStatus.textContent = `Unity Sprite ${i + 1}/${targets.length} renderen (${target.label})…`;

        const res = await renderUnityTargetSprites({
          target,
          opts,
          bgImage: bgImageEl,
          contentMode: unityContentMode,
          baseCellSize: unityCellSize,
          fps: unityFps,
          trimStillDelays: unityTrimDelays,
          includeBurst: unityIncludeBurst,
          includePress: unityIncludePress,
          preStickeredIds: getPreStickeredIdsFor(target.keyId),
          wantSpriteSheet,
          wantFrames,
          signal: exportAbort.signal,
          onFrameProgress: (fp) => {
            expProgress.value = ((i + fp) / targets.length) * 0.92;
          },
        });

        if (exportAbort.signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
        metaList.push(res.meta);
        if (!sharedWavBlob) sharedWavBlob = res.wavBlob;

        if (unityFormat === 'spritesheet_png' && targets.length === 1 && res.spriteSheetBlob) {
          triggerBlobDownload(res.spriteSheetBlob, res.meta.filename);
        } else {
          if (res.spriteSheetBlob) {
            zipEntries.push({
              path: `SpriteSheets/${res.meta.filename}`,
              data: res.spriteSheetBlob,
            });
          }
          if (res.frameBlobs.length) {
            for (const fb of res.frameBlobs) {
              zipEntries.push({
                path: `Frames/${target.slug}/${fb.filename}`,
                data: fb.blob,
              });
            }
          }
        }
      }

      if (unityFormat === 'spritesheet_png') {
        if (targets.length > 1) {
          zipEntries.push({ path: 'unity_import_meta.json', data: JSON.stringify({ animations: metaList }, null, 2) });
          triggerBlobDownload(await buildZipBlob(zipEntries), 'sticker_spritesheets.zip');
        }
        expProgress.value = 1;
        toast(`${targets.length} transparante Sprite Sheet PNG('s) gedownload!`, 'ok', 4500);
        return;
      }

      expStatus.textContent = assetsOnly
        ? 'ZIP samenstellen (Sprite Sheet + WAV)…'
        : 'Unity .zip pakket samenstellen (Sprite Sheet + WAV + C# script)…';
      expProgress.value = 0.96;

      if (sharedWavBlob && opts.sounds !== false) {
        zipEntries.push({ path: 'Audio/sticker_sfx.wav', data: sharedWavBlob });
      }
      if (!assetsOnly) {
        zipEntries.push({
          path: 'Scripts/StickerSpriteAnimator.cs',
          data: generateUnityCSharpScript(opts, metaList),
        });
        zipEntries.push({
          path: 'Editor/ImportStickerSprites.cs',
          data: generateUnityEditorScript(metaList, { wantSpriteSheet }),
        });
        zipEntries.push({
          path: 'unity_import_meta.json',
          data: JSON.stringify(
            {
              generator: 'Keyboard Sticker Unity Exporter',
              contentMode: unityContentMode,
              targetScope: unityTargetScope,
              sizeScope: unitySizeScope,
              stickerStyle: opts.stickerStyle,
              stickerShine: opts.stickerShine !== false,
              fps: unityFps,
              fingerColors: opts.fingerColors,
              animations: metaList,
            },
            null,
            2
          ),
        });
        zipEntries.push({
          path: 'README_UNITY.txt',
          data: generateUnityReadme(opts, metaList, {
            contentMode: unityContentMode,
            targetScope: unityTargetScope,
            fps: unityFps,
          }),
        });
      }

      const zipBlob = await buildZipBlob(zipEntries);
      if (exportAbort.signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
      const safeName = (title.value.trim() || 'sticker_unity')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const zipFilename = `${safeName || 'sticker'}_unity_${unityContentMode}_${unityTargetScope}_${unityFps}fps.zip`;
      triggerBlobDownload(zipBlob, zipFilename);
      expProgress.value = 1;
      toast(`Unity Sprite-pakket (${zipFilename}) gedownload!`, 'ok', 4500);
    } catch (e) {
      toast(
        e.name === 'AbortError' ? 'Unity-export geannuleerd' : 'Unity-export mislukt: ' + e.message,
        e.name === 'AbortError' ? 'info' : 'err'
      );
    } finally {
      exporting = false;
      exportAbort = null;
      expProgress.hidden = true;
      expStatus.hidden = true;
      if (!destroyed) {
        paintSettings();
      }
    }
  }

  function downloadAllExports() {
    exports.forEach((exp, idx) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = fileUrl.export(exp);
        a.download = exp.filename;
        document.body.append(a);
        a.click();
        a.remove();
      }, idx * 220);
    });
    toast(`${exports.length} downloads gestart`, 'ok');
  }

  async function startExport() {
    if (exporting) {
      exportAbort?.abort();
      return;
    }
    const keysToExport = exportScope === 'single' ? [opts.previewKey] : [...opts.selectedKeys];
    if (!keysToExport.length) return toast('Selecteer eerst toetsen om te exporteren', 'err');

    stopPlay();
    exporting = true;
    exportAbort = new AbortController();
    paintSettings();
    expProgress.hidden = false;
    expStatus.hidden = false;

    const flat = getFlatKeys(opts.layout);
    const byId = Object.fromEntries(flat.map((k) => [k.id, k]));
    const width = quality === '2160' ? 3840 : 1920;
    const height = quality === '2160' ? 2160 : 1080;

    try {
      await persist();
      await syncBgImage();
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width;
      outCanvas.height = height;

      for (let i = 0; i < keysToExport.length; i++) {
        if (exportAbort.signal.aborted) throw new DOMException('Geannuleerd', 'AbortError');
        const keyId = keysToExport[i];
        const keyObj = byId[keyId] || { id: keyId, label: keyId.toUpperCase() };
        const preIds = opts.cumulativeStickers ? keysToExport.slice(0, i) : [];

        // Also update live preview to show which key is being rendered
        opts.previewKey = keyId;
        paintKeyboardGrid();
        paintSelectedChips();

        const rendered = createKeyboardScene(outCanvas, keyId, opts, {
          preStickeredIds: preIds,
          bgImage: bgImageEl,
        });
        const keySlug = keyExportSlug(keyObj);

        const result = await renderCanvasExport({
          projectId: id,
          canvas: outCanvas,
          scene: rendered,
          soundtrack: rendered.soundtrack,
          duration: rendered.schedule.total,
          mode: 'keyboard',
          keyLabel: keySlug,
          width,
          height,
          fps,
          signal: exportAbort.signal,
          onProgress: (p, label) => {
            const overall = (i + p) / keysToExport.length;
            expProgress.value = overall;
            expStatus.textContent = `Toets ${i + 1}/${keysToExport.length} ("${keyObj.label}") · ${label}`;
          },
        });
        rendered.dispose();
        exports.unshift(result);
        paintSettings();
      }
      toast(
        keysToExport.length === 1
          ? 'MP4-video geëxporteerd en klaar om te downloaden!'
          : `Alle ${keysToExport.length} toets-video’s zijn geëxporteerd!`,
        'ok',
        4500
      );
    } catch (e) {
      toast(
        e.name === 'AbortError' ? 'Export geannuleerd' : 'Export mislukt: ' + e.message,
        e.name === 'AbortError' ? 'info' : 'err'
      );
    } finally {
      exporting = false;
      exportAbort = null;
      expProgress.hidden = true;
      expStatus.hidden = true;
      if (!destroyed) {
        rebuildScene(false);
        paintSettings();
      }
    }
  }

  const onKey = (e) => {
    if (e.target.closest('input, select, textarea, button, dialog')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay(false);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepPreviewKey(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepPreviewKey(-1);
    }
  };
  document.addEventListener('keydown', onKey);

  paintLeft();
  paintKeyboardGrid();
  paintSelectedChips();
  paintSettings();
  rebuildScene(false);
  syncBgImage();

  return () => {
    destroyed = true;
    closeKeyContextMenu();
    stopPlay();
    exportAbort?.abort();
    disposePanels();
    document.removeEventListener('keydown', onKey);
    player.dispose();
  };
}
