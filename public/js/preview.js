// Shared one-at-a-time preview player + Freesound-style sound wave renderer
import { encodeWav, h } from './util.js';
import { SR, decodeUrl } from './audio/engine.js';

const peakCache = new Map();

export function computePeaksFromPcm(pcm, bars = 64) {
  if (!pcm || !pcm.length) return new Float32Array(bars);
  const out = new Float32Array(bars);
  const step = Math.max(1, Math.floor(pcm.length / bars));
  let maxPeak = 0.01;
  for (let i = 0; i < bars; i++) {
    const start = i * step;
    const end = Math.min(pcm.length, start + step);
    let max = 0;
    for (let j = start; j < end; j += Math.max(1, Math.floor((end - start) / 32))) {
      const v = Math.abs(pcm[j]);
      if (v > max) max = v;
    }
    out[i] = max;
    if (max > maxPeak) maxPeak = max;
  }
  for (let i = 0; i < bars; i++) {
    out[i] = Math.min(1, out[i] / maxPeak);
  }
  return out;
}

export function deterministicFallbackPeaks(seedStr = 'sound', bars = 64) {
  let hVal = 2166136261;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) {
    hVal ^= s.charCodeAt(i);
    hVal = Math.imul(hVal, 16777619);
  }
  const out = new Float32Array(bars);
  for (let i = 0; i < bars; i++) {
    hVal ^= i * 2654435761;
    hVal = Math.imul(hVal, 1597334677);
    const r = ((hVal >>> 0) % 1000) / 1000;
    const env = Math.sin((i / (bars - 1)) * Math.PI);
    out[i] = Math.max(0.08, Math.min(1, (0.22 + r * 0.78) * (0.35 + 0.65 * env)));
  }
  return out;
}

export function drawSoundWaveCanvas(canvas, peaks, progress = 0, palette = 'freesound') {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 180;
  const hPx = canvas.clientHeight || 42;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hPx * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hPx * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hPx);

  const mid = hPx / 2;
  // Center baseline
  ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.fillRect(0, mid - 0.5, w, 1);

  const n = peaks.length || 1;
  const barW = Math.max(1.5, (w / n) * 0.66);
  const gap = w / n;

  // Spectral Freesound-style gradient
  const gradUnplayed = ctx.createLinearGradient(0, 0, w, 0);
  if (palette === 'freesound') {
    gradUnplayed.addColorStop(0, '#22c55e');
    gradUnplayed.addColorStop(0.5, '#eab308');
    gradUnplayed.addColorStop(1, '#10b981');
  } else {
    gradUnplayed.addColorStop(0, '#38bdf8');
    gradUnplayed.addColorStop(0.5, '#818cf8');
    gradUnplayed.addColorStop(1, '#34d399');
  }

  const gradPlayed = ctx.createLinearGradient(0, 0, w, 0);
  gradPlayed.addColorStop(0, '#4ade80');
  gradPlayed.addColorStop(0.5, '#facc15');
  gradPlayed.addColorStop(1, '#fb923c');

  for (let i = 0; i < n; i++) {
    const x = i * gap + (gap - barW) * 0.5;
    const ratio = i / n;
    const amp = Math.max(2, peaks[i] * (mid - 3));
    const isPlayed = progress > 0 && ratio <= progress;

    ctx.fillStyle = isPlayed ? gradPlayed : gradUnplayed;
    ctx.globalAlpha = progress > 0 ? (isPlayed ? 1 : 0.45) : 0.85;
    ctx.fillRect(x, mid - amp, barW, amp * 2);

    // Inner bright core like Freesound's RMS overlay
    if (amp > 4) {
      ctx.fillStyle = isPlayed ? '#fef08a' : 'rgba(255, 255, 255, 0.28)';
      ctx.globalAlpha = isPlayed ? 0.85 : 0.45;
      ctx.fillRect(x, mid - amp * 0.42, barW, amp * 0.84);
    }
  }
  ctx.globalAlpha = 1;
}

export function fmtWaveDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function createWaveBox({ key, waveformUrl, loadPcm, audioUrl, duration = 0, playBtn, compact = false }) {
  const cv = h('canvas', { class: 'sound-wave-canvas' });
  const img = waveformUrl ? h('img', {
    class: 'sound-wave-img',
    src: waveformUrl,
    alt: '',
    loading: 'lazy',
    onerror: () => { img.hidden = true; cv.hidden = false; renderCv(currentProgress); }
  }) : null;
  if (img) cv.hidden = true;

  const progressFill = h('div', { class: 'sound-wave-progress' });
  const playhead = h('div', { class: 'sound-wave-playhead' });
  const durBadge = duration > 0 ? h('span', { class: 'sound-wave-dur' }, fmtWaveDuration(duration)) : null;

  const box = h('div', {
    class: `sound-wave-box${compact ? ' compact' : ''}`,
    title: 'Klik om te beluisteren',
    onclick: (e) => {
      if (e.target.closest('.play')) return;
      e.stopPropagation();
      const rect = box.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.max(0, Math.min(0.98, (e.clientX - rect.left) / rect.width)) : 0;
      playBtn.dataset.seekRatio = String(ratio);
      playBtn.click();
      delete playBtn.dataset.seekRatio;
    }
  },
    img,
    cv,
    progressFill,
    playhead,
    playBtn,
    durBadge
  );

  let peaks = peakCache.get(key) || deterministicFallbackPeaks(key, compact ? 44 : 68);
  let currentProgress = 0;
  let decodedReal = peakCache.has(key);

  const renderCv = (prog = 0) => {
    if (!cv.hidden) drawSoundWaveCanvas(cv, peaks, prog, 'freesound');
  };

  const ensureRealPeaks = async () => {
    if (decodedReal) return;
    decodedReal = true;
    try {
      let pcm = null;
      if (typeof loadPcm === 'function') pcm = await loadPcm();
      else if (audioUrl) pcm = await decodeUrl(audioUrl);
      if (pcm && pcm.length) {
        peaks = computePeaksFromPcm(pcm, compact ? 44 : 68);
        peakCache.set(key, peaks);
        renderCv(currentProgress);
      }
    } catch {}
  };

  if (!waveformUrl && typeof loadPcm === 'function') {
    requestAnimationFrame(() => ensureRealPeaks());
  }

  playBtn.addEventListener('statechange', (e) => {
    const playing = Boolean(e.detail);
    box.classList.toggle('playing', playing);
    if (playing && !waveformUrl) ensureRealPeaks();
    if (!playing) {
      currentProgress = 0;
      box.style.setProperty('--wave-p', '0%');
      renderCv(0);
    }
  });

  playBtn.addEventListener('previewprogress', (e) => {
    currentProgress = e.detail?.progress || 0;
    box.style.setProperty('--wave-p', `${(currentProgress * 100).toFixed(2)}%`);
    renderCv(currentProgress);
  });

  requestAnimationFrame(() => renderCv(0));
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
