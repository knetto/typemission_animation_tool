import { h, icon, toast, modal, fmtTime, fmtSize } from '../util.js';
import { api, fileUrl } from '../api.js';
import { Player } from '../audio/engine.js';
import { normalizeFileOpts, fileSchedule, sequenceAt, displayFileFolder, FILE_THEMES } from '../files/model.js';
import { createFileScene } from '../files/renderer.js';
import { renderCanvasExport, renderAudioExport, exportSupported } from '../export.js';
import { initEditorPanels } from '../editor-panels.js';

export async function mount(root, { id, project, exportingView = false }) {
  project ||= await api.project(id);
  let images = project.images || [], opts = normalizeFileOpts(project.file_opts), exports = project.exports || [];
  if (!project.file_opts?.folders && images.some((i) => i.folder === 'Bestanden')) opts.folders = ['Bestanden'];
  let folder = opts.folders[0], selected = images[0]?.id, scene = null, sceneVersion = 0, destroyed = false, raf = 0, rebuildTimer = 0, currentImage = null;
  let exporting = false, exportAbort = null, quality = '1080', fps = 30, exportType = 'video', audioFormat = 'wav', uploading = false;
  const player = new Player();
  const status = h('span', { class: 'save-state', role: 'status' }, 'Saved');
  const title = h('input', { class: 'ed-title', value: project.name, 'aria-label': 'Project name', maxlength: 120 });
  let saveQueue = Promise.resolve();
  const pendingEdits = new Set();
  function trackEdit(task) { pendingEdits.add(task); task.finally(() => pendingEdits.delete(task)).catch(() => {}); return task; }
  function persist() {
    const payload = { file_opts: structuredClone(opts), duration: fileSchedule(images, opts).total, name: title.value.trim() || 'Untitled' };
    status.textContent = 'Saving…';
    const task = saveQueue.catch(() => {}).then(() => api.updateProject(id, payload));
    saveQueue = task;
    task.then(() => { if (saveQueue === task && !destroyed) status.textContent = 'Saved'; }, (e) => { status.textContent = 'Could not save'; toast(e.message, 'err'); });
    return task;
  }
  title.addEventListener('change', persist);
  async function goToExport(e) { e.preventDefault(); try { await Promise.all([...pendingEdits]); await persist(); location.hash = `#/project/${id}/export`; } catch (error) { toast('Could not save: ' + error.message, 'err'); } }
  const exportLink = h('a', { class: 'btn btn-primary', id: 'to-scene-btn', href: `#/project/${id}/export`, onclick: goToExport }, icon('download'), 'Export');
  const header = h('div', { class: 'ed-head' },
    h('a', { class: 'btn btn-ghost btn-icon', href: exportingView ? `#/project/${id}` : '#/', title: exportingView ? 'Back to files' : 'Back to projects' }, icon('back')),
    title, status, h('div', { class: 'spacer' }),
    h('nav', { class: 'steps' }, h('a', { class: exportingView ? '' : 'on', href: `#/project/${id}` }, '1 · Files'), h('span', {}, '›'), h('a', { class: exportingView ? 'on' : '', href: `#/project/${id}/export`, onclick: goToExport }, '2 · Export')),
    exportingView ? null : exportLink);

  const folderList = h('div', { class: 'file-folder-list' });
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, id: 'image-upload' });
  const addFolder = h('button', { class: 'btn btn-sm', id: 'new-image-folder', onclick: async () => {
    const name = await modal({ title: 'New folder', input: { placeholder: 'e.g. Evidence' }, confirm: 'Create', cancel: 'Cancel' });
    if (!name?.trim()) return;
    folder = name.trim().slice(0, 60); opts.folders = [...new Set([...opts.folders, folder])]; await persist(); paintFiles(); changedPreview();
  } }, icon('folderPlus'), 'New folder');
  const left = h('aside', { class: 'panel media-panel file-folders', 'aria-label': 'Image folders' },
    h('div', { class: 'panel-heading' }, icon('folder'), 'File Terminal'), h('div', { class: 'panel-body' },
      h('p', { class: 'hint' }, 'Create folders and add images. The export navigates through them automatically.'), addFolder, folderList,
      h('div', { class: 'file-library-help' }, 'JPG, PNG and WebP', h('br'), 'Max. 30 MB per image')), input);

  const grid = h('div', { class: 'file-image-grid' });
  const path = h('b', { class: 'file-path' });
  const uploadBtn = h('button', { class: 'btn btn-sm btn-primary', id: 'upload-images-btn', onclick: () => input.click() }, icon('upload'), 'Add images');
  const explorer = h('section', { class: 'file-explorer', 'aria-label': 'File explorer' },
    h('div', { class: 'file-explorer-head' }, path, uploadBtn), grid,
    h('div', { class: 'file-drop-hint' }, 'Drop images here to add them to this folder.'));
  explorer.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); explorer.classList.add('drag-over'); } });
  explorer.addEventListener('dragleave', (e) => { if (!explorer.contains(e.relatedTarget)) explorer.classList.remove('drag-over'); });
  explorer.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); explorer.classList.remove('drag-over'); trackEdit(upload(e.dataTransfer.files)); });
  input.addEventListener('change', () => { trackEdit(upload(input.files)); input.value = ''; });

  const canvas = h('canvas', { width: 1920, height: 1080, id: 'file-canvas', 'aria-label': 'File Terminal video preview' });
  const play = h('button', { class: 'btn btn-sm', id: 'file-play-btn', onclick: togglePlay }, icon('play'), 'Play preview');
  const scrub = h('input', { type: 'range', min: 0, max: 0, step: 0.02, value: 0, 'aria-label': 'Playback position', id: 'file-scrub' });
  const time = h('span', { class: 'mono' }, '0:00 / 0:00');
  const timeline = h('div', { class: 'file-playback-timeline', 'aria-label': 'Image timestamps' });
  const timelineTrack = h('div', { class: 'file-timeline-track' });
  timeline.append(timelineTrack);
  const currentLabel = h('span', { id: 'file-current-image' }, 'No images yet');
  const renameCurrent = h('button', { class: 'btn btn-sm btn-ghost file-rename-current', title: 'Rename current file', disabled: true, onclick: () => { if (currentImage) renameFile(currentImage); } }, icon('edit'), 'Rename');
  const sequence = h('div', { class: 'file-sequence-list' });
  const sequenceSummary = h('span', { class: 'hint' });
  const preview = h('section', { class: 'file-preview-section' },
    h('div', { class: 'file-section-heading' }, h('b', {}, exportingView ? 'Export preview' : 'Live preview'), h('span', { class: 'hint' }, 'Navigation + viewing time + sound')),
    h('div', { class: 'stage-frame file-stage-frame' }, canvas),
    h('div', { class: 'file-preview-controls' }, play, scrub, time), timeline,
    h('div', { class: 'file-playback-summary' }, currentLabel, exportingView ? null : renameCurrent));
  const center = h('section', { class: 'center file-work-center' }, exportingView ? null : explorer, preview,
    exportingView ? null : h('section', { class: 'file-sequence' }, h('div', { class: 'file-section-heading' }, h('b', {}, 'Playback order'), sequenceSummary), h('p', { class: 'hint' }, 'Drag to reorder or use the arrows. Viewing time excludes opening and closing.'), sequence));
  const settings = h('div', { class: 'panel-body', id: 'file-settings' });
  const right = h('aside', { class: 'panel right file-settings-panel', 'aria-label': 'File Terminal settings' }, h('div', { class: 'panel-heading' }, icon('edit'), exportingView ? 'Export' : 'Settings'), settings);
  const layout = h('div', { class: exportingView ? 'file-export-layout' : 'ed-body file-editor-body' }, ...(exportingView ? [center, right] : [left, center, right]));
  root.append(h('div', { class: 'editor file-editor' }, header, layout));
  const disposePanels = exportingView ? () => {} : initEditorPanels(layout, left, center, right, { language: 'en' });
  const expButton = h('button', { class: 'btn btn-primary', id: 'start-export-btn', onclick: startExport });
  const expStatus = h('div', { class: 'hint mono', id: 'exp-status', role: 'status', hidden: true });
  const expProgress = h('progress', { max: 1, value: 0, class: 'file-export-progress', hidden: true });

  function allFolders() { return [...new Set([...opts.folders, ...images.map((i) => i.folder)])]; }
  function paintFiles() {
    path.textContent = `ARCHIVE / ${displayFileFolder(folder)}`;
    folderList.replaceChildren(...allFolders().map((f) => h('button', { class: `file-folder${folder === f ? ' on' : ''}`, 'aria-pressed': String(folder === f), 'data-folder': f, onclick: () => { folder = f; paintFiles(); } }, icon('folder'), h('span', {}, displayFileFolder(f)), h('small', {}, images.filter((i) => i.folder === f).length))));
    const filtered = images.filter((i) => i.folder === folder);
    grid.replaceChildren(...filtered.map((image) => h('button', { class: `file-image${selected === image.id ? ' on' : ''}`, 'data-image-id': image.id, 'aria-pressed': String(selected === image.id), onclick: () => select(image.id), ondblclick: () => showImage(image) },
      h('img', { src: fileUrl.image(image), alt: '', loading: 'lazy' }), h('b', {}, image.name), h('span', {}, `${image.duration.toFixed(1)}s · #${images.indexOf(image) + 1}`))));
    if (!filtered.length) grid.append(h('div', { class: 'file-empty' }, icon('folderPlus'), h('h3', {}, 'This folder is empty'), h('p', {}, 'Add images. Each image opens for 3 seconds by default.'), h('button', { class: 'btn', onclick: () => input.click() }, icon('plus'), 'Choose images')));
    paintSequence();
  }
  function select(imageId) { selected = imageId; stop(); const segment = scene?.schedule.segments.find((s) => s.image.id === imageId); if (segment) draw(segment.open + 0.05); paintFiles(); paintSettings(); }
  function showImage(image) {
    const dialog = h('dialog', { class: 'file-image-dialog', 'aria-label': image.name }, h('div', { class: 'file-section-heading' }, h('b', {}, image.name), h('button', { class: 'btn btn-icon', title: 'Close', onclick: () => dialog.close() }, '×')), h('img', { src: fileUrl.image(image), alt: image.name }));
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog); dialog.showModal();
  }
  function paintSequence() {
    const schedule = fileSchedule(images, opts);
    sequenceSummary.textContent = `${images.length} images · ${fmtTime(schedule.total, true)} total`;
    sequence.replaceChildren(...images.map((image, index) => h('div', { class: `file-sequence-item${selected === image.id ? ' on' : ''}`, draggable: true, 'data-sequence-id': image.id,
      ondragstart: (e) => { e.dataTransfer.setData('application/x-file-sequence', String(image.id)); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('application/x-file-sequence')) e.preventDefault(); },
      ondrop: (e) => { const moved = Number(e.dataTransfer.getData('application/x-file-sequence')); if (!moved) return; e.preventDefault(); trackEdit(moveImage(moved, index)); }
    }, h('span', { class: 'mono file-sequence-number' }, String(index + 1).padStart(2, '0')),
      h('button', { class: 'file-sequence-select', onclick: () => { folder = image.folder; select(image.id); } }, h('img', { src: fileUrl.image(image), alt: '', loading: 'lazy' }), h('span', {}, h('b', {}, image.name), h('small', {}, `${displayFileFolder(image.folder)} · ${image.duration.toFixed(1)}s · opens ${fmtTime(schedule.segments[index].open, true)}`))),
      h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Rename file', 'aria-label': `Rename ${image.name}`, onclick: () => renameFile(image) }, icon('edit')),
      h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Move earlier', disabled: index === 0, onclick: () => trackEdit(moveImage(image.id, index - 1)) }, '↑'),
      h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Move later', disabled: index === images.length - 1, onclick: () => trackEdit(moveImage(image.id, index + 1)) }, '↓'))));
    if (!images.length) sequence.append(h('p', { class: 'hint' }, 'Your images appear here in their export order.'));
    paintTimeline(schedule);
  }
  function paintTimeline(schedule = fileSchedule(images, opts)) {
    timelineTrack.replaceChildren();
    timeline.hidden = !images.length;
    timelineTrack.style.minWidth = Math.max(0, images.length * 150 + (schedule.intro ? 100 : 0) + (schedule.outro ? 150 : 0)) + 'px';
    const percent = (t) => (t / (schedule.total || 1)) * 100 + '%';
    const marker = (label, start, end, content, onclick, extra = {}) => h('button', { class: 'file-time-marker', type: 'button', title: label, 'aria-label': label,
      style: { left: percent(start), width: percent(end - start) }, onclick, ...extra }, content);
    if (schedule.intro) timelineTrack.append(marker(`Login intro · ${fmtTime(0, true)}–${fmtTime(schedule.intro, true)}`, 0, schedule.intro,
      [h('small', { class: 'mono' }, '0:00.0'), h('b', {}, 'Login intro')], () => { stop(); draw(0); }, { class: 'file-time-marker file-time-intro' }));
    schedule.segments.forEach((s, index) => {
      const range = `${fmtTime(s.open, true)}–${fmtTime(s.closeClick, true)}`;
      timelineTrack.append(marker(`${s.image.name} · ${range} · viewing time ${s.hold.toFixed(1)}s`, s.start, s.end,
        [h('i', { class: 'file-time-visible', style: { left: ((s.open - s.start) / (s.end - s.start)) * 100 + '%', width: ((s.closeClick - s.open) / (s.end - s.start)) * 100 + '%' } }),
          h('small', { class: 'mono' }, fmtTime(s.open, true)), h('b', {}, `${index + 1}. ${s.image.name}`)],
        () => { stop(); selected = s.image.id; folder = s.folder; draw(s.open); if (!exportingView) { paintFiles(); paintSettings(); } }, { 'data-timeline-image': s.image.id, 'data-start': s.open.toFixed(3), 'data-end': s.closeClick.toFixed(3) }));
    });
    if (schedule.outro) timelineTrack.append(marker(`Logout outro · ${fmtTime(schedule.outro.start, true)}–${fmtTime(schedule.outro.end, true)}`, schedule.outro.start, schedule.outro.end,
      [h('small', { class: 'mono' }, fmtTime(schedule.outro.start, true)), h('b', {}, 'Logout outro')], () => { stop(); draw(schedule.outro.start); }, { class: 'file-time-marker file-time-intro', 'data-timeline-outro': '' }));
    const playhead = h('i', { class: 'file-time-playhead', style: { left: percent(+scrub.value) } });
    timelineTrack.append(playhead);
    if (scene) draw(+scrub.value);
  }
  async function renameFile(image) {
    const name = await modal({ title: 'Rename file', body: 'This name appears in the explorer, login intro and exported sequence.', input: { value: image.name }, confirm: 'Save name', cancel: 'Cancel' });
    if (!name?.trim() || name.trim() === image.name) return;
    trackEdit((async () => {
      try {
        const updated = await api.updateImage(image.id, { name: name.trim() }); images = images.map((i) => i.id === image.id ? updated : i);
        await persist(); paintFiles(); paintSettings(); await rebuild(true); toast('File renamed', 'ok');
      } catch (e) { toast('Could not rename file: ' + e.message, 'err'); }
    })());
  }
  async function moveImage(imageId, index) {
    if (exporting) return;
    const reordered = [...images]; const [item] = reordered.splice(reordered.findIndex((i) => i.id === imageId), 1); if (!item) return;
    reordered.splice(index, 0, item);
    try { await api.orderImages(id, reordered.map((i) => i.id)); images = reordered; paintFiles(); changedPreview(); } catch (e) { toast(e.message, 'err'); }
  }
  async function upload(files) {
    if (uploading) return;
    const valid = [...files].filter((f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.type));
    if (!valid.length) return toast('Choose JPG, PNG or WebP images.', 'err');
    if (valid.length > 50 || valid.some((f) => f.size > 30 * 1024 * 1024)) return toast('Upload up to 50 images at a time, each up to 30 MB.', 'err');
    uploading = true; uploadBtn.disabled = true; const uploadFolder = folder; status.textContent = 'Uploading images…';
    try {
      // Decode before uploading so corrupt files never enter an export sequence.
      for (const file of valid) { const bitmap = await createImageBitmap(file); bitmap.close(); }
      const added = await api.uploadImages(id, valid, uploadFolder);
      images.push(...added); selected = added[0]?.id ?? selected; folder = uploadFolder;
      await persist(); paintFiles(); paintSettings(); await rebuild(); toast(`${added.length} images added`, 'ok');
    } catch (e) { toast('Upload failed: ' + e.message, 'err'); }
    finally { uploading = false; uploadBtn.disabled = false; }
  }
  function optionChanged() { persist(); paintSequence(); changedPreview(); }
  const toggle = (label, key, idAttr) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: idAttr, checked: opts[key], disabled: exporting, onchange: (e) => { opts[key] = e.target.checked; optionChanged(); paintSettings(); } }), h('span', { class: 'track' }), label);
  function paintSettings() {
    settings.replaceChildren();
    const themes = h('div', { class: 'file-theme-choices', role: 'group', 'aria-label': 'Terminal theme' }, ...Object.entries(FILE_THEMES).map(([key, theme]) => h('button', { class: `file-theme-choice ${key}${opts.theme === key ? ' on' : ''}`, 'data-theme': key, 'aria-pressed': String(opts.theme === key), disabled: exporting, onclick: () => { opts.theme = key; optionChanged(); paintSettings(); } }, h('span', { class: 'file-theme-swatch' }, '>_'), h('b', {}, key === 'green' ? 'Hacker' : 'Classic'), h('small', {}, key === 'green' ? 'Black & green' : 'Blue & white'))));
    const styleCard = h('div', { class: 'insp-card' }, h('h6', {}, 'Terminal style'), themes,
      h('label', { class: 'field' }, 'Navigation pace', h('select', { class: 'select', id: 'file-navigation-pace', disabled: exporting, onchange: (e) => { opts.pace = +e.target.value; optionChanged(); } },
        ...[[0.8, 'Brisk'], [1, 'Relaxed (default)'], [1.3, 'Extra relaxed']].map(([value, label]) => h('option', { value, selected: value === opts.pace }, label)))),
      h('button', { class: 'btn btn-sm', id: 'file-shuffle-mouse', disabled: exporting, onclick: () => {
        opts.motionSeed = crypto.getRandomValues(new Uint32Array(1))[0]; optionChanged();
      } }, 'Shuffle mouse paths'), h('p', { class: 'hint' }, 'Natural curves and varied movement on every gesture. Shuffle to create a new set of paths.'),
      h('label', { class: 'field' }, 'Explorer title', h('input', { class: 'input', value: opts.title, maxlength: 70, disabled: exporting, onchange: (e) => { opts.title = e.target.value || 'CLASSIFIED FILE ARCHIVE'; optionChanged(); } })),
      toggle('Show login intro', 'intro', 'file-intro'), h('p', { class: 'hint' }, 'System Login → username → masked password → file list → explorer.'),
      opts.intro ? h('label', { class: 'field' }, 'Intro username', h('input', { class: 'input', id: 'file-username', maxlength: 30, value: opts.username, disabled: exporting, onchange: (e) => { opts.username = e.target.value || 'operator'; optionChanged(); } })) : null,
      toggle('Show logout outro', 'outro', 'file-outro'), h('p', { class: 'hint' }, 'Close the image and explorer, log out, then finish on an empty black terminal.'),
      toggle('Navigation sounds', 'sounds', 'file-sounds'), h('p', { class: 'hint' }, 'Subtle mouse clicks, typing, and folder and file opening sounds.'),
      opts.sounds ? h('label', { class: 'field' }, 'Volume', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: opts.volume, disabled: exporting, 'aria-label': 'Navigation sound volume', onchange: (e) => { opts.volume = +e.target.value; optionChanged(); } })) : null);
    settings.append(styleCard);
    if (!exportingView) {
      const image = images.find((i) => i.id === selected);
      const imageCard = h('div', { class: 'insp-card file-selected-settings' }, h('h6', {}, 'Selected image'));
      if (image) {
        const update = (data) => trackEdit((async () => {
          try { const updated = await api.updateImage(image.id, data); images = images.map((i) => i.id === image.id ? updated : i); if (data.folder) folder = updated.folder; await persist(); paintFiles(); paintSettings(); changedPreview(); } catch (e) { toast(e.message, 'err'); paintSettings(); throw e; }
        })());
        imageCard.append(h('img', { class: 'file-selected-thumb', src: fileUrl.image(image), alt: image.name, onclick: () => showImage(image) }),
          h('label', { class: 'field' }, 'File name', h('input', { class: 'input', value: image.name, maxlength: 160, onchange: (e) => update({ name: e.target.value }) })),
          h('label', { class: 'field' }, 'Viewing time (seconds)', h('input', { class: 'input', type: 'number', min: 0.5, max: 60, step: 0.5, value: image.duration, id: 'image-duration', onchange: (e) => update({ duration: +e.target.value }) })),
          h('p', { class: 'hint' }, 'Default: 3 seconds. The full image stays visible; opening and closing take extra time.'),
          h('label', { class: 'field' }, 'Folder', h('select', { class: 'select', id: 'image-folder-select', onchange: (e) => update({ folder: e.target.value }) }, ...allFolders().map((f) => h('option', { value: f, selected: image.folder === f }, displayFileFolder(f))))),
          h('button', { class: 'btn btn-sm', onclick: () => showImage(image) }, icon('full'), 'View image'),
          h('button', { class: 'btn btn-sm btn-ghost btn-danger', onclick: async () => {
            if (!await modal({ title: `Delete "${image.name}"?`, confirm: 'Delete', cancel: 'Cancel', danger: true })) return;
            try { await api.deleteImage(image.id); images = images.filter((i) => i.id !== image.id); selected = images[0]?.id; await persist(); paintFiles(); paintSettings(); changedPreview(); } catch (e) { toast(e.message, 'err'); }
          } }, icon('trash'), 'Delete'));
      } else imageCard.append(h('p', { class: 'hint' }, 'Select an image to adjust its viewing time and folder.'));
      settings.append(imageCard);
    } else paintExportSettings();
  }
  function paintExportSettings() {
    expButton.disabled = !images.length || !scene || (exportType === 'video' && !exportSupported());
    expButton.replaceChildren(icon(exporting ? 'stop' : 'download'), exporting ? 'Cancel' : exportType === 'video' ? 'Export MP4' : `Export ${audioFormat.toUpperCase()}`);
    settings.prepend(h('div', { class: 'insp-card' }, h('h6', {}, 'Export file'),
      h('div', { class: 'seg' }, ...[['video', 'Video with explorer'], ['audio', 'Sound only']].map(([key, label]) => h('button', { class: exportType === key ? 'on' : '', disabled: exporting, 'data-export-type': key, onclick: () => { exportType = key; paintSettings(); } }, label))),
      exportType === 'video' ? h('label', { class: 'field' }, 'Quality', h('select', { class: 'select', id: 'file-quality', disabled: exporting, onchange: (e) => { quality = e.target.value; } }, ...[['1080', '1080p Full HD'], ['2160', '4K Ultra HD']].map(([value, label]) => h('option', { value, selected: value === quality }, label)))) :
        h('label', { class: 'field' }, 'File format', h('select', { class: 'select', disabled: exporting, onchange: (e) => { audioFormat = e.target.value; paintSettings(); } }, ...['wav', 'mp3'].map((key) => h('option', { value: key, selected: key === audioFormat }, key.toUpperCase())))),
      exportType === 'video' ? h('label', { class: 'field' }, 'Framerate', h('select', { class: 'select', id: 'file-fps', disabled: exporting, onchange: (e) => { fps = +e.target.value; } }, ...[30, 60].map((value) => h('option', { value, selected: value === fps }, `${value} FPS`)))) : h('p', { class: 'hint' }, 'Only the navigation sounds from this sequence, without video.'),
      h('p', { class: 'hint', id: 'file-export-summary' }, `${images.length} images · ${fmtTime(fileSchedule(images, opts).total, true)}`), expProgress, expStatus, expButton,
      !images.length ? h('p', { class: 'hint' }, 'Add images in the editor first.') : null,
      exportType === 'video' && !exportSupported() ? h('p', { class: 'bt-warn' }, 'Video export requires Chrome or Edge.') : null));
    const list = h('div', { class: 'insp-card' }, h('h6', {}, `Saved exports (${exports.length})`));
    if (!exports.length) list.append(h('p', { class: 'hint' }, 'Your exports appear here with download links.'));
    exports.forEach((exp) => list.append(h('div', { class: 'export-item' },
      h('div', { class: 'info' }, h('div', { class: 'name' }, exp.filename), h('div', { class: 'sub' }, `${exp.scene === 'audio' ? exp.filename.split('.').pop().toUpperCase() : exp.height + 'p · ' + exp.fps + ' FPS'} · ${fmtTime(exp.duration)} · ${fmtSize(exp.size)}`)),
      h('a', { class: 'btn btn-icon btn-sm', href: fileUrl.export(exp), download: exp.filename, title: 'Download' }, icon('download')),
      h('button', { class: 'btn btn-icon btn-sm btn-ghost btn-danger', title: 'Delete export', disabled: exporting, onclick: async () => {
        if (!await modal({ title: 'Delete export?', confirm: 'Delete', cancel: 'Cancel', danger: true })) return;
        await api.deleteExport(exp.id); exports = exports.filter((e) => e.id !== exp.id); paintSettings();
      } }, icon('trash')))));
    settings.append(list);
  }
  function stop() { player.pause(); cancelAnimationFrame(raf); play.replaceChildren(icon('play'), 'Play preview'); }
  function draw(t) {
    if (!scene) return;
    t = Math.max(0, Math.min(scene.schedule.total, t)); scene.draw(t); scrub.value = t;
    time.textContent = `${fmtTime(t, true)} / ${fmtTime(scene.schedule.total, true)}`;
    const state = sequenceAt(scene.schedule, t);
    currentImage = state.segment?.image || null;
    const finished = t >= (scene.schedule.segments.at(-1)?.end ?? Infinity);
    currentLabel.textContent = state.phase === 'intro' ? 'Login intro' : state.phase === 'blank' ? 'Empty terminal' : state.phase === 'outro' ? 'Logging out' : finished ? 'Sequence complete' : currentImage ? `${state.phase === 'navigate' ? 'Opening' : state.phase === 'close' ? 'Closing' : 'Viewing'}: ${displayFileFolder(currentImage.folder)} / ${currentImage.name}` : 'No images yet';
    renameCurrent.disabled = !currentImage || exporting;
    scrub.setAttribute('aria-valuetext', `${fmtTime(t, true)} · ${currentLabel.textContent}`);
    const playhead = timelineTrack.querySelector('.file-time-playhead');
    if (playhead) playhead.style.left = (t / (scene.schedule.total || 1)) * 100 + '%';
    timelineTrack.querySelectorAll('[data-timeline-image]').forEach((el) => {
      const active = Number(el.dataset.timelineImage) === currentImage?.id && !finished;
      el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
    const outroMarker = timelineTrack.querySelector('[data-timeline-outro]');
    if (outroMarker) {
      const active = state.phase === 'outro' || state.phase === 'blank';
      outroMarker.classList.toggle('active', active);
      if (active) outroMarker.setAttribute('aria-current', 'true'); else outroMarker.removeAttribute('aria-current');
    }
  }
  async function togglePlay() {
    if (player.playing) return stop();
    if (!scene || !images.length) return;
    try {
      await player.play(+scrub.value >= scene.schedule.total - 0.05 ? 0 : +scrub.value);
      play.replaceChildren(icon('pause'), 'Pause');
      const loop = () => { if (destroyed) return; draw(player.time); if (player.playing) raf = requestAnimationFrame(loop); else stop(); };
      raf = requestAnimationFrame(loop);
    } catch (e) { toast('Could not start preview: ' + e.message, 'err'); }
  }
  scrub.addEventListener('input', () => { stop(); draw(+scrub.value); });
  async function rebuild(keepTime = false) {
    clearTimeout(rebuildTimer); const version = ++sceneVersion; stop();
    const previousTime = keepTime ? +scrub.value : 0;
    if (exportingView) expButton.disabled = true;
    try {
      const next = await createFileScene(canvas, [...images], structuredClone(opts));
      if (destroyed || version !== sceneVersion) { next.dispose(); return; }
      scene?.dispose(); scene = next; player.load(scene.soundtrack); scrub.max = scene.schedule.total; paintTimeline(scene.schedule); draw(previousTime);
      play.disabled = !images.length; if (exportingView) paintSettings();
    } catch (e) { if (version === sceneVersion && !destroyed) { scene?.dispose(); scene = null; play.disabled = true; expButton.disabled = true; toast('Preview failed: ' + e.message, 'err'); } }
  }
  function changedPreview() { stop(); play.disabled = true; if (exportingView) expButton.disabled = true; clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 100); }
  async function startExport() {
    if (exporting) return exportAbort?.abort();
    if (!images.length || !scene) return;
    stop(); exporting = true; exportAbort = new AbortController(); paintSettings(); expProgress.hidden = false; expStatus.hidden = false;
    const snapshot = { images: structuredClone(images), opts: structuredClone(opts) };
    const onProgress = (p, label) => { expProgress.value = p; expStatus.textContent = label; };
    let rendered;
    try {
      await persist();
      onProgress(0, 'Preparing images…');
      const output = document.createElement('canvas'); output.width = quality === '2160' ? 3840 : 1920; output.height = quality === '2160' ? 2160 : 1080;
      rendered = await createFileScene(output, snapshot.images, snapshot.opts);
      const result = exportType === 'audio'
        ? await renderAudioExport({ projectId: id, pcm: rendered.soundtrack, format: audioFormat, signal: exportAbort.signal, onProgress })
        : await renderCanvasExport({ projectId: id, canvas: output, scene: rendered, soundtrack: rendered.soundtrack, duration: rendered.schedule.total, width: output.width, height: output.height, fps, signal: exportAbort.signal, onProgress });
      exports.unshift(result); toast('Export saved and ready to download.', 'ok');
    } catch (e) { toast(e.name === 'AbortError' ? 'Export cancelled' : 'Export failed: ' + e.message, e.name === 'AbortError' ? 'info' : 'err'); }
    finally { rendered?.dispose(); exporting = false; exportAbort = null; expStatus.hidden = true; expProgress.hidden = true; if (!destroyed) paintSettings(); }
  }
  const onKey = (e) => { if (e.target.closest('input, select, textarea, button, dialog')) return; if (e.code === 'Space') { e.preventDefault(); togglePlay(); } };
  document.addEventListener('keydown', onKey);
  paintFiles(); paintSettings(); await rebuild();
  return () => { destroyed = true; ++sceneVersion; stop(); clearTimeout(rebuildTimer); scene?.dispose(); exportAbort?.abort(); disposePanels(); document.removeEventListener('keydown', onKey); document.querySelectorAll('.file-image-dialog').forEach((d) => d.remove()); player.dispose(); };
}
