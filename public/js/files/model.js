// Pure sequence model: item hold times exclude navigation and closing animations.
// Supports 3 File Terminal variants: 'images', 'login_log', and 'email'.
export const FILE_THEMES = {
  green: { name: 'Hacker · black & green', bg: '#020905', panel: '#06150c', bar: '#113b23', ink: '#a8ffc4', muted: '#65a780', accent: '#56ff91', border: '#25633d', selected: '#164b2b', warn: '#ff6b6b', warnBg: '#3a0d12' },
  blue: { name: 'Classic · blue & white', bg: '#000080', panel: '#0000a0', bar: '#c4c4cc', ink: '#ffffff', muted: '#b9c3f2', accent: '#ffffff', border: '#b9c3f2', selected: '#2449cf', warn: '#ffdf6b', warnBg: '#5a1830' },
};

export const FILE_VARIANTS = {
  images: {
    id: 'images',
    name: 'Afbeeldingen',
    short: 'Afbeeldingen',
    desc: 'Inlog → File Explorer → Open afbeeldingen',
    icon: 'folder',
  },
  login_log: {
    id: 'login_log',
    name: 'Inlog Log',
    short: 'Inlog Log',
    desc: 'Inlog → File Explorer → Open inlog-/systeemlogboek',
    icon: 'log',
  },
  email: {
    id: 'email',
    name: 'E-mail',
    short: 'E-mail',
    desc: 'Inlog → File Explorer → Open onderschepte e-mail',
    icon: 'mail',
  },
};

export function defaultLogItem(index = 1) {
  return {
    id: 1000 + index,
    kind: 'login_log',
    name: index === 1 ? 'auth_access_log.txt' : `security_log_0${index}.txt`,
    folder: 'Logs',
    duration: 5,
    node: 'NODE: HQ-GATEWAY-04',
    alert: 'SECURITY ALERT: UNAUTHORIZED ACCESS LOGIN DETECTED',
    entriesText: [
      '2026-10-20 02:11:04 | operator_01 | 10.14.0.22     | TERMINAL_AUTH       | GRANTED',
      '2026-10-20 02:28:41 | operator_02 | 10.14.0.31     | ARCHIVE_READ        | GRANTED',
      '2026-10-20 02:44:19 | sys_backup  | 10.14.0.05     | ARCHIVE_SYNC        | GRANTED',
      '2026-10-20 03:02:15 | operator_01 | 10.14.0.22     | SESSION_VERIFY      | GRANTED',
      '2026-10-20 03:11:08 | unknown     | 185.220.101.47 | UNAUTHORIZED_ACCESS | UNAUTHORIZED',
    ].join('\n'),
  };
}

const SCRAMBLE_GLYPHS = '▓▒░█#@$%&*?!§¤¥±∆0123456789XKVZQWJPMLR';

export function scrambleText(input = '', tick = 0, seed = 17) {
  const s = String(input ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      out += ch;
      continue;
    }
    const hBase = (Math.imul(i + 1, 2654435761) ^ Math.imul(s.charCodeAt(i), 2246822519) ^ Math.imul(seed + 1, 374761393)) >>> 0;
    // Roughly 25% of characters actively cycle each tick to create a live encrypted/scrambled look
    const changes = (hBase % 4) === 0;
    const h = changes ? ((hBase ^ Math.imul(tick + 1, 668265263)) >>> 0) : hBase;
    out += SCRAMBLE_GLYPHS[h % SCRAMBLE_GLYPHS.length];
  }
  return out;
}

export function defaultEmailItem(index = 1) {
  return {
    id: 2000 + index,
    kind: 'email',
    name: index === 1 ? 'email_bericht.eml' : `email_0${index}.eml`,
    folder: 'Inbox',
    duration: 6,
    scrambled: true,
    from: 'unknown@transmission.local',
    to: 'agent@transmission.local',
    date: '20 OKT 2026 · 03:11',
    subject: 'Bericht',
    badge: '',
    attachment: '',
    body: [
      'Beste agent,',
      '',
      'Alle gegevens voor deze missie zijn verstuurd naar het archief.',
      'Controleer de bestanden en volg de instructies op het scherm om verder te gaan.',
      '',
      'Met vriendelijke groet,',
      'Hoofdkwartier',
    ].join('\n'),
  };
}

export function parseLogEntries(entriesText = '') {
  return String(entriesText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes('|')) {
        const parts = line.split('|').map((p) => p.trim());
        return {
          time: parts[0] || '',
          user: parts[1] || '-',
          ip: parts[2] || '-',
          action: parts[3] || '-',
          status: (parts[4] || 'INFO').toUpperCase(),
          raw: null,
        };
      }
      return {
        time: '',
        user: '',
        ip: '',
        action: line,
        status: /unauth|breach|alert|denied|fail|err|warn/i.test(line) ? 'UNAUTHORIZED' : 'INFO',
        raw: line,
      };
    });
}

function normalizeLogItem(item = {}, index = 0) {
  const def = defaultLogItem(index + 1);
  const rawEntries = typeof item.entriesText === 'string' && !item.entriesText.includes('root_ghost')
    ? item.entriesText
    : def.entriesText;
  return {
    id: Number(item.id) || def.id,
    kind: 'login_log',
    name: String(item.name || def.name).trim().slice(0, 160) || def.name,
    folder: String(item.folder || def.folder).trim().slice(0, 60) || def.folder,
    duration: Number.isFinite(+item.duration) ? Math.max(0.5, Math.min(60, +item.duration)) : def.duration,
    node: String(item.node ?? def.node).slice(0, 80),
    alert: String(item.alert ?? def.alert).slice(0, 120),
    entriesText: rawEntries,
  };
}

function normalizeEmailItem(item = {}, index = 0) {
  const def = defaultEmailItem(index + 1);
  return {
    id: Number(item.id) || def.id,
    kind: 'email',
    name: String(item.name || def.name).trim().slice(0, 160) || def.name,
    folder: String(item.folder || def.folder).trim().slice(0, 60) || def.folder,
    duration: Number.isFinite(+item.duration) ? Math.max(0.5, Math.min(60, +item.duration)) : def.duration,
    scrambled: item.scrambled !== false,
    from: String(item.from ?? def.from).slice(0, 120),
    to: String(item.to ?? def.to).slice(0, 120),
    date: String(item.date ?? def.date).slice(0, 80),
    subject: String(item.subject ?? def.subject).slice(0, 140),
    badge: String(item.badge ?? def.badge).slice(0, 60),
    attachment: String(item.attachment ?? def.attachment).slice(0, 100),
    body: typeof item.body === 'string' ? item.body : def.body,
  };
}

export function normalizeFileOpts(opts = {}) {
  const variant = ['images', 'login_log', 'email'].includes(opts.variant) ? opts.variant : 'images';
  const defaultFolder = variant === 'login_log' ? 'Logs' : variant === 'email' ? 'Inbox' : (Array.isArray(opts.folders) && opts.folders.includes('Bestanden') ? 'Bestanden' : 'Files');
  const rawFolders = Array.isArray(opts.folders)
    ? opts.folders.filter((f) => typeof f === 'string').map((f) => f.trim().slice(0, 60)).filter(Boolean)
    : [];
  const logs = Array.isArray(opts.logs) && opts.logs.length
    ? opts.logs.map(normalizeLogItem)
    : [defaultLogItem(1)];
  const emails = Array.isArray(opts.emails) && opts.emails.length
    ? opts.emails.map(normalizeEmailItem)
    : [defaultEmailItem(1)];

  return {
    variant,
    theme: opts.theme === 'blue' ? 'blue' : 'green',
    pace: Number.isFinite(opts.pace) ? Math.max(0.7, Math.min(1.5, opts.pace)) : 1,
    intro: opts.intro !== false,
    outro: opts.outro === true,
    stopOnOpen: opts.stopOnOpen === true,
    // Open the last file, keep it on screen for N seconds, then end without closing it.
    endWhileOpen: opts.endWhileOpen === true && opts.stopOnOpen !== true,
    endWhileOpenSeconds: Number.isFinite(opts.endWhileOpenSeconds) ? Math.max(0.5, Math.min(60, opts.endWhileOpenSeconds)) : 5,
    sounds: opts.sounds !== false,
    motionSeed: Number.isFinite(opts.motionSeed) ? opts.motionSeed >>> 0 : 41763,
    volume: Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, opts.volume)) : 0.65,
    username: String(opts.username || 'operator').slice(0, 30),
    title: String(opts.title || 'CLASSIFIED FILE ARCHIVE').slice(0, 70),
    folders: [...new Set([defaultFolder, ...rawFolders])],
    logs,
    emails,
  };
}

export function getActiveFileItems(images = [], options = {}) {
  const opts = normalizeFileOpts(options);
  if (opts.variant === 'login_log') return opts.logs;
  if (opts.variant === 'email') return opts.emails;
  return images || [];
}

export function fileSchedule(images, options = {}) {
  const opts = normalizeFileOpts(options);
  const items = getActiveFileItems(images, opts);
  const defaultFolder = opts.variant === 'login_log' ? 'Logs' : opts.variant === 'email' ? 'Inbox' : 'Files';
  const intro = opts.intro ? 4.6 + items.length * 0.22 : 0;
  let cursor = intro, previous = null;
  const segments = items.map((image, index) => {
    const folder = image.folder || defaultFolder, folderChanged = previous !== folder;
    const pace = opts.pace;
    const noOpen = Boolean(opts.stopOnOpen || image.stopOnOpen);
    const keepOpen = !noOpen && opts.endWhileOpen && index === items.length - 1;
    const folderArrive = cursor + 0.9 * pace, folderClick = cursor + 1.25 * pace, folderOpen = cursor + 1.45 * pace;
    const fileMove = folderChanged ? folderOpen + 0.18 * pace : cursor + 0.1 * pace;
    const fileArrive = cursor + (folderChanged ? 2.35 : 1.05) * pace;
    const fileClick = fileArrive + 0.35 * pace, fileDoubleClick = fileClick + 0.15 * pace;
    const open = fileDoubleClick + 0.16 * pace;
    const hold = noOpen ? 0 : keepOpen ? opts.endWhileOpenSeconds : (Number.isFinite(image.duration) ? Math.max(0.5, Math.min(60, image.duration)) : 3);
    const close = noOpen ? open : open + hold;
    const closeArrive = noOpen || keepOpen ? close : close + 0.7 * pace;
    const closeClick = noOpen || keepOpen ? close : close + 0.98 * pace;
    const end = noOpen ? open + 0.12 * pace : keepOpen ? close : close + 1.25 * pace;
    const motionSeed = (opts.motionSeed ^ Math.imul(index + 1, 2654435761) ^ Math.imul(Number(image.id) || 0, 2246822519)) >>> 0;
    const segment = { image, item: image, folder, folderChanged, noOpen, keepOpen, motionSeed, start: cursor, folderArrive, folderClick, folderOpen, fileMove, fileArrive, fileClick, fileDoubleClick, open, close, closeArrive, closeClick, end, hold, pace };
    cursor = segment.end; previous = folder;
    return segment;
  });
  const terminal = cursor + 1.4 * opts.pace;
  const outro = opts.outro && !opts.stopOnOpen && !opts.endWhileOpen && items.length ? {
    start: cursor, arrive: cursor + 0.85 * opts.pace, click: cursor + 1.2 * opts.pace,
    terminal, logout: terminal + 0.4, loggedOut: terminal + 1.8,
    clear: terminal + 2.6, blank: terminal + 3.5, end: terminal + 4.8,
    motionSeed: opts.motionSeed, pace: opts.pace,
  } : null;
  return { intro, segments, outro, total: outro ? outro.end : cursor + (items.length && !opts.stopOnOpen && !opts.endWhileOpen ? 0.8 : 0) };
}

export const displayFileFolder = (name) => name === 'Bestanden' ? 'Files' : name;

export function sequenceAt(schedule, time) {
  if (time < schedule.intro) return { phase: 'intro', segment: null, elapsed: time };
  if (schedule.outro && time >= schedule.outro.start) return { phase: time >= schedule.outro.blank ? 'blank' : 'outro', segment: null, elapsed: time - schedule.outro.start };
  const segment = schedule.segments.find((s) => time < s.end) || schedule.segments.at(-1);
  if (!segment) return { phase: 'empty', segment: null, elapsed: 0 };
  if (segment.noOpen) return { phase: 'navigate', segment, elapsed: time - segment.start };
  if (segment.keepOpen) return { phase: time < segment.open ? 'navigate' : 'image', segment, elapsed: time - segment.start };
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
    events.push({ at: s.fileClick, kind: 'click' }, { at: s.fileDoubleClick, kind: 'click' }, { at: s.open, kind: 'open' });
    if (s.noOpen) return;
    if (!s.keepOpen) events.push({ at: s.closeClick, kind: 'click' });
    if (opts?.variant === 'login_log' || opts?.variant === 'email') {
      const ticks = opts.variant === 'login_log' ? 6 : 8;
      for (let i = 0; i < ticks; i++) {
        const tickAt = s.open + 0.14 + i * 0.11;
        if (tickAt < s.close - 0.15) events.push({ at: tickAt, kind: 'key' });
      }
    }
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
