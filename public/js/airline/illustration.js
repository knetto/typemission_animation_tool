// Original, resolution-independent Berlin artwork. The sky and skyline share
// one canvas, so there is no photograph edge or rectangular gradient seam.
const TAU = Math.PI * 2;

function rect(g, x, y, w, h, color, radius = 0) {
  g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, radius); g.fill();
}
function path(g, points, fill, stroke, width = 1) {
  g.beginPath();
  for (const [op, ...args] of points) g[op](...args);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
}
function line(g, x1, y1, x2, y2, color, width = 1) {
  path(g, [['moveTo', x1, y1], ['lineTo', x2, y2]], null, color, width);
}
function ellipse(g, x, y, rx, ry, color) {
  g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
}
function gradient(g, x1, y1, x2, y2, stops) {
  const paint = g.createLinearGradient(x1, y1, x2, y2);
  stops.forEach(([at, color]) => paint.addColorStop(at, color));
  return paint;
}
function arch(g, x, y, w, h, color) {
  path(g, [['moveTo', x, y + h], ['lineTo', x, y + w / 2],
    ['bezierCurveTo', x, y - w / 6, x + w, y - w / 6, x + w, y + w / 2],
    ['lineTo', x + w, y + h], ['closePath']], color);
}

function dome(g, x, y, r, height) {
  // A restrained copper cupola, seated inside its cornice rather than overhanging it.
  const roof = gradient(g, x - r, y, x + r, y, [[0, '#426c68'], [0.43, '#8ba995'], [0.72, '#709789'], [1, '#3c6864']]);
  path(g, [['moveTo', x - r, y], ['lineTo', x - r, y - height * 0.13],
    ['bezierCurveTo', x - r * 0.91, y - height * 0.62, x - r * 0.37, y - height * 0.92, x - r * 0.12, y - height],
    ['lineTo', x + r * 0.12, y - height],
    ['bezierCurveTo', x + r * 0.37, y - height * 0.92, x + r * 0.91, y - height * 0.62, x + r, y - height * 0.13],
    ['lineTo', x + r, y], ['closePath']], roof);
  for (const bend of [-0.72, -0.38, 0, 0.38, 0.72]) {
    path(g, [['moveTo', x, y - height + 2], ['bezierCurveTo', x + r * bend * 0.34, y - height * 0.7, x + r * bend, y - height * 0.38, x + r * bend, y]], null, '#c0c5a587', 1.1);
  }
  rect(g, x - r - 3, y, r * 2 + 6, 3, '#b9c1a5');
  rect(g, x - r - 1, y + 3, r * 2 + 2, 3, '#527a6d');
  rect(g, x - 5, y - height - 9, 10, 9, '#789586');
  for (const dx of [-2, 2]) rect(g, x + dx - 0.7, y - height - 7, 1.4, 5, '#d5d4b1');
  path(g, [['moveTo', x - 7, y - height - 9], ['lineTo', x, y - height - 16], ['lineTo', x + 7, y - height - 9], ['closePath']], '#4e786e');
  line(g, x, y - height - 27, x, y - height - 16, '#e1c78a', 1.4);
  line(g, x - 3, y - height - 23, x + 3, y - height - 23, '#e1c78a', 1.3);
}

function cathedral(g) {
  const stone = gradient(g, 1050, 0, 1285, 0, [[0, '#8c9f91'], [0.4, '#d1c9a9'], [0.68, '#c2c2a3'], [1, '#8a9d8f']]);
  // Broad, layered stone facade and recessed side wings.
  rect(g, 1056, 285, 214, 82, stone);
  rect(g, 1102, 274, 126, 93, stone);
  for (const y of [304, 326, 348]) line(g, 1058, y, 1268, y, '#768f7e35', 0.8);
  // Stepped bell towers with narrow copper caps and distinct stone storeys.
  for (const x of [1085, 1245]) {
    rect(g, x - 20, 274, 40, 92, stone);
    rect(g, x - 17, 239, 34, 35, '#b4bea1');
    rect(g, x - 21, 270, 42, 5, '#ded5b3');
    rect(g, x - 16, 234, 32, 5, '#d4cfb0');
    dome(g, x, 232, 14, 19);
    arch(g, x - 5, 246, 10, 17, '#54746a');
    for (const dx of [-13, 10]) rect(g, x + dx, 241, 3, 27, '#dad3b2');
    rect(g, x - 22, 294, 44, 4, '#d3cdb0');
    for (const dx of [-10, 4]) {
      rect(g, x + dx, 311, 6, 14, '#617d70');
      rect(g, x + dx - 1, 326, 8, 2, '#d8d0af');
      rect(g, x + dx, 339, 6, 13, '#617d70');
    }
    rect(g, x - 22, 360, 44, 6, '#b8b99b');
  }
  // Octagonal drum: a broad architectural base, not a narrow mushroom stem.
  path(g, [['moveTo', 1108, 268], ['lineTo', 1114, 229], ['lineTo', 1124, 214],
    ['lineTo', 1206, 214], ['lineTo', 1216, 229], ['lineTo', 1222, 268], ['closePath']], stone);
  rect(g, 1112, 266, 106, 7, '#d4cdae');
  for (let i = 0; i < 6; i++) {
    const x = 1125 + i * 14;
    arch(g, x, 231, 6, 17, '#54766d');
    rect(g, x - 4, 225, 3, 34, '#d8d3b2');
    rect(g, x - 5, 224, 5, 3, '#e3d9b8');
    rect(g, x - 5, 258, 5, 3, '#a5ad94');
  }
  dome(g, 1165, 210, 46, 55);
  // A deep pediment, frieze and paired columns give the facade a civic scale.
  path(g, [['moveTo', 1097, 302], ['lineTo', 1165, 275], ['lineTo', 1233, 302], ['closePath']], '#a9b198');
  path(g, [['moveTo', 1106, 299], ['lineTo', 1165, 281], ['lineTo', 1224, 299], ['closePath']], '#d0caab');
  path(g, [['moveTo', 1132, 295], ['lineTo', 1165, 286], ['lineTo', 1198, 295]], null, '#9aa88f', 1.5);
  rect(g, 1098, 302, 134, 7, '#e0d5b4');
  rect(g, 1104, 309, 122, 6, '#b3b69a');
  for (let i = 0; i < 13; i++) rect(g, 1109 + i * 9, 310, 3, 3, '#dcd2b0');
  // Three equally sized portals avoid the old face-like window/door arrangement.
  for (const x of [1135, 1158, 1181]) {
    arch(g, x - 2, 335, 18, 31, '#b4b69b');
    arch(g, x, 337, 14, 29, '#486b63');
    line(g, x + 7, 346, x + 7, 366, '#b5b99c', 0.7);
    line(g, x + 1, 347, x + 13, 347, '#a2ae94', 0.8);
  }
  for (const x of [1110, 1120, 1205, 1215]) {
    rect(g, x, 318, 5, 44, '#ded4b1'); rect(g, x - 2, 316, 9, 4, '#eee0bb'); rect(g, x - 2, 361, 9, 4, '#a6ad92');
  }
  for (const x of [1140, 1163, 1186]) rect(g, x, 320, 5, 8, '#a7b299');
  rect(g, 1049, 365, 230, 5, '#b8b99c');
  rect(g, 1044, 370, 240, 4, '#7b9282');
}

function tower(g) {
  // Fernsehturm: slender taper, antenna bands and glazed observation sphere.
  path(g, [['moveTo', 1567, 365], ['lineTo', 1579, 125], ['lineTo', 1585, 125], ['lineTo', 1594, 365], ['closePath']], '#d4d7c4');
  path(g, [['moveTo', 1583, 126], ['lineTo', 1585, 126], ['lineTo', 1594, 365], ['lineTo', 1588, 365], ['closePath']], '#92aaa8');
  const sphere = gradient(g, 0, 87, 0, 131, [[0, '#e0e2cc'], [0.38, '#b7cbc2'], [0.5, '#688d91'], [0.68, '#8da9a5'], [1, '#ced3bf']]);
  ellipse(g, 1582, 110, 23, 21, sphere);
  g.save(); g.beginPath(); g.ellipse(1582, 110, 23, 21, 0, 0, TAU); g.clip();
  rect(g, 1558, 105, 48, 8, '#567c86');
  for (let i = 0; i < 9; i++) line(g, 1561 + i * 5, 105, 1561 + i * 5, 113, '#baccc0', 0.7);
  line(g, 1562, 117, 1602, 117, '#e5e2c8', 1);
  g.restore();
  rect(g, 1578, 77, 8, 15, '#abbfb4');
  rect(g, 1580, 27, 3.5, 50, '#d1d5c4');
  for (let i = 0; i < 5; i++) rect(g, 1580, 30 + i * 9, 3.5, 4, '#c27f75');
  line(g, 1582, 17, 1582, 27, '#799ba0', 1.1);
  rect(g, 1564, 362, 34, 6, '#9eb7ac');
}

function gate(g) {
  const x = 1334;
  // Brandenburg Gate: six paired columns and stepped entablature.
  rect(g, x - 8, 362, 209, 6, '#c8bfa0');
  rect(g, x - 3, 356, 199, 6, '#ddd1b0');
  for (let i = 0; i < 6; i++) {
    const cx = x + 10 + i * 32;
    rect(g, cx, 307, 12, 49, '#d9cba9');
    rect(g, cx + 9, 307, 3, 49, '#b6b69a');
    rect(g, cx - 3, 306, 18, 4, '#e7d7b6');
    rect(g, cx - 2, 352, 16, 5, '#b8b59a');
    line(g, cx + 4, 312, cx + 4, 350, '#ece0bd', 0.8);
  }
  rect(g, x - 5, 295, 202, 12, '#c6c1a2');
  rect(g, x - 10, 291, 212, 5, '#ead8b3');
  rect(g, x + 8, 281, 177, 10, '#d3c7a6');
  rect(g, x + 23, 275, 148, 6, '#aeb59b');
  for (let i = 0; i < 13; i++) rect(g, x + 12 + i * 13, 298, 4, 5, '#abb097');
  // Four small horse profiles with curved necks, muzzles, tails and jointed legs.
  const bronze = '#547e70', center = x + 97;
  for (const offset of [-35, -17, 6, 24]) {
    g.save(); g.translate(center + offset, 274); g.scale(0.75, 0.75);
    // Far legs sit behind the body; visible knees keep them from reading as sticks.
    path(g, [['moveTo', 3, -9], ['lineTo', 5, -5], ['lineTo', 3, -1], ['lineTo', 6, -1]], null, '#71917c', 1.5);
    path(g, [['moveTo', 14, -8], ['lineTo', 12, -4], ['lineTo', 14, -1], ['lineTo', 17, -1]], null, '#71917c', 1.5);
    path(g, [['moveTo', 0, -16], ['bezierCurveTo', 4, -18, 8, -15, 10, -17],
      ['bezierCurveTo', 12, -20, 10, -25, 12, -27],
      ['lineTo', 13, -31], ['lineTo', 15, -28], ['lineTo', 17, -29], ['lineTo', 18, -26],
      ['bezierCurveTo', 18, -24, 22, -24, 23, -22], ['lineTo', 25, -21], ['lineTo', 24, -18], ['lineTo', 19, -18],
      ['bezierCurveTo', 18, -15, 17, -12, 17, -9],
      ['bezierCurveTo', 15, -4, 5, -3, 0, -5], ['bezierCurveTo', -5, -7, -5, -13, 0, -16], ['closePath']], bronze);
    path(g, [['moveTo', 1, -7], ['lineTo', -2, -3], ['lineTo', -1, 0], ['lineTo', 2, 0]], null, bronze, 1.8);
    path(g, [['moveTo', 14, -7], ['lineTo', 16, -3], ['lineTo', 16, 0], ['lineTo', 19, 0]], null, bronze, 1.8);
    path(g, [['moveTo', -1, -15], ['bezierCurveTo', -7, -15, -3, -6, -8, -5]], null, bronze, 1.6);
    line(g, 19, -23, 19, -18, '#a1b59a', 0.8);
    line(g, 14, -26, 19, -20, '#a1b59a', 0.8);
    g.restore();
  }
  // Chariot and winged driver, set behind the horses rather than astride them.
  rect(g, center - 8, 263, 16, 6, bronze, 1);
  for (const dx of [-8, 8]) {
    ellipse(g, center + dx, 271, 3.2, 3.2, bronze);
    ellipse(g, center + dx, 271, 1.5, 1.5, '#aeb99d');
  }
  path(g, [['moveTo', center - 3, 251], ['lineTo', center + 3, 251], ['lineTo', center + 5, 263], ['lineTo', center - 5, 263], ['closePath']], bronze);
  ellipse(g, center, 247, 2.6, 3, bronze);
  path(g, [['moveTo', center - 2, 254], ['bezierCurveTo', center - 8, 254, center - 13, 249, center - 12, 244],
    ['bezierCurveTo', center - 7, 246, center - 5, 248, center - 2, 252]], bronze);
  path(g, [['moveTo', center + 2, 254], ['bezierCurveTo', center + 8, 254, center + 13, 249, center + 12, 244],
    ['bezierCurveTo', center + 7, 246, center + 5, 248, center + 2, 252]], bronze);
  line(g, center + 6, 236, center + 6, 261, bronze, 1.3);
  ellipse(g, center + 6, 236, 2.1, 2.1, bronze);
  for (const dx of [-23, 23]) line(g, center + Math.sign(dx) * 5, 258, center + dx, 262, bronze, 0.7);
}

function townhouse(g, x, base, w, h, color, roof = 'gable') {
  rect(g, x, base - h, w, h, color);
  if (roof === 'gable') {
    path(g, [['moveTo', x - 3, base - h], ['lineTo', x + w / 2, base - h - 13], ['lineTo', x + w + 3, base - h], ['closePath']], '#748b81');
  } else {
    rect(g, x - 2, base - h - 6, w + 4, 6, '#80988c');
    rect(g, x + 6, base - h - 10, w - 12, 4, color);
  }
  rect(g, x + w - 5, base - h, 5, h, '#78958740');
  line(g, x + 2, base - h + 5, x + w - 2, base - h + 5, '#e6d9b66e', 1.2);
  const cols = Math.max(2, Math.floor(w / 13));
  const rows = Math.max(1, Math.floor((h - 12) / 17));
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const wx = x + (col + 0.5) * w / cols - 2;
    const wy = base - h + 12 + row * 16;
    rect(g, wx, wy, 4, 7, '#5d7e78');
    line(g, wx - 1, wy + 8, wx + 5, wy + 8, '#e4d6b4', 1);
  }
}

function tree(g, x, y, scale, color) {
  g.save(); g.translate(x, y); g.scale(scale, scale);
  line(g, 0, 0, 0, -19, '#658571', 2);
  path(g, [['moveTo', -14, -11], ['bezierCurveTo', -24, -15, -21, -28, -12, -30],
    ['bezierCurveTo', -13, -41, 2, -46, 8, -37], ['bezierCurveTo', 21, -40, 26, -25, 18, -19],
    ['bezierCurveTo', 22, -9, 5, -6, 0, -11], ['bezierCurveTo', -5, -6, -11, -6, -14, -11], ['closePath']], color);
  path(g, [['moveTo', -12, -26], ['bezierCurveTo', -6, -33, -1, -37, 4, -33]], null, '#d6dfb22e', 1.5);
  g.restore();
}

export function drawBerlinIllustration(g, x, y, width, height) {
  g.save(); g.translate(x, y); g.scale(width / 1824, height / 440);
  // One continuous sky, rather than a flat panel overlaid on an image.
  const sky = gradient(g, 0, 50, 1824, 205, [[0, '#142e49'], [0.3, '#1e4056'], [0.51, '#628e9f'], [0.76, '#aed4d9'], [1, '#d8e5da']]);
  rect(g, 0, 0, 1824, 440, sky);
  const sun = gradient(g, 0, 32, 0, 186, [[0, '#fff8de'], [1, '#f4ebc6']]);
  ellipse(g, 1585, 104, 73, 73, sun);
  // Restrained flight-path arcs in the sky.
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.ellipse(1528, 267, 268 + i * 103, 230 + i * 67, -0.13, Math.PI * 1.05, Math.PI * 1.88);
    g.strokeStyle = '#f4f6e929'; g.lineWidth = 0.8; g.stroke();
  }
  // Atmospheric background blocks, with varied footprints and cornices.
  const colors = ['#83a7a7', '#94b2ac', '#7fa2a4'];
  for (let i = 0; i < 35; i++) {
    const bx = 710 + i * 34, bh = 27 + (i * 29) % 66;
    rect(g, bx, 349 - bh, 25 + i % 3 * 3, bh + 10, colors[i % 3]);
    if (i % 5 === 0) rect(g, bx + 7, 343 - bh, 11, 7, colors[i % 3]);
  }
  // A distant church spire balances the larger dome.
  rect(g, 963, 287, 24, 65, '#789990');
  path(g, [['moveTo', 959, 287], ['lineTo', 975, 243], ['lineTo', 991, 287], ['closePath']], '#557c76');
  line(g, 975, 234, 975, 245, '#99b5a0', 1.1);
  tower(g); cathedral(g); gate(g);
  const houses = [
    [738, 53, 43, '#8caa9c'], [794, 45, 57, '#b3bea3'], [842, 59, 48, '#c9c5a5'],
    [905, 40, 64, '#a6b7a0'], [950, 62, 44, '#c3c6a7'], [1016, 36, 52, '#d0c9a8'],
    [1284, 43, 33, '#b3bda0'], [1548, 45, 31, '#c9c9ac'], [1610, 51, 45, '#d9ceb0'],
    [1665, 47, 58, '#bfc4a8'], [1716, 56, 48, '#dacbab'], [1776, 50, 63, '#c2c2a5'],
  ];
  houses.forEach(([hx, hw, hh, color], i) => townhouse(g, hx, 369, hw, hh, color, i % 3 ? 'gable' : 'flat'));
  // Park and embankment: organic canopies rather than repeated circles.
  rect(g, 700, 370, 1124, 10, '#91ac91');
  const trees = [[744, 1], [807, 0.74], [878, 0.94], [935, 0.66], [1000, 0.8], [1053, 0.62], [1287, 0.83], [1324, 0.61], [1536, 0.72], [1610, 0.76], [1669, 0.63], [1741, 0.8], [1801, 0.7]];
  trees.forEach(([tx, scale], i) => tree(g, tx, 379, scale, i % 2 ? '#6c937c' : '#547f70'));
  rect(g, 0, 380, 1824, 5, '#c4c7aa');
  rect(g, 0, 385, 1824, 5, '#789d96');
  // River with quiet, deliberately placed reflection strokes.
  const water = gradient(g, 680, 390, 1824, 440, [[0, '#507e8e'], [0.55, '#87b2b3'], [1, '#accbc1']]);
  rect(g, 0, 390, 1824, 50, water);
  for (let i = 0; i < 39; i++) {
    const rx = 730 + (i * 109) % 1094, ry = 396 + (i * 17) % 41;
    line(g, rx, ry, Math.min(1824, rx + 15 + i % 4 * 11), ry, i % 3 ? '#e2e3c060' : '#537e8550', i % 4 ? 1 : 2);
  }
  // A river boat gives scale without cluttering the skyline.
  path(g, [['moveTo', 1483, 414], ['lineTo', 1566, 414], ['lineTo', 1557, 424], ['lineTo', 1490, 424], ['closePath']], '#e6e2c9');
  rect(g, 1496, 405, 55, 9, '#f4edcf', 2);
  for (let i = 0; i < 7; i++) rect(g, 1500 + i * 7, 407, 4, 5, '#608e96');
  line(g, 1476, 427, 1564, 427, '#dae2cc70', 1);
  // Apply the same broad tint across the entire banner, preserving continuity.
  const shade = gradient(g, 0, 0, 1824, 0, [[0, '#142e49'], [0.25, '#142e49f2'], [0.4, '#1b3e52b3'], [0.59, '#39667820'], [0.75, '#39667800'], [1, '#39667800']]);
  rect(g, 0, 0, 1824, 440, shade);
  g.restore();
}
