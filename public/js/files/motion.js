// Time-based, curved pointer paths: deterministic when seeking or exporting.
const clamp = (v) => Math.max(0, Math.min(1, v));
export function organicMove(from, to, progress, bend = 1, variation = {}) {
  const u = clamp(progress);
  const eased = u ** 3 * (u * (u * 6 - 15) + 10);
  const p = eased + (variation.timing || 0) * Math.sin(Math.PI * eased) ** 2;
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy) || 1;
  const arc = Math.min(110, distance * 0.16) * bend;
  const nx = -dy / distance, ny = dx / distance;
  const a = { x: from.x + dx * (variation.lead ?? 0.28) + nx * arc, y: from.y + dy * (variation.lead ?? 0.28) + ny * arc };
  const b = { x: to.x - dx * (variation.finish ?? 0.18) + nx * arc * (variation.curve ?? 0.65), y: to.y - dy * (variation.finish ?? 0.18) + ny * arc * (variation.curve ?? 0.65) };
  const q = 1 - p;
  return { x: q ** 3 * from.x + 3 * q ** 2 * p * a.x + 3 * q * p ** 2 * b.x + p ** 3 * to.x,
    y: q ** 3 * from.y + 3 * q ** 2 * p * a.y + 3 * q * p ** 2 * b.y + p ** 3 * to.y };
}

// A saved seed varies each gesture without changing paths on redraw or export.
function variedMove(from, to, progress, seed, leg) {
  let state = (seed ^ Math.imul(leg + 1, 374761393)) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const bend = (random() < 0.5 ? -1 : 1) * (0.35 + random() * 1.1);
  return organicMove(from, to, progress, bend, {
    lead: 0.2 + random() * 0.2, finish: 0.12 + random() * 0.18,
    curve: -0.45 + random() * 1.6, timing: (random() - 0.5) * 0.18,
  });
}

export function outroPointer(outro, time) {
  const position = variedMove({ x: 1706, y: 180 }, { x: 1798, y: 90 },
    (time - outro.start) / (outro.arrive - outro.start), outro.motionSeed, 4);
  return { ...position, hover: time >= outro.arrive - 0.1 * outro.pace ? 'explorer-close' : null,
    pressed: time >= outro.click && time < outro.click + 0.075 };
}

export function filePointer(s, time, { folder, file, first = false }) {
  const close = { x: 1706, y: 180 }, parked = { x: 1768, y: 933 };
  const origin = first ? { x: 1270, y: 770 } : close;
  const move = (from, to, progress, leg) => variedMove(from, to, progress, s.motionSeed ?? 41763, leg);
  let position;
  if (time < s.open) {
    if (s.folderChanged && time < s.folderOpen) position = move(origin, folder, (time - s.start) / (s.folderArrive - s.start), 0);
    else position = move(s.folderChanged ? folder : origin, file, (time - s.fileMove) / (s.fileArrive - s.fileMove), 1);
  } else if (s.noOpen) {
    position = file;
  } else if (time < s.close) {
    const retreat = Math.min(0.8 * s.pace, s.hold * 0.65);
    position = move(file, parked, (time - s.open - 0.05) / retreat, 2);
  } else position = move(parked, close, (time - s.close) / (s.closeArrive - s.close), 3);
  const hover = s.folderChanged && time >= s.folderArrive - 0.12 * s.pace && time < s.folderOpen ? 'folder'
    : time >= s.fileArrive - 0.12 * s.pace && (s.noOpen || time < s.open) ? 'file'
    : !s.noOpen && time >= s.closeArrive - 0.12 * s.pace && time < s.closeClick ? 'close' : null;
  const clicks = [s.fileClick, s.fileDoubleClick, ...(s.noOpen ? [] : [s.closeClick]), ...(s.folderChanged ? [s.folderClick] : [])];
  return { ...position, hover, pressed: clicks.some((at) => time >= at && time < at + 0.075) };
}
