import { fileUrl } from '../api.js';
import {
  FILE_THEMES,
  normalizeFileOpts,
  getActiveFileItems,
  parseLogEntries,
  scrambleText,
  fileSchedule,
  sequenceAt,
  fileSoundtrack,
  displayFileFolder,
} from './model.js';
import { filePointer, outroPointer } from './motion.js';

const W = 1920, H = 1080;

export async function createFileScene(canvas, images, options = {}) {
  const opts = normalizeFileOpts(options), colors = FILE_THEMES[opts.theme];
  const items = getActiveFileItems(images, opts);
  const loaded = new Map();
  if (opts.variant === 'images') {
    try {
      await Promise.all(images.map(async (image) => {
        const response = await fetch(fileUrl.image(image));
        if (!response.ok) throw new Error(`Image not found: ${image.name}`);
        const bitmap = await createImageBitmap(await response.blob());
        loaded.set(image.id, bitmap);
      }));
    } catch (e) {
      loaded.forEach((bitmap) => bitmap.close());
      throw e;
    }
  }

  const schedule = fileSchedule(images, opts), soundtrack = fileSoundtrack(schedule, opts);
  const defaultFolder = opts.variant === 'login_log' ? 'Logs' : opts.variant === 'email' ? 'Inbox' : 'Files';
  const folders = [...new Set([...opts.folders, ...items.map((i) => i.folder || defaultFolder)])];
  const g = canvas.getContext('2d');

  const rect = (x, y, w, h, fill, stroke, lineWidth = 2) => {
    if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lineWidth; g.strokeRect(x, y, w, h); }
  };
  const text = (s, x, y, size = 24, color = colors.ink, weight = 'normal') => {
    g.font = `${weight} ${size}px "Consolas", "Share Tech Mono", "Courier New", monospace`;
    g.fillStyle = color;
    g.fillText(String(s), x, y);
  };
  const fit = (value, max, size = 24, weight = 'normal') => {
    g.font = `${weight} ${size}px "Consolas", "Share Tech Mono", "Courier New", monospace`;
    let s = String(value ?? '');
    while (s.length > 2 && g.measureText(s).width > max) s = s.slice(0, -2) + '…';
    return s;
  };
  const wrapLines = (rawText, maxWidth, size = 23, maxLines = 9) => {
    g.font = `bold ${size}px "Consolas", "Share Tech Mono", "Courier New", monospace`;
    const out = [];
    for (const para of String(rawText ?? '').split(/\r?\n/)) {
      if (!para.trim()) {
        out.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (g.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
    }
    return out.slice(0, maxLines);
  };

  const photo = (image, x, y, w, h) => {
    const b = loaded.get(image.id);
    if (!b) return;
    const scale = Math.min(w / b.width, h / b.height);
    g.drawImage(b, x + (w - b.width * scale) / 2, y + (h - b.height * scale) / 2, b.width * scale, b.height * scale);
  };

  const drawTilePreview = (item, x, y, w, h, t = 0) => {
    if (opts.variant === 'images') {
      photo(item, x, y, w, h);
      return;
    }
    rect(x, y, w, h, colors.panel, colors.border, 1.5);
    if (opts.variant === 'login_log') {
      rect(x, y, w, 28, colors.bar);
      text('ACCESS LOG', x + 10, y + 20, 15, opts.theme === 'blue' ? '#000080' : colors.ink, 'bold');
      // Draw 4 green granted bars + 1 red unauthorized bar
      for (let i = 0; i < 4; i++) {
        const ry = y + 36 + i * 19;
        const isUnauth = i === 3;
        rect(x + 12, ry, w - 24, 13, isUnauth ? colors.warnBg : colors.bg, isUnauth ? colors.warn : colors.border, 1);
        rect(x + 16, ry + 3, isUnauth ? w - 90 : w - 110, 7, isUnauth ? colors.warn : colors.accent);
        text(isUnauth ? 'UNAUTH' : 'OK', x + w - 68, ry + 11, 11, isUnauth ? colors.warn : colors.accent, 'bold');
      }
    } else if (opts.variant === 'email') {
      rect(x, y, w, 28, colors.bar);
      text('E-MAIL', x + 10, y + 20, 15, opts.theme === 'blue' ? '#000080' : colors.ink, 'bold');
      // Simple envelope icon in the middle of the tile
      const ex = x + (w - 84) / 2, ey = y + 40, ew = 84, eh = 56;
      rect(ex, ey, ew, eh, colors.bg, colors.accent, 2);
      g.strokeStyle = colors.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex + ew / 2, ey + 30);
      g.lineTo(ex + ew, ey);
      g.stroke();
    }
  };

  const drawLogViewer = (item, t, openAt, hold, count) => {
    const elapsed = Math.max(0, t - openAt);
    const entries = parseLogEntries(item.entriesText);
    const revealDur = Math.min(1.0, hold * 0.4);
    const visibleCount = revealDur > 0.05
      ? Math.max(1, Math.min(entries.length, Math.ceil((elapsed / revealDur) * entries.length)))
      : entries.length;

    // Top subheader bar
    rect(210, 228, 1500, 50, colors.panel, colors.border);
    text('>_ SYSTEM ACCESS & LOGIN LOG', 230, 261, 23, colors.accent, 'bold');
    const nodeText = fit(item.node || 'NODE: HQ-GATEWAY-04', 520, 21);
    text(nodeText, 1690 - g.measureText(nodeText).width, 260, 21, colors.muted);

    let tableTop = 294;
    if (item.alert && item.alert.trim()) {
      const pulse = Math.floor(elapsed * 3) % 2 === 0;
      rect(210, 290, 1500, 48, pulse ? colors.warnBg : colors.panel, colors.warn, 2);
      text(fit(`[!] ${item.alert.trim()}`, 1460, 22, 'bold'), 230, 322, 22, colors.warn, 'bold');
      tableTop = 354;
    }

    // Column headers
    rect(210, tableTop, 1500, 44, colors.selected, colors.border);
    text('TIMESTAMP', 228, tableTop + 29, 20, colors.accent, 'bold');
    text('USER', 535, tableTop + 29, 20, colors.accent, 'bold');
    text('IP ADDRESS', 790, tableTop + 29, 20, colors.accent, 'bold');
    text('EVENT / ACTION', 1075, tableTop + 29, 20, colors.accent, 'bold');
    text('STATUS', 1455, tableTop + 29, 20, colors.accent, 'bold');

    const maxRows = Math.floor((880 - (tableTop + 52)) / 56);
    const shownEntries = entries.slice(0, visibleCount).slice(-maxRows);

    shownEntries.forEach((entry, idx) => {
      const rowY = tableTop + 54 + idx * 56;
      const isFlagged = /unauth|denied|breach|alert|fail|err|block|intrusion/i.test(entry.status);
      rect(210, rowY, 1500, 48, isFlagged ? colors.warnBg : (idx % 2 === 0 ? colors.panel : colors.bg), isFlagged ? colors.warn : colors.border, isFlagged ? 2 : 1);

      if (entry.raw) {
        text(fit(entry.raw, 1200, 21, 'bold'), 228, rowY + 31, 21, isFlagged ? colors.warn : colors.ink, 'bold');
      } else {
        text(fit(entry.time, 290, 20), 228, rowY + 31, 20, colors.muted);
        text(fit(entry.user, 240, 22, 'bold'), 535, rowY + 31, 22, isFlagged ? colors.warn : colors.ink, 'bold');
        text(fit(entry.ip, 265, 20), 790, rowY + 31, 20, colors.ink);
        text(fit(entry.action, 365, 20, 'bold'), 1075, rowY + 31, 20, isFlagged ? colors.warn : colors.ink, 'bold');
      }
      const badgeText = isFlagged ? `[! ${entry.status}]` : `[OK ${entry.status}]`;
      text(fit(badgeText, 235, 20, 'bold'), 1455, rowY + 31, 20, isFlagged ? colors.warn : colors.accent, 'bold');
    });

    const flaggedCount = entries.filter((e) => /unauth|denied|breach|alert|fail|err|block|intrusion/i.test(e.status)).length;
    text(`${entries.length} ENTRIES  ·  UNAUTHORIZED: ${flaggedCount}  ·  ${hold.toFixed(1)}s  ·  LOG ${count}/${items.length}`, 210, 935, 20, colors.muted);
  };

  const drawEmailViewer = (item, t, openAt, hold, count) => {
    const elapsed = Math.max(0, t - openAt);
    const isScrambled = item.scrambled !== false;
    const tick = Math.floor(t * 6);
    const maybeScramble = (str, seed) => (isScrambled ? scrambleText(str, tick, seed) : String(str ?? ''));

    // Simple, clean Email UI: Header box + Body box
    const boxX = 216, boxW = 1488;

    // 1. Simple Email Header
    rect(boxX, 232, boxW, 168, colors.panel, colors.border);

    text('From   :', boxX + 28, 274, 22, colors.muted, 'bold');
    text(fit(maybeScramble(item.from || 'unknown@transmission.local', 11), 980, 23, 'bold'), boxX + 156, 274, 23, colors.ink, 'bold');

    const dateStr = fit(maybeScramble(item.date || '20 OKT 2026', 19), 340, 20);
    text(dateStr, boxX + boxW - g.measureText(dateStr).width - 28, 274, 20, colors.muted);

    text('To     :', boxX + 28, 318, 22, colors.muted, 'bold');
    text(fit(maybeScramble(item.to || 'agent@transmission.local', 22), 1260, 22), boxX + 156, 318, 22, colors.ink);

    text('Subject:', boxX + 28, 366, 22, colors.muted, 'bold');
    text(fit(maybeScramble(item.subject || 'Bericht', 33), 1260, 25, 'bold'), boxX + 156, 366, 25, colors.accent, 'bold');

    // 2. Simple Email Body
    const bodyY = 418, bodyH = 486;
    rect(boxX, bodyY, boxW, bodyH, colors.bg, colors.border);

    const rawLines = wrapLines(item.body || '', boxW - 64, 26, 10);
    const revealDur = Math.min(0.8, hold * 0.3);
    const totalLines = rawLines.length || 1;
    const visibleLines = revealDur > 0.05
      ? Math.max(1, Math.min(totalLines, Math.ceil((elapsed / revealDur) * totalLines)))
      : totalLines;

    rawLines.slice(0, visibleLines).forEach((line, idx) => {
      if (!line.trim()) return;
      const y = bodyY + 52 + idx * 44;
      const renderedLine = maybeScramble(line, 100 + idx * 13);
      text(fit(renderedLine, boxW - 64, 26, 'bold'), boxX + 32, y, 26, colors.ink, 'bold');
    });

    text(`${hold.toFixed(1)}s  ·  EMAIL ${count}/${items.length}`, boxX, 936, 20, colors.muted);
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
    text('TERMINAL / SECURE SESSION', 100, 103, 25, opts.theme === 'blue' ? '#000080' : colors.ink, 'bold');
    const lines = ['System Login'];
    if (t >= 0.8) lines.push('Username: ' + opts.username.slice(0, Math.max(0, Math.floor((t - 1) / 0.055))));
    if (t >= 1.95) lines.push('Password: ' + '*'.repeat(Math.max(0, Math.min(8, Math.floor((t - 2.1) / 0.06)))));
    if (t >= 3.05) lines.push('', 'Authentication successful.', '> dir /archive');
    const shown = Math.max(0, Math.min(items.length, Math.floor((t - 3.6) / 0.22)));
    const names = items.slice(0, shown).map((i) => `  ${displayFileFolder(i.folder || defaultFolder)}/${i.name}`);
    lines.push(...names.slice(-6));
    if (t > schedule.intro - 0.8) lines.push('', 'ACCESS GRANTED', '> Opening File Explorer…');
    lines.forEach((line, i) => text(fit(line, 1560, i === 0 ? 40 : 29), 128, 210 + i * 46, i === 0 ? 40 : 29));
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
        lines.forEach((line, i) => text(fit(line, 1640, 29), 96, 130 + i * 48, 29));
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
    const itemIndex = s ? items.filter((i) => (i.folder || defaultFolder) === s.folder).findIndex((i) => i.id === s.image.id) : 0;
    const tileIndex = Math.max(0, itemIndex) % 12;
    const target = { x: 418 + tileIndex % 4 * 346 + 156, y: 322 + Math.floor(tileIndex / 4) * 207 + 80 };
    const folderPoint = { x: 438 + rootFolderIndex % 4 * 340 + 37, y: 370 + Math.floor(rootFolderIndex / 4) * 185 + 26 };
    const cursor = ending ? outroPointer(schedule.outro, t) : s ? filePointer(s, t, { folder: folderPoint, file: target, first: s === schedule.segments[0] }) : null;
    rect(60, 60, 1800, 960, colors.panel, colors.border);
    rect(60, 60, 1800, 58, colors.bar);
    text(opts.title, 88, 99, 27, opts.theme === 'blue' ? '#000080' : colors.ink, 'bold');
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
      text(fit(displayFileFolder(f), 196, 23), 153, y + 32, 23);
    });
    let fileIndex = 0;
    const inFolder = currentFolder ? items.filter((i) => (i.folder || defaultFolder) === currentFolder) : [];
    if (s) fileIndex = inFolder.findIndex((i) => i.id === s.image.id);
    const page = Math.floor(Math.max(0, fileIndex) / 12);
    if (currentFolder) {
      text(displayFileFolder(currentFolder).toUpperCase(), 420, 286, 22, colors.muted);
      inFolder.slice(page * 12, page * 12 + 12).forEach((item, index) => {
        const x = 418 + index % 4 * 346, y = 322 + Math.floor(index / 4) * 207;
        const selected = s?.image.id === item.id && t >= s.fileClick;
        const hovered = s?.image.id === item.id && cursor?.hover === 'file';
        g.save();
        if (hovered) { g.shadowColor = colors.accent; g.shadowBlur = 14; }
        rect(x, y, 312, 182, selected || hovered ? colors.selected : colors.bg, selected || hovered ? colors.accent : colors.border);
        g.restore();
        drawTilePreview(item, x + 14, y + 12, 284, 120, t);
        text(fit(item.name, 282, 20), x + 14, y + 163, 20);
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
        text(fit(displayFileFolder(folder), 292, 23), x, y + 99, 23);
      });
    }
    const count = s ? schedule.segments.indexOf(s) + 1 : 0;
    text(`${items.length} FILES  ·  ${currentFolder ? 'FOLDER: ' + displayFileFolder(currentFolder) : 'ARCHIVE ROOT'}`, 94, 993, 21, colors.muted);
    text(`SEQUENCE ${count}/${items.length}`, 1520, 993, 21, colors.muted);
    if (s) {
      const phase = state.phase;
      const viewer = phase === 'image' || (phase === 'close' && t < s.closeClick);
      if (viewer) {
        g.fillStyle = '#000a'; g.fillRect(60, 118, 1800, 902);
        rect(180, 155, 1560, 805, colors.bg, colors.accent);
        rect(180, 155, 1560, 55, colors.bar);
        text(fit(s.image.name, 1360, 26, 'bold'), 205, 192, 26, opts.theme === 'blue' ? '#000080' : colors.ink, 'bold');
        if (cursor.hover === 'close') rect(1684, 164, 45, 38, colors.accent + '35', colors.border);
        text('×', 1695, 192, 30, opts.theme === 'blue' ? '#000080' : colors.ink);
        if (opts.variant === 'login_log') {
          drawLogViewer(s.image, t, s.open, s.hold, count);
        } else if (opts.variant === 'email') {
          drawEmailViewer(s.image, t, s.open, s.hold, count);
        } else {
          photo(s.image, 204, 233, 1512, 652);
          text(`${s.hold.toFixed(1)}s  ·  IMAGE ${count}/${items.length}`, 205, 935, 20, colors.muted);
        }
      }
      pointer(cursor.x, cursor.y, cursor.pressed);
    } else text('Add files to begin your sequence.', 480, 460, 30);
    g.restore();
  }
  return { schedule, soundtrack, draw, reset() {}, dispose() { loaded.forEach((b) => b.close()); loaded.clear(); } };
}
