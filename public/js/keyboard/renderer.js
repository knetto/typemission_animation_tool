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
function traceKeyShape(ctx, x, y, w, h, r = 13.125, isoStepX = 0, isoStepY = 0) {
  ctx.beginPath();
  if (isoStepX <= 0 || isoStepY <= 0) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rOuter = Math.min(r, w * 0.25, h * 0.2, isoStepX * 0.5, isoStepY * 0.45);
  ctx.moveTo(x + rOuter, y);
  ctx.arcTo(x + w, y, x + w, y + h, rOuter);
  ctx.arcTo(x + w, y + h, x + isoStepX, y + h, rOuter);
  ctx.arcTo(x + isoStepX, y + h, x + isoStepX, y + isoStepY, rOuter);
  ctx.lineTo(x + isoStepX, y + isoStepY);
  ctx.arcTo(x, y + isoStepY, x, y, rOuter);
  ctx.arcTo(x, y, x + w, y, rOuter);
  ctx.closePath();
}

// Compute pixel rectangles for all keys in the 1920x1080 stage (1:1 scaled from 1024x576 reference by 1.875x)
export function computeKeyRects(layoutId) {
  const layout = getLayout(layoutId);
  const flatKeys = getFlatKeys(layoutId);
  const S = W / 1024; // 1.875
  const unitW = (160 / 3) * S; // 100px
  const keyH = (160 / 3) * S; // 100px
  const rowPitchY = 60 * S; // 112.5px
  const startX = 70 * S; // 131.25px
  const rowSpanW = 884 * S; // 1657.5px (right edge at 954 * S = 1788.75px)
  const startY = 130 * S; // 243.75px

  const rowXPositions = layout.rows.map((row, rIdx) => {
    const prevRowIso = rIdx > 0 ? layout.rows[rIdx - 1]?.find((k) => k.isoEnter) : null;
    const isoBottomW = prevRowIso ? (prevRowIso.wBottom || 1) * unitW : 0;
    const slotCount = row.length + (prevRowIso ? 1 : 0);
    const sumKeyW = row.reduce((acc, k) => acc + k.w * unitW, 0) + isoBottomW;
    const gap = slotCount > 1 ? (rowSpanW - sumKeyW) / (slotCount - 1) : 0;
    let curX = startX;
    return row.map((k) => {
      const x = curX;
      const w = k.w * unitW;
      curX += w + gap;
      return { x, w };
    });
  });

  return {
    boardRect: {
      x: 45 * S,
      y: 110 * S,
      w: 934 * S,
      h: 334 * S,
      borderWidth: 10 * S,
      outerRadius: 22 * S,
      centerRadius: 17 * S,
    },
    keys: flatKeys.map((k) => {
      const isIso = Boolean(k.isoEnter);
      const pos = rowXPositions[k.rowIndex]?.[k.colIndex] || { x: startX + k.unitX * unitW, w: k.w * unitW };
      const x = pos.x;
      const w = pos.w;
      const y = startY + k.rowIndex * rowPitchY;
      const h = isIso ? rowPitchY + keyH : keyH;
      const isoStepX = isIso ? (k.w - (k.wBottom || 1)) * unitW : 0;
      const isoStepY = isIso ? keyH : 0;
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

export function createKeyboardScene(
  canvas,
  targetKeyId,
  options = {},
  {
    preStickeredIds = [],
    bgImage = null,
    spriteMode = null,
    colorOverride = null,
    includeBurst = true,
    includePress = true,
  } = {}
) {
  const opts = normalizeKeyboardOpts(options);
  const theme = KEYBOARD_THEMES[opts.theme] || KEYBOARD_THEMES.dark;
  const schedule = keyboardSchedule(opts);
  const soundtrack = keyboardSoundtrack(schedule, opts);
  const { boardRect, keys } = computeKeyRects(opts.layout);
  const targetKey = keys.find((k) => k.id === targetKeyId) || keys.find((k) => k.id === opts.previewKey) || keys[16];
  const preSet = new Set(preStickeredIds.filter((id) => id !== targetKey?.id));
  let g = canvas.getContext('2d');

  const isChromaOrCutout =
    opts.bgMode === 'transparent' ||
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

  function isKeyLaneColored(k) {
    const isModifier = k.kind === 'special' && k.id !== 'space';
    if (k.id === targetKey?.id) {
      return Boolean(opts.showLaneGuide || theme.allLanesColored);
    }
    if (isModifier) return false;
    if (theme.allLanesColored) return true;
    return Boolean(opts.showLaneGuide && k.finger === targetKey?.finger);
  }

  function drawKeyTypography(k, rx, ry, rw, rh, stepX = 0, stepY = 0, textColor = '#ffffff') {
    const displayLabel = k.canvasLabel !== undefined ? k.canvasLabel : (k.blankKey ? '' : k.label);
    if (!displayLabel && !k.spyIcon) return;

    const textCenterX = rx + rw / 2;
    const textCenterY = stepY > 0 ? ry + stepY / 2 : ry + rh / 2;

    if (k.spyIcon) {
      const logoW = Math.min(rw * 0.42, (rh * 0.50) / KEY_LOGO_ASPECT);
      const logoH = logoW * KEY_LOGO_ASPECT;
      drawLogo(g, textCenterX - logoW / 2, textCenterY - logoH / 2, logoW, textColor, logoH);
      return;
    }

    const isWord = displayLabel.length > 2;
    const fontSize = isWord ? 31 : 52;
    g.fillStyle = textColor;
    g.font = `400 ${fontSize}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(displayLabel, textCenterX, textCenterY + fontSize * 0.34);
  }

  function drawKeycapBase(k, pressY = 0, highlightAlpha = 0, fingerColor = '#456d74', { laneColored = false } = {}) {
    const x = k.x;
    const y = k.y + pressY;
    const w = k.w;
    const h = k.h;
    const stepX = k.isoStepX || 0;
    const stepY = k.isoStepY || 0;
    const keyRadius = 13.125;
    const isModifier = k.kind === 'special' && k.id !== 'space';
    const baseKeyColor = isModifier ? (theme.keySpecial || '#363636') : (theme.keyTop || '#353535');

    g.save();

    let fillColor = laneColored ? fingerColor : baseKeyColor;
    if (highlightAlpha > 0) {
      fillColor = laneColored
        ? mixHex(fingerColor, '#ffffff', highlightAlpha * 0.12)
        : mixHex(baseKeyColor, fingerColor, clamp01(highlightAlpha * 0.38));
    }

    g.fillStyle = fillColor;
    traceKeyShape(g, x, y, w, h, keyRadius, stepX, stepY);
    g.fill();

    // If image is masked across the keycaps themselves ('keys' mask mode)
    if (maskImageOnKeys && bgImage) {
      g.save();
      traceKeyShape(g, x, y, w, h, keyRadius, stepX, stepY);
      g.clip();
      drawCoverImage(g, bgImage, boardRect.x, boardRect.y - pressY, boardRect.w, boardRect.h);
      if (opts.bgImageDim > 0) {
        g.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
        g.fillRect(x, y, w, h);
      }
      g.restore();
    }

    // Single centered white key label (1-on-1 with reference image)
    drawKeyTypography(k, x, y, w, h, stepX, stepY, theme.keyText || '#ffffff');

    g.restore();
    return { topX: x, topY: y, topW: w, topH: h, topStepX: stepX, topStepY: stepY };
  }

  // Draw a finished or partial sticker on top of a keycap
  function drawStickerSurface(k, topRect, color, {
    style = 'peel',
    progress = 1,
    shineProgress = -1,
    blank = true,
  } = {}) {
    if (progress <= 0) return;
    const { topX: sx, topY: sy, topW: sw, topH: sh, topStepX: sStepX = 0, topStepY: sStepY = 0 } = topRect;
    const radius = 13.125;

    // Subtle vinyl sheen stays on stickered keys when stickerShine is enabled
    const useShine = opts.stickerShine !== false;
    const sheen = useShine
      ? (progress < 1 ? 1 : (shineProgress >= 0 && shineProgress < 1 ? lerp(1, 0.75, easeInOutCubic(shineProgress)) : 0.75))
      : 0;

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

    // Main sticker body (no border/outline around the key)
    if (sheen > 0.01) {
      const grad = g.createLinearGradient(sx, sy, sx + sw * 0.45, sy + sh);
      grad.addColorStop(0, mixHex(color, '#ffffff', 0.11 * sheen));
      grad.addColorStop(0.48, color);
      grad.addColorStop(1, mixHex(color, '#000000', 0.08 * sheen));
      g.fillStyle = grad;
    } else {
      g.fillStyle = color;
    }
    traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
    g.fill();
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;

    // Subtle soft reflection across the top-left of the sticker
    if (sheen > 0.01) {
      g.save();
      traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
      g.clip();
      const glossGrad = g.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh * 0.6);
      glossGrad.addColorStop(0, `rgba(255, 255, 255, ${(0.12 * sheen).toFixed(3)})`);
      glossGrad.addColorStop(0.35, `rgba(255, 255, 255, ${(0.035 * sheen).toFixed(3)})`);
      glossGrad.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
      g.fillStyle = glossGrad;
      g.fillRect(sx, sy, sw, sh);
      g.restore();
    }

    // Optional label on sticker (off by default: blind typing uses blank colored stickers!)
    if (!blank) {
      drawKeyTypography(k, sx, sy, sw, sh, sStepX, sStepY, '#ffffff');
    }

    // Diagonal glossy shine sweep after the sticker seals
    if (useShine && shineProgress > 0 && shineProgress < 1) {
      g.save();
      traceKeyShape(g, sx, sy, sw, sh, radius, sStepX, sStepY);
      g.clip();
      const bandW = Math.max(36, sw * 0.22);
      const skew = sh * 0.45;
      const sweepX = lerp(sx - bandW - skew, sx + sw + bandW + skew, easeInOutCubic(shineProgress));
      const shineGrad = g.createLinearGradient(sweepX - bandW, sy, sweepX + bandW, sy + sh * 0.4);
      shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.38)');
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
  function drawSealBurst(k, color, burstP, pressY = 0) {
    if (burstP <= 0 || burstP >= 1) return;
    const p = easeOutCubic(burstP);
    const alpha = Math.pow(1 - burstP, 1.5);
    g.save();

    // Expanding shockwave ring around keycap
    const expand = p * 34;
    g.strokeStyle = rgba(color, alpha * 0.75);
    g.lineWidth = lerp(4, 1, p);
    g.beginPath();
    g.roundRect(k.x - expand, k.y + pressY - expand, k.w + expand * 2, k.h + expand * 2, 14 + expand * 0.5);
    g.stroke();

    // 12 radial sparkle particles hugging the key's width & height
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + 0.25;
      const rx = k.w * 0.5 + lerp(4, 34, p);
      const ry = k.h * 0.5 + lerp(4, 34, p);
      const px = k.x + k.w / 2 + Math.cos(angle) * rx;
      const py = k.y + k.h / 2 + pressY + Math.sin(angle) * ry;
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
  const activeColor = colorOverride || opts.fingerColors[targetKey.finger] || '#456d74';
  // Keep the entire entrance and its shadow inside the cell, including a
  // rotated, enlarged spacebar. Padding must grow with the key for pop.
  const spritePadX = opts.stickerStyle === 'pop'
    ? Math.max(78, Math.ceil((1.65 * (targetKey.w + targetKey.h * Math.sin(0.18)) - targetKey.w) / 2 + 64))
    : 78;
  const spritePadY = opts.stickerStyle === 'pop'
    ? Math.max(78, Math.ceil((1.65 * (targetKey.h + targetKey.w * Math.sin(0.18)) - targetKey.h) / 2 + 56 + 86))
    : opts.stickerStyle === 'slide' ? 130 : 78;
  const spriteBox = {
    pad: Math.max(spritePadX, spritePadY),
    keyW: targetKey.w,
    keyH: targetKey.h,
    // A fixed anchor at the middle of the entire key's bounds, including ISO
    // Enter. Its typography/finger anchor (cx) is offset into its lower leg.
    centerX: targetKey.x + targetKey.w / 2,
    centerY: targetKey.y + targetKey.h / 2,
    logicalW: Math.ceil(targetKey.w + spritePadX * 2),
    logicalH: Math.ceil(targetKey.h + spritePadY * 2),
  };
  let bgCache = null, boardCache = null, hudCache = null;

  function ensureCaches() {
    if (bgCache || spriteMode === 'sticker_only' || spriteMode === 'key_and_sticker') return;
    const savedG = g;

    // 1. Background Cache (Studio / Transparent / Black / White / Greenscreen / Custom Color / Image / Masked)
    bgCache = document.createElement('canvas');
    bgCache.width = W;
    bgCache.height = H;
    g = bgCache.getContext('2d');

    if (opts.bgMode === 'transparent') {
      g.clearRect(0, 0, W, H);
    } else if (opts.bgMode === 'black') {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'white') {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'greenscreen') {
      g.fillStyle = opts.greenscreenColor || '#00ff00';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'custom') {
      g.fillStyle = opts.bgColor || '#484848';
      g.fillRect(0, 0, W, H);
    } else if (opts.bgMode === 'image') {
      g.fillStyle = opts.bgColor || '#484848';
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
          vg.fillStyle = theme.bg1 || '#484848';
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
    } else if (theme.bg1 === theme.bg2) {
      // Exact 1-on-1 flat background matching the reference screenshot (#484848)
      g.fillStyle = theme.bg1;
      g.fillRect(0, 0, W, H);
    } else {
      // Gradient studio themes ('light', 'cyber')
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
        plateFill = opts.boardColor || '#484848';
        plateBorder = mixHex(plateFill, '#000000', 0.18);
      }

      const outerR = boardRect.outerRadius || 41.25;
      const bw = boardRect.borderWidth || 18.75;

      g.fillStyle = plateFill;
      if (!isChromaOrCutout && theme.boardShadow && theme.boardShadow !== 'rgba(0, 0, 0, 0)') {
        g.shadowColor = theme.boardShadow;
        g.shadowBlur = 48;
        g.shadowOffsetY = 18;
      }
      g.beginPath();
      g.roundRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h, outerR);
      g.fill();
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;

      if (effectiveBoardMode === 'image') {
        g.save();
        g.beginPath();
        g.roundRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h, outerR);
        g.clip();
        if (bgImage && drawCoverImage(g, bgImage, boardRect.x, boardRect.y, boardRect.w, boardRect.h)) {
          if (opts.bgImageDim > 0) {
            g.fillStyle = `rgba(0, 0, 0, ${opts.bgImageDim})`;
            g.fillRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h);
          }
        } else {
          const fallbackGrad = g.createLinearGradient(boardRect.x, boardRect.y, boardRect.x + boardRect.w, boardRect.y + boardRect.h);
          fallbackGrad.addColorStop(0, mixHex(activeColor, '#353535', 0.55));
          fallbackGrad.addColorStop(1, opts.boardColor || theme.boardBg);
          g.fillStyle = fallbackGrad;
          g.fillRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h);
        }
        g.restore();
      }

      // Thick rounded frame border inset inside boardRect (10px at 1024x576 -> 18.75px at 1920x1080)
      g.strokeStyle = plateBorder;
      g.lineWidth = bw;
      g.beginPath();
      g.roundRect(
        boardRect.x + bw / 2,
        boardRect.y + bw / 2,
        boardRect.w - bw,
        boardRect.h - bw,
        Math.max(4, outerR - bw / 2)
      );
      g.stroke();
      g.restore();
    }

    for (const k of keys) {
      if (k.id === targetKey.id) continue;
      const kColor = opts.fingerColors[k.finger] || '#456d74';
      const topRect = drawKeycapBase(k, 0, 0, kColor, { laneColored: isKeyLaneColored(k) });
      if (preSet.has(k.id)) {
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
    g.clearRect(0, 0, canvas.width, canvas.height);

    // Target key animation state
    let highlightAlpha = 0;
    if (t >= schedule.focusStart && t < schedule.peelEnd) {
      const pulse = 0.75 + 0.25 * Math.sin((t - schedule.focusStart) * 10);
      highlightAlpha = clamp01((t - schedule.focusStart) / 0.25) * pulse;
    } else if (t >= schedule.peelEnd && t < schedule.shineEnd) {
      highlightAlpha = (1 - clamp01((t - schedule.peelEnd) / Math.max(0.1, schedule.shineEnd - schedule.peelEnd))) * 0.5;
    }

    // Physical key depression when sticker seals at pressPeak
    let pressY = 0;
    if (includePress && t >= schedule.peelEnd - 0.08 && t <= schedule.pressDone) {
      const dp = (t - (schedule.peelEnd - 0.08)) / (schedule.pressDone - (schedule.peelEnd - 0.08));
      pressY = Math.sin(clamp01(dp) * Math.PI) * 6.5;
    }

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

    // Isolated transparent Unity Sprite mode ('sticker_only' or 'key_and_sticker')
    if (spriteMode === 'sticker_only' || spriteMode === 'key_and_sticker') {
      const uniformScale = Math.min(canvas.width / spriteBox.logicalW, canvas.height / spriteBox.logicalH);
      g.save();
      g.translate(canvas.width / 2, canvas.height / 2);
      g.scale(uniformScale, uniformScale);
      g.translate(-spriteBox.centerX, -spriteBox.centerY);

      const targetTopRect =
        spriteMode === 'key_and_sticker'
          ? drawKeycapBase(targetKey, pressY, highlightAlpha, activeColor, {
              laneColored: isKeyLaneColored(targetKey),
            })
          : {
              topX: targetKey.x,
              topY: targetKey.y + pressY,
              topW: targetKey.w,
              topH: targetKey.h,
              topStepX: targetKey.isoStepX || 0,
              topStepY: targetKey.isoStepY || 0,
            };

      if (stickerProgress > 0) {
        drawStickerSurface(targetKey, targetTopRect, activeColor, {
          style: opts.stickerStyle,
          progress: stickerProgress,
          shineProgress,
          blank: opts.blankSticker,
        });
      }

      if (includeBurst && t >= schedule.peelEnd - 0.02 && t <= schedule.shineEnd) {
        const burstP = (t - (schedule.peelEnd - 0.02)) / 0.52;
        drawSealBurst(targetKey, activeColor, burstP, pressY);
      }

      g.restore();
      return;
    }

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

    // 4. Draw target key + sticker + seal burst
    const targetTopRect = drawKeycapBase(targetKey, pressY, highlightAlpha, activeColor, {
      laneColored: isKeyLaneColored(targetKey),
    });

    if (stickerProgress > 0) {
      drawStickerSurface(targetKey, targetTopRect, activeColor, {
        style: opts.stickerStyle,
        progress: stickerProgress,
        shineProgress,
        blank: opts.blankSticker,
      });
    }

    // Celebratory burst right as the sticker seals
    if (includeBurst && t >= schedule.peelEnd - 0.02 && t <= schedule.shineEnd) {
      const burstP = (t - (schedule.peelEnd - 0.02)) / 0.52;
      drawSealBurst(targetKey, activeColor, burstP, pressY);
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
    spriteBox,
    draw,
    reset() { },
    dispose() { },
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
