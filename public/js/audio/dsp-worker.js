import { speedPitch } from './dsp.js';
import { vocode } from './robot.js';

self.onmessage = ({ data: { id, operation, pcm: input, options } }) => {
  try {
    let pcm;
    if (operation === 'vocode') pcm = vocode(input, options.sr, options.voice);
    else if (operation === 'speedPitch') pcm = speedPitch(input, options.speed, options.pitch);
    else throw new Error('Onbekende audiobewerking');
    self.postMessage({ id, pcm }, [pcm.buffer]);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
