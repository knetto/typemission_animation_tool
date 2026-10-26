// Deterministic Canvas Renderer for Keyboard Grid & Satisfying Per-Key Sticker Animation
import {
  FINGERS,
  KEYBOARD_THEMES,
  getLayout,
  getFlatKeys,
  normalizeKeyboardOpts,
  keyboardSchedule,
  keyboardSoundtrack,
} from './model.js';
import { drawLogo, LOGO_ASPECT } from '../scenes/renderer.js';

// Keycap icons are drawn slightly narrower than the native (wide) logo so they read as upright, not stretched.
const KEY_LOGO_ASPECT = LOGO_ASPECT / 0.84;

export const W = 1920, H = 1080;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutCubic = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutBack = (t) => {
  t = clamp01(t);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function hexToRgb(hex) {
  const clean = String(hex || '#3b82f6').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16) || 0x3b82f6;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(hex1, hex2, weight = 0.5) {
  const a = hexToRgb(hex1), b = hexToRgb(hex2);
  const r = Math.round(lerp(a.r, b.r, weight));
  const g = Math.round(lerp(a.g, b.g, weight));
  const bl = Math.round(lerp(a.b, b.b, weight));
  return `rgb(${r}, ${g}, ${bl})`;
}

function drawCoverImage(ctx, img, rx, ry, rw, rh) {
  const iw = img?.naturalWidth || img?.width || 0;
  const ih = img?.naturalHeight || img?.height || 0;
  if (!iw || !ih) return false;
  const scale = Math.max(rw / iw, rh / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = rx + (rw - dw) / 2;
  const dy = ry + (rh - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}

// Trace either a standard rounded rectangle or a 6-corner stepped L-shaped ISO Enter key
function traceKeyShape(ctx, x, y, w, h, r, isoStepX = 0, isoStepY = 0) {
  ctx.beginPath();
  if (isoStepX <= 0 || isoStepY <= 0) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rOuter = Math.min(r, w * 0.25, h * 0.2);
  const rInner = Math.min(rOuter * 0.75, isoStepX * 0.45, isoStepY * 0.45);
  ctx.moveTo(x + rOuter, y);
  ctx.arcTo(x + w, y, x + w, y + h, rOuter);
  ctx.arcTo(x + w, y + h, x + isoStepX, y + h, rOuter);
  ctx.arcTo(x + isoStepX, y + h, x + isoStepX, y + isoStepY, rOuter);
  ctx.arcTo(x + isoStepX, y + isoStepY, x, y + isoStepY, rInner);
  ctx.arcTo(x, y + isoStepY, x, y, rOuter);
  ctx.arcTo(x, y, x + w, y, rOuter);
  ctx.closePath();
}

// Compute pixel rectangles for all keys in the 1920x1080 stage
export function computeKeyRects(layoutId) {
  const keys = getFlatKeys(layoutId);
  const unitW = 102;
  const rowH = 102;
  const gap = 10;
  const totalW = 15 * unitW;
  const totalH = 5 * rowH;
  const startX = (W - totalW) / 2;
  const startY = (H - totalH) / 2 + 28;

  return {
    boardRect: {
      x: startX - 38,
      y: startY - 38,
      w: totalW + 76 - gap,
      h: totalH + 76 - gap,
    },
    keys: keys.map((k) => {
      const isIso = Boolean(k.isoEnter);
      const x = startX + k.unitX * unitW;
      const y = startY + k.rowIndex * rowH;
      const w = k.w * unitW - gap;
      const h = isIso ? rowH * 2 - gap : rowH - gap;
      const isoStepX = isIso ? (k.w - (k.wBottom || 1.25)) * unitW : 0;
      const isoStepY = isIso ? rowH - gap : 0;
      return {
        ...k,
        x,
        y,
        w,
        h,
        isoStepX,
        isoStepY,
        cx: x + (isoStepX + w) / 2,
        cy: y + h / 2,
      };
    }),
  };
}

export function createKeyboardScene(canvas, targetKeyId, options = {}, { preStickeredIds = [], bgImage = null } = {}) {
  const opts = normalizeKeyboardOpts(options);
  const theme = KEYBOARD_THEMES[opts.theme] || KEYBOARD_THEMES.dark;
  const schedule = keyboardSchedule(opts);
  const soundtrack = keyboardSoundtrack(schedule, opts);
  const { boardRect, keys } = computeKeyRects(opts.layout);
  const targetKey = keys.find((k) => k.id === targetKeyId) || keys.find((k) => k.id === opts.previewKey) || keys[16];
  const preSet = new Set(preStickeredIds.filter((id) => id !== targetKey?.id));
  let g = canvas.getContext('2d');

  const isChromaOrCutout =
    opts.bgMode === 'greenscreen' ||
    (opts.bgMode === 'masked' && (opts.maskMode === 'cutout' || opts.maskMode === 'board' || opts.maskMode === 'keys'));
  const effectiveBoardMode =
    opts.bgMode === 'masked'
      ? opts.maskMode === 'board'
        ? 'image'
        : opts.maskMode === 'keys'
          ? 'hidden'
          : opts.boardMode
      : opts.boardMode;
  const maskImageOnKeys = opts.bgMode === 'masked' && opts.maskMode === 'keys';

  function drawKeycapBase(k, pressY = 0, highlightAlpha = 0, fingerColor = '#3b82f6') {
    const x = k.x;
    const y = k.y + pressY;
    const w = k.w;
    const h = k.h;
    const stepX = k.isoStepX || 0;
    const stepY = k.isoStepY || 0;
    const sideDepth = Math.max(2, 8 - pressY * 0.75);

    g.save();
    // Avoid semi-transparent outer shadow on greenscreen/cutout when board plate is hidden
    if (!(isChromaOrCutout && effectiveBoardMode === 'hidden')) {
      g.fillStyle = 'rgba(0, 0, 0, 0.38)';
      traceKeyShape(g, x + 1, k.y + 4, w, h, 14, stepX, stepY);
      g.fill();
    }

    // Fast GPU-friendly glow halo (avoids expensive CPU shadowBlur on wide keys like spacebar)
    if (highlightAlpha > 0.05 && !(isChromaOrCutout && effectiveBoardMode === 'hidden')) {
      g.fillStyle = rgba(fingerColor, highlightAlpha * 0.18);
      traceKeyShape(g, x - 6, y - 6, w + 12, h + 12, 18, stepX, stepY > 0 ? stepY + 12 : 0);
      g.fill();
      g.fillStyle = rgba(fingerColor, highlightAlpha * 0.28);
      traceKeyShape(g, x - 3, y - 3, w + 6, h + 6, 15, stepX, stepY > 0 ? stepY + 6 : 0);
      g.fill();
    }

    // Keycap 3D bevel / side wall
    g.fillStyle = highlightAlpha > 0 ? mixHex(theme.keySide, fingerColor, highlightAlpha * 0.45) : theme.keySide;
    g.strokeStyle = highlightAlpha > 0 ? mixHex(theme.keyBorder, fingerColor, highlightAlpha * 0.85) : theme.keyBorder;
    g.lineWidth = highlightAlpha > 0 ? 2.5 : 1.5;
    traceKeyShape(g, x, y, w, h, 13, stepX, stepY);
    g.fill();
    g.stroke();

    // Keycap top surface
    const topX = x + 5;
    const topY = y + 3;
    const topW = w - 10;
    const topH = h - 3 - sideDepth;
    const topStepX = stepX > 0 ? stepX : 0;
    const topStepY = stepY > 0 ? stepY - 3 - sideDepth : 0;
    const topGrad = g.createLinearGradient(topX, topY, topX, topY + topH);
    const cTop = highlightAlpha > 0 ? mixHex(theme.keyTop, fingerColor, highlightAlpha * 0.25) : theme.keyTop;
    topGrad.addColorStop(0, mixHex(cTop, '#ffffff', 0.06));
    topGrad.addColorStop(1, cTop);
    g.fillStyle = topGrad;
    traceKeyShape(g, topX, topY, topW, topH, 10, topStepX, topStepY);
    g.fill();

    // If image is masked across the keycaps themselves ('keys' mask mode)
    if (maskImageOnKeys && bgImage) {
      g.save();
      traceKeyShape(g, topX, topY, topW, topH, 10, topStepX, topStepY);
      g.clip();
      drawCoverImage(g, bgImage, boardRect.x, boardRect.y - pressY, boardRect.w, boardRect.h);
      if (opts.bgImageDim > 0) {
        g.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
        g.fillRect(topX, topY, topW, topH);
      }
      g.restore();
    }

    // Subtle finger-lane color bar or bottom edge indicator if showLaneGuide is enabled
    if (opts.showLaneGuide) {
      const kColor = opts.fingerColors[k.finger] || '#3b82f6';
      g.fillStyle = rgba(kColor, 0.42);
      const barLeft = topX + topStepX + 10;
      const barW = Math.max(12, topW - topStepX - 20);
      g.beginPath();
      g.roundRect(barLeft, topY + topH - 5, barW, 3, 1.5);
      g.fill();
    }

    // Keycap typography or Spy mask icon (visible before sticker covers it)
    const textCenterX = topX + (topStepX + topW) / 2;
    g.fillStyle = theme.keyText;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (k.spyIcon || k.id === 'win') {
      const logoW = Math.min(topW * 0.42, (topH * 0.50) / KEY_LOGO_ASPECT);
      const logoH = logoW * KEY_LOGO_ASPECT;
      drawLogo(g, textCenterX - logoW / 2, topY + (topH - logoH) / 2, logoW, theme.keyText, logoH);
    } else if (k.sub) {
      g.font = '600 16px "Outfit", sans-serif';
      g.fillStyle = theme.keySub;
      g.fillText(k.sub, textCenterX, topY + topH * 0.30);
      g.font = '700 24px "Outfit", sans-serif';
      g.fillStyle = theme.keyText;
      g.fillText(k.label, textCenterX, topY + topH * 0.67);
    } else {
      const isWord = k.label.length > 2;
      g.font = isWord ? '600 18px "Outfit", sans-serif' : '700 28px "Outfit", sans-serif';
      g.fillText(k.label, textCenterX, topY + topH * 0.5);
    }

    // Tactile homing bump on F and J
    if (k.homing) {
      g.fillStyle = rgba(theme.keyText, 0.45);
      g.beginPath();
      g.roundRect(topX + topW / 2 - 9, topY + topH - 11, 18, 2.5, 1.5);
      g.fill();
    }

    g.restore();
    return { topX, topY, topW, topH, topStepX, topStepY };
  }

  // Draw a finished or partial sticker on top of a keycap
  function drawStickerSurface(k, topRect, color, {
    style = 'peel',
    progress = 1,
    shineProgress = -1,
    blank = true,
  } = {}) {
    if (progress <= 0) return;
    const { topX, topY, topW, topH, topStepX = 0, topStepY = 0 } = topRect;
    const pad = 2;
    const sx = topX + pad;
    const sy = topY + pad;
    const sw = topW - pad * 2;
    const sh = topH - pad * 2;
    const sStepX = topStepX > 0 ? topStepX : 0;
    const sStepY = topStepY > 0 ? Math.max(8, topStepY - pad * 2) : 0;
    const radius = 9;

    g.save();

    if (style === 'pop' && progress < 1) {
      const p = easeOutBack(progress);
      const scale = lerp(1.65, 1.0, p);
      const liftY = lerp(-56, 0, easeOutCubic(progress));
      const tilt = lerp(k.hand === 'left' ? -0.18 : 0.18, 0, easeOutCubic(progress));
      g.translate(sx + sw / 2, sy + sh / 2 + liftY);
      g.rotate(tilt);
      g.scale(scale, scale);
      g.translate(-(sx + sw / 2), -(sy + sh / 2));

      // Floating shadow on keycap
      g.shadowColor = 'rgba(0, 0, 0, 0.48)';
      g.shadowBlur = lerp(28, 4, easeOutCubic(progress));
      g.shadowOffsetY = lerp(22, 1, easeOutCubic(progress));
    } else if (style === 'slide' && progress < 1) {
      const p = easeOutCubic(progress);
      const angle = k.hand === 'left' ? -0.25 : k.hand === 'right' ? 0.25 : 0;
      const dist = (1 - p) * 95;
      const dx = Math.sin(angle) * dist;
      const dy = -Math.cos(angle) * dist;
      g.translate(dx, dy);
      g.globalAlpha = clamp01(progress * 1.35);
      g.shadowColor = 'rgba(0, 0, 0, 0.42)';
      g.shadowBlur = (1 - p) * 20 + 3;
      g.shadowOffsetY = (1 - p) * 12 + 1;
    }

    // For 'peel' mode, clip the adhered portion from top to bottom
    let peelLineY = sy + sh;
    if (style === 'peel' && progress < 1) {
      const p = easeInOutCubic(progress);
      peelLineY = lerp(sy, sy + sh, p);
      g.beginPath();
      g.rect(sx - 10, sy - 10, sw + 20, Math.max(0, peelLineY - sy + 10));
      g.clip();
    }

    // Main vinyl sticker body
    const grad = g.createLinearGradient(sx, sy, sx + sw * 0.4, sy + sh);
    grad.addColorStop(0, mixHex(color, '#ffffff', 0.22));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, mixHex(color, '#000000', 0.18));

    g.fillStyle = grad;
    traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
    g.fill();
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;

    // Crisp vinyl sticker inner rim highlight
    g.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    g.lineWidth = 2;
    traceKeyShape(g, sx + 1, sy + 1, sw - 2, sh - 2, radius - 1, sStepX, sStepY > 0 ? sStepY - 2 : 0);
    g.stroke();

    // Subtle matte-gloss texture sheen on top half
    g.save();
    traceKeyShape(g, sx + 2, sy + 2, sw - 4, sh - 4, radius - 2, sStepX, sStepY > 0 ? sStepY - 4 : 0);
    g.clip();
    const topSheen = g.createLinearGradient(sx, sy, sx, sy + sh * 0.55);
    topSheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    topSheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = topSheen;
    g.fillRect(sx, sy, sw, sh * 0.5);
    g.restore();

    // Optional label on sticker (off by default: blind typing uses blank colored stickers!)
    if (!blank) {
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(0, 0, 0, 0.35)';
      g.shadowBlur = 4;
      if (k.spyIcon || k.id === 'win') {
        const logoW = Math.min(sw * 0.42, (sh * 0.50) / KEY_LOGO_ASPECT);
        const logoH = logoW * KEY_LOGO_ASPECT;
        drawLogo(g, sx + (sStepX + sw) / 2 - logoW / 2, sy + (sh - logoH) / 2, logoW, '#ffffff', logoH);
      } else {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const isWord = k.label.length > 2;
        g.font = isWord ? '700 18px "Outfit", sans-serif' : '800 28px "Outfit", sans-serif';
        g.fillText(k.label, sx + (sStepX + sw) / 2, sy + sh / 2);
      }
      g.shadowBlur = 0;
    }

    // Tactile homing bump embossed on sticker for F and J
    if (k.homing) {
      g.fillStyle = 'rgba(255, 255, 255, 0.55)';
      g.beginPath();
      g.roundRect(sx + sw / 2 - 9, sy + sh - 9, 18, 2.8, 1.5);
      g.fill();
    }

    // Diagonal glossy shine sweep after the sticker seals
    if (shineProgress > 0 && shineProgress < 1) {
      g.save();
      traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
      g.clip();
      const bandW = Math.max(36, sw * 0.22);
      const skew = sh * 0.45;
      const sweepX = lerp(sx - bandW - skew, sx + sw + bandW + skew, easeInOutCubic(shineProgress));
      const shineGrad = g.createLinearGradient(sweepX - bandW, sy, sweepX + bandW, sy + sh * 0.4);
      shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.68)');
      shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = shineGrad;
      g.beginPath();
      g.moveTo(sweepX - bandW + skew, sy - 10);
      g.lineTo(sweepX + bandW + skew, sy - 10);
      g.lineTo(sweepX + bandW - skew, sy + sh + 10);
      g.lineTo(sweepX - bandW - skew, sy + sh + 10);
      g.closePath();
      g.fill();
      g.restore();
    }

    g.restore();

    // Draw 3D curling peel lip when style === 'peel' and 0 < progress < 1
    if (style === 'peel' && progress > 0.02 && progress < 0.98) {
      const p = easeInOutCubic(progress);
      const curlH = Math.max(8, Math.sin(p * Math.PI) * 22);
      g.save();
      traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
      g.clip();

      // Shadow cast onto the uncovered keycap just below the peel line
      const shadowGrad = g.createLinearGradient(sx, peelLineY, sx, peelLineY + curlH * 1.25);
      shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
      shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = shadowGrad;
      g.fillRect(sx, peelLineY, sw, curlH * 1.25);

      // Rolled sticker underside lip
      const lipGrad = g.createLinearGradient(sx, peelLineY - curlH * 0.5, sx, peelLineY + curlH * 0.45);
      lipGrad.addColorStop(0, mixHex(color, '#ffffff', 0.15));
      lipGrad.addColorStop(0.55, mixHex(color, '#ffffff', 0.68));
      lipGrad.addColorStop(1, mixHex(color, '#000000', 0.15));
      g.fillStyle = lipGrad;
      g.beginPath();
      g.roundRect(sx, peelLineY - curlH * 0.45, sw, curlH * 0.85, 5);
      g.fill();

      g.restore();
    }
  }

  // Celebratory micro-sparkles + ripple ring when the sticker seals onto the keycap
  function drawSealBurst(k, color, burstP) {
    if (burstP <= 0 || burstP >= 1) return;
    const p = easeOutCubic(burstP);
    const alpha = Math.pow(1 - burstP, 1.5);
    g.save();

    // Expanding shockwave ring around keycap
    const expand = p * 34;
    g.strokeStyle = rgba(color, alpha * 0.75);
    g.lineWidth = lerp(4, 1, p);
    g.beginPath();
    g.roundRect(k.x - expand, k.y - expand, k.w + expand * 2, k.h + expand * 2, 14 + expand * 0.5);
    g.stroke();

    // 12 radial sparkle particles hugging the key's width & height
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + 0.25;
      const rx = k.w * 0.5 + lerp(4, 34, p);
      const ry = k.h * 0.5 + lerp(4, 34, p);
      const px = k.cx + Math.cos(angle) * rx;
      const py = k.cy + Math.sin(angle) * ry;
      const r = lerp(5.5, 1.2, p);
      g.fillStyle = i % 2 === 0 ? '#ffffff' : mixHex(color, '#ffffff', 0.35);
      g.globalAlpha = alpha;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }

    g.restore();
  }

  function drawTopBadge(t) {
    if (!opts.showKeyBadge || !targetKey) return;
    const fingerInfo = FINGERS.find((f) => f.id === targetKey.finger) || FINGERS[0];
    const fingerColor = opts.fingerColors[targetKey.finger] || fingerInfo.defaultColor;
    const layoutName = getLayout(opts.layout).name.toUpperCase();

    g.save();
    const badgeW = 660, badgeH = 68;
    const bx = (W - badgeW) / 2, by = 52;
    g.fillStyle = rgba(theme.boardBg, 0.88);
    g.strokeStyle = rgba(fingerColor, 0.65);
    g.lineWidth = 2;
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = 20;
    g.beginPath();
    g.roundRect(bx, by, badgeW, badgeH, 34);
    g.fill();
    g.stroke();
    g.shadowBlur = 0;

    // Colored sticker dot
    g.fillStyle = fingerColor;
    g.shadowColor = fingerColor;
    g.shadowBlur = 12;
    g.beginPath();
    g.arc(bx + 38, by + badgeH / 2, 14, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    // Finger name + layout + key label
    g.fillStyle = theme.keyText;
    g.font = '700 22px "Orbitron", "Outfit", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    if (targetKey.spyIcon || targetKey.id === 'win') {
      g.fillText('TOETS:', bx + 68, by + badgeH / 2 + 1);
      const badgeLogoW = 28;
      const badgeLogoH = badgeLogoW * LOGO_ASPECT;
      drawLogo(g, bx + 162, by + (badgeH - badgeLogoH) / 2, badgeLogoW, theme.keyText);
    } else {
      const keyDisplay = targetKey.sub ? `${targetKey.label}  ${targetKey.sub}` : targetKey.label;
      g.fillText(`TOETS: ${keyDisplay}`, bx + 68, by + badgeH / 2 + 1);
    }

    g.fillStyle = mixHex(fingerColor, '#ffffff', 0.25);
    g.font = '600 18px "Outfit", sans-serif';
    g.textAlign = 'right';
    g.fillText(`${fingerInfo.name.toUpperCase()}  ·  ${layoutName}`, bx + badgeW - 28, by + badgeH / 2 + 1);
    g.restore();
  }

  // Pre-render static layers once so per-frame draw(t) only renders the active key + sticker
  const activeColor = opts.fingerColors[targetKey.finger] || '#3b82f6';
  let bgCache = null, boardCache = null, hudCache = null;

  function ensureCaches() {
    if (bgCache) return;
    const savedG = g;

    // 1. Background Cache (Studio / Black / White / Greenscreen / Custom Color / Image / Masked)
    bgCache = document.createElement('canvas');
    bgCache.width = W;
    bgCache.height = H;
    g = bgCache.getContext('2d');

    if (opts.bgMode === 'black') {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'white') {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'greenscreen') {
      g.fillStyle = opts.greenscreenColor || '#00ff00';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'custom') {
      g.fillStyle = opts.bgColor || '#0f172a';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'image') {
      g.fillStyle = opts.bgColor || '#0a0f1d';
      g.fillRect(0, 0, W, H);
      if (bgImage && drawCoverImage(g, bgImage, 0, 0, W, H)) {
        if (opts.bgImageDim > 0) {
          g.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
          g.fillRect(0, 0, W, H);
        }
      }
    } else if (opts.bgMode === 'masked') {
      g.fillStyle = opts.bgColor || '#000000';
      g.fillRect(0, 0, W, H);
      if (opts.maskMode === 'vignette') {
        const vigCanvas = document.createElement('canvas');
        vigCanvas.width = W;
        vigCanvas.height = H;
        const vg = vigCanvas.getContext('2d');
        if (bgImage && drawCoverImage(vg, bgImage, 0, 0, W, H)) {
          if (opts.bgImageDim > 0) {
            vg.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
            vg.fillRect(0, 0, W, H);
          }
        } else {
          const bgGrad = vg.createRadialGradient(W / 2, H * 0.5, 80, W / 2, H * 0.5, W * 0.55);
          bgGrad.addColorStop(0, mixHex(activeColor, theme.bg2, 0.55));
          bgGrad.addColorStop(1, theme.bg1);
          vg.fillStyle = bgGrad;
          vg.fillRect(0, 0, W, H);
        }
        // Apply feathered oval mask around the keyboard
        vg.globalCompositeOperation = 'destination-in';
        vg.save();
        vg.translate(W / 2, boardRect.y + boardRect.h / 2);
        vg.scale(1.62, 1.0);
        const maskGrad = vg.createRadialGradient(0, 0, 220, 0, 0, 560);
        maskGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
        maskGrad.addColorStop(0.68, 'rgba(0, 0, 0, 0.92)');
        maskGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        vg.fillStyle = maskGrad;
        vg.beginPath();
        vg.arc(0, 0, 580, 0, Math.PI * 2);
        vg.fill();
        vg.restore();
        g.drawImage(vigCanvas, 0, 0);
      }
    } else {
      // Default 'theme' Studio background + ambient finger glow
      const bgGrad = g.createRadialGradient(W / 2, H * 0.48, 80, W / 2, H * 0.5, W * 0.65);
      bgGrad.addColorStop(0, theme.bg2);
      bgGrad.addColorStop(1, theme.bg1);
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, W, H);
      const ambientGlow = g.createRadialGradient(targetKey.cx, targetKey.cy, 20, targetKey.cx, targetKey.cy, 560);
      ambientGlow.addColorStop(0, rgba(activeColor, 0.22));
      ambientGlow.addColorStop(1, rgba(activeColor, 0));
      g.fillStyle = ambientGlow;
      g.fillRect(0, 0, W, H);
    }

    // 2. Static Board Chassis + Non-Target Keys Cache
    boardCache = document.createElement('canvas');
    boardCache.width = W;
    boardCache.height = H;
    g = boardCache.getContext('2d');

    if (effectiveBoardMode !== 'hidden') {
      g.save();
      let plateFill = theme.boardBg;
      let plateBorder = theme.boardBorder;
      if (effectiveBoardMode === 'black') {
        plateFill = '#070a12';
        plateBorder = '#1e293b';
      } else if (effectiveBoardMode === 'white') {
        plateFill = '#f1f5f9';
        plateBorder = '#cbd5e1';
      } else if (effectiveBoardMode === 'custom') {
        plateFill = opts.boardColor || '#0d1324';
        plateBorder = mixHex(plateFill, '#ffffff', 0.22);
      }

      g.fillStyle = plateFill;
      g.strokeStyle = plateBorder;
      g.lineWidth = 3;
      if (!isChromaOrCutout) {
        g.shadowColor = theme.boardShadow;
        g.shadowBlur = 48;
        g.shadowOffsetY = 18;
      }
      g.beginPath();
      g.roundRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h, 28);
      g.fill();
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;

      if (effectiveBoardMode === 'image') {
        g.save();
        g.beginPath();
        g.roundRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h, 28);
        g.clip();
        if (bgImage && drawCoverImage(g, bgImage, boardRect.x, boardRect.y, boardRect.w, boardRect.h)) {
          if (opts.bgImageDim > 0) {
            g.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
            g.fillRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h);
          }
        } else {
          // Stylish masked gradient fallback when no image is uploaded yet
          const fallbackGrad = g.createLinearGradient(boardRect.x, boardRect.y, boardRect.x + boardRect.w, boardRect.y + boardRect.h);
          fallbackGrad.addColorStop(0, mixHex(activeColor, '#0f172a', 0.55));
          fallbackGrad.addColorStop(1, opts.boardColor || theme.boardBg);
          g.fillStyle = fallbackGrad;
          g.fillRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h);
        }
        g.restore();
      }

      g.beginPath();
      g.roundRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h, 28);
      g.stroke();
      g.restore();
    }

    for (const k of keys) {
      if (k.id === targetKey.id) continue;
      const sameLane = opts.showLaneGuide && k.finger === targetKey.finger;
      const laneGlow = sameLane ? 0.22 : 0;
      const topRect = drawKeycapBase(k, 0, laneGlow, activeColor);
      if (preSet.has(k.id)) {
        const kColor = opts.fingerColors[k.finger] || '#3b82f6';
        drawStickerSurface(k, topRect, kColor, { style: 'peel', progress: 1, blank: opts.blankSticker });
      }
    }

    // 3. Static HUD Badge Cache
    hudCache = document.createElement('canvas');
    hudCache.width = W;
    hudCache.height = H;
    g = hudCache.getContext('2d');
    drawTopBadge(0);

    g = savedG;
  }

  function draw(t) {
    ensureCaches();
    t = Math.max(0, Math.min(schedule.total, Number(t) || 0));
    g.save();
    g.scale(canvas.width / W, canvas.height / H);

    // 1. Blit pre-rendered studio background + ambient glow
    g.drawImage(bgCache, 0, 0);

    // 2. Camera transform (subtle smooth zoom toward active key during sticker application)
    g.save();
    if (opts.cameraZoom && targetKey) {
      let zoomP = 0;
      if (t >= schedule.focusStart && t < schedule.zoomOutStart) {
        zoomP = easeInOutCubic((t - schedule.focusStart) / (schedule.peelStart - schedule.focusStart + 0.25));
      } else if (t >= schedule.zoomOutStart) {
        const zoomEnd = schedule.animEnd ?? schedule.total;
        zoomP = 1 - easeInOutCubic((t - schedule.zoomOutStart) / Math.max(0.2, zoomEnd - schedule.zoomOutStart));
      }
      const zoom = lerp(1.0, 1.28, zoomP);
      const focusX = lerp(W / 2, clamp(targetKey.cx, W * 0.28, W * 0.72), zoomP * 0.65);
      const focusY = lerp(H / 2, clamp(targetKey.cy, H * 0.32, H * 0.68), zoomP * 0.65);
      g.translate(W / 2, H / 2);
      g.scale(zoom, zoom);
      g.translate(-focusX, -focusY);
    }

    // 3. Blit pre-rendered keyboard chassis + all non-target keys
    g.drawImage(boardCache, 0, 0);

    // 4. Target key animation state
    let highlightAlpha = opts.showLaneGuide ? 0.22 : 0;
    if (t >= schedule.focusStart && t < schedule.peelEnd) {
      const pulse = 0.75 + 0.25 * Math.sin((t - schedule.focusStart) * 10);
      highlightAlpha = Math.max(highlightAlpha, clamp01((t - schedule.focusStart) / 0.25) * pulse);
    } else if (t >= schedule.peelEnd) {
      highlightAlpha = 0.65;
    }

    // Physical key depression when sticker seals at pressPeak
    let pressY = 0;
    if (t >= schedule.peelEnd - 0.08 && t <= schedule.pressDone) {
      const dp = (t - (schedule.peelEnd - 0.08)) / (schedule.pressDone - (schedule.peelEnd - 0.08));
      pressY = Math.sin(clamp01(dp) * Math.PI) * 6.5;
    }

    const targetTopRect = drawKeycapBase(targetKey, pressY, highlightAlpha, activeColor);

    // Sticker progress (0 -> 1)
    let stickerProgress = 0;
    if (t >= schedule.peelStart) {
      stickerProgress = clamp01((t - schedule.peelStart) / Math.max(0.1, schedule.peelEnd - schedule.peelStart));
    }

    // Glossy shine sweep progress
    let shineProgress = -1;
    if (t >= schedule.shineStart && t <= schedule.shineEnd) {
      shineProgress = clamp01((t - schedule.shineStart) / Math.max(0.1, schedule.shineEnd - schedule.shineStart));
    }

    if (stickerProgress > 0) {
      drawStickerSurface(targetKey, targetTopRect, activeColor, {
        style: opts.stickerStyle,
        progress: stickerProgress,
        shineProgress,
        blank: opts.blankSticker,
      });
    }

    // Celebratory burst right as the sticker seals
    if (t >= schedule.peelEnd - 0.02 && t <= schedule.shineEnd) {
      const burstP = (t - (schedule.peelEnd - 0.02)) / 0.52;
      drawSealBurst(targetKey, activeColor, burstP);
    }

    g.restore(); // end camera zoom

    // 5. Blit pre-rendered HUD / Badge / Finger legend overlays
    g.drawImage(hudCache, 0, 0);

    g.restore();
  }

  return {
    schedule,
    soundtrack,
    targetKey,
    draw,
    reset() {},
    dispose() {},
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
