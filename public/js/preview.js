// Shared one-at-a-time preview player + Pro Studio Waveform renderer
import { encodeWav, h } from './util.js';
import { SR, decodeUrl } from './audio/engine.js';

const peakCache = new Map();
const pendingDecodes = new Map();

// Extract high-resolution normalized peaks (up to 160 buckets) from PCM
export function computePeaksFromPcm(pcm, buckets = 140) {
  if (!pcm || !pcm.length) return new Float32Array(buckets);
  const out = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(pcm.length / buckets));
  let maxPeak = 0.005;

  for (let i = 0; i < buckets; i++) {
    const start = i * step;
    const end = Math.min(pcm.length, start + step);
    const stride = Math.max(1, Math.floor((end - start) / 48));
    let sumSq = 0;
    let count = 0;
    let peak = 0;
    for (let j = start; j < end; j += stride) {
      const v = Math.abs(pcm[j]);
      if (v > peak) peak = v;
      sumSq += v * v;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    // Blend peak and RMS for a natural, musical waveform profile
    const val = peak * 0.65 + rms * 0.35;
    out[i] = val;
    if (val > maxPeak) maxPeak = val;
  }

  for (let i = 0; i < buckets; i++) {
    // Slight gamma curve (0.8) so quiet details remain visible while transients pop
    out[i] = Math.pow(Math.min(1, out[i] / maxPeak), 0.82);
  }
  return out;
}

// Natural-looking transient envelope while real audio decodes
export function deterministicFallbackPeaks(seedStr = 'sound', buckets = 140) {
  let hVal = 2166136261;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) {
    hVal ^= s.charCodeAt(i);
    hVal = Math.imul(hVal, 16777619);
  }
  const nextRand = () => {
    hVal ^= hVal << 13;
    hVal ^= hVal >>> 17;
    hVal ^= hVal << 5;
    return ((hVal >>> 0) % 10000) / 10000;
  };

  const out = new Float32Array(buckets);
  // Generate 3–5 transient clusters
  const numClusters = 2 + Math.floor(nextRand() * 4);
  const clusters = Array.from({ length: numClusters }, () => ({
    pos: 0.06 + nextRand() * 0.82,
    width: 0.04 + nextRand() * 0.16,
    amp: 0.45 + nextRand() * 0.55,
  }));

  let maxV = 0.01;
  for (let i = 0; i < buckets; i++) {
    const t = i / (buckets - 1);
    let env = 0.04;
    for (const c of clusters) {
      const dist = (t - c.pos) / c.width;
      // Fast attack, exponential decay
      const shape = dist < 0
        ? Math.exp(-dist * dist * 6)
        : Math.exp(-dist * 1.8);
      env += c.amp * shape;
    }
    const detail = 0.55 + nextRand() * 0.45;
    const edgeFade = Math.min(1, t * 14) * Math.min(1, (1 - t) * 8);
    out[i] = env * detail * edgeFade;
    if (out[i] > maxV) maxV = out[i];
  }
  for (let i = 0; i < buckets; i++) {
    out[i] = Math.max(0.03, Math.min(1, out[i] / maxV));
  }
  return out;
}

// Sample the 140-bucket array into `barCount` display bars
function resamplePeaks(peaks, barCount) {
  const out = new Float32Array(barCount);
  const srcLen = peaks.length;
  for (let i = 0; i < barCount; i++) {
    const pos = (i / barCount) * srcLen;
    const idx = Math.min(srcLen - 1, Math.floor(pos));
    out[i] = peaks[idx];
  }
  return out;
}

export function drawSoundWaveCanvas(canvas, rawPeaks, { progress = 0, hoverProgress = -1, isPlaying = false } = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 160;
  const hPx = canvas.clientHeight || 30;
  if (w <= 0 || hPx <= 0) return;

  const targetW = Math.round(w * dpr);
  const targetH = Math.round(hPx * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hPx);

  // Studio pill-bar geometry: 2px bar + 1.5px gap
  const step = 3.5;
  const barW = 2;
  const barCount = Math.max(16, Math.floor(w / step));
  const bars = resamplePeaks(rawPeaks, barCount);

  // Asymmetric split (62% upper wave, 38% lower reflection) like Splice / SoundCloud / Epidemic
  const midY = Math.round(hPx * 0.6);
  const maxUp = midY - 2;
  const maxDown = hPx - midY - 2;

  // Gradients
  const playedGrad = ctx.createLinearGradient(0, 0, w, 0);
  playedGrad.addColorStop(0, '#38bdf8');
  playedGrad.addColorStop(0.6, '#60a5fa');
  playedGrad.addColorStop(1, '#818cf8');

  const totalBarsWidth = barCount * step - (step - barW);
  const offsetX = Math.max(0, (w - totalBarsWidth) * 0.5);

  for (let i = 0; i < barCount; i++) {
    const x = offsetX + i * step;
    const ratio = i / Math.max(1, barCount - 1);
    const amp = Math.max(0.05, bars[i]);
    const upH = Math.max(1.5, amp * maxUp);
    const downH = Math.max(1, amp * maxDown * 0.72);

    const isPlayed = (isPlaying || progress > 0) && ratio <= progress;
    const isHovered = hoverProgress >= 0 && ratio <= hoverProgress;

    // Upper bar
    ctx.beginPath();
    if (isPlayed) {
      ctx.fillStyle = playedGrad;
      ctx.globalAlpha = 1;
    } else if (isHovered) {
      ctx.fillStyle = '#93c5fd';
      ctx.globalAlpha = 0.75;
    } else {
      ctx.fillStyle = '#7c96c4';
      ctx.globalAlpha = 0.42;
    }
    ctx.roundRect(x, midY - upH, barW, upH, 1);
    ctx.fill();

    // Lower reflection bar
    ctx.beginPath();
    if (isPlayed) {
      ctx.fillStyle = '#38bdf8';
      ctx.globalAlpha = 0.42;
    } else if (isHovered) {
      ctx.fillStyle = '#93c5fd';
      ctx.globalAlpha = 0.3;
    } else {
      ctx.fillStyle = '#647da8';
      ctx.globalAlpha = 0.2;
    }
    ctx.roundRect(x, midY + 1, barW, downH, 1);
    ctx.fill();
  }

  // Subtle playhead needle when playing
  if (isPlaying && progress > 0 && progress < 1) {
    const px = offsetX + progress * totalBarsWidth;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(px - 0.75, 1, 1.5, hPx - 2);
  }

  ctx.globalAlpha = 1;
}

export function fmtWaveDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

// Shared IntersectionObserver to lazily decode real audio peaks when visible
let waveObserver = null;
const observedElements = new WeakMap();
function observeWaveElement(el, fn) {
  if (typeof IntersectionObserver === 'undefined') {
    requestAnimationFrame(fn);
    return;
  }
  if (!waveObserver) {
    waveObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = observedElements.get(entry.target);
          if (cb) {
            waveObserver.unobserve(entry.target);
            observedElements.delete(entry.target);
            cb();
          }
        }
      }
    }, { rootMargin: '120px' });
  }
  observedElements.set(el, fn);
  waveObserver.observe(el);
}

export function createWaveBox({ key, waveformUrl, loadPcm, audioUrl, duration = 0, playBtn, compact = false }) {
  const cv = h('canvas', { class: 'sound-wave-canvas' });
  const durEl = h('span', { class: 'sound-wave-dur' }, duration > 0 ? fmtWaveDuration(duration) : '');

  let peaks = peakCache.get(key) || deterministicFallbackPeaks(key, 140);
  let currentProgress = 0;
  let hoverProgress = -1;
  let isPlaying = false;
  let decodedReal = peakCache.has(key);

  const renderCv = () => {
    drawSoundWaveCanvas(cv, peaks, {
      progress: currentProgress,
      hoverProgress,
      isPlaying,
    });
  };

  const track = h('div', {
    class: 'sound-wave-track',
    title: 'Klik om vanaf hier af te spelen',
    onpointermove: (e) => {
      const rect = track.getBoundingClientRect();
      if (rect.width > 0) {
        hoverProgress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        renderCv();
      }
    },
    onpointerleave: () => {
      hoverProgress = -1;
      renderCv();
    },
    onclick: (e) => {
      e.stopPropagation();
      const rect = track.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.max(0, Math.min(0.98, (e.clientX - rect.left) / rect.width)) : 0;
      playBtn.dataset.seekRatio = String(ratio);
      playBtn.click();
      delete playBtn.dataset.seekRatio;
    }
  }, cv);

  const box = h('div', {
    class: `sound-wave-row${compact ? ' compact' : ''}`,
  },
    playBtn,
    track,
    durEl
  );

  const ensureRealPeaks = async () => {
    if (decodedReal) return;
    decodedReal = true;
    try {
      let p = pendingDecodes.get(key);
      if (!p) {
        p = (async () => {
          let pcm = null;
          if (typeof loadPcm === 'function') pcm = await loadPcm();
          else if (audioUrl) pcm = await decodeUrl(audioUrl);
          if (pcm && pcm.length) {
            const computed = computePeaksFromPcm(pcm, 140);
            peakCache.set(key, computed);
            return { peaks: computed, dur: pcm.length / SR };
          }
          return null;
        })();
        pendingDecodes.set(key, p);
      }
      const res = await p;
      pendingDecodes.delete(key);
      if (res?.peaks) {
        peaks = res.peaks;
        if (!duration && res.dur) durEl.textContent = fmtWaveDuration(res.dur);
        renderCv();
      }
    } catch {
      pendingDecodes.delete(key);
    }
  };

  observeWaveElement(box, () => {
    renderCv();
    if (typeof loadPcm === 'function' || audioUrl) {
      ensureRealPeaks();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => renderCv());
    ro.observe(track);
  }

  playBtn.addEventListener('statechange', (e) => {
    isPlaying = Boolean(e.detail);
    box.classList.toggle('playing', isPlaying);
    if (isPlaying) ensureRealPeaks();
    if (!isPlaying) {
      currentProgress = 0;
      if (duration > 0) durEl.textContent = fmtWaveDuration(duration);
    }
    renderCv();
  });

  playBtn.addEventListener('previewprogress', (e) => {
    currentProgress = e.detail?.progress || 0;
    if (isPlaying && Number.isFinite(e.detail?.currentTime)) {
      durEl.textContent = fmtWaveDuration(e.detail.currentTime);
    }
    renderCv();
  });

  requestAnimationFrame(renderCv);
  return box;
}

export const previewAudio = (() => {
  const el = new Audio();
  let btn = null, blobUrl = null, rafId = 0;

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const setBtn = (b, on) => {
    if (!b) return;
    b.classList.toggle('playing', on);
    const host = b.closest('.sfx-tile, .media-item, .fs-wave-card');
    if (host) {
      host.classList.toggle('is-playing', on);
      if (!on) host.style.setProperty('--play-progress', '0%');
    }
    b.dispatchEvent(new CustomEvent('statechange', { detail: on }));
  };

  const tick = () => {
    if (!btn || el.paused) return;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 1;
    const progress = Math.max(0, Math.min(1, el.currentTime / dur));
    const host = btn.closest('.sfx-tile, .media-item, .fs-wave-card');
    if (host) host.style.setProperty('--play-progress', `${(progress * 100).toFixed(2)}%`);
    btn.dispatchEvent(new CustomEvent('previewprogress', {
      detail: { progress, currentTime: el.currentTime, duration: dur }
    }));
    rafId = requestAnimationFrame(tick);
  };

  el.addEventListener('ended', () => {
    stopLoop();
    setBtn(btn, false);
    btn = null;
  });

  return {
    async playUrl(url, button) {
      const seekRatio = button?.dataset?.seekRatio ? Number(button.dataset.seekRatio) : 0;
      if (button && btn === button && !el.paused && !seekRatio) {
        this.stop();
        return;
      }
      if (button && btn === button && !el.paused && seekRatio > 0 && Number.isFinite(el.duration)) {
        el.currentTime = seekRatio * el.duration;
        return;
      }
      this.stop();
      el.src = url;
      btn = button;
      setBtn(btn, true);
      try {
        await el.play();
        if (seekRatio > 0 && Number.isFinite(el.duration)) {
          el.currentTime = seekRatio * el.duration;
        }
        stopLoop();
        rafId = requestAnimationFrame(tick);
      } catch {
        stopLoop();
        setBtn(btn, false);
        btn = null;
      }
    },
    async playPcm(pcm, button) {
      const seekRatio = button?.dataset?.seekRatio ? Number(button.dataset.seekRatio) : 0;
      if (button && btn === button && !el.paused && !seekRatio) {
        this.stop();
        return;
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(encodeWav(pcm, SR));
      return this.playUrl(blobUrl, button);
    },
    stop() {
      stopLoop();
      el.pause();
      setBtn(btn, false);
      btn = null;
    },
  };
})();
