import { fileUrl } from '../api.js';
import { FILE_THEMES, normalizeFileOpts, fileSchedule, sequenceAt, fileSoundtrack, displayFileFolder } from './model.js';
import { filePointer, outroPointer } from './motion.js';

const W = 1920, H = 1080;
export async function createFileScene(canvas, images, options = {}) {
  const opts = normalizeFileOpts(options), colors = FILE_THEMES[opts.theme];
  const loaded = new Map();
  try {
    await Promise.all(images.map(async (image) => {
      const response = await fetch(fileUrl.image(image));
      if (!response.ok) throw new Error(`Image not found: ${image.name}`);
      const bitmap = await createImageBitmap(await response.blob()); loaded.set(image.id, bitmap);
    }));
  } catch (e) { loaded.forEach((bitmap) => bitmap.close()); throw e; }
  const schedule = fileSchedule(images, opts), soundtrack = fileSoundtrack(schedule, opts);
  const folders = [...new Set([...opts.folders, ...images.map((i) => i.folder || 'Files')])];
  const g = canvas.getContext('2d');
  const rect = (x, y, w, h, fill, stroke) => { g.fillStyle = fill; g.fillRect(x, y, w, h); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.strokeRect(x, y, w, h); } };
  const text = (s, x, y, size = 24, color = colors.ink) => { g.font = `${size}px "Courier New", monospace`; g.fillStyle = color; g.fillText(String(s), x, y); };
  const fit = (value, max) => { let s = String(value); while (s.length > 2 && g.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; };
  const photo = (image, x, y, w, h) => {
    const b = loaded.get(image.id); if (!b) return;
    const scale = Math.min(w / b.width, h / b.height);
    g.drawImage(b, x + (w - b.width * scale) / 2, y + (h - b.height * scale) / 2, b.width * scale, b.height * scale);
  };
  function pointer(x, y, pressed = false) {
    if (pressed) { g.strokeStyle = colors.accent; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 25, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y + 34); g.lineTo(x + 10, y + 26); g.lineTo(x + 18, y + 42); g.lineTo(x + 25, y + 38); g.lineTo(x + 17, y + 23); g.lineTo(x + 30, y + 22); g.closePath();
    g.fillStyle = '#fff'; g.strokeStyle = '#06100b'; g.lineWidth = 2; g.fill(); g.stroke();
  }
  function intro(t) {
    rect(0, 0, W, H, colors.bg);
    rect(76, 65, W - 152, H - 130, colors.panel, colors.border);
    rect(76, 65, W - 152, 54, colors.bar);
    text('TERMINAL / SECURE SESSION', 100, 103, 25, opts.theme === 'blue' ? '#000080' : colors.ink);
    const lines = ['System Login'];
    if (t >= 0.8) lines.push('Username: ' + opts.username.slice(0, Math.max(0, Math.floor((t - 1) / 0.055))));
    if (t >= 1.95) lines.push('Password: ' + '*'.repeat(Math.max(0, Math.min(8, Math.floor((t - 2.1) / 0.06)))));
    if (t >= 3.05) lines.push('', 'Authentication successful.', '> dir /archive');
    const shown = Math.max(0, Math.min(images.length, Math.floor((t - 3.6) / 0.22)));
    const names = images.slice(0, shown).map((i) => `  ${displayFileFolder(i.folder)}/${i.name}`);
    lines.push(...names.slice(-6));
    if (t > schedule.intro - 0.8) lines.push('', 'ACCESS GRANTED', '> Opening File Explorer…');
    lines.forEach((line, i) => text(fit(line, 1560), 128, 210 + i * 46, i === 0 ? 40 : 29));
    if (Math.floor(t * 3) % 2 === 0) text('█', 128, Math.min(976, 210 + lines.length * 46), 28);
    text('ENCRYPTED SESSION  ·  LOCAL ARCHIVE', 128, 982, 20, colors.muted);
  }
  function draw(t) {
    g.save(); g.scale(canvas.width / W, canvas.height / H);
    rect(0, 0, W, H, colors.bg);
    const state = sequenceAt(schedule, t);
    if (state.phase === 'intro') { intro(t); g.restore(); return; }
    const ending = state.phase === 'outro' || state.phase === 'blank';
    if (ending && t >= schedule.outro.terminal) {
      const o = schedule.outro;
      rect(0, 0, W, H, '#000000');
      if (t < o.blank) {
        const typed = (command, start) => command.slice(0, Math.max(0, Math.floor((t - start) / 0.075)));
        const lines = ['SESSION / ' + opts.username, '', '> ' + typed('logout', o.logout)];
        if (t >= o.logout + 0.75) lines.push('Closing session...');
        if (t >= o.loggedOut) lines.push('Logged out.');
        if (t >= o.clear) lines.push('', '> ' + typed('clear', o.clear));
        lines.forEach((line, i) => text(fit(line, 1640), 96, 130 + i * 48, 29));
      }
      g.restore(); return;
    }
    const s = ending ? schedule.segments.at(-1) : state.segment;
    const folderOpen = s && (!s.folderChanged || t >= s.folderOpen);
    const currentFolder = folderOpen ? s.folder : null;
    const folderIndex = s ? folders.indexOf(s.folder) : 0;
    const folderOffset = Math.max(0, folderIndex - 10);
    const rootFolderOffset = Math.floor(Math.max(0, folderIndex) / 12) * 12;
    const rootFolderIndex = Math.max(0, folderIndex) - rootFolderOffset;
    const imageIndex = s ? images.filter((i) => i.folder === s.folder).findIndex((i) => i.id === s.image.id) : 0;
    const tileIndex = Math.max(0, imageIndex) % 12;
    const target = { x: 418 + tileIndex % 4 * 346 + 156, y: 322 + Math.floor(tileIndex / 4) * 207 + 80 };
    const folderPoint = { x: 438 + rootFolderIndex % 4 * 340 + 37, y: 370 + Math.floor(rootFolderIndex / 4) * 185 + 26 };
    const cursor = ending ? outroPointer(schedule.outro, t) : s ? filePointer(s, t, { folder: folderPoint, file: target, first: s === schedule.segments[0] }) : null;
    rect(60, 60, 1800, 960, colors.panel, colors.border);
    rect(60, 60, 1800, 58, colors.bar);
    text(opts.title, 88, 99, 27, opts.theme === 'blue' ? '#000080' : colors.ink);
    if (cursor?.hover === 'explorer-close') rect(1778, 72, 44, 37, colors.accent + '35', colors.border);
    text('—  □  ×', 1690, 99, 28, opts.theme === 'blue' ? '#000080' : colors.ink);
    text('File    Edit    View    Navigate    Help', 88, 155, 23, colors.muted);
    rect(80, 180, 1760, 52, colors.bg, colors.border);
    text('C:\\ARCHIVE' + (currentFolder ? '\\' + displayFileFolder(currentFolder) : ''), 104, 214, 24);
    text('FOLDERS', 94, 282, 22, colors.muted);
    rect(374, 258, 2, 702, colors.border);
    folders.slice(folderOffset, folderOffset + 11).forEach((f, index) => {
      const y = 305 + index * 56;
      if (f === currentFolder) rect(80, y, 280, 49, colors.selected);
      text('[+]', 95, y + 32, 25, colors.accent);
      text(fit(displayFileFolder(f), 196), 153, y + 32, 23);
    });
    let fileIndex = 0;
    const inFolder = currentFolder ? images.filter((i) => i.folder === currentFolder) : [];
    if (s) fileIndex = inFolder.findIndex((i) => i.id === s.image.id);
    const page = Math.floor(Math.max(0, fileIndex) / 12);
    if (currentFolder) {
      text(displayFileFolder(currentFolder).toUpperCase(), 420, 286, 22, colors.muted);
      inFolder.slice(page * 12, page * 12 + 12).forEach((image, index) => {
        const x = 418 + index % 4 * 346, y = 322 + Math.floor(index / 4) * 207;
        const selected = s?.image.id === image.id && t >= s.fileClick;
        const hovered = s?.image.id === image.id && cursor?.hover === 'file';
        g.save();
        if (hovered) { g.shadowColor = colors.accent; g.shadowBlur = 14; }
        rect(x, y, 312, 182, selected || hovered ? colors.selected : colors.bg, selected || hovered ? colors.accent : colors.border);
        g.restore();
        photo(image, x + 14, y + 12, 284, 120);
        text(fit(image.name, 282), x + 14, y + 163, 20);
      });
    } else {
      text('ARCHIVE / ROOT', 420, 286, 22, colors.muted);
      folders.slice(rootFolderOffset, rootFolderOffset + 12).forEach((folder, index) => {
        const x = 438 + index % 4 * 340, y = 370 + Math.floor(index / 4) * 185;
        const hovered = folder === s?.folder && cursor?.hover === 'folder';
        const selected = folder === s?.folder && t >= s.folderClick;
        if (hovered || selected) {
          g.save();
          if (hovered) { g.shadowColor = colors.accent; g.shadowBlur = 14; }
          rect(x - 18, y - 28, 310, 144, colors.selected, colors.accent);
          g.restore();
        }
        rect(x, y, 74, 52, colors.accent); rect(x, y - 12, 35, 15, colors.accent);
        text(fit(displayFileFolder(folder), 292), x, y + 99, 23);
      });
    }
    const count = s ? schedule.segments.indexOf(s) + 1 : 0;
    text(`${images.length} FILES  ·  ${currentFolder ? 'FOLDER: ' + displayFileFolder(currentFolder) : 'ARCHIVE ROOT'}`, 94, 993, 21, colors.muted);
    text(`SEQUENCE ${count}/${images.length}`, 1520, 993, 21, colors.muted);
    if (s) {
      const phase = state.phase;
      const viewer = phase === 'image' || (phase === 'close' && t < s.closeClick);
      if (viewer) {
        g.fillStyle = '#000a'; g.fillRect(60, 118, 1800, 902);
        rect(180, 155, 1560, 805, colors.bg, colors.accent);
        rect(180, 155, 1560, 55, colors.bar);
        text(fit(s.image.name, 1360), 205, 192, 26, opts.theme === 'blue' ? '#000080' : colors.ink);
        if (cursor.hover === 'close') rect(1684, 164, 45, 38, colors.accent + '35', colors.border);
        text('×', 1695, 192, 30, opts.theme === 'blue' ? '#000080' : colors.ink);
        photo(s.image, 204, 233, 1512, 652);
        text(`${s.hold.toFixed(1)}s  ·  IMAGE ${count}/${images.length}`, 205, 935, 20, colors.muted);
      }
      pointer(cursor.x, cursor.y, cursor.pressed);
    } else text('Add images to begin your sequence.', 480, 460, 30);
    // Static subtle monitor texture; no random state so seeking matches export.
    if (opts.theme === 'green') { g.fillStyle = '#00000010'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1); }
    g.restore();
  }
  return { schedule, soundtrack, draw, reset() {}, dispose() { loaded.forEach((b) => b.close()); loaded.clear(); } };
}
