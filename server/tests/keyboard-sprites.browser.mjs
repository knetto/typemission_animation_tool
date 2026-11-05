// Run with npm run test:keyboard-sprites. Set CHROME_PATH outside Windows.
import { createApp } from '../index.js';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboard-browser-'));
const { app: studio, db } = createApp({ storageDir: path.join(tmp, 'storage') });
const app = express();
app.get('/__keyboard_check', (_req, res) => res.send('<html><head><link rel="stylesheet" href="/css/app.css"></head><body><main id="check"></main></body></html>'));
app.use(studio);
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${path.join(tmp, 'chrome')}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome start timeout')), 15000);
    child.once('error', reject);
    child.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const port = new URL(endpoint).port;
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (pending.has(result.id)) { pending.get(result.id)(result); pending.delete(result.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 60000);
    pending.set(id, value => { clearTimeout(timer); value.error ? reject(value.error) : resolve(value.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.navigate', { url: base + '/__keyboard_check' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const result = await send('Runtime.evaluate', { expression: `(${browserCheck.toString()})()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value, null, 2));
  if (process.env.KEYBOARD_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(process.env.KEYBOARD_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
} finally {
  socket?.close();
  child.kill();
  await new Promise(resolve => server.close(resolve));
  db.close();
  await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve));
  const resolvedTmp = path.resolve(tmp);
  if (path.dirname(resolvedTmp) === path.resolve(os.tmpdir()) && path.basename(resolvedTmp).startsWith('keyboard-browser-')) {
    await fs.promises.rm(resolvedTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

async function browserCheck() {
  const { normalizeKeyboardOpts } = await import('/js/keyboard/model.js');
  const { createKeyboardScene } = await import('/js/keyboard/renderer.js');
  const { resolveUnityTargets, renderUnityTargetSprites, unityFrameTime, unityClipTiming } = await import('/js/keyboard/unity-export.js');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  let framesChecked = 0, boundsChecked = 0, centersChecked = 0;
  for (const stickerStyle of ['peel', 'pop', 'slide']) {
    for (const keyId of ['f', 'j', 'space', 'enter']) {
      for (const contentMode of ['sticker_only', 'key_and_sticker', ...(keyId === 'f' ? ['full_board'] : [])]) {
      const opts = normalizeKeyboardOpts({ previewKey: keyId, selectedKeys: [keyId], stickerStyle, duration: 1.5 });
      const target = resolveUnityTargets(opts, 'current_key')[0];
      const output = await renderUnityTargetSprites({ target, opts, contentMode, fps: 24, wantFrames: true });
      const sheet = await createImageBitmap(output.spriteSheetBlob);
      const canvas = document.createElement('canvas');
      canvas.width = output.meta.cellWidth; canvas.height = output.meta.cellHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scene = createKeyboardScene(canvas, keyId, contentMode === 'full_board' ? { ...opts, bgMode: 'transparent' } : opts, {
        spriteMode: contentMode === 'full_board' ? null : contentMode, colorOverride: target.colorOverride,
      });
      const timing = unityClipTiming(scene.schedule, { contentMode, fps: 24 });
      if (contentMode !== 'full_board') {
        scene.draw(scene.schedule.total);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
        assert(right >= left, `${stickerStyle}/${keyId} final pose is empty`);
        assert(Math.abs((left + right + 1) / 2 - canvas.width / 2) <= 0.75, `${stickerStyle}/${keyId} is not horizontally centered`);
        assert(Math.abs((top + bottom + 1) / 2 - canvas.height / 2) <= 0.75, `${stickerStyle}/${keyId} is not vertically centered`);
        // Inspect the actual Canvas geometry: particles and ring must share a
        // center, even on L-shaped Enter and while the key is pressed down.
        const arcs = [], rings = [];
        const originalArc = ctx.arc, originalRoundRect = ctx.roundRect;
        ctx.arc = function (x, y, ...rest) {
          arcs.push(this.getTransform().transformPoint({ x, y }));
          return originalArc.call(this, x, y, ...rest);
        };
        ctx.roundRect = function (x, y, width, height, ...rest) {
          if (width > scene.targetKey.w && height > scene.targetKey.h) {
            rings.push(this.getTransform().transformPoint({ x: x + width / 2, y: y + height / 2 }));
          }
          return originalRoundRect.call(this, x, y, width, height, ...rest);
        };
        scene.draw(scene.schedule.pressPeak);
        ctx.arc = originalArc; ctx.roundRect = originalRoundRect;
        assert(arcs.length === 12 && rings.length === 1, 'burst geometry missing');
        const centerX = arcs.reduce((sum, point) => sum + point.x, 0) / arcs.length;
        const centerY = arcs.reduce((sum, point) => sum + point.y, 0) / arcs.length;
        assert(Math.abs(centerX - canvas.width / 2) < 0.001, `${keyId} burst is off center: ${centerX} vs ${canvas.width / 2}`);
        assert(Math.abs(centerX - rings[0].x) < 0.001 && Math.abs(centerY - rings[0].y) < 0.001, `${keyId} particles and ring are misaligned`);
        centersChecked++;
      }
      for (const index of [0, 1, Math.floor(output.meta.frameCount / 2), output.meta.frameCount - 1]) {
        scene.draw(unityFrameTime(timing, index));
        const expected = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const frame = output.meta.frames[index];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sheet, frame.x, sheet.height - frame.y - frame.height, frame.width, frame.height, 0, 0, frame.width, frame.height);
        const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        assert(expected.every((value, i) => value === actual[i]), stickerStyle + '/' + keyId + '/sheet ' + index + ' differs');
        const png = await createImageBitmap(output.frameBlobs[index].blob);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(png, 0, 0); png.close();
        const pngPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        assert(expected.every((value, i) => value === pngPixels[i]), stickerStyle + '/' + keyId + '/PNG ' + index + ' differs');
        framesChecked++;
      }
      for (let step = 1; contentMode === 'sticker_only' && step <= 20; step++) {
        scene.draw(scene.schedule.peelStart + (step / 20) * (scene.schedule.peelEnd - scene.schedule.peelStart));
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let x = 0; x < canvas.width; x++) {
          assert(pixels[x * 4 + 3] === 0 && pixels[((canvas.height - 1) * canvas.width + x) * 4 + 3] === 0, stickerStyle + '/' + keyId + ' clips vertically');
        }
        for (let y = 0; y < canvas.height; y++) {
          assert(pixels[(y * canvas.width) * 4 + 3] === 0 && pixels[(y * canvas.width + canvas.width - 1) * 4 + 3] === 0, stickerStyle + '/' + keyId + ' clips horizontally');
        }
        boundsChecked++;
      }
      const wav = new DataView(await output.wavBlob.arrayBuffer());
      assert(wav.getUint32(40, true) / 2 / 48000 === Math.ceil(timing.duration * 48000) / 48000, 'WAV length differs from clip');
      sheet.close();
      }
    }
  }
  const project = await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'keyboard', name: 'Sprite export check' }) })).json();
  project.keyboard_opts = { selectedKeys: ['f', 'j', 'space', 'enter'], previewKey: 'space', stickerStyle: 'pop' };
  const root = document.getElementById('check');
  const dispose = await (await import('/js/views/keyboard.js')).mount(root, { id: project.id, project, exportingView: true });
  const change = (id, value, checked = false) => {
    const input = document.getElementById(id);
    if (checked) input.checked = value; else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  assert(document.getElementById('kb-unity-summary').textContent.includes('4 animaties'), 'needed variants summary incorrect');
  change('kb-unity-size-scope', 'current_size');
  change('kb-unity-target-scope', 'current_color');
  assert(document.getElementById('kb-unity-summary').textContent.includes('1 animatie'), 'only this size/color not restricted');
  change('kb-unity-preview-isolated', true, true);
  const preview = document.getElementById('kb-canvas');
  assert(preview.width > preview.height, 'spacebar preview has wrong proportions');
  assert(preview.style.objectFit === 'contain', 'preview may be stretched');
  await new Promise(resolve => setTimeout(resolve, 500));
  const saved = await (await fetch('/api/projects/' + project.id)).json();
  assert(saved.keyboard_opts.unityExport.sizeScope === 'current_size', 'size settings not saved');
  assert(saved.keyboard_opts.unityExport.targetScope === 'current_color', 'color settings not saved');
  assert(!document.getElementById('kb-active-preview-label').textContent.includes('null'), 'preview label contains null');
  // Exercise the real download path and inspect its ZIP entries.
  change('kb-unity-format', 'both_zip');
  const downloads = [];
  const urls = new Map();
  const originalCreate = URL.createObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => { const url = originalCreate(blob); urls.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: urls.get(this.href) }); };
  document.getElementById('start-unity-export-btn').click();
  for (let i = 0; i < 500 && !downloads.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(downloads.length === 1, 'export did not produce one ZIP');
  const readZip = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const entries = new Map();
    for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
      const length = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      const start = offset + 30 + nameLength + extraLength;
      entries.set(name, bytes.subarray(start, start + length));
      offset = start + length;
    }
    return entries;
  };
  const entries = await readZip(downloads[0].blob);
  assert(entries.has('Editor/ImportStickerSprites.cs'), 'Unity importer missing');
  assert(entries.has('Scripts/StickerSpriteAnimator.cs'), 'Unity player missing');
  assert(entries.has('Audio/sticker_sfx.wav'), 'audio missing');
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('unity_import_meta.json')));
  assert(metadata.animations.length === 1 && metadata.animations[0].sizeId === '7u', 'wrong variant in ZIP');
  assert([...entries.keys()].filter(name => name.startsWith('Frames/')).length === metadata.animations[0].frameCount, 'frames missing');
  const animation = metadata.animations[0];
  const currentFrame = Math.min(animation.frameCount - 1, Math.round(Number(document.getElementById('kb-scrub').value) * animation.fps));
  const previewPixels = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data;
  const exportedPng = await createImageBitmap(new Blob([entries.get(`Frames/${animation.slug}/frame_${String(currentFrame).padStart(3, '0')}.png`)], { type: 'image/png' }));
  const decodedCanvas = document.createElement('canvas');
  decodedCanvas.width = preview.width; decodedCanvas.height = preview.height;
  const decodedCtx = decodedCanvas.getContext('2d');
  decodedCtx.drawImage(exportedPng, 0, 0);
  const exportedPixels = decodedCtx.getImageData(0, 0, preview.width, preview.height).data;
  assert(previewPixels.every((value, i) => value === exportedPixels[i]), 'visible preview does not match the downloaded animation');
  exportedPng.close();
  change('kb-unity-format', 'spritesheet_audio_zip');
  change('kb-unity-size-scope', 'used_sizes');
  document.getElementById('start-unity-export-btn').click();
  for (let i = 0; i < 1000 && downloads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(downloads.length === 2, 'sheets and audio export did not download');
  const assets = await readZip(downloads[1].blob);
  const sheets = [...assets.keys()].filter(name => name.startsWith('SpriteSheets/') && name.endsWith('.png'));
  assert(sheets.length === 3, 'sheets and audio ZIP is missing selected sizes');
  assert(assets.size === sheets.length + 1 && assets.has('Audio/sticker_sfx.wav'),
    'sheets and audio ZIP must contain only PNG sheets and WAV, without scripts, README or metadata');
  const assetSettings = await (await fetch('/api/projects/' + project.id)).json();
  assert(assetSettings.keyboard_opts.unityExport.format === 'spritesheet_audio_zip', 'new export format not saved');
  URL.createObjectURL = originalCreate;
  HTMLAnchorElement.prototype.click = originalClick;
  dispose();
  return { framesChecked, boundsChecked, centersChecked, previewSize: [preview.width, preview.height], settingsSaved: true, zipEntries: entries.size, sheetsAndAudioEntries: assets.size };
}
