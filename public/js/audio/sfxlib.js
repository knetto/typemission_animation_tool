// Built-in sound effects, synthesized offline (no files, no live audio device)
import { synth } from './synth.js';

export const SR = 48000;

const LIB = [
  // TV
  { key: 'crt_on', name: 'TV aan (CRT)', category: 'TV', dur: 1.5, build: ({ noise, tone, crackle }) => {
    noise(0, 0.02, { type: 'highpass', f: 1200, g: 0.9, attack: 0.001 });
    tone(0.03, 0.55, { f0: 120, f1: 32, g: 0.95 });
    tone(0.05, 1.25, { type: 'sawtooth', f0: 50, g: 0.22, attack: 0.12, lp: 320 });
    noise(0.02, 1.0, { f: 2600, q: 0.6, g: 0.5, attack: 0.01 });
    crackle(0.05, 0.9, 16, 0.45);
    tone(0.12, 1.35, { f0: 7900, g: 0.03, attack: 0.35 });
  } },
  { key: 'crt_off', name: 'TV uit (CRT)', category: 'TV', dur: 1.3, build: ({ noise, tone, crackle }) => {
    noise(0, 0.015, { type: 'highpass', f: 1200, g: 0.8, attack: 0.001 });
    noise(0, 0.5, { f: 3200, q: 0.7, g: 0.42 });
    tone(0.02, 0.5, { type: 'square', f0: 1500, f1: 45, g: 0.16, lp: 2600 });
    tone(0.42, 0.45, { f0: 95, f1: 28, g: 0.75 });
    tone(0, 1.2, { f0: 8200, f1: 5200, g: 0.03, attack: 0.01 });
    crackle(0, 0.55, 12, 0.4);
  } },
  { key: 'glitch', name: 'Glitch', category: 'TV', dur: 0.3, build: ({ noise, tone, crackle }) => {
    noise(0, 0.18, { f: 1800, q: 1.2, g: 0.35 });
    tone(0, 0.12, { type: 'square', f0: 900, f1: 300, g: 0.08, lp: 3000 });
    crackle(0, 0.15, 5, 0.3);
  } },
  { key: 'static', name: 'Ruis (2s)', category: 'TV', dur: 2, build: ({ noise, crackle }) => {
    noise(0, 2, { f: 3000, q: 0.4, g: 0.35, attack: 0.08 }); crackle(0, 1.9, 30, 0.3);
  } },
  { key: 'tv_click', name: 'Klik', category: 'TV', dur: 0.08, build: ({ noise }) => noise(0, 0.05, { type: 'highpass', f: 1500, g: 0.9, attack: 0.001 }) },

  // Radio
  { key: 'squelch', name: 'Squelch (kssht)', category: 'Radio', dur: 0.4, build: ({ noise }) => noise(0, 0.35, { f: 2500, q: 0.4, g: 0.55, attack: 0.002 }) },
  { key: 'roger', name: 'Roger-beep', category: 'Radio', dur: 0.3, build: ({ tone }) => { tone(0, 0.09, { f0: 1200, g: 0.3 }); tone(0.11, 0.12, { f0: 1600, g: 0.3 }); } },
  { key: 'radio_static', name: 'Radio storing', category: 'Radio', dur: 2, build: ({ noise, tone, crackle }) => {
    noise(0, 2, { f: 1500, q: 0.8, g: 0.3, attack: 0.1 }); tone(0, 2, { type: 'sine', f0: 600, f1: 900, g: 0.03, attack: 0.3 }); crackle(0, 1.9, 25, 0.35);
  } },

  // Computer
  { key: 'beep', name: 'Piep', category: 'Computer', dur: 0.2, build: ({ tone }) => tone(0, 0.15, { f0: 1000, g: 0.35 }) },
  { key: 'double_beep', name: 'Dubbele piep', category: 'Computer', dur: 0.4, build: ({ tone }) => { tone(0, 0.12, { f0: 1300, g: 0.3 }); tone(0.18, 0.12, { f0: 1300, g: 0.3 }); } },
  { key: 'data', name: 'Data-chirp', category: 'Computer', dur: 0.9, build: ({ tone }) => {
    for (let i = 0; i < 14; i++) tone(i * 0.055, 0.045, { type: 'square', f0: 600 + ((i * 7919) % 1800), g: 0.07, lp: 4000 });
  } },
  { key: 'typing', name: 'Typen', category: 'Computer', dur: 1.6, build: ({ noise }) => {
    for (let i = 0; i < 18; i++) noise(i * 0.085 + ((i * 37) % 10) / 400, 0.03, { type: 'bandpass', f: 2500 + ((i * 131) % 1500), q: 2, g: 0.4, attack: 0.001, seed: i + 50 });
  } },
  { key: 'success', name: 'Succes', category: 'Computer', dur: 0.8, build: ({ tone }) => { [880, 1108, 1318].forEach((f, i) => tone(i * 0.1, 0.5, { type: 'triangle', f0: f, g: 0.22 })); } },
  { key: 'error', name: 'Fout', category: 'Computer', dur: 0.6, build: ({ tone }) => { tone(0, 0.22, { type: 'square', f0: 220, g: 0.15, lp: 1500 }); tone(0.26, 0.3, { type: 'square', f0: 160, g: 0.15, lp: 1500 }); } },
  { key: 'power_up', name: 'Opstarten', category: 'Computer', dur: 1.3, build: ({ tone, noise }) => { tone(0, 1.2, { type: 'sawtooth', f0: 80, f1: 1200, g: 0.12, lp: 2500, attack: 0.3 }); noise(0, 1.2, { f: 500, f1: 6000, q: 1, g: 0.12, attack: 0.4 }); } },
  { key: 'power_down', name: 'Uitschakelen', category: 'Computer', dur: 1.1, build: ({ tone }) => tone(0, 1, { type: 'sawtooth', f0: 1000, f1: 50, g: 0.14, lp: 2000 }) },

  // Alarm
  { key: 'alarm', name: 'Alarm sirene', category: 'Alarm', dur: 2.2, build: ({ tone }) => { for (let i = 0; i < 4; i++) { tone(i * 0.55, 0.27, { type: 'sawtooth', f0: 700, f1: 1100, g: 0.13, lp: 3000 }); tone(i * 0.55 + 0.27, 0.27, { type: 'sawtooth', f0: 1100, f1: 700, g: 0.13, lp: 3000 }); } } },
  { key: 'alert', name: 'Waarschuwing', category: 'Alarm', dur: 1.2, build: ({ tone }) => { for (let i = 0; i < 3; i++) tone(i * 0.36, 0.22, { type: 'square', f0: 880, g: 0.14, lp: 3500 }); } },

  // Cinematic
  { key: 'whoosh', name: 'Whoosh', category: 'Cinematic', dur: 0.9, build: ({ noise }) => noise(0, 0.8, { f: 300, f1: 5000, q: 1.5, g: 0.5, attack: 0.35 }) },
  { key: 'riser', name: 'Riser', category: 'Cinematic', dur: 2, build: ({ tone, noise }) => { tone(0, 1.9, { type: 'sawtooth', f0: 100, f1: 900, g: 0.1, lp: 3000, attack: 1.2 }); noise(0, 1.9, { f: 400, f1: 8000, g: 0.2, attack: 1.5 }); } },
  { key: 'impact', name: 'Impact', category: 'Cinematic', dur: 1.5, build: ({ tone, noise }) => { tone(0, 1.2, { f0: 90, f1: 30, g: 1 }); noise(0, 0.4, { type: 'lowpass', f: 900, g: 0.6, attack: 0.001 }); } },

  // Telefoon
  { key: 'phone_ring', name: 'Telefoon rinkelt', category: 'Telefoon', dur: 3, build: ({ tone }) => {
    for (const s of [0, 1.5]) for (let i = 0; i < 20; i++) tone(s + i * 0.04, 0.035, { type: 'square', f0: i % 2 ? 1000 : 1200, g: 0.1, lp: 3000, attack: 0.002 });
  } },
  { key: 'dial_tone', name: 'Kiestoon', category: 'Telefoon', dur: 1.2, build: ({ tone }) => { tone(0, 1.1, { f0: 425, g: 0.2, attack: 0.01 }); } },
  { key: 'hangup', name: 'Ophangen (tuut)', category: 'Telefoon', dur: 1.6, build: ({ tone }) => { for (let i = 0; i < 3; i++) tone(i * 0.5, 0.25, { f0: 425, g: 0.22, attack: 0.005 }); } },
];

export const BUILTIN_SFX = LIB.map(({ key, name, category, dur }) => ({ key, name, category, duration: dur }));
const cache = new Map();

export function renderBuiltin(key) {
  if (!cache.has(key)) {
    const def = LIB.find((s) => s.key === key);
    if (!def) return Promise.resolve(new Float32Array(1));
    cache.set(key, (async () => {
      const ctx = new OfflineAudioContext(1, Math.ceil(SR * def.dur), SR);
      const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
      const out = ctx.createGain(); out.gain.value = 0.9; out.connect(comp);
      def.build(synth(ctx, out));
      return (await ctx.startRendering()).getChannelData(0).slice();
    })());
  }
  return cache.get(key);
}
