import { normalizeAirlineOpts, getAirlineFlights } from './model.js';
import { drawBerlinIllustration } from './illustration.js';

const NAVY = '#12243a', MUTED = '#68798c', LINE = '#dce4eb';
const FONT = 'Arial, sans-serif';

function box(g, x, y, w, h, fill, r = 0, stroke) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
}
function text(g, value, x, y, size = 20, color = NAVY, weight = 400, max = 600, align = 'left') {
  g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  // Fit text without cutting off user-supplied names or translations.
  let actual = size;
  g.font = `${weight} ${actual}px ${FONT}`;
  while (g.measureText(String(value)).width > max && actual > 8) {
    actual -= 0.5; g.font = `${weight} ${actual}px ${FONT}`;
  }
  g.fillText(String(value), x, y, max);
  g.textAlign = 'left';
}
function line(g, x, y, x2, y2, color = LINE, width = 1.5, dash = []) {
  g.beginPath(); g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
  g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
}
function plane(g, x, y, size, color = NAVY, rotation = 0) {
  g.save(); g.translate(x, y); g.rotate(rotation); g.scale(size / 24, size / 24);
  g.fillStyle = color; g.beginPath();
  g.moveTo(23, 12); g.lineTo(14, 9.5); g.lineTo(8, 1); g.lineTo(5, 1);
  g.lineTo(8, 10); g.lineTo(3, 10.5); g.lineTo(1, 7); g.lineTo(0, 7);
  g.lineTo(1, 12); g.lineTo(0, 17); g.lineTo(1, 17); g.lineTo(3, 13.5);
  g.lineTo(8, 14); g.lineTo(5, 23); g.lineTo(8, 23); g.lineTo(14, 14.5);
  g.closePath(); g.fill(); g.restore();
}
function brand(g, o, x, y, color = o.accent, size = 31, max = 340) {
  plane(g, x, y - size * 0.65, size, color, -0.45);
  text(g, o.airline, x + size + 12, y, size, color, 700, max - size - 12);
}
function arrow(g, x, y, color = NAVY) {
  line(g, x, y, x + 22, y, color, 2);
  line(g, x + 16, y - 6, x + 22, y, color, 2);
  line(g, x + 16, y + 6, x + 22, y, color, 2);
}

// Canvas flags also work on Windows, where flag emoji often render as letters.
export function flag(g, code, x, y, w = 32, h = 21) {
  g.save(); g.beginPath(); g.roundRect(x, y, w, h, 2); g.clip();
  g.fillStyle = '#fff'; g.fillRect(x, y, w, h);
  const stripe = (color, a, b, c, d) => { g.fillStyle = color; g.fillRect(a, b, c, d); };
  if (code === 'FR') {
    stripe('#163b8a', x, y, w / 3, h); stripe('#e13a43', x + w * 2 / 3, y, w / 3, h);
  } else if (code === 'NL' || code === 'DE' || code === 'ES') {
    const colors = code === 'NL' ? ['#b82b36', '#fff', '#234687'] : code === 'DE' ? ['#202020', '#d93937', '#f5ca45'] : ['#bd2635', '#f7c842', '#bd2635'];
    colors.forEach((c, i) => stripe(c, x, y + h * i / 3, w, h / 3));
  } else {
    stripe('#213967', x, y, w, h);
    line(g, x, y, x + w, y + h, '#fff', h * 0.23);
    line(g, x, y + h, x + w, y, '#fff', h * 0.23);
    line(g, x, y, x + w, y + h, '#c83245', h * 0.09);
    line(g, x, y + h, x + w, y, '#c83245', h * 0.09);
    stripe('#fff', x + w * 0.38, y, w * 0.24, h); stripe('#fff', x, y + h * 0.33, w, h * 0.34);
    stripe('#c83245', x + w * 0.43, y, w * 0.14, h); stripe('#c83245', x, y + h * 0.4, w, h * 0.2);
  }
  g.restore(); box(g, x, y, w, h, null, 2, '#00000018');
}

function website(g, o) {
  box(g, 0, 0, 1920, 1080, '#f8fafb');
  box(g, 0, 0, 1920, 96, '#fff');
  brand(g, o, 72, 62, o.accent, 33, 330);
  const nav = [[o.navBook, 456], [o.navDestinations, 670], [o.navTrips, 906], [o.navHelp, 1136]];
  nav.forEach(([label, x]) => text(g, label, x, 59, 20, NAVY, 500, 196));
  line(g, 456, 94, 597, 94, o.accent, 3);
  ['EN', 'NL', 'FR', 'DE', 'ES'].forEach((lang, i) => {
    const x = 1350 + i * 99;
    if (o.language === lang) box(g, x - 10, 24, 88, 52, '#eef3fa', 8);
    flag(g, lang, x, 39, 30, 20); text(g, lang, x + 38, 55, 14, NAVY, 600, 34);
  });
  g.save(); g.beginPath(); g.roundRect(48, 116, 1824, 440, 20); g.clip();
  drawBerlinIllustration(g, 48, 116, 1824, 440);
  plane(g, 1760, 179, 37, '#f7f8e9', -0.42);
  text(g, o.heroEyebrow, 115, 176, 15, '#bfe3df', 700, 650);
  text(g, o.heroTitle, 110, 248, 61, '#fff', 400, 720);
  text(g, o.destination + (o.destination ? '.' : ''), 110, 337, 88, '#fff', 700, 730);
  text(g, o.heroSubtitle, 115, 381, 21, '#d5e2eb', 400, 690);
  box(g, 115, 407, 254, 52, '#d9f5a4', 7);
  text(g, o.heroButton, 137, 440, 18, NAVY, 700, 190); arrow(g, 327, 433);
  g.restore();
  // Search fields and every result below read from the same shared route.
  g.save(); g.shadowColor = '#1b35451c'; g.shadowBlur = 25; g.shadowOffsetY = 8;
  box(g, 94, 576, 1732, 140, '#fff', 15); g.restore();
  text(g, o.bookingTitle, 127, 609, 21, NAVY, 700, 1150);
  text(g, o.oneWay + '  ⌄', 1779, 609, 16, MUTED, 400, 350, 'right');
  const fields = [
    [o.from, o.origin + ' (' + o.originCode + ')', 127, 359],
    [o.to, o.destination + ' (' + o.destinationCode + ')', 506, 359],
    [o.dateLabel, o.date, 885, 305],
    [o.passengers, o.ticketType === 'child' ? o.childPassengerCount : o.passengerCount, 1210, 273],
  ];
  fields.forEach(([label, val, x, w]) => {
    box(g, x, 625, w, 68, '#fff', 8, LINE);
    text(g, label, x + 19, 648, 13, MUTED, 400, w - 38);
    text(g, val, x + 19, 678, 21, NAVY, 600, w - 38);
  });
  box(g, 1503, 625, 290, 68, o.accent, 8);
  text(g, o.search, 1648, 667, 22, '#fff', 700, 250, 'center');
  text(g, o.featured, 96, 748, 24, NAVY, 700, 1500);
  getAirlineFlights(o).forEach((flight, i) => {
    const y = 762 + i * 92;
    box(g, 94, y, 1732, 82, '#fff', 12, LINE);
    plane(g, 126, y + 28, 32, o.accent, -0.35);
    text(g, o.airline, 175, y + 36, 19, NAVY, 700, 200);
    text(g, flight.flight, 175, y + 65, 14, MUTED, 400, 200);
    text(g, flight.departure, 439, y + 37, 26, NAVY, 700, 200);
    text(g, flight.originCode + ' · ' + flight.origin, 439, y + 66, 15, MUTED, 400, 230);
    line(g, 704, y + 33, 939, y + 33, LINE, 2); plane(g, 811, y + 22, 23, o.accent);
    text(g, flight.duration + ' · ' + o.direct, 825, y + 65, 15, MUTED, 400, 280, 'center');
    text(g, flight.arrival, 998, y + 37, 26, NAVY, 700, 200);
    text(g, flight.destinationCode + ' · ' + flight.destination, 998, y + 66, 15, MUTED, 400, 240);
    line(g, 1260, y + 14, 1260, y + 74);
    text(g, o.fareLabel, 1295, y + 21, 12, MUTED, 400, 210);
    text(g, flight.fare, 1295, y + 51, 29, NAVY, 700, 210);
    text(g, o.fareNote, 1295, y + 72, 12, MUTED, 400, 210);
    box(g, 1540, y + 18, 252, 52, '#eff4ff', 8);
    text(g, o.select, 1666, y + 51, 18, o.accent, 700, 220, 'center');
  });
}

function barcode(g, seed, x, y, w, h) {
  // Decorative bars, intentionally not a machine-readable travel credential.
  let state = [...seed].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 17);
  g.fillStyle = NAVY;
  for (let px = 0; px < w;) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bw = 1 + state % 4;
    g.fillRect(x + px, y, Math.min(bw, w - px), h); px += bw + 2 + state % 3;
  }
}

function ticket(g, o) {
  box(g, 0, 0, 1600, 800, '#edf1f4');
  // Quiet destination contours around the pass.
  g.save(); g.globalAlpha = 0.15;
  for (let i = 0; i < 8; i++) { g.beginPath(); g.strokeStyle = '#86a7b0'; g.lineWidth = 1; g.ellipse(1290, 140, 300 + i * 52, 140 + i * 46, -0.3, 0, 7); g.stroke(); }
  g.restore();
  g.save(); g.shadowColor = '#20334b20'; g.shadowBlur = 36; g.shadowOffsetY = 12;
  box(g, 56, 80, 1488, 640, '#fff', 24); g.restore();
  g.save(); g.beginPath(); g.roundRect(56, 80, 1488, 640, 24); g.clip();
  box(g, 56, 80, 1488, 123, NAVY);
  box(g, 1174, 203, 370, 517, '#f5f8fc');
  brand(g, o, 97, 153, '#fff', 34, 630);
  text(g, o.boardingPass, 1125, 151, 21, '#e4eeff', 500, 440, 'right');
  text(g, o.boardingPass, 1359, 151, 17, '#e4eeff', 600, 325, 'center');
  const label = (val, x, y, w = 260) => text(g, val, x, y, 15, MUTED, 500, w);
  const value = (val, x, y, w = 260, size = 25) => text(g, val || '—', x, y, size, NAVY, 600, w);
  label(o.passengerLabel, 100, 251, 600); value(o.passenger, 100, 287, 700, 31);
  const ticketType = o.ticketType === 'child' ? o.childTicket : o.adultTicket;
  label(o.ticketTypeLabel, 830, 251, 145); value(ticketType, 830, 287, 145, 23);
  text(g, o.confirmed, 1128, 264, 14, o.accent, 700, 145, 'right');
  text(g, o.originCode, 97, 402, 92, NAVY, 700, 315);
  text(g, o.destinationCode, 810, 402, 92, NAVY, 700, 320);
  value(o.origin, 102, 443, 380, 23);
  value(o.destination, 814, 443, 310, 23);
  line(g, 456, 361, 742, 361, '#bdcbd7', 2, [5, 6]);
  plane(g, 575, 337, 48, o.accent);
  text(g, o.duration, 600, 412, 17, MUTED, 400, 230, 'center');
  line(g, 100, 476, 1128, 476);
  const detail = (l, v, x, y, w = 150) => { label(l, x, y, w); value(v, x, y + 34, w); };
  detail(o.flightLabel, o.flight, 102, 516, 195);
  detail(o.dateLabel, o.date, 328, 516, 245);
  detail(o.boardingLabel, o.boarding, 609, 516, 180);
  detail(o.departureLabel, o.departure, 829, 516, 145);
  detail(o.arrivalLabel, o.arrival, 1010, 516, 120);
  barcode(g, o.reference + o.passenger + o.flight, 103, 600, 364, 55);
  text(g, o.reference, 285, 679, 14, MUTED, 500, 360, 'center');
  detail(o.referenceLabel, o.reference, 510, 615, 270);
  text(g, o.ticketNote, 812, 638, 15, MUTED, 400, 310);
  // Perforated stub.
  line(g, 1174, 203, 1174, 720, '#c4d0dc', 2, [6, 8]);
  text(g, o.originCode, 1217, 282, 46, NAVY, 700, 112);
  arrow(g, 1346, 267, o.accent);
  text(g, o.destinationCode, 1390, 282, 46, NAVY, 700, 112);
  label(o.passengerLabel, 1217, 325, 280); value(o.passenger, 1217, 355, 280, 22);
  detail(o.flightLabel, o.flight, 1217, 404, 130);
  detail(o.dateLabel, o.date, 1380, 404, 125);
  detail(o.gateLabel, o.gate, 1217, 490, 120);
  detail(o.seatLabel, o.seat, 1380, 490, 125);
  detail(o.classLabel, o.cabin, 1217, 577, 140);
  detail(o.ticketTypeLabel, ticketType, 1380, 577, 125);
  text(g, o.tagline, 1358, 679, 14, MUTED, 400, 285, 'center');
  g.restore();
  // Round cutouts at the ends of the perforation.
  for (const y of [80, 720]) { g.fillStyle = '#edf1f4'; g.beginPath(); g.arc(1174, y, 16, 0, Math.PI * 2); g.fill(); }
}

export function renderAirline(canvas, raw) {
  const opts = normalizeAirlineOpts(raw), g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas wordt niet ondersteund in deze browser.');
  g.save(); g.clearRect(0, 0, canvas.width, canvas.height);
  g.scale(canvas.width / (opts.design === 'ticket' ? 1600 : 1920), canvas.height / (opts.design === 'ticket' ? 800 : 1080));
  if (opts.design === 'ticket') ticket(g, opts); else website(g, opts);
  g.restore();
}
