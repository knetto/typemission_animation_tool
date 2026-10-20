// Canvas scene renderer: Transmission / Urgent / AI-orb, with CRT on/off.
// Deterministic: draw(t) depends only on t (+ smoothing state), so the same code drives live preview and MP4 export.
import { renderBuiltin, SR } from '../audio/sfxlib.js';
import { measureAudio, formatDbfs } from '../audio/meter.js';

export const W = 1920, H = 1080;

export const SCENES = {
  transmission: { name: 'Incoming Transmission', desc: 'Blauw TV-scherm, logo + audiometer', headline: 'INCOMING TRANSMISSION', status: 'LIVE',
    c: { bg1: '#041633', bg2: '#0a3a78', accent: '#3b8fe0', hi: '#7cc0ff', hud: '#4aa3ff', logo: '#3b8fe0', glow: 'rgba(70,160,255,0.55)' } },
  urgent: { name: 'Urgent / Headquarters', desc: 'Rood alarm, driehoek + URGENT', headline: 'HEADQUARTERS // PRIORITY ALPHA', status: 'PRIORITY ALERT',
    c: { bg1: '#1f0306', bg2: '#5c0d14', accent: '#ff3b3b', hi: '#ff8a7a', hud: '#ff4d4d', logo: '#ff3b3b', glow: 'rgba(255,60,60,0.55)' } },
  ai: { name: 'AI / Computer', desc: 'Siri-achtige orb die op de stem reageert', headline: 'AI TRANSMISSION // S.S.S. CORE', status: 'AI CORE ONLINE',
    c: { bg1: '#05030f', bg2: '#1a0f3d', accent: '#8b5cf6', hi: '#c4b5fd', hud: '#7c6cff', logo: '#8b5cf6', glow: 'rgba(140,100,255,0.55)' } },
};

export const defaultSceneOpts = () => ({ headline: '', hud: true, sfx: true, sfxVolume: 0.7, logoBlue: false, preDelay: 1, postDelay: 0.7, aiLabel: 'S.S.S. AI ASSISTANT' });

// Upgrade saved Dutch preset text while preserving custom titles and labels.
export function normalizeSceneOpts(opts = {}) {
  const normalized = { ...defaultSceneOpts(), ...opts };
  const headline = (normalized.headline || '').trim().toUpperCase();
  if (headline === 'HOOFDKWARTIER // PRIORITEIT ALPHA') normalized.headline = SCENES.urgent.headline;
  if (headline === 'AI TRANSMISSIE // S.S.S. CORE') normalized.headline = SCENES.ai.headline;
  if ((normalized.aiLabel || '').trim().toUpperCase() === 'S.S.S. AI-ASSISTENT') normalized.aiLabel = defaultSceneOpts().aiLabel;
  return normalized;
}

// ---------- logo (traced 1:1 from reference; coordinates in a 627x512 box after translate(-48,-50)) ----------
const LOGO_FILL = [
  'M214,188 C222,148 232,100 247,73 C255,59 268,54 283,57 C303,62 326,80 355,81 C384,80 407,62 427,57 C442,54 455,60 463,73 C478,100 488,148 497,188 C458,201 410,207 355,207 C300,207 252,201 214,188 Z',
  'M112,262 C100,246 135,212 185,208 C205,206 220,209 240,213 C285,222 320,226 356,226 C392,226 428,222 473,213 C493,209 508,206 528,208 C578,212 613,246 601,262 C580,274 543,276 503,281 C453,289 401,294 356,294 C311,294 260,289 210,281 C170,276 133,274 112,262 Z',
  'M55,352 C78,330 102,308 122,302 L186,304 L203,362 L325,497 L135,440 L185,410 Z',
  'M602,297 C626,308 650,330 668,352 L545,410 L590,428 C490,470 380,520 300,555 L528,368 L540,302 Z',
];
const LOGO_LENS = [
  'M218,318 C260,315 305,317 338,325 C337,345 311,357 276,357 C241,357 210,345 210,328 C210,322 213,318 218,318 Z',
  'M507,318 C465,315 420,317 387,325 C388,345 414,357 449,357 C484,357 515,345 515,328 C515,322 512,318 507,318 Z',
];
let logoPaths = null;
const getLogo = () => (logoPaths ||= { fill: LOGO_FILL.map((d) => new Path2D(d)), lens: LOGO_LENS.map((d) => new Path2D(d)) });
export const LOGO_ASPECT = 512 / 627;
export const logoSvg = (color = 'currentColor') =>
  `<svg viewBox="48 50 627 512" aria-hidden="true"><g fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round">${LOGO_FILL.map((d) => `<path d="${d}"/>`).join('')}</g><g fill="${color}">${LOGO_LENS.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;

export function drawLogo(ctx, x, y, w, color) {
  const L = getLogo(), s = w / 627;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-48, -50);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  for (const p of L.fill) { ctx.fill(p); ctx.stroke(p); }
  for (const p of L.lens) ctx.fill(p);
  ctx.restore();
}

// ---------- math helpers ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t, dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-5) break; const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    return sy(clamp01(t));
  };
}
const EASE_ON = bezier(0.2, 0.7, 0.2, 1), EASE_OFF = bezier(0.6, 0, 0.4, 1), EASE_POP = bezier(0.3, 1.6, 0.5, 1), EASE_IO = bezier(0.6, 0, 0.2, 1), EASE_METER = bezier(0.2, 0.9, 0.3, 1);
function keyframes(p, frames) {
  for (let i = 0; i < frames.length - 1; i++) {
    const [a, A] = frames[i], [b, B] = frames[i + 1];
    if (p <= b) { const k = (p - a) / (b - a || 1); const o = {}; for (const key in A) o[key] = lerp(A[key], B[key], k); return o; }
  }
  return { ...frames[frames.length - 1][1] };
}
const CRT_ON = [[0, { sx: 0, sy: 0.003, b: 12, s: 0 }], [0.18, { sx: 1, sy: 0.003, b: 10, s: 0 }], [0.4, { sx: 1, sy: 0.006, b: 8, s: 0.3 }], [0.62, { sx: 1, sy: 1.06, b: 2.6, s: 0.8 }], [0.74, { sx: 1, sy: 0.97, b: 1.6, s: 1 }], [0.86, { sx: 1, sy: 1.01, b: 1.15, s: 1 }], [1, { sx: 1, sy: 1, b: 1, s: 1 }]];
const CRT_OFF = [[0, { sx: 1, sy: 1, b: 1, s: 1 }], [0.12, { sx: 1.01, sy: 1.02, b: 1.8, s: 1 }], [0.42, { sx: 1, sy: 0.004, b: 9, s: 0 }], [0.72, { sx: 0.004, sy: 0.004, b: 14, s: 0 }], [1, { sx: 0, sy: 0, b: 14, s: 0 }]];
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

// ---------- schedule ----------
export function makeSchedule(mode, voiceDur, opts) {
  const tOn = Math.max(0, opts.preDelay ?? 1);
  const tUi = tOn + 1.1, tLogo = tUi + 0.35;
  const tUrgent = mode === 'urgent' ? tLogo + 1.1 : null;
  const tMeter = mode === 'urgent' ? tUrgent + 0.9 : tLogo + 1.1;
  const tAudio = tMeter + 0.5, tAudioEnd = tAudio + voiceDur;
  const tOff = tAudioEnd + Math.max(0, opts.postDelay ?? 0.7);
  const tGlow = tOff + 0.62, total = tOff + 0.85 + 1.2;
  return { tOn, tUi, tLogo, tUrgent, tMeter, tAudio, tAudioEnd, tOff, tGlow, total };
}

// ---------- soundtrack: TV sfx + voice, rendered offline into one buffer ----------
export async function buildSoundtrack(mode, voice, schedule, opts) {
  const total = Math.ceil(schedule.total * SR), out = new Float32Array(total);
  const add = (pcm, t, g = 1) => { const s0 = Math.round(t * SR); for (let i = 0; i < pcm.length && s0 + i < total; i++) out[s0 + i] += pcm[i] * g; };
  if (opts.sfx !== false) {
    const v = opts.sfxVolume ?? 0.7;
    add(await renderBuiltin('crt_on'), schedule.tOn, v);
    add(await renderBuiltin(mode === 'ai' ? 'data' : 'glitch'), schedule.tLogo, v * (mode === 'ai' ? 0.6 : 0.8));
    if (schedule.tUrgent !== null) { add(await renderBuiltin('glitch'), schedule.tUrgent, v * 0.9); add(await renderBuiltin('alert'), schedule.tUrgent + 0.1, v * 0.45); }
    add(await renderBuiltin('crt_off'), schedule.tOff, v);
  }
  add(voice, schedule.tAudio, 1);
  let peak = 0; for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.98) for (let i = 0; i < total; i++) out[i] *= 0.98 / peak;
  return out;
}

// ---------- renderer ----------
export function createScene(canvas, { mode = 'transmission', opts = {}, voice = new Float32Array(1), soundtrack = null } = {}) {
  opts = normalizeSceneOpts(opts);
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  const scene = SCENES[mode] || SCENES.transmission;
  const C = { ...scene.c };
  if (mode === 'urgent' && opts.logoBlue) C.logo = '#3b8fe0';
  const headline = (opts.headline || scene.headline).toUpperCase();
  const schedule = makeSchedule(mode, voice.length / SR, opts);
  let audioPcm = soundtrack || voice, audioOffset = soundtrack ? 0 : schedule.tAudio;

  // noise frames + scanline pattern
  const noiseFrames = Array.from({ length: 6 }, (_, k) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'), img = g.createImageData(320, 180), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = hash(i * 0.37 + k * 1000) * 255; d[i] = v * 0.85; d[i + 1] = v * 0.92; d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0); return c;
  });
  const scan = document.createElement('canvas'); scan.width = 4; scan.height = 6;
  { const g = scan.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, 4, 2); g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 3, 4, 1); }
  let scanPattern = null;

  // audio analysis state
  const BARS = 56, HALF = BARS / 2, WIN = 2048, FFTN = 1024;
  const heights = new Float32Array(BARS), bandVals = new Float32Array(HALF), win = new Float32Array(WIN);
  const hann = Float32Array.from({ length: FFTN }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (FFTN - 1)));
  const coeffs = Float32Array.from({ length: HALF }, (_, i) => 2 * Math.cos((2 * Math.PI * 90 * Math.pow(7000 / 90, i / (HALF - 1))) / SR));
  let lastT = null, smoothRms = 0;

  function analyse(t) {
    const local = t - audioOffset;
    const level = measureAudio(audioPcm, SR, local);
    if (level.live) {
      const c = Math.floor(local * SR) - WIN + 1;
      for (let k = 0; k < WIN; k++) win[k] = audioPcm[c + k] || 0;
      const o = (WIN - FFTN) >> 1;
      for (let i = 0; i < HALF; i++) {
        const cf = coeffs[i]; let s1 = 0, s2 = 0;
        for (let n = 0; n < FFTN; n++) { const s = win[o + n] * hann[n] + cf * s1 - s2; s2 = s1; s1 = s; }
        const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - cf * s1 * s2)) / (FFTN / 4);
        bandVals[i] = clamp01((20 * Math.log10(mag + 1e-9) + 55) / 50);
      }
      return level;
    }
    win.fill(0); bandVals.fill(0);
    return level;
  }

  function resize() {
    if (off.width !== canvas.width || off.height !== canvas.height) { off.width = canvas.width; off.height = canvas.height; scanPattern = null; }
  }

  // ---------- content layers ----------
  function drawBackground(g, t) {
    const grad = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.62);
    grad.addColorStop(0, C.bg2); grad.addColorStop(0.75, C.bg1); grad.addColorStop(1, '#01060f');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
  }

  function drawHud(g, t) {
    g.save();
    g.scale(1.2, 1.2);   // HUD was designed on 1600x900
    g.strokeStyle = C.hud; g.fillStyle = C.hud; g.lineWidth = 1.3;
    // grid
    g.globalAlpha = 0.32 * 0.5 * 0.25;
    g.beginPath();
    for (let x = 0; x <= 1600; x += 40) { g.moveTo(x, 0); g.lineTo(x, 900); }
    for (let y = 0; y <= 900; y += 40) { g.moveTo(0, y); g.lineTo(1600, y); }
    g.stroke();
    g.globalAlpha = 0.32;
    const circle = (x, y, r, w = 1.3, dash = null, rot = 0) => {
      g.save(); g.translate(x, y); g.rotate(rot); g.lineWidth = w; if (dash) g.setLineDash(dash);
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.restore();
    };
    const spin = (period) => ((t % period) / period) * Math.PI * 2;
    // radar
    circle(300, 300, 170); g.globalAlpha = 0.32 * 0.6; circle(300, 300, 130); g.globalAlpha = 0.32;
    circle(300, 300, 150, 3, [120, 60, 30, 60], spin(14));
    circle(300, 300, 90, 3, [200, 80], -spin(22));
    circle(300, 300, 50);
    g.globalAlpha = 0.32 * 0.4; g.beginPath(); g.moveTo(300, 130); g.lineTo(300, 470); g.moveTo(130, 300); g.lineTo(470, 300); g.stroke();
    g.save(); g.translate(300, 300); g.rotate(spin(6)); g.globalAlpha = 0.32 * 0.25;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -130); g.arc(0, 0, 130, -Math.PI / 2, -Math.PI / 4); g.closePath(); g.fill(); g.restore();
    g.globalAlpha = 0.32;
    // label
    g.font = '700 14px Orbitron'; g.letterSpacing = '3px'; g.fillText('SIGNAL QUALITY // TARGET', 1040, 395); g.letterSpacing = '0px';
    // schematic
    g.save(); g.translate(1020, 170);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke(); };
    rr(0, 0, 360, 130, 10); rr(130, 35, 100, 60, 4);
    g.beginPath(); g.moveTo(0, 65); g.lineTo(130, 65); g.moveTo(230, 65); g.lineTo(360, 65); g.moveTo(180, 0); g.lineTo(180, 35); g.moveTo(180, 95); g.lineTo(180, 130); g.stroke();
    rr(0, 180, 360, 160, 6); rr(30, 250, 80, 60, 0); rr(140, 250, 80, 60, 0); rr(250, 250, 80, 60, 0);
    g.restore();
    // right rings
    circle(1500, 110, 40); circle(1500, 110, 26, 3, [40, 20], spin(14));
    circle(1500, 470, 40); circle(1500, 470, 24);
    g.globalAlpha = 0.32 * (Math.floor(t / 0.8) % 2 ? 0.2 : 1); g.beginPath(); g.arc(1500, 470, 10, 0, Math.PI * 2); g.fill(); g.globalAlpha = 0.32;
    g.globalAlpha = 0.32 * 0.7; [90, 60, 80, 40, 70].forEach((w, i) => g.fillRect(1450, 220 + i * 20, w, 8)); g.globalAlpha = 0.32;
    // animated bar chart
    g.globalAlpha = 0.32 * 0.8;
    [[0, 0, 60, 0.2], [16, -20, 80, 0.6], [32, 20, 40, 1], [48, -10, 70, 0.4], [64, 10, 50, 0.8], [80, -30, 90, 0.1], [96, 15, 45, 1.2], [112, -5, 65, 0.5]].forEach(([x, y, h, d]) => {
      const k = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(((t + d) / 1.4) * Math.PI));
      g.fillRect(370 + x, 560 + y + h * (1 - k), 10, h * k);
    });
    g.globalAlpha = 0.32;
    // pies
    circle(150, 640, 40);
    g.globalAlpha = 0.32 * 0.6; g.beginPath(); g.moveTo(150, 640); g.arc(150, 640, 40, -Math.PI / 2, 0.3); g.closePath(); g.fill(); g.globalAlpha = 0.32;
    circle(150, 790, 40); circle(150, 790, 40, 3, [60, 190], -spin(22));
    // bottom rings
    circle(470, 790, 85); circle(470, 790, 60, 3); circle(470, 790, 35);
    circle(860, 790, 70); circle(860, 790, 50, 3, [80, 40], spin(14));
    circle(1060, 790, 70); circle(1060, 790, 48); circle(1060, 790, 22, 3);
    circle(1260, 790, 65, 3, [140, 60], -spin(22)); circle(1260, 790, 40);
    circle(1470, 790, 65); circle(1470, 790, 45); circle(1470, 790, 25, 3);
    // ticks
    g.globalAlpha = 0.32 * 0.7; g.beginPath();
    for (let i = 0; i <= 6; i++) { g.moveTo(60, 120 + i * 30); g.lineTo(60 + (i % 2 ? 20 : 30), 120 + i * 30); }
    g.stroke();
    g.restore();
  }

  function drawBars(g, t, s) {
    const top = 34, bottom = H - 34, left = 77, right = W - 77, fade = clamp01((t - s.tUi) / 0.4) * 0.9;
    if (fade <= 0) return;
    g.save(); g.globalAlpha = fade;
    g.fillStyle = C.hi; g.shadowColor = C.glow; g.shadowBlur = 12;
    g.font = '400 26px "Share Tech Mono"'; g.letterSpacing = '5px'; g.textBaseline = 'middle';
    const blink = Math.floor(t / 0.5) % 2 === 0;
    g.save(); g.fillStyle = C.accent; g.shadowColor = C.accent; g.shadowBlur = 19; g.globalAlpha = fade * (blink ? 1 : 0.2);
    g.beginPath(); g.arc(left + 10, top + 9, 10, 0, Math.PI * 2); g.fill(); g.restore();
    g.textAlign = 'left'; g.fillText(scene.status, left + 34, top + 9);
    g.textAlign = 'right'; g.fillText('SECURE CHANNEL // SSS-HQ', right, top + 9);
    g.font = '400 21px "Share Tech Mono"'; g.letterSpacing = '4px';
    const tc = Math.max(0, t - s.tUi), mm = String(Math.floor(tc / 60)).padStart(2, '0'), ss = String(Math.floor(tc % 60)).padStart(2, '0'), ff = String(Math.floor((tc % 1) * 30)).padStart(2, '0');
    g.textAlign = 'left'; g.fillText(`${mm}:${ss}:${ff}`, left, bottom - 9);
    g.textAlign = 'center'; g.fillText('ENCRYPTION AES-512 ▮ FREQ 147.300 MHz', W / 2, bottom - 9);
    g.textAlign = 'right'; g.fillText('SIGNAL ▮▮▮▮▯', right, bottom - 9);
    g.restore();
  }

  function drawHeadline(g, t, s) {
    const p = (t - s.tUi) / 0.6;
    if (p < 0) return;
    const step = Math.min(1, Math.floor(p * 6) / 6);
    let a = step;
    if (t - s.tUi > 1) a *= Math.floor((t - s.tUi - 1) / 0.7) % 2 ? 0.35 : 1;
    g.save(); g.globalAlpha = a;
    g.font = '900 44px Orbitron'; g.letterSpacing = `${lerp(38, 11.5, step)}px`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = C.hi; g.shadowColor = C.glow; g.shadowBlur = 23;
    g.fillText(headline, W / 2, 97);
    g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 4; g.fillText(headline, W / 2, 97);
    g.restore();
  }

  function glitchState(p) {
    if (p <= 0) return null;
    if (p >= 1) return { a: 1, tx: 0, skew: 0, clip: null };
    if (p < 0.1) return { a: 0, tx: 0, skew: 0, clip: null };
    if (p < 0.2) return { a: 0.8, tx: -23, skew: 0.21, clip: [0, 0.4] };
    if (p < 0.3) return { a: 0, tx: 0, skew: 0, clip: null };
    if (p < 0.42) return { a: 1, tx: 19, skew: 0, clip: [0.4, 1], tint: true };
    if (p < 0.55) return { a: 0.4, tx: 0, skew: 0, clip: null };
    if (p < 0.7) return { a: 1, tx: -8, skew: 0, clip: null };
    return { a: 0.85, tx: 0, skew: 0, clip: null };
  }

  function drawLogoAnimated(g, t, s, x, y, w) {
    const st = glitchState((t - s.tLogo) / 0.9);
    if (!st || st.a <= 0) return;
    const h = w * LOGO_ASPECT;
    g.save(); g.globalAlpha = st.a;
    if (st.clip) { g.beginPath(); g.rect(x - 60, y + h * st.clip[0], w + 120, h * (st.clip[1] - st.clip[0])); g.clip(); }
    g.translate(x + st.tx + w / 2, y + h / 2); g.transform(1, 0, -st.skew, 1, 0, 0); g.translate(-w / 2, -h / 2);
    g.shadowColor = C.glow; g.shadowBlur = 27;
    drawLogo(g, 0, 0, w, st.tint ? C.hi : C.logo);
    g.restore();
  }

  function drawTriangle(g, x, y, w) {
    const s = w / 120;
    g.save(); g.translate(x, y); g.scale(s, s);
    const tri = new Path2D('M60,6 L114,100 L6,100 Z');
    g.fillStyle = alpha(C.accent, 0.15); g.fill(tri);
    g.strokeStyle = C.accent; g.lineWidth = 9; g.lineJoin = 'round'; g.stroke(tri);
    g.fillStyle = C.accent; g.beginPath(); g.roundRect(54, 36, 12, 38, 6); g.fill();
    g.beginPath(); g.arc(60, 86, 7, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawUrgent(g, t, s, cy) {
    const p = clamp01((t - s.tUrgent) / 0.5);
    const scale = lerp(0.6, 1, EASE_POP(p)), a = p;
    const triW = 144, triH = 130;
    g.save(); g.font = '900 115px Orbitron'; g.letterSpacing = '23px';
    const textW = g.measureText('URGENT').width;
    const total = triW + 38 + textW, x0 = W / 2 - total / 2;
    g.translate(W / 2, cy); g.scale(scale, scale); g.translate(-W / 2, -cy);
    g.globalAlpha = a;
    const pulse = 1 + 0.08 * (0.5 - 0.5 * Math.cos(((t - s.tUrgent) % 1) * Math.PI * 2));
    g.save(); g.translate(x0 + triW / 2, cy); g.scale(pulse, pulse);
    g.shadowColor = C.glow; g.shadowBlur = 29 * pulse * 1.4; drawTriangle(g, -triW / 2, -triH / 2, triW); g.restore();
    const blink = Math.floor((t - s.tUrgent) / 0.5) % 2 ? 0.45 : 1;
    g.globalAlpha = a * blink; g.fillStyle = C.accent; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.shadowColor = C.glow; g.shadowBlur = 38; g.fillText('URGENT', x0 + triW + 38, cy + 4);
    g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 6; g.fillText('URGENT', x0 + triW + 38, cy + 4);
    g.restore();
  }

  function drawMeter(g, t, s, x, y, w, h, an, dt) {
    const p = clamp01((t - s.tMeter) / 0.6);
    if (p <= 0) return;
    const sx = EASE_METER(p);
    g.save();
    g.translate(x + w / 2, 0); g.scale(sx, 1); g.translate(-(x + w / 2), 0);
    // frame
    const fx = x - 23, fy = y - 13, fw = w + 46, fh = h + 26, cut = 23;
    g.beginPath(); g.moveTo(fx + cut, fy); g.lineTo(fx + fw, fy); g.lineTo(fx + fw, fy + fh - cut); g.lineTo(fx + fw - cut, fy + fh); g.lineTo(fx, fy + fh); g.lineTo(fx, fy + cut); g.closePath();
    g.fillStyle = alpha(C.bg1, 0.45); g.fill(); g.strokeStyle = alpha(C.accent, 0.45); g.lineWidth = 1.5; g.stroke();
    // labels
    g.font = '400 19px "Share Tech Mono"'; g.letterSpacing = '4px'; g.fillStyle = C.hi; g.globalAlpha = 0.85; g.textBaseline = 'bottom';
    g.textAlign = 'left'; g.fillText('AUDIO AMPLITUDE', x, y - 26);
    g.textAlign = 'right'; g.fillText(formatDbfs(an.dbfs), x + w, y - 26);
    g.globalAlpha = 1;
    // bars
    const gap = w / BARS, bw = gap * 0.55, mid = y + h / 2;
    const kUp = 1 - Math.pow(0.45, dt * 60), kDown = 1 - Math.pow(0.82, dt * 60);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, C.hi); grad.addColorStop(0.5, C.accent); grad.addColorStop(1, C.hi);
    g.fillStyle = grad; g.shadowColor = C.accent; g.shadowBlur = 12;
    for (let i = 0; i < HALF; i++) {
      const target = an.live ? Math.min(1, Math.pow(bandVals[i], 1.5) * (0.7 + an.rms * 2.5)) : 0;
      heights[i] += (target - heights[i]) * (target > heights[i] ? kUp : kDown);
      const bh = Math.max(bw, heights[i] * h * 0.92);
      for (const side of [-1, 1]) {
        const bx = x + w / 2 + side * (i * gap + gap / 2) - bw / 2;
        g.beginPath(); g.roundRect(bx, mid - bh / 2, bw, bh, Math.min(bw / 2, bh / 2)); g.fill();
      }
    }
    g.shadowBlur = 0;
    // waveform
    if (an.live) {
      g.beginPath(); g.lineWidth = 1.5; g.strokeStyle = C.hi; g.globalAlpha = 0.55;
      for (let i = 0; i <= 200; i++) {
        const px = x + (i / 200) * w, env = Math.sin((i / 200) * Math.PI);
        const py = mid + win[Math.floor((i / 200) * (WIN - 1))] * h * 0.45 * env;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    g.globalAlpha = 0.35; g.fillStyle = C.accent; g.fillRect(x, mid - 0.5, w, 1);
    g.restore();
  }

  function drawOrb(g, t, s, an, dt) {
    const p = clamp01((t - s.tLogo) / 0.9);
    if (p <= 0) return;
    smoothRms += ((an.live ? an.rms : 0) - smoothRms) * (1 - Math.pow(0.8, dt * 60));
    const amp = Math.min(1, smoothRms * 4.5);
    const boot = p < 1 ? EASE_POP(p) : 1, flick = p < 0.5 ? (hash(Math.floor(t * 30)) > 0.4 ? 1 : 0.3) : 1;
    const cx = W / 2, cy = 520, R = 190 * boot * (1 + amp * 0.12 + 0.015 * Math.sin(t * 2));
    if (R <= 1) return;
    g.save(); g.globalAlpha = flick;
    // outer glow
    const og = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.4);
    og.addColorStop(0, alpha(C.accent, 0.35 + amp * 0.3)); og.addColorStop(1, alpha(C.accent, 0));
    g.fillStyle = og; g.beginPath(); g.arc(cx, cy, R * 2.4, 0, Math.PI * 2); g.fill();
    // waveform ring
    g.lineWidth = 3; g.strokeStyle = alpha('#c4b5fd', 0.75); g.shadowColor = C.glow; g.shadowBlur = 20;
    g.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2, sIdx = Math.floor((i % 160) / 160 * (WIN - 1));
      const r = R * 1.28 + (an.live ? win[sIdx] * 140 : 0) + 4 * Math.sin(a * 6 + t * 2);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(t * 0.6); g.setLineDash([30, 18, 6, 18]); g.lineWidth = 2; g.globalAlpha = flick * 0.5;
    g.beginPath(); g.arc(0, 0, R * 1.5, 0, Math.PI * 2); g.stroke(); g.restore();
    g.shadowBlur = 0;
    // sphere body
    const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#1e1b4b'); body.addColorStop(1, '#0b0820');
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // blobs (Siri-like)
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'lighter';
    const cols = ['#22d3ee', '#8b5cf6', '#f472b6', '#38bdf8'];
    cols.forEach((col, k) => {
      const band = bandVals[Math.min(HALF - 1, 3 + k * 5)] || 0;
      const energy = 0.25 + amp * 0.9 + band * 0.6;
      const ox = Math.cos(t * (0.7 + k * 0.23) + k * 1.7) * R * 0.32 * energy;
      const oy = Math.sin(t * (0.9 + k * 0.17) + k * 2.3) * R * 0.28 * energy;
      g.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = R * (0.55 + 0.12 * energy) * (1 + 0.18 * Math.sin(a * 3 + t * (1.3 + k * 0.4) + k) * energy + 0.08 * Math.sin(a * 5 - t * 2 + k * 3));
        const px = cx + ox + Math.cos(a) * r, py = cy + oy + Math.sin(a) * r;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      const bg = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, R * 0.9);
      bg.addColorStop(0, alpha(col, 0.75)); bg.addColorStop(1, alpha(col, 0));
      g.fillStyle = bg; g.fill();
    });
    g.restore();
    // glass highlight + rim
    const hl = g.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.7);
    hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = alpha('#e0e7ff', 0.35 + amp * 0.4); g.stroke();
    g.restore();
    // caption
    g.save(); g.globalAlpha = clamp01((t - s.tLogo - 0.4) / 0.5);
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = '700 30px Orbitron'; g.letterSpacing = '8px'; g.fillStyle = C.hi; g.shadowColor = C.glow; g.shadowBlur = 18;
    g.fillText((opts.aiLabel || defaultSceneOpts().aiLabel).toUpperCase(), cx, cy + 190 * 1.62 + 30);
    const status = an.live ? 'SPEAKING' : t < s.tAudio ? 'CONNECTING' : 'STANDBY';
    const dots = '.'.repeat(1 + (Math.floor(t * 2) % 3));
    g.font = '400 22px "Share Tech Mono"'; g.letterSpacing = '5px'; g.fillStyle = '#e9d5ff'; g.globalAlpha *= 0.85;
    g.fillText(`● ${status}${an.live ? '' : dots}`, cx, cy + 190 * 1.62 + 78);
    g.restore();
  }

  function drawOverlays(g, t, s) {
    // alarm wash (urgent)
    if (s.tUrgent !== null && t >= s.tUrgent) {
      const a = 0.55 * (0.5 - 0.5 * Math.cos(((t - s.tUrgent) % 1) * Math.PI * 2));
      const wg = g.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.62);
      wg.addColorStop(0, 'rgba(0,0,0,0)'); wg.addColorStop(1, alpha(C.accent, 0.45 * a)); g.fillStyle = wg; g.fillRect(0, 0, W, H);
    }
    // rolling bar
    const ry = -0.2 * H + (((t % 7) / 7) * 1.3 * H);
    const rg = g.createLinearGradient(0, ry, 0, ry + H * 0.18);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.045)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, ry, W, H * 0.18);
    // scanlines
    if (!scanPattern) scanPattern = g.createPattern(scan, 'repeat');
    g.save(); g.fillStyle = scanPattern; g.fillRect(0, 0, W, H); g.restore();
    // vignette + frame
    const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(0, 0, W, 7); g.fillRect(0, H - 7, W, 7); g.fillRect(0, 0, 7, H); g.fillRect(W - 7, 0, 7, H);
    g.fillStyle = alpha(C.accent, 0.55); g.fillRect(7, 7, W - 14, 10); g.fillRect(7, 7, 4, H - 14); g.fillRect(W - 11, 7, 4, H - 14);
  }

  function drawContent(g, t, s, dt) {
    const an = analyse(t);
    drawBackground(g, t);
    drawHud(g, t);
    if (opts.hud !== false) drawBars(g, t, s);
    drawHeadline(g, t, s);
    if (mode === 'ai') {
      drawOrb(g, t, s, an, dt);
    } else {
      // column layout: logo / (urgent) / meter
      let logoW = 653;
      if (mode === 'urgent') logoW = s.tUrgent !== null && t >= s.tUrgent ? lerp(576, 365, EASE_IO(clamp01((t - s.tUrgent) / 0.8))) : 576;
      const logoH = logoW * LOGO_ASPECT, meterH = 140, urgentH = mode === 'urgent' && t >= s.tUrgent ? 130 : 0;
      const gap = mode === 'urgent' ? 38 : 49;
      const total = logoH + gap + (urgentH ? urgentH + gap : 0) + meterH;
      let y = (H + 65 - total) / 2;
      drawLogoAnimated(g, t, s, (W - logoW) / 2, y, logoW);
      y += logoH + gap;
      if (urgentH) { drawUrgent(g, t, s, y + urgentH / 2); y += urgentH + gap; }
      drawMeter(g, t, s, (W - 998) / 2, y + 36, 998, meterH - 36, an, dt);
    }
    drawOverlays(g, t, s);
  }

  function noiseLevel(t, s) {
    const bursts = [[s.tOn, 0.55, 1.2], [s.tLogo, 0.15, 0.3], [s.tOff, 0.4, 0.7]];
    if (s.tUrgent !== null) bursts.push([s.tUrgent, 0.12, 0.25]);
    let n = 0;
    for (const [t0, peak, d] of bursts) { const p = (t - t0) / d; if (p >= 0 && p < 1) n = Math.max(n, peak * (1 - p) * (0.6 + 0.4 * hash(Math.floor(t * 60)))); }
    return n;
  }

  // ---------- main draw ----------
  function draw(t) {
    resize();
    if (lastT !== null && (t < lastT || t - lastT > 0.15)) reset();
    const dt = lastT === null ? 1 / 60 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    const s = schedule, scale = canvas.width / W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    let crt = null;
    if (t >= s.tOn && t < s.tOn + 1.1) crt = keyframes(EASE_ON(clamp01((t - s.tOn) / 1.1)), CRT_ON);
    else if (t >= s.tOn + 1.1 && t < s.tOff) crt = { sx: 1, sy: 1, b: 1, s: 1 };
    else if (t >= s.tOff && t < s.tOff + 0.85) crt = keyframes(EASE_OFF(clamp01((t - s.tOff) / 0.85)), CRT_OFF);

    if (crt && crt.sx > 0.0005 && crt.sy > 0.0005) {
      octx.setTransform(scale, 0, 0, scale, 0, 0);
      octx.globalAlpha = Math.floor(t / 0.06) % 2 ? 0.965 : 1;   // subtle flicker
      octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H);
      drawContent(octx, t, s, dt);
      octx.globalAlpha = 1;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(crt.sx, crt.sy); ctx.translate(-canvas.width / 2, -canvas.height / 2);
      if (crt.b !== 1 || crt.s !== 1) ctx.filter = `brightness(${crt.b.toFixed(2)}) saturate(${crt.s.toFixed(2)})`;
      ctx.drawImage(off, 0, 0);
      ctx.restore(); ctx.filter = 'none';
    } else if (t >= s.tOn && t < s.tOff) {
      analyse(t);
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // power-on flash line
    const fp = (t - s.tOn) / 0.6;
    if (fp >= 0 && fp < 1) {
      ctx.globalAlpha = 1 - fp;
      const lg = ctx.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.2, '#fff'); lg.addColorStop(0.8, '#fff'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, H / 2 - 3, W, 6); ctx.globalAlpha = 1;
    }
    // afterglow dot
    const gp = (t - s.tGlow) / 1.1;
    if (gp >= 0 && gp < 1) {
      const a = gp < 0.15 ? gp / 0.15 : 1 - (gp - 0.15) / 0.85;
      const sc = gp < 0.15 ? lerp(0.4, 1.4, gp / 0.15) : lerp(1.4, 0.2, (gp - 0.15) / 0.85);
      const r = 19 * sc * 1.2;
      const dg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r * 2);
      dg.addColorStop(0, `rgba(255,255,255,${a})`); dg.addColorStop(0.3, `rgba(200,230,255,${0.8 * a})`); dg.addColorStop(0.7, 'rgba(120,180,255,0)');
      ctx.fillStyle = dg; ctx.fillRect(W / 2 - r * 2, H / 2 - r * 2, r * 4, r * 4);
    }
    // static noise
    const nl = noiseLevel(t, s);
    if (nl > 0.01) {
      ctx.globalAlpha = nl; ctx.globalCompositeOperation = 'screen'; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(noiseFrames[Math.floor(t * 60) % noiseFrames.length], 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
    }
  }

  function reset() { heights.fill(0); lastT = null; smoothRms = 0; }

  function setSoundtrack(pcm) { audioPcm = pcm; audioOffset = 0; reset(); }
  return { draw, reset, setSoundtrack, measure: (t) => measureAudio(audioPcm, SR, t - audioOffset), schedule, mode, colors: C };
}

export async function ensureFonts() {
  await Promise.all(['900 44px Orbitron', '700 14px Orbitron', '400 26px "Share Tech Mono"'].map((f) => document.fonts.load(f).catch(() => {})));
}
