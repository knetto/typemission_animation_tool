import { speedPitch } from './dsp.js';
import { vocode } from './robot.js';

// Keep pure, CPU-heavy DSP out of the editor's event loop. Transfer a copy so
// cached source audio stays intact and can still be used by other clips.
let worker = null, nextId = 0;
const pending = new Map();

export function runDsp(operation, input, options = {}) {
  if (typeof Worker === 'undefined') {
    if (operation === 'vocode') return Promise.resolve(vocode(input, options.sr, options.voice));
    if (operation === 'speedPitch') return Promise.resolve(speedPitch(input, options.speed, options.pitch));
    return Promise.reject(new Error('Onbekende audiobewerking'));
  }
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./dsp-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          const job = pending.get(data.id);
          if (!job) return;
          pending.delete(data.id);
          if (data.error) job.reject(new Error(data.error));
          else job.resolve(data.pcm);
        };
        worker.onerror = () => {
          worker?.terminate(); worker = null;
          for (const job of pending.values()) job.reject(new Error('Audioverwerking kon niet worden afgerond. Probeer opnieuw.'));
          pending.clear();
        };
      }
      const id = ++nextId, pcm = input.slice();
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, operation, pcm, options }, [pcm.buffer]); }
      catch (error) { pending.delete(id); reject(error); }
    } catch (error) { reject(error); }
  });
}
