// Pure sequence model: image hold times exclude navigation and closing animations.
export const FILE_THEMES = {
  green: { name: 'Hacker · black & green', bg: '#020905', panel: '#06150c', bar: '#113b23', ink: '#a8ffc4', muted: '#65a780', accent: '#56ff91', border: '#25633d', selected: '#164b2b' },
  blue: { name: 'Classic · blue & white', bg: '#000080', panel: '#0000a0', bar: '#c4c4cc', ink: '#ffffff', muted: '#b9c3f2', accent: '#ffffff', border: '#b9c3f2', selected: '#2449cf' },
};

export function normalizeFileOpts(opts = {}) {
  return {
    theme: opts.theme === 'blue' ? 'blue' : 'green',
    pace: Number.isFinite(opts.pace) ? Math.max(0.7, Math.min(1.5, opts.pace)) : 1,
    intro: opts.intro !== false, outro: opts.outro === true, sounds: opts.sounds !== false,
    motionSeed: Number.isFinite(opts.motionSeed) ? opts.motionSeed >>> 0 : 41763,
    volume: Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, opts.volume)) : 0.65,
    username: String(opts.username || 'operator').slice(0, 30),
    title: String(opts.title || 'CLASSIFIED FILE ARCHIVE').slice(0, 70),
    folders: [...new Set([Array.isArray(opts.folders) && opts.folders.includes('Bestanden') ? 'Bestanden' : 'Files', ...(Array.isArray(opts.folders) ? opts.folders.filter((f) => typeof f === 'string').map((f) => f.trim().slice(0, 60)).filter(Boolean) : [])])],
  };
}

export function fileSchedule(images, options = {}) {
  const opts = normalizeFileOpts(options);
  const intro = opts.intro ? 4.6 + images.length * 0.22 : 0;
  let cursor = intro, previous = null;
  const segments = images.map((image, index) => {
    const folder = image.folder || 'Files', folderChanged = previous !== folder;
    const pace = opts.pace;
    const folderArrive = cursor + 0.9 * pace, folderClick = cursor + 1.25 * pace, folderOpen = cursor + 1.45 * pace;
    const fileMove = folderChanged ? folderOpen + 0.18 * pace : cursor + 0.1 * pace;
    const fileArrive = cursor + (folderChanged ? 2.35 : 1.05) * pace;
    const fileClick = fileArrive + 0.35 * pace, fileDoubleClick = fileClick + 0.15 * pace;
    const open = fileDoubleClick + 0.16 * pace;
    const hold = Number.isFinite(image.duration) ? Math.max(0.5, Math.min(60, image.duration)) : 3;
    const close = open + hold, closeArrive = close + 0.7 * pace, closeClick = close + 0.98 * pace;
    const motionSeed = (opts.motionSeed ^ Math.imul(index + 1, 2654435761) ^ Math.imul(Number(image.id) || 0, 2246822519)) >>> 0;
    const segment = { image, folder, folderChanged, motionSeed, start: cursor, folderArrive, folderClick, folderOpen, fileMove, fileArrive, fileClick, fileDoubleClick, open, close, closeArrive, closeClick, end: close + 1.25 * pace, hold, pace };
    cursor = segment.end; previous = folder;
    return segment;
  });
  const terminal = cursor + 1.4 * opts.pace;
  const outro = opts.outro && images.length ? {
    start: cursor, arrive: cursor + 0.85 * opts.pace, click: cursor + 1.2 * opts.pace,
    terminal, logout: terminal + 0.4, loggedOut: terminal + 1.8,
    clear: terminal + 2.6, blank: terminal + 3.5, end: terminal + 4.8,
    motionSeed: opts.motionSeed, pace: opts.pace,
  } : null;
  return { intro, segments, outro, total: outro ? outro.end : cursor + (images.length ? 0.8 : 0) };
}

export const displayFileFolder = (name) => name === 'Bestanden' ? 'Files' : name;

export function sequenceAt(schedule, time) {
  if (time < schedule.intro) return { phase: 'intro', segment: null, elapsed: time };
  if (schedule.outro && time >= schedule.outro.start) return { phase: time >= schedule.outro.blank ? 'blank' : 'outro', segment: null, elapsed: time - schedule.outro.start };
  const segment = schedule.segments.find((s) => time < s.end) || schedule.segments.at(-1);
  if (!segment) return { phase: 'empty', segment: null, elapsed: 0 };
  return { phase: time < segment.open ? 'navigate' : time < segment.close ? 'image' : 'close', segment, elapsed: time - segment.start };
}

// Events are shared by the audio renderer and pointer animation.
export function fileSoundEvents(schedule, opts) {
  const events = [];
  if (schedule.intro) {
    for (let i = 0; i < opts.username.length; i++) events.push({ at: 1 + i * 0.055, kind: 'key' });
    for (let i = 0; i < 8; i++) events.push({ at: 2.1 + i * 0.06, kind: 'key' });
    events.push({ at: 3.05, kind: 'folder' });
  }
  schedule.segments.forEach((s) => {
    if (s.folderChanged) events.push({ at: s.folderClick, kind: 'click' }, { at: s.folderOpen, kind: 'folder' });
    events.push({ at: s.fileClick, kind: 'click' }, { at: s.fileDoubleClick, kind: 'click' }, { at: s.open, kind: 'open' }, { at: s.closeClick, kind: 'click' });
  });
  if (schedule.outro) {
    const o = schedule.outro;
    events.push({ at: o.click, kind: 'click' });
    for (const [at, command] of [[o.logout, 'logout'], [o.clear, 'clear']]) {
      for (let i = 0; i < command.length; i++) events.push({ at: at + i * 0.075, kind: 'key' });
      events.push({ at: at + command.length * 0.075 + 0.12, kind: 'key' });
    }
  }
  return events;
}

export function fileSoundtrack(schedule, options = {}, sampleRate = 48000) {
  const opts = normalizeFileOpts(options);
  const pcm = new Float32Array(Math.ceil(schedule.total * sampleRate));
  if (!opts.sounds || !opts.volume) return pcm;
  let seed = 921;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (const event of fileSoundEvents(schedule, opts)) {
    const mechanical = event.kind === 'click' || event.kind === 'key';
    const seconds = mechanical ? 0.075 : 0.14, length = Math.ceil(seconds * sampleRate);
    const offset = Math.round(event.at * sampleRate);
    let low = 0;
    for (let i = 0; i < length && offset + i < pcm.length; i++) {
      const t = i / sampleRate;
      const n = noise(); low += 0.22 * (n - low);
      // Damped plastic switch resonances and two separate press/release transients.
      const press = Math.exp(-t * (event.kind === 'key' ? 300 : 230));
      const releaseT = t - 0.023, release = releaseT >= 0 ? Math.exp(-releaseT * 330) : 0;
      const value = mechanical
        ? (low * 0.85 + Math.sin(t * Math.PI * 2 * 1900) * 0.23) * press + low * release * 0.48
        : (Math.sin(t * Math.PI * 2 * (event.kind === 'open' ? 700 : 460)) * 0.32 + low * 0.16) * Math.sin(Math.min(1, t / 0.005) * Math.PI / 2) * Math.exp(-t * 45);
      pcm[offset + i] += value * opts.volume * (event.kind === 'key' ? 0.28 : 0.55);
    }
  }
  return pcm;
}
