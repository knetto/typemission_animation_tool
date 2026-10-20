// Scene selection · live deterministic preview · frame-by-frame MP4 export
import { $, h, fmtTime, fmtSize, toast, modal, icon, debounce } from '../util.js';
import { api, fileUrl } from '../api.js';
import { AudioEngine, Player, SR } from '../audio/engine.js';
import { createScene, buildSoundtrack, defaultSceneOpts, normalizeSceneOpts, SCENES, W, H, ensureFonts } from '../scenes/renderer.js';
import { renderExport, renderAudioExport, exportSupported } from '../export.js';

export async function mount(root, { id }) {
  await ensureFonts();
  const project = await api.project(id);
  if (project.type === 'file') return (await import('./files.js')).mount(root, { id, project, exportingView: true });
  if (project.type === 'keyboard') return (await import('./keyboard.js')).mount(root, { id, project, exportingView: true });
  const assets = project.assets || [];
  const customSfx = await api.sfx().catch(() => []);
  let exports = project.exports || [];

  function resolveUrl(src) {
    if (src.type === 'asset') { const a = assets.find((x) => x.id === src.id); if (!a) throw new Error('Audiobestand ontbreekt'); return fileUrl.asset(a); }
    if (src.type === 'sfx') { const s = customSfx.find((x) => x.id === src.id); if (!s) throw new Error('Effect ontbreekt'); return fileUrl.sfx(s); }
    throw new Error('Onbekende bron');
  }

  const engine = new AudioEngine(resolveUrl);
  let voicePcm = new Float32Array(0);
  let mixError = null;
  try {
    const mix = await engine.renderMix(project.timeline);
    voicePcm = mix.pcm;
  } catch (e) {
    console.warn('Kon audio mix niet renderen:', e);
    mixError = e;
  }

  let mode = ['transmission', 'urgent', 'ai'].includes(project.scene) ? project.scene : 'transmission';
  const audioPeaks = new Float32Array(800);
  for (let i = 0; i < voicePcm.length; i++) {
    const bin = Math.min(799, Math.floor(i * 800 / voicePcm.length));
    audioPeaks[bin] = Math.max(audioPeaks[bin], Math.abs(voicePcm[i]));
  }
  let opts = normalizeSceneOpts(project.scene_opts || {});
  let exportType = opts.exportType === 'audio' ? 'audio' : 'video', audioFormat = opts.audioFormat === 'mp3' ? 'mp3' : 'wav';

  const player = new Player();
  let scene = null, soundtrack = null, raf = 0, destroyed = false, exportAbort = null;
  let sceneVersion = 0;

  // Header
  const head = h('div', { class: 'ed-head' },
    h('a', { class: 'btn btn-ghost btn-icon', href: `#/project/${id}`, title: 'Terug naar editor', id: 'back-to-editor' }, icon('back')),
    h('span', { style: { fontSize: '18px', fontWeight: 600 } }, project.name),
    h('div', { class: 'spacer' }),
    h('nav', { class: 'steps' },
      h('a', { href: `#/project/${id}` }, '1 · Audio bewerken'),
      h('span', {}, '›'),
      h('a', { class: 'on', href: `#/project/${id}/export` }, '2 · Export')));

  // Stage (Canvas preview)
  const canvas = h('canvas', { width: W, height: H, id: 'scene-canvas' });
  const playOverlayBtn = h('button', { class: 'play-btn', id: 'stage-play-btn', onclick: () => togglePlay() }, icon('play'));
  const stageOverlay = h('div', { class: 'stage-overlay show', id: 'stage-overlay', onclick: (e) => { if (e.target === stageOverlay) togglePlay(); } }, playOverlayBtn);
  const stageFrame = h('div', { class: 'stage-frame', id: 'stage-frame' }, canvas, stageOverlay);

  const scrub = h('input', { type: 'range', min: 0, max: 10, step: 0.05, value: 0, id: 'scrub-range', style: { width: '100%' } });
  const scrubTime = h('span', { class: 'mono', id: 'scrub-time' }, '0:00 / 0:00');
  const fullBtn = h('button', { class: 'btn btn-sm btn-icon btn-ghost', id: 'full-btn', title: 'Volledig scherm', onclick: () => toggleFullscreen() }, icon('full'));
  const stageControls = h('div', { class: 'scrub' }, scrubTime, scrub, fullBtn);

  // Scene selector cards
  const sceneCardsWrap = h('div', { class: 'scene-cards' });
  const renderSceneCards = () => {
    sceneCardsWrap.replaceChildren();
    Object.entries(SCENES).forEach(([key, sc]) => {
      const isSel = mode === key;
      const card = h('div', {
        class: `scene-card${isSel ? ' on' : ''}`,
        style: { '--sc': sc.c.accent, '--sc-bg': `radial-gradient(circle at 10% 50%, ${sc.c.bg2}, ${sc.c.bg1})` },
        onclick: () => setMode(key),
      },
      h('div', { class: 'sc-ico' }, key === 'transmission' ? '📡' : key === 'urgent' ? '🚨' : '💠'),
      h('div', {}, h('b', {}, sc.name), h('span', {}, sc.desc)));
      sceneCardsWrap.append(card);
    });
  };

  const typeChoices = h('div', { class: 'export-type-choices', role: 'group', 'aria-label': 'Exporttype' });
  function renderTypeChoices() {
    typeChoices.replaceChildren(...[['video', 'Video met scène', 'MP4 · beeld en je bewerkte audio', 'film'], ['audio', 'Alleen audio', 'WAV of MP3 · je tijdlijn zonder scène', 'wave']].map(([key, label, desc, ico]) => h('button', {
      class: `export-type-choice${exportType === key ? ' on' : ''}`, disabled: exporting, 'aria-pressed': String(exportType === key), 'data-export-type': key,
      onclick: async () => { if (exporting || exportType === key) return; player.pause(); cancelAnimationFrame(raf); stageOverlay.classList.add('show'); exportType = key; opts.exportType = key; renderTypeChoices(); renderSide(); await initScene(); saveOpts(); }
    }, icon(ico), h('div', {}, h('b', {}, label), h('span', {}, desc)))));
    sceneCardsWrap.hidden = exportType === 'audio';
  }
  const stageCol = h('div', { class: 'stage-col' }, typeChoices, sceneCardsWrap, h('div', { class: 'stage' }, stageFrame), stageControls);

  // Side panel (Settings + Export)
  const side = h('aside', { class: 'scene-side' });

  root.append(h('div', { class: 'scene-view' }, head, h('div', { class: 'scene-body' }, stageCol, side)));

  // Setup / reload scene
  async function initScene(keepTime = false) {
    const version = ++sceneVersion;
    const curTime = keepTime ? +scrub.value : 0;
    if (exportType === 'audio') {
      const total = voicePcm.length / SR;
      scene = { schedule: { total }, draw(t) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0c1324'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#e6edff'; ctx.font = '600 54px sans-serif'; ctx.fillText('Alleen audio', 120, 180);
        ctx.fillStyle = '#a0b0cc'; ctx.font = '30px sans-serif'; ctx.fillText('Je bewerkte tijdlijn · zonder videoscène of extra scenegeluiden', 120, 240);
        const end = Math.min(1, t / (total || 1));
        for (let x = 0; x < 800; x++) {
          const peak = audioPeaks[x];
          ctx.fillStyle = x / 800 <= end ? '#69a5ff' : '#293954';
          ctx.fillRect(120 + x * 2.1, H / 2 - Math.max(3, peak * 270), 1.5, Math.max(6, peak * 540));
        }
        ctx.fillStyle = '#a0b0cc'; ctx.font = '28px monospace'; ctx.fillText(`${fmtTime(t, true)} / ${fmtTime(total, true)}`, 120, 900);
      } };
      soundtrack = voicePcm; scrub.max = total; player.load(soundtrack, 0); drawAt(curTime); return;
    }
    const nextScene = createScene(canvas, { mode, opts, voice: voicePcm });
    const sched = nextScene.schedule;
    const nextSoundtrack = await buildSoundtrack(mode, voicePcm, sched, opts);
    if (destroyed || version !== sceneVersion) return;
    nextScene.setSoundtrack(nextSoundtrack);
    scene = nextScene;
    soundtrack = nextSoundtrack;
    scrub.max = sched.total;
    player.load(soundtrack, 0);
    drawAt(curTime);
  }

  function drawAt(t) {
    if (!scene) return;
    t = Math.max(0, Math.min(scene.schedule.total, t));
    scene.draw(t);
    scrub.value = t;
    const p = (t / (scene.schedule.total || 1)) * 100;
    scrub.style.setProperty('--p', p + '%');
    scrubTime.textContent = `${fmtTime(t, true)} / ${fmtTime(scene.schedule.total, true)}`;
  }

  function togglePlay() {
    if (!scene || !soundtrack) return;
    if (player.playing) {
      player.pause();
      cancelAnimationFrame(raf);
      stageOverlay.classList.add('show');
      playOverlayBtn.replaceChildren(icon('play'));
    } else {
      let t = +scrub.value;
      if (t >= scene.schedule.total - 0.1) t = 0;
      player.play(t);
      stageOverlay.classList.remove('show');
      playOverlayBtn.replaceChildren(icon('pause'));
      const loop = () => {
        if (destroyed) return;
        if (!player.playing) {
          stageOverlay.classList.add('show');
          playOverlayBtn.replaceChildren(icon('play'));
          return;
        }
        drawAt(player.time);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
  }

  scrub.addEventListener('input', () => {
    if (player.playing) player.pause();
    stageOverlay.classList.add('show');
    playOverlayBtn.replaceChildren(icon('play'));
    drawAt(+scrub.value);
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      stageFrame.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Persistence
  const saveOpts = debounce(async () => {
    try {
      await api.updateProject(id, { scene: mode, scene_opts: opts });
    } catch (e) {
      console.error('Opslaan mislukt', e);
    }
  }, 400);

  async function setMode(newMode) {
    if (exporting || mode === newMode) return;
    mode = newMode;
    renderSceneCards();
    renderSide();
    await initScene(true);
    saveOpts();
  }

  // Side panel rendering: Options + Export Form
  let expRes = '1080', expFps = 30, exporting = false;
  const progressBox = h('div', { class: 'progress', style: { display: 'none' } }, h('i', { id: 'exp-bar' }));
  const expStatus = h('div', { class: 'hint mono', id: 'exp-status', style: { display: 'none' } });
  const expBtn = h('button', { class: 'btn btn-primary', id: 'start-export-btn', style: { width: '100%' } }, icon('film'), 'Exporteer MP4');
  const exportsListEl = h('div', { style: { display: 'grid', gap: '8px' } });

  function renderSide() {
    side.replaceChildren();
    expBtn.replaceChildren(icon(exportType === 'audio' ? 'wave' : 'film'), exportType === 'audio' ? `Exporteer ${audioFormat.toUpperCase()}` : 'Exporteer MP4');
    expBtn.disabled = !!mixError || !voicePcm.length || (exportType === 'video' && !exportSupported());

    // 1. Scène aanpassen
    const optCard = h('div', { class: 'insp-card' },
      h('h6', {}, '⚙️ Scène-instellingen'),
      h('label', { class: 'field' },
        'Titelbalk tekst (leeg = standaard)',
        h('input', {
          class: 'input',
          placeholder: SCENES[mode].headline,
          value: opts.headline || '',
          oninput: (e) => { opts.headline = e.target.value; initScene(true); saveOpts(); },
        })),
      h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: opts.hud !== false,
          onchange: (e) => { opts.hud = e.target.checked; initScene(true); saveOpts(); },
        }),
        h('span', { class: 'track' }),
        'HUD elementen (radar, raster, data)'),
      h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: opts.sfx !== false,
          onchange: (e) => { opts.sfx = e.target.checked; initScene(true); saveOpts(); },
        }),
        h('span', { class: 'track' }),
        'TV & glitch geluidseffecten'),
      opts.sfx !== false ? h('div', { class: 'slider-row' },
        h('span', {}, 'SFX volume'),
        (() => {
          const r = h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: opts.sfxVolume ?? 0.7,
            oninput: (e) => { opts.sfxVolume = +e.target.value; out.textContent = Math.round(opts.sfxVolume * 100) + '%'; initScene(true); saveOpts(); },
          });
          const out = h('output', {}, Math.round((opts.sfxVolume ?? 0.7) * 100) + '%');
          return [r, out];
        })()) : null,
      h('div', { class: 'slider-row' },
        h('span', {}, 'Opstart-pauze'),
        (() => {
          const r = h('input', {
            type: 'range', min: 0.2, max: 3, step: 0.1, value: opts.preDelay ?? 1,
            oninput: (e) => { opts.preDelay = +e.target.value; out.textContent = opts.preDelay.toFixed(1) + 's'; initScene(false); saveOpts(); },
          });
          const out = h('output', {}, (opts.preDelay ?? 1).toFixed(1) + 's');
          return [r, out];
        })()),
      h('div', { class: 'slider-row' },
        h('span', {}, 'Afsluit-pauze'),
        (() => {
          const r = h('input', {
            type: 'range', min: 0.2, max: 3, step: 0.1, value: opts.postDelay ?? 0.7,
            oninput: (e) => { opts.postDelay = +e.target.value; out.textContent = opts.postDelay.toFixed(1) + 's'; initScene(false); saveOpts(); },
          });
          const out = h('output', {}, (opts.postDelay ?? 0.7).toFixed(1) + 's');
          return [r, out];
        })()),
      mode === 'urgent' ? h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: !!opts.logoBlue,
          onchange: (e) => { opts.logoBlue = e.target.checked; initScene(true); saveOpts(); },
        }),
        h('span', { class: 'track' }),
        'Spion-logo blauw houden') : null,
      mode === 'ai' ? h('label', { class: 'field' },
        'AI assistent label',
        h('input', {
          class: 'input',
          value: opts.aiLabel || defaultSceneOpts().aiLabel,
          oninput: (e) => { opts.aiLabel = e.target.value; initScene(true); saveOpts(); },
        })) : null);

    // 2. Export MP4
    const expCard = h('div', { class: 'insp-card' },
      h('h6', {}, exportType === 'audio' ? 'Exporteer audio' : 'Exporteer video (MP4)'),
      exportType === 'audio' ? h('div', { class: 'field' }, 'Bestandsformaat', h('div', { class: 'seg' },
        ...[['wav', 'WAV · 48 kHz'], ['mp3', 'MP3 · 320 kbps']].map(([key, label]) => h('button', { class: audioFormat === key ? 'on' : '', disabled: exporting, onclick: () => { audioFormat = key; opts.audioFormat = key; renderSide(); saveOpts(); } }, label))),
        h('p', { class: 'hint' }, 'Inclusief stemeffecten en geluiden op je tijdlijn. Geen intro, afsluiting of scenegeluiden.')) : null,
      exportType === 'video' ? h('div', { class: 'field' },
        'Kwaliteit',
        h('div', { class: 'seg' },
          h('button', { class: expRes === '1080' ? 'on' : '', onclick: () => { expRes = '1080'; renderSide(); } }, '1080p Full HD'),
          h('button', { class: expRes === '2160' ? 'on' : '', onclick: () => { expRes = '2160'; renderSide(); } }, '4K Ultra HD'))) : null,
      exportType === 'video' ? h('div', { class: 'field' },
        'Framerate',
        h('div', { class: 'seg' },
          h('button', { class: expFps === 30 ? 'on' : '', onclick: () => { expFps = 30; renderSide(); } }, '30 FPS'),
          h('button', { class: expFps === 60 ? 'on' : '', onclick: () => { expFps = 60; renderSide(); } }, '60 FPS'))) : null,
      progressBox, expStatus, expBtn,
      mixError ? h('div', { class: 'bt-warn' }, 'Audio kon niet worden geladen. Ga terug naar de editor en controleer de bestanden.') : !voicePcm.length ? h('div', { class: 'hint' }, 'Voeg eerst audio aan je tijdlijn toe.') : null,
      exportType === 'video' && !exportSupported() ? h('div', { class: 'bt-warn' }, '⚠️ WebCodecs video-export vereist Chrome of Edge.') : null);

    // 3. Eerdere exports
    const expListCard = h('div', { class: 'insp-card' },
      h('h6', {}, `📦 Opgeslagen exports (${exports.length})`),
      exportsListEl);

    side.append(expCard, ...(exportType === 'video' ? [optCard] : []), expListCard);
    renderExportsList();
  }

  function renderExportsList() {
    exportsListEl.replaceChildren();
    if (!exports.length) {
      exportsListEl.append(h('div', { class: 'hint' }, 'Nog geen exports voor dit project.'));
      return;
    }
    exports.forEach((e) => {
      const item = h('div', { class: 'export-item' },
        h('div', { class: 'vid-ico' }, icon(e.scene === 'audio' ? 'wave' : 'film')),
        h('div', { class: 'info' },
          h('div', { class: 'name' }, e.filename),
          h('div', { class: 'sub' }, `${e.scene === 'audio' ? e.filename.split('.').pop().toUpperCase() + ' · Alleen audio' : `${e.width}×${e.height} · ${e.fps}fps`} · ${fmtTime(e.duration)} · ${fmtSize(e.size)}`)),
        h('a', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Downloaden', href: fileUrl.export(e), download: e.filename }, icon('download')),
        h('button', { class: 'btn btn-ghost btn-sm btn-icon btn-danger', title: 'Verwijderen', onclick: async () => {
          if (await modal({ title: `"${e.filename}" verwijderen?`, confirm: 'Verwijderen', danger: true })) {
            await api.deleteExport(e.id);
            exports = exports.filter((x) => x.id !== e.id);
            renderExportsList();
            toast('Export verwijderd', 'ok');
          }
        } }, icon('trash')));
      exportsListEl.append(item);
    });
  }

  // Export action
  expBtn.onclick = async () => {
    if (exporting) {
      if (exportAbort) exportAbort.abort();
      return;
    }
    if (player.playing) togglePlay();

    exporting = true;
    renderTypeChoices();
    side.querySelectorAll('input, .seg button').forEach((el) => { el.disabled = true; });
    sceneCardsWrap.style.pointerEvents = 'none';
    exportAbort = new AbortController();
    expBtn.classList.add('btn-danger');
    expBtn.replaceChildren(icon('stop'), 'Annuleren');
    progressBox.style.display = 'block';
    expStatus.style.display = 'block';
    const bar = $('#exp-bar');

    const width = expRes === '2160' ? 3840 : 1920;
    const height = expRes === '2160' ? 2160 : 1080;

    try {
      await api.updateProject(id, { scene: mode, scene_opts: opts });
      const res = exportType === 'audio' ? await renderAudioExport({ projectId: id, pcm: voicePcm, format: audioFormat, signal: exportAbort.signal, onProgress: (p, label) => { bar.style.width = Math.round(p * 100) + '%'; expStatus.textContent = label; } }) : await renderExport({
        projectId: id,
        mode,
        opts,
        voice: voicePcm,
        width,
        height,
        fps: expFps,
        signal: exportAbort.signal,
        onProgress: (p, label) => {
          if (bar) bar.style.width = Math.round(p * 100) + '%';
          if (expStatus) expStatus.textContent = label;
        },
      });
      exports.unshift(res);
      renderExportsList();
      toast('Export opgeslagen en klaar om te downloaden.', 'ok', 4000);
    } catch (err) {
      if (err.name === 'AbortError') {
        toast('Export geannuleerd', 'info');
      } else {
        console.error(err);
        toast('Export mislukt: ' + err.message, 'err', 5000);
      }
    } finally {
      exporting = false;
      exportAbort = null;
      expBtn.classList.remove('btn-danger');
      renderTypeChoices(); renderSide(); sceneCardsWrap.style.pointerEvents = '';
      progressBox.style.display = 'none';
      expStatus.style.display = 'none';
    }
  };

  // Init view
  renderSceneCards();
  renderTypeChoices();
  renderSide();
  await initScene(false);

  // Keyboard shortcut (space to toggle play)
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === 'f') { toggleFullscreen(); }
  };
  document.addEventListener('keydown', onKey);

  return () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    player.dispose();
    cancelAnimationFrame(raf);
    if (exportAbort) exportAbort.abort();
  };
}
