// Hacked Screen scene: clean start (greenscreen / bluescreen / black / image) → glitch takeover →
// "YOU ARE HACKED!" warning screen with flying matrix code, terminals, pop-ups and alarms.
// Fully deterministic (seeded hashes per time tick) so the live preview and the MP4 export match.
import { SR } from '../audio/engine.js';

export const W = 1920, H = 1080;

export const HACK_BACKGROUNDS = [
  { id: 'green', name: 'Greenscreen', color: '#00b140' },
  { id: 'blue', name: 'Bluescreen', color: '#0047bb' },
  { id: 'black', name: 'Zwart', color: '#000000' },
  { id: 'image', name: 'Afbeelding', color: '#000000' },
  { id: 'transparent', name: 'Transparant', color: 'transparent' },
];

export const HACK_ENDINGS = [
  { id: 'hold', name: 'Blijven staan', short: 'Blijven', desc: 'Eindigt op het gehackte scherm.' },
  { id: 'glitch_out', name: 'Glitch terug', short: 'Glitch terug', desc: 'Glitcht terug naar de start-achtergrond.' },
  { id: 'black', name: 'Fade naar zwart', short: 'Naar zwart', desc: 'Het gehackte scherm vervaagt naar zwart.' },
];

export const DEFAULT_WARNINGS = [
  'FIREWALL DISABLED',
  'ACCESS GRANTED: ROOT',
  'WEBCAM ACTIVATED',
  'PASSWORDS DECRYPTED',
  'UPLOADING FILES...',
  'ANTIVIRUS TERMINATED',
  'SYSTEM32 CORRUPTED',
  'REMOTE CONTROL ENABLED',
];

const num = (v, min, max, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const str = (v, max, d) => (typeof v === 'string' ? v.slice(0, max) : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

export function normalizeHackOpts(o = {}) {
  o = o && typeof o === 'object' ? o : {};
  // v2 = cleaner look. Projects saved before v2 get the new, calmer defaults once.
  const legacy = o.v !== 2;
  const warnings = Array.isArray(o.warnings)
    ? o.warnings.filter((w) => typeof w === 'string').map((w) => w.trim().slice(0, 60)).filter(Boolean).slice(0, 24)
    : DEFAULT_WARNINGS.slice();
  return {
    v: 2,
    bgMode: HACK_BACKGROUNDS.some((b) => b.id === o.bgMode) ? o.bgMode : 'green',
    bgImageUrl: str(o.bgImageUrl, 400, ''),
    bgImageDim: num(o.bgImageDim, 0, 0.85, 0),
    startDelay: num(o.startDelay, 0, 30, 1.5),
    glitchDuration: num(o.glitchDuration, 0.3, 10, 1.6),
    glitchIntensity: num(o.glitchIntensity, 0.2, 1, 0.8),
    hackDuration: num(o.hackDuration, 1, 120, 7),
    title: str(o.title, 60, 'YOU ARE HACKED!'),
    subtitle: str(o.subtitle, 80, 'WARNING: SYSTEM COMPROMISED'),
    progressLabel: str(o.progressLabel, 60, 'UPLOADING DATA'),
    warnings,
    codeColor: color(o.codeColor, '#00ff66'),
    alertColor: color(o.alertColor, '#ff1f3d'),
    matrix: o.matrix !== false,
    // Only used with bgMode 'transparent': also drop the dark backdrop of the hacked screen (code + boxes float over your footage).
    hackTransparent: o.hackTransparent === true,
    terminal: legacy ? false : o.terminal === true,
    warnIcon: o.warnIcon !== false,
    progress: o.progress !== false,
    popups: legacy ? false : o.popups === true,
    hazard: legacy ? false : o.hazard === true,
    miniGlitches: o.miniGlitches !== false,
    ending: HACK_ENDINGS.some((e) => e.id === o.ending) ? o.ending : 'hold',
    sounds: o.sounds !== false,
    volume: num(o.volume, 0, 1, 0.7),
    seed: Number.isFinite(o.seed) ? o.seed >>> 0 : 1337,
  };
}

// Deterministic 0..1 hash
function hash(a, b = 0, c = 0) {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const OUTRO_DURATION = { hold: 0, glitch_out: 1.3, black: 1.2 };
const GLITCH_OUT = 0.8;   // seconds of glitching inside the glitch_out outro

export function hackSchedule(options = {}) {
  const opts = normalizeHackOpts(options);
  const start = opts.startDelay;
  const glitchEnd = start + opts.glitchDuration;
  const hackEnd = glitchEnd + opts.hackDuration;
  const total = hackEnd + OUTRO_DURATION[opts.ending];

  const popups = [];
  if (opts.popups && opts.warnings.length) {
    const first = glitchEnd + 1.2, interval = 1.3;
    const count = Math.min(4, Math.max(0, Math.floor((hackEnd - 0.6 - first) / interval) + 1));
    // Seeded random positions around the central warning box: never over the box or each other,
    // and picked from several candidates to stay spread out (so it looks chaotic, not grid-like).
    const pw = 380, ph = 100, m = 22;
    const bh = 40 + (opts.warnIcon ? 170 : 0) + 105 + 50 + (opts.progress ? 60 : 0) + 30;
    const box = { x: (W - 1000) / 2 - m, y: (H - bh) / 2 - m, w: 1000 + 2 * m, h: bh + 2 * m };
    const hits = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
    const placed = [];
    for (let i = 0; i < count; i++) {
      let best = null, bestScore = -1;
      for (let k = 0; k < 60; k++) {
        const c = {
          x: Math.round(18 + hash(opts.seed, i * 101 + k, 94) * (W - pw - 36)),
          y: Math.round(18 + hash(opts.seed, i * 101 + k, 95) * (H - ph - 36)),
          w: pw, h: ph,
        };
        if (hits(c, box) || placed.some((p) => hits(c, p, 16))) continue;
        // spread score: distance to the nearest already-placed pop-up (+ a little randomness)
        const d = placed.length ? Math.min(480, ...placed.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) : 480;
        const score = d * (0.75 + 0.5 * hash(opts.seed, i * 101 + k, 96));
        if (score > bestScore) { best = c; bestScore = score; }
      }
      if (!best) break;
      placed.push(best);
      popups.push({ at: first + i * interval, text: opts.warnings[i % opts.warnings.length], x: best.x, y: best.y });
    }
  }

  const glitches = [];
  if (opts.miniGlitches) {
    let at = glitchEnd + 1.2, i = 0;
    while (at < hackEnd - 0.3) {
      glitches.push({ at, dur: 0.12 + hash(opts.seed, i, 71) * 0.12 });
      at += 1.3 + hash(opts.seed, i, 72) * 1.6;
      i++;
    }
  }
  return { start, glitchEnd, hackEnd, total, popups, glitches };
}

// Binary-heavy mix of hex digits and code symbols (0/1 repeated so they appear most often).
const MATRIX_CHARS = '0101010101010101010123456789ABCDEF0123456789ABCDEF{}[]<>/\\;:=+*#$%&!?_|';

function termLine(n, side, seed) {
  const r = (k) => hash(seed + side * 977, n, k);
  const hx = (len, k) => { let s = ''; for (let i = 0; i < len; i++) s += '0123456789ABCDEF'[Math.floor(hash(seed + side, n, k * 31 + i) * 16)]; return s; };
  const pick = (arr, k) => arr[Math.floor(r(k) * arr.length)];
  const ip = `${10 + Math.floor(r(1) * 240)}.${Math.floor(r(2) * 255)}.${Math.floor(r(3) * 255)}.${Math.floor(r(4) * 255)}`;
  const port = 1000 + Math.floor(r(5) * 64000);
  switch (Math.floor(r(0) * 11)) {
    case 0: case 1: return `0x${hx(6, 1)}  ${hx(2, 2)} ${hx(2, 3)} ${hx(2, 4)} ${hx(2, 5)} ${hx(2, 6)} ${hx(2, 7)} ${hx(2, 8)}`;
    case 2: return `> bypass firewall --port ${port}`;
    case 3: return `[OK] injecting payload ${hx(6, 9)}`;
    case 4: return `decrypt ${pick(['passwords.db', 'mail.pst', 'webcam.cfg', 'bank.dat', 'contacts.vcf', 'keychain'], 6)} ${Math.floor(r(7) * 100)}%`;
    case 5: return `ssh root@${ip} -p ${port}`;
    case 6: return '> sudo rm -rf /security/*';
    case 7: return `ACCESS ${pick(['GRANTED', 'OVERRIDE', 'ELEVATED'], 8)} uid=0(root)`;
    case 8: return `mov eax, 0x${hx(4, 10)} ; jmp 0x${hx(6, 11)}`;
    case 9: return `[!] ${pick(['keylogger', 'rootkit', 'backdoor', 'trojan.exe', 'worm.bin'], 12)} installed`;
    default: return `GET /admin/${hx(8, 13).toLowerCase()} 200 OK`;
  }
}

/**
 * @param {HTMLCanvasElement} canvas output canvas (any 16:9 size)
 * @param {object} options hack_opts
 * @param {{ bgImage?: HTMLImageElement|null }} extra
 */
export function createHackScene(canvas, options = {}, { bgImage = null } = {}) {
  const opts = normalizeHackOpts(options);
  const s = hackSchedule(opts);
  const soundtrack = hackSoundtrack(s, opts);
  const ctx = canvas.getContext('2d');

  const mk = () => { const c = document.createElement('canvas'); return { c, g: c.getContext('2d') }; };
  const layer = mk(), work = mk(), chR = mk(), chC = mk();
  const noiseTiles = Array.from({ length: 4 }, (_, k) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = hash(opts.seed + k, i, 3) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
  const patterns = new WeakMap();
  function scanPattern(g) {
    if (patterns.has(g)) return patterns.get(g);
    const c = document.createElement('canvas'); c.width = 4; c.height = 4;
    const pg = c.getContext('2d'); pg.fillStyle = 'rgba(0,0,0,0.28)'; pg.fillRect(0, 0, 4, 2);
    const p = g.createPattern(c, 'repeat'); patterns.set(g, p); return p;
  }

  function sizeLayers() {
    for (const l of [layer, work, chR, chC]) {
      if (l.c.width !== canvas.width || l.c.height !== canvas.height) { l.c.width = canvas.width; l.c.height = canvas.height; }
    }
  }
  const scale = () => canvas.width / W;
  const logical = (g) => { const k = scale(); g.setTransform(k, 0, 0, k, 0, 0); };
  const pixel = (g) => g.setTransform(1, 0, 0, 1, 0, 0);
  const resetState = (g) => { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; };

  // Transparent output: start background has alpha 0; optionally the hacked screen too.
  const transparent = opts.bgMode === 'transparent';
  const hackClear = transparent && opts.hackTransparent;

  // ---------- start background ----------
  function drawStart(g) {
    logical(g); resetState(g);
    if (transparent) { g.clearRect(0, 0, W, H); return; }
    const bg = HACK_BACKGROUNDS.find((b) => b.id === opts.bgMode) || HACK_BACKGROUNDS[0];
    g.fillStyle = bg.color; g.fillRect(0, 0, W, H);
    if (opts.bgMode === 'image' && bgImage && bgImage.naturalWidth) {
      const r = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight);
      const iw = bgImage.naturalWidth * r, ih = bgImage.naturalHeight * r;
      g.drawImage(bgImage, (W - iw) / 2, (H - ih) / 2, iw, ih);
      if (opts.bgImageDim > 0) { g.fillStyle = `rgba(0,0,0,${opts.bgImageDim})`; g.fillRect(0, 0, W, H); }
    }
  }

  // ---------- hacked screen ----------
  function drawMatrix(g, lt) {
    const fs = 26, cols = Math.ceil(W / fs);
    g.font = `400 ${fs - 4}px "Share Tech Mono", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let i = 0; i < cols; i++) {
      if (hash(opts.seed, i, 4) > 0.55) continue;   // sparser rain = calmer screen
      const sp = 200 + hash(opts.seed, i, 1) * 420;
      const len = 8 + Math.floor(hash(opts.seed, i, 2) * 18);
      const span = H + len * fs;
      const headY = (lt * sp + hash(opts.seed, i, 3) * span) % span;
      const headRow = Math.floor(headY / fs);
      for (let k = 0; k < len; k++) {
        const row = headRow - k, y = row * fs;
        if (y < -fs || y > H) continue;
        const ci = Math.floor(hash(opts.seed * 7 + i, row, Math.floor(lt * 5 + hash(i, row) * 5)) * MATRIX_CHARS.length);
        if (k === 0) { g.fillStyle = '#eafff2'; g.globalAlpha = 0.55; }
        else { g.fillStyle = opts.codeColor; g.globalAlpha = (1 - k / len) * 0.32; }
        g.fillText(MATRIX_CHARS[ci], i * fs + fs / 2, y);
      }
    }
    g.globalAlpha = 1;
  }

  function drawTerminal(g, x, y, w, h, lt, side) {
    g.fillStyle = 'rgba(0, 12, 5, 0.84)'; g.fillRect(x, y, w, h);
    g.strokeStyle = rgba(opts.codeColor, 0.7); g.lineWidth = 2; g.strokeRect(x, y, w, h);
    g.fillStyle = rgba(opts.codeColor, 0.18); g.fillRect(x, y, w, 34);
    g.font = '400 18px "Share Tech Mono", monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = opts.codeColor;
    g.fillText(side ? 'root@target:/var/log# tail -f' : 'root@target:~# ./exploit.sh', x + 12, y + 17);
    g.save(); g.beginPath(); g.rect(x + 4, y + 38, w - 8, h - 42); g.clip();
    const rate = side ? 8 : 11, lineH = 25;
    const total = lt * rate, shown = Math.floor(total), frac = total - shown;
    const visible = Math.floor((h - 50) / lineH);
    const first = Math.max(0, shown - visible + 1);
    g.font = '400 19px "Share Tech Mono", monospace';
    for (let n = first; n <= shown; n++) {
      let text = termLine(n, side, opts.seed);
      if (n === shown) text = text.slice(0, Math.ceil(text.length * frac));
      const ly = y + 52 + (n - first) * lineH;
      g.fillStyle = /^(ACCESS|\[!\])/.test(text) ? opts.alertColor : opts.codeColor;
      g.fillText(text, x + 12, ly);
      if (n === shown && Math.floor(lt * 3) % 2 === 0) g.fillRect(x + 14 + g.measureText(text).width, ly - 9, 10, 18);
    }
    g.restore();
  }

  // Rounded warning triangle with an exclamation mark and a soft pulsing glow.
  function drawWarnSign(g, cx, cy, size, pulse) {
    const hgt = size * 0.87;
    const tri = (k) => {
      g.beginPath();
      g.moveTo(cx, cy - (hgt / 2) * k);
      g.lineTo(cx + (size / 2) * k, cy + (hgt / 2) * k);
      g.lineTo(cx - (size / 2) * k, cy + (hgt / 2) * k);
      g.closePath();
    };
    g.save();
    g.lineJoin = 'round';
    g.fillStyle = g.strokeStyle = opts.alertColor;
    g.globalAlpha = 0.12 + 0.18 * pulse;
    g.lineWidth = size * 0.16; tri(1.12); g.fill(); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = size * 0.09; tri(1); g.fill(); g.stroke();
    g.fillStyle = '#140004';
    g.beginPath(); g.roundRect(cx - size * 0.045, cy - hgt * 0.16, size * 0.09, hgt * 0.4, size * 0.045); g.fill();
    g.beginPath(); g.arc(cx, cy + hgt * 0.34, size * 0.056, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function fitFont(g, text, weight, size, family, maxW, min = 28) {
    let fs = size;
    g.font = `${weight} ${fs}px ${family}`;
    while (fs > min && g.measureText(text).width > maxW) { fs -= 4; g.font = `${weight} ${fs}px ${family}`; }
    return fs;
  }

  function drawWarningBox(g, lt, ht) {
    const bw = 1000, bh = 40 + (opts.warnIcon ? 170 : 0) + 105 + 50 + (opts.progress ? 60 : 0) + 30;
    const bx = (W - bw) / 2, by = (H - bh) / 2;
    const pulse = 0.5 + 0.5 * Math.sin(lt * Math.PI * 2 * 1.2);
    g.strokeStyle = rgba(opts.alertColor, 0.12 + 0.2 * pulse);
    g.lineWidth = 14; g.strokeRect(bx - 10, by - 10, bw + 20, bh + 20);
    g.fillStyle = 'rgba(8, 0, 2, 0.92)'; g.fillRect(bx, by, bw, bh);
    g.strokeStyle = opts.alertColor; g.lineWidth = 4; g.strokeRect(bx, by, bw, bh);

    let y = by + 40;
    if (opts.warnIcon) {
      drawWarnSign(g, W / 2, y + 66, 150, pulse);
      y += 170;
    }
    // Title: slow blink; RGB ghosting + jitter only during the takeover entrance
    const blink = Math.floor(lt / 0.6) % 2 === 0;
    const entering = ht >= 0 && ht < 0.5;
    const jitter = entering ? (hash(opts.seed, Math.floor(ht * 30), 5) - 0.5) * 34 * (1 - ht / 0.5) : 0;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, opts.title, 900, 96, 'Orbitron, sans-serif', bw - 100);
    const ty = y + 50;
    if (entering) {
      g.globalAlpha = 0.5 * (1 - ht / 0.5);
      g.fillStyle = '#00e5ff'; g.fillText(opts.title, W / 2 - 6 + jitter, ty);
      g.fillStyle = '#ff00aa'; g.fillText(opts.title, W / 2 + 6 + jitter, ty);
      g.globalAlpha = 1;
    }
    g.fillStyle = blink ? opts.alertColor : '#ffffff';
    g.fillText(opts.title, W / 2 + jitter, ty);
    y += 105;
    if (opts.subtitle.trim()) {
      fitFont(g, opts.subtitle, 700, 30, 'Orbitron, sans-serif', bw - 100, 16);
      g.fillStyle = 'rgba(255, 255, 255, 0.82)';
      g.fillText(opts.subtitle, W / 2, y);
    }
    y += 50;

    if (opts.progress) {
      const p = clamp01(ht / Math.max(0.5, opts.hackDuration * 0.85));
      const pct = Math.floor(100 * (1 - Math.pow(1 - p, 1.6)));
      const px = bx + 90, pw = bw - 180;
      g.font = '400 20px "Share Tech Mono", monospace';
      g.fillStyle = rgba(opts.alertColor, 0.95);
      if (opts.progressLabel.trim()) { g.textAlign = 'left'; g.fillText(opts.progressLabel, px, y); }
      g.textAlign = 'right'; g.fillText(`${pct}%`, px + pw, y);
      const barY = y + 18;
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(px, barY, pw, 10);
      g.fillStyle = opts.alertColor; g.fillRect(px, barY, pw * (pct / 100), 10);
    }
  }

  function drawPopups(g, t) {
    for (const p of s.popups) {
      if (t < p.at) break;
      const k = clamp01((t - p.at) / 0.16);
      const sc = 0.75 + 0.25 * easeOutBack(k);
      const w = 380, h = 100;
      g.save();
      g.globalAlpha = k;
      g.translate(p.x + w / 2, p.y + h / 2); g.scale(sc, sc); g.translate(-w / 2, -h / 2);
      g.fillStyle = 'rgba(6, 6, 6, 0.94)'; g.fillRect(0, 0, w, h);
      g.fillStyle = opts.alertColor; g.fillRect(0, 0, w, 30);
      g.strokeStyle = rgba(opts.alertColor, 0.8); g.lineWidth = 2; g.strokeRect(0, 0, w, h);
      g.font = '700 15px Orbitron, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
      g.fillText('WARNING', 14, 16);
      fitFont(g, p.text, 400, 24, '"Share Tech Mono", monospace', w - 36, 14);
      g.fillStyle = opts.alertColor;
      g.fillText(p.text, 18, 66);
      g.restore();
    }
  }

  function drawHazard(g, y, lt) {
    const h = 22;
    g.save(); g.beginPath(); g.rect(0, y, W, h); g.clip();
    g.fillStyle = '#ffd400'; g.fillRect(0, y, W, h);
    g.fillStyle = '#111111';
    const off = (lt * 40) % 44;
    for (let x = -88 + off; x < W + 44; x += 44) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + 22, y + h); g.lineTo(x + 22 + h, y); g.lineTo(x + h, y); g.closePath(); g.fill(); }
    g.restore();
  }

  function drawHacked(g, t) {
    logical(g); resetState(g);
    const lt = Math.max(0, t - s.start), ht = t - s.glitchEnd;
    if (hackClear) g.clearRect(0, 0, W, H);
    else { g.fillStyle = '#010503'; g.fillRect(0, 0, W, H); }
    if (opts.matrix) drawMatrix(g, lt);
    if (opts.terminal) {
      drawTerminal(g, 40, 120, 430, 840, lt, 0);
      drawTerminal(g, W - 470, 120, 430, 840, lt + 0.37, 1);
    }
    if (opts.popups) drawPopups(g, t);
    drawWarningBox(g, lt, ht);
    if (opts.hazard) { drawHazard(g, 0, lt); drawHazard(g, H - 22, lt); }
    // CRT overlay: light scanlines + vignette
    // (source-atop keeps scanlines on drawn content only, so transparent areas stay fully transparent)
    g.globalAlpha = 0.6; g.globalCompositeOperation = 'source-atop';
    g.fillStyle = scanPattern(g); g.fillRect(0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (!hackClear) {
      const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.65);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
  }

  // ---------- glitch compositor ----------
  function glitchCompose(src, amount, tick) {
    const cw = canvas.width, ch = canvas.height, k = scale();
    const R = (n) => hash(opts.seed * 13 + tick, n, 17);
    // RGB channel split
    const shift = amount * 28 * (0.4 + R(1)) * k;
    pixel(work.g); resetState(work.g);
    if (shift > 1) {
      for (const [l, col] of [[chR, '#ff0000'], [chC, '#00ffff']]) {
        pixel(l.g); resetState(l.g);
        l.g.drawImage(src, 0, 0);
        l.g.globalCompositeOperation = 'multiply';
        l.g.fillStyle = col; l.g.fillRect(0, 0, cw, ch);
        // restore the source alpha (multiply would paint the tint into transparent pixels)
        l.g.globalCompositeOperation = 'destination-in';
        l.g.drawImage(src, 0, 0);
        l.g.globalCompositeOperation = 'source-over';
      }
      if (transparent) work.g.clearRect(0, 0, cw, ch);
      else { work.g.fillStyle = '#000'; work.g.fillRect(0, 0, cw, ch); }
      work.g.globalCompositeOperation = 'lighter';
      work.g.drawImage(chR.c, shift, (R(2) - 0.5) * shift * 0.4);
      work.g.drawImage(chC.c, -shift, 0);
      work.g.globalCompositeOperation = 'source-over';
    } else {
      if (transparent) work.g.clearRect(0, 0, cw, ch);
      work.g.drawImage(src, 0, 0);
    }
    pixel(ctx); resetState(ctx);
    if (transparent) ctx.clearRect(0, 0, cw, ch);
    // occasional vertical roll
    if (R(3) < amount * 0.18) {
      const dy = Math.round((R(4) - 0.5) * 240 * k);
      ctx.drawImage(work.c, 0, dy); ctx.drawImage(work.c, 0, dy > 0 ? dy - ch : dy + ch);
    } else ctx.drawImage(work.c, 0, 0);
    // horizontal slice displacement
    const slices = Math.floor(2 + amount * 16 * R(5) + amount * 4);
    for (let i = 0; i < slices; i++) {
      const y = Math.floor(R(10 + i) * ch);
      const hh = Math.max(2, Math.floor((4 + R(40 + i) * 110 * amount) * k));
      const dx = Math.round((R(70 + i) - 0.5) * 2 * amount * 240 * k);
      if (transparent) ctx.clearRect(0, y, cw, hh);
      ctx.drawImage(work.c, 0, y, cw, hh, dx, y, cw, hh);
    }
    // noise / colour blocks
    const blocks = Math.floor(amount * 12 * R(6));
    const cols = [opts.codeColor, opts.alertColor, '#ffffff', '#ff00aa', '#00e5ff'];
    for (let i = 0; i < blocks; i++) {
      const bw = (40 + R(100 + i) * 520) * k, bh = (6 + R(130 + i) * 90) * k;
      const bx = R(160 + i) * cw - bw / 2, by = R(190 + i) * ch;
      const type = R(220 + i);
      if (type < 0.4) {
        ctx.globalAlpha = 0.5 + R(250 + i) * 0.5;
        const tile = noiseTiles[Math.floor(R(280 + i) * noiseTiles.length)];
        ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(bx, by, bw, bh);
      } else if (type < 0.75) {
        ctx.globalAlpha = 0.25 + R(250 + i) * 0.55;
        ctx.fillStyle = cols[Math.floor(R(310 + i) * cols.length)]; ctx.fillRect(bx, by, bw, bh);
      } else {
        ctx.globalAlpha = 1;
        const sy = Math.max(0, Math.min(ch - bh, by + (R(340 + i) - 0.5) * 300 * k));
        ctx.drawImage(work.c, Math.max(0, bx), sy, Math.max(1, bw), Math.max(1, bh), bx + (R(370 + i) - 0.5) * 80 * k, by, bw, bh);
      }
    }
    ctx.globalAlpha = 1;
    // thin tear lines
    const lines = Math.floor(amount * 6 * R(7));
    for (let i = 0; i < lines; i++) {
      ctx.fillStyle = R(400 + i) < 0.5 ? 'rgba(255,255,255,0.7)' : rgba(opts.codeColor, 0.8);
      ctx.fillRect(0, R(430 + i) * ch, cw, Math.max(1, 2 * k));
    }
    // invert flash
    if (!transparent && R(8) < amount * 0.1) {   // 'difference' would turn transparent pixels white
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function renderGlitched(t, showHack, amount) {
    sizeLayers();
    if (showHack) drawHacked(layer.g, t); else drawStart(layer.g);
    glitchCompose(layer.c, amount, Math.floor(t * 24));
  }

  function draw(t) {
    t = Math.max(0, Math.min(s.total, t));
    const tick = Math.floor(t * 24);
    const I = opts.glitchIntensity;
    const R = (n) => hash(opts.seed * 31 + tick, n, 23);

    if (t < s.start) { drawStart(ctx); return; }

    if (t < s.glitchEnd) {
      const p = (t - s.start) / Math.max(0.001, s.glitchEnd - s.start);
      const burst = R(1) < 0.35 + 0.65 * p;
      const amount = I * (0.25 + 0.75 * p) * (burst ? 1 : 0.15);
      const showHack = p > 0.92 || R(2) < Math.pow(p, 1.3) * 0.9;
      renderGlitched(t, showHack, amount);
      return;
    }

    if (t < s.hackEnd || opts.ending === 'hold') {
      const g = s.glitches.find((m) => t >= m.at && t < m.at + m.dur);
      // Short settle-glitch right after the takeover, plus periodic mini glitches.
      const settle = t - s.glitchEnd < 0.25 ? (1 - (t - s.glitchEnd) / 0.25) * 0.6 : 0;
      const amount = Math.max(settle, g ? I * 0.45 * (0.6 + 0.4 * R(3)) : 0);
      if (amount > 0.02) renderGlitched(t, true, amount);
      else drawHacked(ctx, t);
      return;
    }

    const q = t - s.hackEnd;
    if (opts.ending === 'glitch_out') {
      if (q < GLITCH_OUT) {
        const p = q / GLITCH_OUT;
        const showHack = R(4) < 1 - Math.pow(p, 1.2);
        renderGlitched(t, showHack, I * (1 - p * 0.6));
      } else drawStart(ctx);
      return;
    }
    // fade to black
    if (q < 0.2) renderGlitched(t, true, I * 0.5 * (1 - q / 0.2));
    else drawHacked(ctx, t);
    logical(ctx); resetState(ctx);
    // fully transparent video: fade out to alpha 0 instead of painting black
    if (hackClear) ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${clamp01(q / (OUTRO_DURATION.black - 0.1))})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    schedule: s,
    soundtrack,
    draw,
    reset() {},
    dispose() {
      for (const l of [layer, work, chR, chC]) { l.c.width = 0; l.c.height = 0; }
    },
  };
}

// ---------- procedural soundtrack ----------
export function hackSoundtrack(schedule, options = {}) {
  const opts = normalizeHackOpts(options);
  const pcm = new Float32Array(Math.ceil(schedule.total * SR));
  if (!opts.sounds || !opts.volume) return pcm;
  const vol = opts.volume;
  let seed = (opts.seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const add = (i, v) => { if (i >= 0 && i < pcm.length) pcm[i] += v; };

  // Bit-crushed noise + square chirp burst
  function glitchBurst(at, dur, amp) {
    const n = Math.floor(dur * SR), o = Math.floor(at * SR);
    const crush = 4 + Math.floor(rnd() * 28), f = 90 + rnd() * 1700, sq = rnd() < 0.6;
    let held = 0;
    for (let i = 0; i < n; i++) {
      if (i % crush === 0) held = rnd() * 2 - 1;
      const t = i / SR, env = Math.min(1, i / 60) * Math.min(1, (n - i) / 200);
      const tone = sq ? (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1) * 0.35 : 0;
      add(o + i, (held * 0.6 + tone) * env * amp);
    }
  }

  // Glitch phase
  const gDur = schedule.glitchEnd - schedule.start;
  for (let k = 0; k < Math.ceil(gDur * 24); k++) {
    const at = schedule.start + k / 24, p = k / Math.max(1, gDur * 24);
    if (rnd() < 0.3 + 0.6 * p) glitchBurst(at, 0.03 + rnd() * 0.06, 0.28 * vol * (0.4 + 0.6 * p) * opts.glitchIntensity);
  }

  // Takeover impact: sub drop + noise crack
  {
    const o = Math.floor(schedule.glitchEnd * SR), n = Math.floor(1.6 * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 18))) / SR;
      add(o + i, (Math.sin(ph) * Math.exp(-t * 2.6) * 0.75 + (rnd() * 2 - 1) * Math.exp(-t * 14) * 0.45) * vol);
    }
  }

  // Alarm siren + low drone during the hacked screen
  {
    const o = Math.floor((schedule.glitchEnd + 0.3) * SR), end = Math.floor(schedule.hackEnd * SR);
    let ph = 0;
    for (let i = o; i < end && i < pcm.length; i++) {
      const t = (i - o) / SR, cyc = t % 0.8, f = cyc < 0.4 ? 880 : 620, local = cyc % 0.4;
      const env = Math.min(1, local / 0.01) * Math.max(0, 1 - Math.max(0, local - 0.28) / 0.06);
      ph += (2 * Math.PI * f) / SR;
      const fadeOut = Math.min(1, (end - i) / (0.05 * SR));
      add(i, Math.tanh(3 * Math.sin(ph)) * env * 0.11 * vol * fadeOut);
      const tt = i / SR;
      add(i, (Math.sin(2 * Math.PI * 55 * tt) + 0.5 * Math.sin(2 * Math.PI * 110.5 * tt)) * 0.045 * vol * fadeOut);
    }
  }

  // Pop-up error dings
  for (const p of schedule.popups) {
    const o = Math.floor(p.at * SR);
    for (const [start, len, f] of [[0, 0.09, 740], [0.09, 0.13, 520]]) {
      const n = Math.floor(len * SR), s0 = o + Math.floor(start * SR);
      for (let i = 0; i < n; i++) {
        const t = i / SR, env = Math.min(1, i / 80) * Math.exp(-t * 18);
        add(s0 + i, Math.sin(2 * Math.PI * f * t) * env * 0.26 * vol);
      }
    }
  }

  // Mini glitches
  for (const g of schedule.glitches) glitchBurst(g.at, g.dur, 0.2 * vol * opts.glitchIntensity);

  // Outro
  if (opts.ending === 'glitch_out') {
    for (let k = 0; k < Math.ceil(GLITCH_OUT * 24); k++) {
      if (rnd() < 0.8) glitchBurst(schedule.hackEnd + k / 24, 0.03 + rnd() * 0.05, 0.26 * vol * opts.glitchIntensity);
    }
  } else if (opts.ending === 'black') {
    glitchBurst(schedule.hackEnd, 0.18, 0.2 * vol);
  }

  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.tanh(pcm[i] * 1.1) * 0.92;
  return pcm;
}
