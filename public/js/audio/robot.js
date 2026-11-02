import { resynthesizeVoice } from './voice-model.js';

// Shared DSP entry point for saved presets and background worker jobs.
export const vocode = (input, sr, options) => resynthesizeVoice(input, sr, options);

// Smooth tape speed drift: tiny time changes rather than random pitch
// jumps. Linear interpolation keeps the duration and avoids sample steps.
export function tapeDrift(input, sr, depth = 0.0018) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const time = i / sr;
    const position = Math.max(0, Math.min(input.length - 1, i + sr * depth * (Math.sin(2 * Math.PI * 0.7 * time) + 0.12 * Math.sin(2 * Math.PI * 8.3 * time))));
    const index = Math.floor(position), fraction = position - index;
    out[i] = input[index] * (1 - fraction) + (input[Math.min(index + 1, input.length - 1)] || 0) * fraction;
  }
  return out;
}
