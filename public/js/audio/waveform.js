// Min/max over every sample. Coarse levels accelerate zoomed-out views without
// dropping short transients; canvas callers choose their own physical pixels.
export class WaveformPeaks {
  constructor(pcm) {
    this.pcm = pcm;
    this.block = 64;
    this.levels = [];
    let length = Math.ceil(pcm.length / this.block);
    if (!length) return;
    let min = new Float32Array(length), max = new Float32Array(length);
    for (let b = 0; b < length; b++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = b * this.block; i < Math.min(pcm.length, (b + 1) * this.block); i++) { lo = Math.min(lo, pcm[i]); hi = Math.max(hi, pcm[i]); }
      min[b] = lo; max[b] = hi;
    }
    this.levels.push({ min, max });
    while (length > 1) {
      const nextLength = Math.ceil(length / 2), nextMin = new Float32Array(nextLength), nextMax = new Float32Array(nextLength);
      for (let i = 0; i < nextLength; i++) { nextMin[i] = Math.min(min[i * 2], min[i * 2 + 1] ?? Infinity); nextMax[i] = Math.max(max[i * 2], max[i * 2 + 1] ?? -Infinity); }
      this.levels.push({ min: nextMin, max: nextMax }); min = nextMin; max = nextMax; length = nextLength;
    }
  }

  range(from, to) {
    const a = Math.max(0, Math.floor(Math.min(from, to))), b = Math.min(this.pcm.length, Math.ceil(Math.max(from, to)));
    if (b <= a) return { min: 0, max: 0 };
    let min = Infinity, max = -Infinity;
    const first = Math.ceil(a / this.block), last = Math.floor(b / this.block);
    for (let i = a; i < Math.min(b, first * this.block); i++) { min = Math.min(min, this.pcm[i]); max = Math.max(max, this.pcm[i]); }
    let block = first;
    while (block < last) {
      let level = Math.min(this.levels.length - 1, Math.floor(Math.log2(last - block)));
      while (level > 0 && block % (2 ** level)) level--;
      const index = block / (2 ** level), values = this.levels[level];
      min = Math.min(min, values.min[index]); max = Math.max(max, values.max[index]); block += 2 ** level;
    }
    for (let i = Math.max(a, first * this.block, last * this.block); i < b; i++) { min = Math.min(min, this.pcm[i]); max = Math.max(max, this.pcm[i]); }
    return { min, max };
  }
}

const cache = new WeakMap();
export function waveformPeaks(pcm) {
  if (!cache.has(pcm)) cache.set(pcm, new WaveformPeaks(pcm));
  return cache.get(pcm);
}

export function sourceSampleRange(clip, fromTime, toTime, sr) {
  const at = time => (clip.offset + (clip.reverse ? clip.duration - time : time) * clip.speed) * sr;
  const a = at(fromTime), b = at(toTime);
  return [Math.min(a, b), Math.max(a, b)];
}

// Reuse the audible waveform during a live trim. Its offset moves with source
// time, never with the element's changing width. Newly revealed audio can fall
// back to the decoded source beyond the old processed clip's boundaries.
export function processedTrimRange(clip, reference, fromTime, toTime, sr) {
  const shift = clip.reverse
    ? (reference.offset + reference.duration * reference.speed - clip.offset - clip.duration * clip.speed) / clip.speed
    : (clip.offset - reference.offset) / clip.speed;
  return [(shift + fromTime) * sr, (shift + toTime) * sr];
}
