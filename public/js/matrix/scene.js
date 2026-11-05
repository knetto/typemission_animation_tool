// Hacking Code (Matrix Loop) scene: falling green hacking numbers on black, transparent, greenscreen or bluescreen.
// Mathematically periodic over `opts.duration` so every exported video (MP4 / WebM / MOV) or GIF loops 100% seamlessly.
import { SR } from '../audio/engine.js';

export const W = 1920, H = 1080;

export const MATRIX_BACKGROUNDS = [
  { id: 'black', name: 'Zwart', color: '#000000' },
  { id: 'transparent', name: 'Transparant', color: 'transparent' },
  { id: 'green', name: 'Greenscreen', color: '#00b140' },
  { id: 'blue', name: 'Bluescreen', color: '#0047bb' },
];

export const MATRIX_CHARSETS = [
  { id: 'numbers', name: 'Hacking Cijfers (0–9)', chars: '0123456789', sample: '0123456789' },
  { id: 'binary', name: 'Binair (0 & 1)', chars: '01', sample: '01011001' },
  { id: 'hex', name: 'Hacking Hex (0–9, A–F)', chars: '0101010123456789ABCDEF', sample: '0F 4A 9C 01' },
  { id: 'matrix', name: 'Matrix Code (Cijfers & Symbolen)', chars: '0101010123456789ABCDEF{}[]<>/\\;:=+*#$%&!?_|', sample: '01{A}#9/F' },
  { id: 'custom', name: 'Eigen cijfers / tekens', chars: '', sample: 'Aangepast' },
];

export const MATRIX_FLOW_MODES = [
  { id: 'matrix', name: 'Matrix-raster', desc: 'Cijfers staan op een vast raster en lichten per rij op terwijl de codegolf naar beneden valt.' },
  { id: 'smooth', name: 'Vloeiend vallend', desc: 'De cijfers glijden zelf continu van boven naar beneden over het scherm.' },
];

export const MATRIX_COLOR_PRESETS = [
  { color: '#00ff66', name: 'Hacking Groen' },
  { color: '#22c55e', name: 'Fosfor Groen' },
  { color: '#00e5ff', name: 'Cyber Cyaan' },
  { color: '#3b82f6', name: 'Data Blauw' },
  { color: '#ff1f3d', name: 'Code Rood' },
  { color: '#ffb000', name: 'Retro Amber' },
];

const num = (v, min, max, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const str = (v, max, d) => (typeof v === 'string' ? v.slice(0, max) : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

export function normalizeMatrixOpts(o = {}) {
  o = o && typeof o === 'object' ? o : {};
  const customChars = str(o.customChars, 120, '0123456789').trim() || '0123456789';
  return {
    v: 1,
    bgMode: MATRIX_BACKGROUNDS.some((b) => b.id === o.bgMode) ? o.bgMode : 'black',
    charset: MATRIX_CHARSETS.some((c) => c.id === o.charset) ? o.charset : 'numbers',
    customChars,
    flowMode: MATRIX_FLOW_MODES.some((m) => m.id === o.flowMode) ? o.flowMode : 'matrix',
    duration: num(o.duration, 1, 30, 4),
    codeColor: color(o.codeColor, '#00ff66'),
    brightHead: o.brightHead !== false,
    glow: o.glow !== false,
    fontSize: Math.round(num(o.fontSize, 16, 56, 28)),
    density: num(o.density, 0.2, 1, 0.75),
    speed: Math.round(num(o.speed, 1, 5, 2)),
    trailLength: Math.round(num(o.trailLength, 5, 32, 16)),
    scanlines: o.scanlines === true,
    sounds: o.sounds === true,
    volume: num(o.volume, 0, 1, 0.5),
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

function parseHexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(rgb, targetRgb, t) {
  const r = Math.round(rgb[0] + (targetRgb[0] - rgb[0]) * t);
  const g = Math.round(rgb[1] + (targetRgb[1] - rgb[1]) * t);
  const b = Math.round(rgb[2] + (targetRgb[2] - rgb[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function resolveCharPool(opts) {
  if (opts.charset === 'custom') return opts.customChars || '0123456789';
  const found = MATRIX_CHARSETS.find((c) => c.id === opts.charset);
  return found?.chars || '0123456789';
}

export function matrixSchedule(options = {}) {
  const opts = normalizeMatrixOpts(options);
  return { total: opts.duration, loop: true };
}

/**
 * @param {HTMLCanvasElement} canvas output canvas (any 16:9 size)
 * @param {object} options matrix_opts
 * @param {{ forGifTransparent?: boolean }} extra
 */
export function createMatrixScene(canvas, options = {}, { forGifTransparent = false } = {}) {
  const opts = normalizeMatrixOpts(options);
  const s = matrixSchedule(opts);
  const soundtrack = matrixSoundtrack(opts);
  const ctx = canvas.getContext('2d');
  const charPool = resolveCharPool(opts);
  const baseRgb = parseHexRgb(opts.codeColor);
  const headHex = mixRgb(baseRgb, [255, 255, 255], 0.8);
  const darkTailRgb = [Math.round(baseRgb[0] * 0.14), Math.round(baseRgb[1] * 0.14), Math.round(baseRgb[2] * 0.14)];

  let scanPat = null;
  function getScanPattern(g) {
    if (scanPat) return scanPat;
    if (typeof document === 'undefined' || typeof g.createPattern !== 'function') return 'rgba(0,0,0,0.08)';
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const pg = c.getContext('2d');
    pg.fillStyle = 'rgba(0,0,0,0.28)';
    pg.fillRect(0, 0, 4, 2);
    scanPat = g.createPattern(c, 'repeat');
    return scanPat;
  }

  const transparent = opts.bgMode === 'transparent';
  const gifAlphaMode = transparent && forGifTransparent;

  // Precompute column parameters so drawing each frame is fast and 100% deterministic
  const fs = opts.fontSize;
  const cols = Math.ceil(W / fs);
  const visibleRows = Math.ceil(H / fs);
  const colData = [];

  for (let i = 0; i < cols; i++) {
    if (hash(opts.seed, i, 1) > opts.density) continue;
    const len = Math.max(4, Math.round(opts.trailLength * (0.65 + 0.7 * hash(opts.seed, i, 2))));
    const periodRows = opts.flowMode === 'smooth'
      ? visibleRows + len + Math.floor(hash(opts.seed, i, 3) * 8)
      : Math.max(len + 4, Math.round(visibleRows * (0.65 + 0.65 * hash(opts.seed, i, 3))));
    const baseCycles = Math.max(1, opts.speed);
    // Exact integer cycles per loop duration guarantees t=0 and t=duration match bit-for-bit
    const cycles = hash(opts.seed, i, 4) > 0.62 ? baseCycles + 1 : baseCycles;
    const offset = hash(opts.seed, i, 5);
    const hasSecondDrop = opts.flowMode === 'smooth' && periodRows >= len * 2.2 && hash(opts.seed, i, 6) < opts.density * 0.65;
    colData.push({ i, x: i * fs + fs / 2, len, periodRows, cycles, offset, hasSecondDrop });
  }

  function styleForTrail(isHead, fade) {
    if (gifAlphaMode) {
      // GIF only supports 1-bit transparency; bake the brightness fade into RGB so transparent GIFs keep smooth trails
      ctx.globalAlpha = 1;
      ctx.fillStyle = isHead ? headHex : mixRgb(darkTailRgb, baseRgb, fade);
      ctx.shadowBlur = 0;
    } else {
      ctx.globalAlpha = isHead ? 0.96 : Math.max(0.06, fade * 0.88);
      ctx.fillStyle = isHead ? headHex : opts.codeColor;
      if (opts.glow && !transparent) {
        ctx.shadowColor = opts.codeColor;
        ctx.shadowBlur = isHead ? 14 : 6;
      } else {
        ctx.shadowBlur = 0;
      }
    }
  }

  function draw(t) {
    const dur = Math.max(0.5, opts.duration);
    // Periodic normalized phase p in [0, 1) — wraps seamlessly at t = dur
    const p = (((t % dur) + dur) % dur) / dur;

    const k = canvas.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;

    if (transparent) {
      ctx.clearRect(0, 0, W, H);
    } else {
      const bg = MATRIX_BACKGROUNDS.find((b) => b.id === opts.bgMode) || MATRIX_BACKGROUNDS[0];
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.font = `700 ${Math.max(12, fs - 3)}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const col of colData) {
      const { i, x, len, periodRows, cycles, offset, hasSecondDrop } = col;
      const headPos = ((p * cycles + offset) % 1) * periodRows;
      const headFlipTotal = cycles * 12;
      const tailFlipTotal = cycles * 4;

      if (opts.flowMode === 'smooth') {
        const dropOffsets = hasSecondDrop ? [0, periodRows * 0.5] : [0];
        for (let dIdx = 0; dIdx < dropOffsets.length; dIdx++) {
          const hPos = (headPos + dropOffsets[dIdx]) % periodRows;
          for (let kRow = 0; kRow < len; kRow++) {
            const fade = Math.pow(1 - kRow / len, 1.35);
            if (gifAlphaMode && fade < 0.1) continue;
            const pos = (hPos - kRow + periodRows) % periodRows;
            const isHead = kRow === 0 && opts.brightHead;
            const flips = kRow === 0 || hash(opts.seed, i * 31 + kRow + dIdx * 97, 9) < 0.3;
            const flipCount = kRow === 0 ? headFlipTotal : tailFlipTotal;
            const step = flips ? Math.floor(((p * flipCount + hash(opts.seed, i, kRow * 17 + dIdx * 53)) % 1) * flipCount) : 0;
            const ci = Math.floor(hash(opts.seed * 7 + i + dIdx * 131, kRow, step) * charPool.length);
            const ch = charPool[ci] || '0';

            for (const y of [pos * fs, (pos - periodRows) * fs]) {
              if (y < -fs || y > H) continue;
              styleForTrail(isHead, fade);
              ctx.fillText(ch, x, y);
            }
          }
        }
      } else {
        for (let r = 0; r < visibleRows; r++) {
          const rMod = r % periodRows;
          const d = (headPos - rMod + periodRows) % periodRows;
          if (d >= len) continue;
          const fade = Math.pow(1 - d / len, 1.35);
          if (gifAlphaMode && fade < 0.1) continue;
          const isHead = d < 1 && opts.brightHead;
          const flips = d < 1 || hash(opts.seed, i * 31 + r, 9) < 0.28;
          const flipCount = d < 1 ? headFlipTotal : tailFlipTotal;
          const step = flips ? Math.floor(((p * flipCount + hash(opts.seed, i, r * 17 + 11)) % 1) * flipCount) : 0;
          const ci = Math.floor(hash(opts.seed * 7 + i, r, step) * charPool.length);
          const ch = charPool[ci] || '0';

          styleForTrail(isHead, fade);
          ctx.fillText(ch, x, r * fs);
        }
      }
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (opts.scanlines && !gifAlphaMode) {
      ctx.globalAlpha = 0.55;
      ctx.globalCompositeOperation = transparent ? 'source-atop' : 'source-over';
      ctx.fillStyle = getScanPattern(ctx);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  return {
    schedule: s,
    soundtrack,
    draw,
    reset() {},
    dispose() {},
  };
}

// ---------- optional seamless loop digital data soundtrack ----------
export function matrixSoundtrack(options = {}) {
  const opts = normalizeMatrixOpts(options);
  const totalSamples = Math.ceil(opts.duration * SR);
  const pcm = new Float32Array(totalSamples);
  if (!opts.sounds || !opts.volume) return pcm;

  const vol = opts.volume;
  const dur = opts.duration;
  // Number of rhythmic digital data ticks in one loop (exact integer for seamless audio looping)
  const steps = Math.max(8, Math.round(dur * 16));
  const stepSamples = Math.floor(totalSamples / steps);

  for (let s = 0; s < steps; s++) {
    if (hash(opts.seed, s, 201) > 0.72) continue;
    const freq = 640 + Math.floor(hash(opts.seed, s, 202) * 12) * 110;
    const len = Math.min(stepSamples, Math.floor(0.028 * SR));
    const start = s * stepSamples;
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      const env = Math.sin((Math.PI * i) / len);
      const t = i / SR;
      pcm[start + i] += Math.sin(2 * Math.PI * freq * t) * env * 0.12 * vol;
    }
  }

  // Subtle low digital hum (exact integer number of cycles over `dur` so the loop point has zero click)
  const humCycles = Math.max(1, Math.round(dur * 60));
  for (let i = 0; i < totalSamples; i++) {
    const phase = (i / totalSamples) * humCycles * 2 * Math.PI;
    pcm[i] += Math.sin(phase) * 0.025 * vol;
    pcm[i] = Math.tanh(pcm[i] * 1.1) * 0.9;
  }
  return pcm;
}
