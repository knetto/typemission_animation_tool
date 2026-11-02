import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { speedPitch } from '../../public/js/audio/dsp.js';
import { vocode } from '../../public/js/audio/robot.js';

test('DSP worker runs asynchronously, matches direct processing and preserves cached input buffers', async () => {
  const previous = globalThis.Worker, instances = [];
  // Exercise the actual browser worker entry point through Node's worker
  // transport, rather than replacing the DSP with a mocked result.
  globalThis.Worker = class {
    constructor(url) {
      const bootstrap = `import { parentPort } from 'node:worker_threads';
        globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
        await import(${JSON.stringify(String(url))});
        parentPort.on('message', data => self.onmessage({ data }));`;
      this.thread = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(bootstrap)), { type: 'module' });
      this.thread.on('message', data => this.onmessage?.({ data }));
      this.thread.on('error', error => this.onerror?.(error));
      instances.push(this);
    }
    postMessage(...args) { this.thread.postMessage(...args); }
    terminate() { return this.thread.terminate(); }
  };
  let timer;
  try {
    const { runDsp } = await import('../../public/js/audio/dsp-jobs.js?worker-test');
    const input = Float32Array.from({ length: 48000 * 3 }, (_, i) => Math.sin(2 * Math.PI * 173 * i / 48000) * 0.1);
    const original = input.slice();
    let heartbeats = 0;
    timer = setInterval(() => heartbeats++, 5);
    const [robot, pitch] = await Promise.all([
      runDsp('vocode', input, { sr: 48000, voice: { frequency: 110 } }),
      runDsp('speedPitch', input, { speed: 1, pitch: -3 }),
    ]);
    assert.ok(heartbeats >= 2, 'main thread handles events while the worker computes');
    assert.equal(instances.length, 1, 'concurrent jobs share one worker');
    assert.deepEqual(input, original, 'transfers never detach cached sources');
    assert.deepEqual(robot, vocode(input, 48000, { frequency: 110 }));
    assert.deepEqual(pitch, speedPitch(input, 1, -3));
    await assert.rejects(runDsp('unsupported', input), /Onbekende audiobewerking/);
    assert.deepEqual(await runDsp('speedPitch', input, { speed: 1, pitch: 0 }), input, 'worker remains usable after a failed job');
  } finally {
    clearInterval(timer);
    await Promise.all(instances.map(instance => instance.terminate()));
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  }
});
