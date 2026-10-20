// Shared one-at-a-time preview player (plain <audio>, Bluetooth-safe)
import { encodeWav } from './util.js';
import { SR } from './audio/engine.js';

export const previewAudio = (() => {
  const el = new Audio();
  let btn = null, blobUrl = null;
  const setBtn = (b, on) => { if (!b) return; b.classList.toggle('playing', on); b.dispatchEvent(new CustomEvent('statechange', { detail: on })); };
  el.addEventListener('ended', () => { setBtn(btn, false); btn = null; });
  return {
    async playUrl(url, button) {
      if (button && btn === button && !el.paused) { this.stop(); return; }
      this.stop();
      el.src = url; btn = button; setBtn(btn, true);
      try { await el.play(); } catch { setBtn(btn, false); btn = null; }
    },
    async playPcm(pcm, button) {
      if (button && btn === button && !el.paused) { this.stop(); return; }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(encodeWav(pcm, SR));
      return this.playUrl(blobUrl, button);
    },
    stop() { el.pause(); setBtn(btn, false); btn = null; },
  };
})();
