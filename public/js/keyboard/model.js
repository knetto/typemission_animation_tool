// Keyboard Sticker Animation model: QWERTY, AZERTY & QWERTZ (German) layouts,
// 5 finger-lane colors (pinky, ring, middle, index, thumb), deterministic schedule & satisfying sound synthesis.

export const FINGERS = [
  { id: 'pinky', name: 'Pink', shortName: 'Pink', desc: 'Linker & rechter pink', defaultColor: '#f43f5e' },
  { id: 'ring', name: 'Ringvinger', shortName: 'Ringvinger', desc: 'Linker & rechter ringvinger', defaultColor: '#f59e0b' },
  { id: 'middle', name: 'Middelvinger', shortName: 'Middelvinger', desc: 'Linker & rechter middelvinger', defaultColor: '#10b981' },
  { id: 'index', name: 'Wijsvinger Links', shortName: 'Wijsvinger L', desc: 'Linker wijsvinger', defaultColor: '#3b82f6' },
  { id: 'index_right', name: 'Wijsvinger Rechts', shortName: 'Wijsvinger R', desc: 'Rechter wijsvinger', defaultColor: '#1d4ed8' },
  { id: 'thumb', name: 'Duim', shortName: 'Duim', desc: 'Spatiebalk & duimtoetsen', defaultColor: '#8b5cf6' },
];

export const DEFAULT_FINGER_COLORS = Object.fromEntries(FINGERS.map((f) => [f.id, f.defaultColor]));

export const COLOR_PALETTES = {
  vibrant: { name: 'Spy Neon (Standaard)', colors: { pinky: '#f43f5e', ring: '#f59e0b', middle: '#10b981', index: '#3b82f6', index_right: '#1d4ed8', thumb: '#8b5cf6' } },
  classic: { name: 'Typcursus Klassiek', colors: { pinky: '#ef4444', ring: '#f97316', middle: '#eab308', index: '#22c55e', index_right: '#15803d', thumb: '#06b6d4' } },
  pastel: { name: 'Soft Pastel', colors: { pinky: '#fb7185', ring: '#fdba74', middle: '#6ee7b7', index: '#93c5fd', index_right: '#3b82f6', thumb: '#c4b5fd' } },
  cyber: { name: 'Cyber Agent', colors: { pinky: '#ec4899', ring: '#a855f7', middle: '#06b6d4', index: '#3b82f6', index_right: '#1d4ed8', thumb: '#10b981' } },
};

export const KEYBOARD_THEMES = {
  dark: {
    name: 'Studio Donker',
    bg1: '#0a0f1d',
    bg2: '#141e38',
    boardBg: '#0d1324',
    boardBorder: '#2a395c',
    boardShadow: 'rgba(0, 0, 0, 0.78)',
    keySide: '#151f38',
    keyTop: '#1e2b4a',
    keyBorder: '#334774',
    keyText: '#eef4ff',
    keySub: '#7f95c2',
    accent: '#4f8cff',
  },
  spy: {
    name: 'Spy Terminal',
    bg1: '#031229',
    bg2: '#093066',
    boardBg: '#061a3a',
    boardBorder: '#2f76c9',
    boardShadow: 'rgba(0, 8, 24, 0.85)',
    keySide: '#08234d',
    keyTop: '#0d3169',
    keyBorder: '#3b8fe0',
    keyText: '#dbf0ff',
    keySub: '#75b4f0',
    accent: '#4aa3ff',
  },
  light: {
    name: 'Klassiek Licht',
    bg1: '#1a233a',
    bg2: '#293757',
    boardBg: '#d8e0ee',
    boardBorder: '#9aaac4',
    boardShadow: 'rgba(5, 10, 24, 0.65)',
    keySide: '#b8c4d9',
    keyTop: '#f5f8ff',
    keyBorder: '#c5d1e6',
    keyText: '#1b263b',
    keySub: '#64748b',
    accent: '#3b82f6',
  },
};

export const STICKER_STYLES = {
  peel: { name: 'Peel & Press', desc: 'Sticker rolt met glans over de toets en drukt in' },
  pop: { name: 'Pop & Bounce', desc: 'Sticker zweeft aan en plopt bouncy op de toets' },
  slide: { name: 'Lane Slide', desc: 'Sticker glijdt vanuit de vingerbaan op de toets' },
};

export const BACKGROUND_MODES = {
  theme: { name: 'Studio Gloed', desc: 'Standaard achtergrond met vingerkleur-gloed' },
  black: { name: 'Zwart', desc: 'Puur zwart (#000000)' },
  white: { name: 'Wit', desc: 'Puur wit (#FFFFFF)' },
  greenscreen: { name: 'Greenscreen', desc: 'Chroma-key groen (#00FF00) zonder schaduw-waas' },
  custom: { name: 'Eigen kleur', desc: 'Kies zelf een achtergrondkleur' },
  image: { name: 'Afbeelding', desc: 'Eigen geüploade achtergrondafbeelding' },
  masked: { name: 'Gemaskerd (Mask)', desc: 'Afbeelding of toetsenbord uitgesneden via een masker' },
};

export const BOARD_MODES = {
  theme: { name: 'Standaard plaat', desc: 'Kleur van het gekozen toetsenbord-thema' },
  black: { name: 'Zwart', desc: 'Zwarte toetsenbord-plaat (#080b12)' },
  white: { name: 'Wit', desc: 'Witte toetsenbord-plaat (#f1f5f9)' },
  custom: { name: 'Eigen kleur', desc: 'Kies zelf een kleur voor de toetsenbord-plaat' },
  image: { name: 'Afbeelding in plaat', desc: 'Maskeer de achtergrondafbeelding in de toetsenbord-plaat' },
  hidden: { name: 'Geen plaat (Alleen toetsen)', desc: 'Verberg de toetsenbord-plaat (zwevende toetsen)' },
};

export const MASK_MODES = {
  board: { name: 'In toetsenbord-plaat', desc: 'Afbeelding gemaskerd binnen het afgeronde toetsenbord-frame' },
  keys: { name: 'In de toetsen zelf', desc: 'Afbeelding gemaskerd over de bovenkant van alle toetsen' },
  vignette: { name: 'Zacht ovaal vignet', desc: 'Afbeelding in een zacht ovaal masker achter het toetsenbord' },
  cutout: { name: 'Strakke uitsnede', desc: 'Buitenkant strak uitgesneden zonder schaduw-randen' },
};

// Helper to create a key definition (splits index finger into left 'index' and right 'index_right')
const k = (id, label, { sub = '', w = 1, finger = 'pinky', hand = 'left', kind = 'letter', homing = false } = {}) => ({
  id,
  label,
  sub,
  w,
  finger: finger === 'index' && hand === 'right' ? 'index_right' : finger,
  hand,
  kind,
  homing,
});

export const KEYBOARD_LAYOUTS = {
  qwerty: {
    id: 'qwerty',
    name: 'QWERTY (NL)',
    subtitle: 'Standaard (NL / Internationaal)',
    rows: [
      [
        k('grave', '`', { sub: '~', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('1', '1', { sub: '!', finger: 'pinky', hand: 'left', kind: 'number' }),
        k('2', '2', { sub: '@', finger: 'ring', hand: 'left', kind: 'number' }),
        k('3', '3', { sub: '#', finger: 'middle', hand: 'left', kind: 'number' }),
        k('4', '4', { sub: '$', finger: 'index', hand: 'left', kind: 'number' }),
        k('5', '5', { sub: '%', finger: 'index', hand: 'left', kind: 'number' }),
        k('6', '6', { sub: '^', finger: 'index', hand: 'right', kind: 'number' }),
        k('7', '7', { sub: '&', finger: 'index', hand: 'right', kind: 'number' }),
        k('8', '8', { sub: '*', finger: 'middle', hand: 'right', kind: 'number' }),
        k('9', '9', { sub: '(', finger: 'ring', hand: 'right', kind: 'number' }),
        k('0', '0', { sub: ')', finger: 'pinky', hand: 'right', kind: 'number' }),
        k('minus', '-', { sub: '_', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('equal', '=', { sub: '+', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backspace', '⌫', { w: 2, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('tab', 'Tab', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('q', 'Q', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('w', 'W', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('e', 'E', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('r', 'R', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('t', 'T', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('y', 'Y', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('u', 'U', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('i', 'I', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('o', 'O', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('p', 'P', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('lbracket', '[', { sub: '{', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rbracket', ']', { sub: '}', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backslash', '\\', { sub: '|', w: 1.5, finger: 'pinky', hand: 'right', kind: 'symbol' }),
      ],
      [
        k('caps', 'Caps', { w: 1.75, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('a', 'A', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('s', 'S', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('d', 'D', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('f', 'F', { finger: 'index', hand: 'left', kind: 'letter', homing: true }),
        k('g', 'G', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('h', 'H', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('j', 'J', { finger: 'index', hand: 'right', kind: 'letter', homing: true }),
        k('k', 'K', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('l', 'L', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('semicolon', ';', { sub: ':', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('quote', "'", { sub: '"', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('enter', 'Enter ↵', { w: 2.25, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lshift', 'Shift ⇧', { w: 2.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('z', 'Z', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('x', 'X', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('c', 'C', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('v', 'V', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('b', 'B', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('n', 'N', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('m', 'M', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('comma', ',', { sub: '<', finger: 'middle', hand: 'right', kind: 'symbol' }),
        k('period', '.', { sub: '>', finger: 'ring', hand: 'right', kind: 'symbol' }),
        k('slash', '/', { sub: '?', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rshift', 'Shift ⇧', { w: 2.75, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('win', '❖', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('lalt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'left', kind: 'special' }),
        k('space', 'Spatie', { w: 6.5, finger: 'thumb', hand: 'both', kind: 'special' }),
        k('ralt', 'AltGr', { w: 1.5, finger: 'thumb', hand: 'right', kind: 'special' }),
        k('fn', 'Fn', { w: 1.25, finger: 'pinky', hand: 'right', kind: 'special' }),
        k('rctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
    ],
  },

  qwerty_us: {
    id: 'qwerty_us',
    name: 'QWERTY (US)',
    subtitle: 'Amerikaans toetsenbord (ANSI)',
    rows: [
      [
        k('grave', '`', { sub: '~', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('1', '1', { sub: '!', finger: 'pinky', hand: 'left', kind: 'number' }),
        k('2', '2', { sub: '@', finger: 'ring', hand: 'left', kind: 'number' }),
        k('3', '3', { sub: '#', finger: 'middle', hand: 'left', kind: 'number' }),
        k('4', '4', { sub: '$', finger: 'index', hand: 'left', kind: 'number' }),
        k('5', '5', { sub: '%', finger: 'index', hand: 'left', kind: 'number' }),
        k('6', '6', { sub: '^', finger: 'index', hand: 'right', kind: 'number' }),
        k('7', '7', { sub: '&', finger: 'index', hand: 'right', kind: 'number' }),
        k('8', '8', { sub: '*', finger: 'middle', hand: 'right', kind: 'number' }),
        k('9', '9', { sub: '(', finger: 'ring', hand: 'right', kind: 'number' }),
        k('0', '0', { sub: ')', finger: 'pinky', hand: 'right', kind: 'number' }),
        k('minus', '-', { sub: '_', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('equal', '=', { sub: '+', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backspace', '⌫', { w: 2, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('tab', 'Tab', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('q', 'Q', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('w', 'W', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('e', 'E', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('r', 'R', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('t', 'T', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('y', 'Y', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('u', 'U', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('i', 'I', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('o', 'O', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('p', 'P', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('lbracket', '[', { sub: '{', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rbracket', ']', { sub: '}', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backslash', '\\', { sub: '|', w: 1.5, finger: 'pinky', hand: 'right', kind: 'symbol' }),
      ],
      [
        k('caps', 'Caps', { w: 1.75, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('a', 'A', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('s', 'S', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('d', 'D', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('f', 'F', { finger: 'index', hand: 'left', kind: 'letter', homing: true }),
        k('g', 'G', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('h', 'H', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('j', 'J', { finger: 'index', hand: 'right', kind: 'letter', homing: true }),
        k('k', 'K', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('l', 'L', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('semicolon', ';', { sub: ':', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('quote', "'", { sub: '"', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('enter', 'Enter ↵', { w: 2.25, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lshift', 'Shift ⇧', { w: 2.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('z', 'Z', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('x', 'X', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('c', 'C', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('v', 'V', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('b', 'B', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('n', 'N', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('m', 'M', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('comma', ',', { sub: '<', finger: 'middle', hand: 'right', kind: 'symbol' }),
        k('period', '.', { sub: '>', finger: 'ring', hand: 'right', kind: 'symbol' }),
        k('slash', '/', { sub: '?', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rshift', 'Shift ⇧', { w: 2.75, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('win', '❖', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('lalt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'left', kind: 'special' }),
        k('space', 'Space', { w: 6.5, finger: 'thumb', hand: 'both', kind: 'special' }),
        k('ralt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'right', kind: 'special' }),
        k('fn', 'Fn', { w: 1.25, finger: 'pinky', hand: 'right', kind: 'special' }),
        k('rctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
    ],
  },

  qwerty_uk: {
    id: 'qwerty_uk',
    name: 'QWERTY (UK)',
    subtitle: 'Brits toetsenbord (ISO — incl. £, ¬, @, #)',
    rows: [
      [
        k('grave', '`', { sub: '¬', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('1', '1', { sub: '!', finger: 'pinky', hand: 'left', kind: 'number' }),
        k('2', '2', { sub: '"', finger: 'ring', hand: 'left', kind: 'number' }),
        k('3', '3', { sub: '£', finger: 'middle', hand: 'left', kind: 'number' }),
        k('4', '4', { sub: '$', finger: 'index', hand: 'left', kind: 'number' }),
        k('5', '5', { sub: '%', finger: 'index', hand: 'left', kind: 'number' }),
        k('6', '6', { sub: '^', finger: 'index', hand: 'right', kind: 'number' }),
        k('7', '7', { sub: '&', finger: 'index', hand: 'right', kind: 'number' }),
        k('8', '8', { sub: '*', finger: 'middle', hand: 'right', kind: 'number' }),
        k('9', '9', { sub: '(', finger: 'ring', hand: 'right', kind: 'number' }),
        k('0', '0', { sub: ')', finger: 'pinky', hand: 'right', kind: 'number' }),
        k('minus', '-', { sub: '_', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('equal', '=', { sub: '+', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backspace', '⌫', { w: 2, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('tab', 'Tab', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('q', 'Q', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('w', 'W', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('e', 'E', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('r', 'R', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('t', 'T', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('y', 'Y', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('u', 'U', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('i', 'I', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('o', 'O', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('p', 'P', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('lbracket', '[', { sub: '{', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rbracket', ']', { sub: '}', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('hash', '#', { sub: '~', w: 1.5, finger: 'pinky', hand: 'right', kind: 'symbol' }),
      ],
      [
        k('caps', 'Caps', { w: 1.75, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('a', 'A', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('s', 'S', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('d', 'D', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('f', 'F', { finger: 'index', hand: 'left', kind: 'letter', homing: true }),
        k('g', 'G', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('h', 'H', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('j', 'J', { finger: 'index', hand: 'right', kind: 'letter', homing: true }),
        k('k', 'K', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('l', 'L', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('semicolon', ';', { sub: ':', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('quote', "'", { sub: '@', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('enter', 'Enter ↵', { w: 2.25, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lshift', 'Shift ⇧', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('backslash', '\\', { sub: '|', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('z', 'Z', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('x', 'X', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('c', 'C', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('v', 'V', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('b', 'B', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('n', 'N', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('m', 'M', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('comma', ',', { sub: '<', finger: 'middle', hand: 'right', kind: 'symbol' }),
        k('period', '.', { sub: '>', finger: 'ring', hand: 'right', kind: 'symbol' }),
        k('slash', '/', { sub: '?', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rshift', 'Shift ⇧', { w: 2.75, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('win', '❖', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('lalt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'left', kind: 'special' }),
        k('space', 'Space', { w: 6.5, finger: 'thumb', hand: 'both', kind: 'special' }),
        k('ralt', 'AltGr', { w: 1.5, finger: 'thumb', hand: 'right', kind: 'special' }),
        k('fn', 'Fn', { w: 1.25, finger: 'pinky', hand: 'right', kind: 'special' }),
        k('rctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
    ],
  },

  azerty: {
    id: 'azerty',
    name: 'AZERTY',
    subtitle: 'België / Frankrijk',
    rows: [
      [
        k('sq', '²', { sub: '³', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('1', '&', { sub: '1', finger: 'pinky', hand: 'left', kind: 'number' }),
        k('2', 'é', { sub: '2', finger: 'ring', hand: 'left', kind: 'number' }),
        k('3', '"', { sub: '3', finger: 'middle', hand: 'left', kind: 'number' }),
        k('4', "'", { sub: '4', finger: 'index', hand: 'left', kind: 'number' }),
        k('5', '(', { sub: '5', finger: 'index', hand: 'left', kind: 'number' }),
        k('6', '§', { sub: '6', finger: 'index', hand: 'right', kind: 'number' }),
        k('7', 'è', { sub: '7', finger: 'index', hand: 'right', kind: 'number' }),
        k('8', '!', { sub: '8', finger: 'middle', hand: 'right', kind: 'number' }),
        k('9', 'ç', { sub: '9', finger: 'ring', hand: 'right', kind: 'number' }),
        k('0', 'à', { sub: '0', finger: 'pinky', hand: 'right', kind: 'number' }),
        k('rparen', ')', { sub: '°', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('minus', '-', { sub: '_', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backspace', '⌫', { w: 2, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('tab', 'Tab', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('a', 'A', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('z', 'Z', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('e', 'E', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('r', 'R', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('t', 'T', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('y', 'Y', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('u', 'U', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('i', 'I', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('o', 'O', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('p', 'P', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('circumflex', '^', { sub: '¨', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('dollar', '$', { sub: '*', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('mu', 'µ', { sub: '£', w: 1.5, finger: 'pinky', hand: 'right', kind: 'symbol' }),
      ],
      [
        k('caps', 'Caps', { w: 1.75, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('q', 'Q', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('s', 'S', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('d', 'D', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('f', 'F', { finger: 'index', hand: 'left', kind: 'letter', homing: true }),
        k('g', 'G', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('h', 'H', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('j', 'J', { finger: 'index', hand: 'right', kind: 'letter', homing: true }),
        k('k', 'K', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('l', 'L', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('m', 'M', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('ugrave', 'ù', { sub: '%', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('enter', 'Enter ↵', { w: 2.25, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lshift', 'Shift ⇧', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('angle', '<', { sub: '>', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('w', 'W', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('x', 'X', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('c', 'C', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('v', 'V', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('b', 'B', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('n', 'N', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('comma', ',', { sub: '?', finger: 'index', hand: 'right', kind: 'symbol' }),
        k('semicolon', ';', { sub: '.', finger: 'middle', hand: 'right', kind: 'symbol' }),
        k('colon', ':', { sub: '/', finger: 'ring', hand: 'right', kind: 'symbol' }),
        k('equal', '=', { sub: '+', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rshift', 'Shift ⇧', { w: 2.75, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('win', '❖', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('lalt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'left', kind: 'special' }),
        k('space', 'Spatie', { w: 6.5, finger: 'thumb', hand: 'both', kind: 'special' }),
        k('ralt', 'AltGr', { w: 1.5, finger: 'thumb', hand: 'right', kind: 'special' }),
        k('fn', 'Fn', { w: 1.25, finger: 'pinky', hand: 'right', kind: 'special' }),
        k('rctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
    ],
  },

  qwertz: {
    id: 'qwertz',
    name: 'QWERTZ (Duits)',
    subtitle: 'Duits toetsenbord (incl. Ä, Ö, Ü, ß)',
    rows: [
      [
        k('caret', '^', { sub: '°', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('1', '1', { sub: '!', finger: 'pinky', hand: 'left', kind: 'number' }),
        k('2', '2', { sub: '"', finger: 'ring', hand: 'left', kind: 'number' }),
        k('3', '3', { sub: '§', finger: 'middle', hand: 'left', kind: 'number' }),
        k('4', '4', { sub: '$', finger: 'index', hand: 'left', kind: 'number' }),
        k('5', '5', { sub: '%', finger: 'index', hand: 'left', kind: 'number' }),
        k('6', '6', { sub: '&', finger: 'index', hand: 'right', kind: 'number' }),
        k('7', '7', { sub: '/', finger: 'index', hand: 'right', kind: 'number' }),
        k('8', '8', { sub: '(', finger: 'middle', hand: 'right', kind: 'number' }),
        k('9', '9', { sub: ')', finger: 'ring', hand: 'right', kind: 'number' }),
        k('0', '0', { sub: '=', finger: 'pinky', hand: 'right', kind: 'number' }),
        k('eszett', 'ß', { sub: '?', finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('acute', '´', { sub: '`', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('backspace', '⌫', { w: 2, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('tab', 'Tab', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('q', 'Q', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('w', 'W', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('e', 'E', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('r', 'R', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('t', 'T', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('z', 'Z', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('u', 'U', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('i', 'I', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('o', 'O', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('p', 'P', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('uuml', 'Ü', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('plus', '+', { sub: '*', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('hash', '#', { sub: "'", w: 1.5, finger: 'pinky', hand: 'right', kind: 'symbol' }),
      ],
      [
        k('caps', 'Caps', { w: 1.75, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('a', 'A', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('s', 'S', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('d', 'D', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('f', 'F', { finger: 'index', hand: 'left', kind: 'letter', homing: true }),
        k('g', 'G', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('h', 'H', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('j', 'J', { finger: 'index', hand: 'right', kind: 'letter', homing: true }),
        k('k', 'K', { finger: 'middle', hand: 'right', kind: 'letter' }),
        k('l', 'L', { finger: 'ring', hand: 'right', kind: 'letter' }),
        k('ouml', 'Ö', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('auml', 'Ä', { finger: 'pinky', hand: 'right', kind: 'letter' }),
        k('enter', 'Enter ↵', { w: 2.25, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lshift', 'Shift ⇧', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('angle', '<', { sub: '>', finger: 'pinky', hand: 'left', kind: 'symbol' }),
        k('y', 'Y', { finger: 'pinky', hand: 'left', kind: 'letter' }),
        k('x', 'X', { finger: 'ring', hand: 'left', kind: 'letter' }),
        k('c', 'C', { finger: 'middle', hand: 'left', kind: 'letter' }),
        k('v', 'V', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('b', 'B', { finger: 'index', hand: 'left', kind: 'letter' }),
        k('n', 'N', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('m', 'M', { finger: 'index', hand: 'right', kind: 'letter' }),
        k('comma', ',', { sub: ';', finger: 'middle', hand: 'right', kind: 'symbol' }),
        k('period', '.', { sub: ':', finger: 'ring', hand: 'right', kind: 'symbol' }),
        k('minus', '-', { sub: '_', finger: 'pinky', hand: 'right', kind: 'symbol' }),
        k('rshift', 'Shift ⇧', { w: 2.75, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
      [
        k('lctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('win', '❖', { w: 1.25, finger: 'pinky', hand: 'left', kind: 'special' }),
        k('lalt', 'Alt', { w: 1.5, finger: 'thumb', hand: 'left', kind: 'special' }),
        k('space', 'Spatie', { w: 6.5, finger: 'thumb', hand: 'both', kind: 'special' }),
        k('ralt', 'AltGr', { w: 1.5, finger: 'thumb', hand: 'right', kind: 'special' }),
        k('fn', 'Fn', { w: 1.25, finger: 'pinky', hand: 'right', kind: 'special' }),
        k('rctrl', 'Ctrl', { w: 1.5, finger: 'pinky', hand: 'right', kind: 'special' }),
      ],
    ],
  },
};

export function getLayout(layoutId = 'qwerty') {
  return KEYBOARD_LAYOUTS[layoutId] || KEYBOARD_LAYOUTS.qwerty;
}

export function getFlatKeys(layoutId = 'qwerty') {
  const layout = getLayout(layoutId);
  const out = [];
  layout.rows.forEach((row, rowIndex) => {
    let unitX = 0;
    row.forEach((key, colIndex) => {
      out.push({ ...key, rowIndex, colIndex, unitX });
      unitX += key.w;
    });
  });
  return out;
}

export function defaultSelectedKeys(layoutId = 'qwerty') {
  return getFlatKeys(layoutId).filter((key) => key.kind === 'letter').map((key) => key.id);
}

export function normalizeKeyboardOpts(opts = {}) {
  const layout = Object.prototype.hasOwnProperty.call(KEYBOARD_LAYOUTS, opts.layout) ? opts.layout : 'qwerty';
  const validIds = new Set(getFlatKeys(layout).map((key) => key.id));
  let selectedKeys;
  if (Array.isArray(opts.selectedKeys)) {
    selectedKeys = [...new Set(opts.selectedKeys.filter((id) => validIds.has(id)))];
  } else {
    selectedKeys = defaultSelectedKeys(layout);
  }
  const fingerColors = { ...DEFAULT_FINGER_COLORS };
  if (opts.fingerColors && typeof opts.fingerColors === 'object') {
    for (const f of FINGERS) {
      if (typeof opts.fingerColors[f.id] === 'string' && /^#[0-9a-fA-F]{6}$/.test(opts.fingerColors[f.id])) {
        fingerColors[f.id] = opts.fingerColors[f.id].toLowerCase();
      }
    }
  }
  const startDelay = Number.isFinite(opts.startDelay) ? Math.max(0, Math.min(5, Number(opts.startDelay))) : 0.4;
  const endDelay = Number.isFinite(opts.endDelay) ? Math.max(0, Math.min(5, Number(opts.endDelay))) : 0.4;
  const duration = Number.isFinite(opts.duration) ? Math.max(1.5, Math.min(8, Number(opts.duration))) : 3.0;
  const previewKey = validIds.has(opts.previewKey)
    ? opts.previewKey
    : (selectedKeys[0] || defaultSelectedKeys(layout)[0] || 'a');

  const bgMode = Object.prototype.hasOwnProperty.call(BACKGROUND_MODES, opts.bgMode) ? opts.bgMode : 'theme';
  const bgColor = typeof opts.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(opts.bgColor) ? opts.bgColor.toLowerCase() : '#0f172a';
  const greenscreenColor = typeof opts.greenscreenColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(opts.greenscreenColor) ? opts.greenscreenColor.toLowerCase() : '#00ff00';
  const bgImageUrl = typeof opts.bgImageUrl === 'string' ? opts.bgImageUrl.trim() : '';
  const bgImageDim = Number.isFinite(opts.bgImageDim) ? Math.max(0, Math.min(0.9, Number(opts.bgImageDim))) : 0.25;
  const boardMode = Object.prototype.hasOwnProperty.call(BOARD_MODES, opts.boardMode) ? opts.boardMode : 'theme';
  const boardColor = typeof opts.boardColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(opts.boardColor) ? opts.boardColor.toLowerCase() : '#0d1324';
  const maskMode = Object.prototype.hasOwnProperty.call(MASK_MODES, opts.maskMode) ? opts.maskMode : 'board';

  return {
    layout,
    selectedKeys,
    previewKey,
    fingerColors,
    theme: ['dark', 'spy', 'light'].includes(opts.theme) ? opts.theme : 'dark',
    bgMode,
    bgColor,
    greenscreenColor,
    bgImageUrl,
    bgImageDim,
    boardMode,
    boardColor,
    maskMode,
    stickerStyle: ['peel', 'pop', 'slide'].includes(opts.stickerStyle) ? opts.stickerStyle : 'peel',
    startDelay,
    endDelay,
    duration,
    blankSticker: opts.blankSticker !== false,       // default true: lege gekleurde sticker bedekt letter
    cameraZoom: opts.cameraZoom !== false,           // default true: subtiele zoom naar de toets
    showLaneGuide: opts.showLaneGuide !== false,     // default true: subtiele vingerbaan-indicatie
    showKeyBadge: opts.showKeyBadge !== false,       // default true: toon toets + vingerbaan info boven/onder
    cumulativeStickers: opts.cumulativeStickers === true, // default false: elke export toont 1 toets die geplakt wordt
    sounds: opts.sounds !== false,
    volume: Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, Number(opts.volume))) : 0.75,
  };
}

// Match a typed character to a key in the given layout
export function findKeyIdsByInput(layoutId, text) {
  const flat = getFlatKeys(layoutId);
  const found = new Set();
  for (const ch of String(text || '')) {
    if (ch === ' ') {
      found.add('space');
      continue;
    }
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    const match = flat.find((k) =>
      k.label.toUpperCase() === upper ||
      k.label.toLowerCase() === lower ||
      k.sub.toUpperCase() === upper ||
      k.sub.toLowerCase() === lower
    );
    if (match) found.add(match.id);
  }
  return [...found];
}

// Clean slug for exported filenames per key (e.g. "a", "punt", "komma", "spatie", "a-umlaut")
const SLUG_NAMES = {
  '.': 'punt',
  ',': 'komma',
  ';': 'puntkomma',
  ':': 'dubbelepunt',
  '/': 'slash',
  '\\': 'backslash',
  '?': 'vraagteken',
  '!': 'uitroepteken',
  '-': 'streepje',
  '=': 'is',
  '+': 'plus',
  '*': 'ster',
  "'": 'apostrof',
  '"': 'aanhalingsteken',
  '`': 'grave',
  '^': 'dakje',
  '´': 'accent',
  '[': 'haakje-open',
  ']': 'haakje-sluit',
  '(': 'haakje-open',
  ')': 'haakje-sluit',
  '<': 'kleiner-dan',
  '&': 'ampersand',
  '$': 'dollar',
  '£': 'pond',
  '¬': 'not-teken',
  '@': 'apenstaartje',
  '~': 'tilde',
  'µ': 'mu',
  '²': 'kwadraat',
  '#': 'hekje',
  'é': 'e-accent',
  'è': 'e-grave',
  'ç': 'c-cedille',
  'à': 'a-grave',
  'ù': 'u-grave',
  'ä': 'a-umlaut',
  'ö': 'o-umlaut',
  'ü': 'u-umlaut',
  'ß': 'eszett',
};

export function keyExportSlug(key) {
  if (!key) return 'toets';
  const raw = String(key.label || key.id || '').trim().toLowerCase();
  if (SLUG_NAMES[raw]) return SLUG_NAMES[raw];
  if (key.id === 'space') return 'spatie';
  if (key.id === 'enter') return 'enter';
  if (key.id === 'backspace') return 'backspace';
  const clean = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return clean || key.id;
}

// Timing schedule for a single key's sticker animation
export function keyboardSchedule(options = {}) {
  const opts = normalizeKeyboardOpts(options);
  const delay = opts.startDelay;
  const animDur = opts.duration;
  const endDelay = opts.endDelay;
  const scale = animDur / 3.0;
  const animEnd = delay + animDur;
  return {
    startDelay: delay,
    focusStart: delay + 0.12 * scale,
    focusPeak: delay + 0.65 * scale,
    stickerEnter: delay + 0.55 * scale,
    peelStart: delay + 0.78 * scale,
    peelEnd: delay + 1.48 * scale,
    pressPeak: delay + 1.54 * scale,
    pressDone: delay + 1.82 * scale,
    shineStart: delay + 1.48 * scale,
    shineEnd: delay + 2.05 * scale,
    zoomOutStart: delay + 2.25 * scale,
    animEnd,
    endDelay,
    total: animEnd + endDelay,
  };
}

// Deterministic sound synthesis for a key's sticker application:
// 1. Soft focus ping
// 2. Crisp sticky adhesive micro-tacks (no wind/paper whoosh)
// 3. Juicy sticky seal pop + tactile keycap press
// 4. Happy high sparkling "pling!" chime
export function keyboardSoundtrack(schedule, options = {}, sampleRate = 48000) {
  const opts = normalizeKeyboardOpts(options);
  const totalSamples = Math.ceil(schedule.total * sampleRate);
  const pcm = new Float32Array(totalSamples);
  if (!opts.sounds || opts.volume <= 0) return pcm;

  const vol = opts.volume;
  let seed = 133742;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };

  // Helper: discrete sticky adhesive tack (upward pitch-chirp droplet + micro-snap, zero wind noise)
  const addStickyTack = (atSample, amp, baseFreq, chirpMult = 1.58, decay = 520) => {
    const len = Math.min(Math.round(0.012 * sampleRate), totalSamples - atSample);
    let phase1 = 0;
    let phase2 = 0;
    for (let k = 0; k < len; k++) {
      if (atSample + k < 0) continue;
      const t = k / sampleRate;
      // Fast upward pitch bend gives the unmistakable "tacky/sticky glue" pop character
      const chirp = 1 + (chirpMult - 1) * (1 - Math.exp(-t * 950));
      const f1 = baseFreq * chirp;
      const f2 = baseFreq * 2.15 * chirp;
      phase1 += (2 * Math.PI * f1) / sampleRate;
      phase2 += (2 * Math.PI * f2) / sampleRate;

      const attack = Math.min(1, k / (sampleRate * 0.0004));
      const env = attack * Math.exp(-t * decay);
      // Tiny 0.9ms initial adhesive snap transient
      const snap = Math.exp(-t * 2400) * (rand() * 0.45 + Math.sin(2 * Math.PI * 3400 * t) * 0.55);
      const body = Math.sin(phase1) * 0.68 + Math.sin(phase2) * 0.32;
      pcm[atSample + k] += (body * env + snap * 0.42) * amp * vol;
    }
  };

  // 1. Soft cheerful focus ping when target key highlights (focusStart)
  {
    const start = Math.round(schedule.focusStart * sampleRate);
    const len = Math.round(0.20 * sampleRate);
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      const t = i / sampleRate;
      const env = Math.sin(Math.min(1, t / 0.006) * (Math.PI / 2)) * Math.exp(-t * 20);
      const sig = Math.sin(2 * Math.PI * 659.25 * t) * 0.16 + Math.sin(2 * Math.PI * 1318.5 * t) * 0.07;
      pcm[start + i] += sig * env * vol;
    }
  }

  // 2. Sticky adhesive bonding tacks as the sticker rolls onto the keycap (peelStart -> peelEnd)
  // Uses discrete tacky micro-pops with silent gaps between them (no continuous wind/paper hiss)
  {
    const start = Math.round(schedule.peelStart * sampleRate);
    const dur = Math.max(0.15, schedule.peelEnd - schedule.peelStart);
    const len = Math.round(dur * sampleRate);

    // Initial sticky corner catch when adhesive first grabs the keycap edge
    addStickyTack(Math.max(0, start - Math.round(0.010 * sampleRate)), 0.34, 780, 1.65, 460);
    addStickyTack(start, 0.42, 1080, 1.72, 490);
    addStickyTack(start + Math.round(0.006 * sampleRate), 0.28, 1520, 1.55, 580);

    // Granular zipper of sticky glue micro-pops as the sticker adheres across the surface
    let cursor = Math.round(0.015 * sampleRate);
    while (cursor < len) {
      const p = cursor / len;
      // Pressure curve: strongest in the middle and toward the final seal
      const contour = Math.sin(p * Math.PI) * (0.55 + 0.45 * p);
      // Rising pitch center as the remaining un-stuck area gets smaller (like sticking tape down)
      const baseFreq = 720 + 980 * Math.pow(p, 1.15) + (rand() * 190);
      const amp = (0.20 + 0.18 * Math.abs(rand())) * contour;
      const decay = 480 + Math.abs(rand()) * 260;

      addStickyTack(start + cursor, amp, baseFreq, 1.55 + 0.22 * p, decay);

      // Occasional double micro-tack (two adhesive filaments snapping right after each other)
      if (rand() > 0.25) {
        const subOffset = Math.round((0.0022 + Math.abs(rand()) * 0.0028) * sampleRate);
        addStickyTack(start + cursor + subOffset, amp * 0.68, baseFreq * 1.28, 1.62, decay * 1.15);
      }

      // Irregular spacing between 7ms and 18ms so it sounds unmistakably sticky & organic
      const gapSec = 0.007 + Math.abs(rand()) * 0.011 * (1 - 0.35 * p);
      cursor += Math.max(12, Math.round(gapSec * sampleRate));
    }
  }

  // 3. Juicy sticky suction-seal pop + crisp tactile key press when sticker seals flat (pressPeak)
  {
    const start = Math.round((schedule.pressPeak - 0.025) * sampleRate);
    const len = Math.round(0.28 * sampleRate);
    let low = 0;
    let popPhase = 0;
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      if (start + i < 0) continue;
      const t = i / sampleRate;
      const n = rand();
      low += 0.25 * (n - low);

      // (a) Juicy sticky suction pop (upward pitch sweep 240Hz -> 760Hz as the last air bubble seals)
      const popFreq = 240 + 520 * (1 - Math.exp(-t * 420));
      popPhase += (2 * Math.PI * popFreq) / sampleRate;
      const stickyPop =
        (Math.sin(popPhase) * 0.72 + Math.sin(popPhase * 1.92) * 0.28) *
        Math.min(1, t / 0.001) *
        Math.exp(-t * 155) *
        0.52;

      // (b) Tactile keycap thock + crisp adhesive seal snap
      const pitchDrop = 175 * Math.exp(-t * 48) + 70;
      const thock = Math.sin(2 * Math.PI * pitchDrop * t) * Math.exp(-t * 32) * 0.44;
      const snap = (low * 0.65 + Math.sin(2 * Math.PI * 1850 * t) * 0.35) * Math.exp(-t * 210) * 0.42;

      // (c) Crisp key release + fingertip un-stick tick 70ms later
      const relT = t - 0.070;
      let release = 0;
      if (relT >= 0) {
        const unstickFreq = 920 + 680 * (1 - Math.exp(-relT * 700));
        release =
          (Math.sin(2 * Math.PI * unstickFreq * relT) * 0.55 + Math.sin(2 * Math.PI * 2250 * relT) * 0.35) *
          Math.exp(-relT * 280) *
          0.32;
      }

      pcm[start + i] += (stickyPop + thock + snap + release) * vol;
    }
  }

  // 4. Happy, bright high "Pling!" completion chime during shine sweep (shineStart)
  {
    const start = Math.round((schedule.pressPeak + 0.015) * sampleRate);
    const len = Math.round(0.52 * sampleRate);
    // Bright E-major sparkle arpeggio reaching up to high E6 & B6 for a happy rewarding "pling!"
    const notes = [659.25, 830.61, 987.77, 1318.5, 1975.53]; // E5, G#5, B5, E6, B6
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      const t = i / sampleRate;
      let s = 0;
      notes.forEach((freq, idx) => {
        const dt = t - idx * 0.024;
        if (dt > 0) {
          const isTop = idx >= 3;
          const attack = Math.sin(Math.min(1, dt / 0.004) * (Math.PI / 2));
          const decay = Math.exp(-dt * (isTop ? 7.8 : 10.5));
          const env = attack * decay;
          const fundamental = Math.sin(2 * Math.PI * freq * dt);
          const bellOvertone = Math.sin(2 * Math.PI * (freq * 2) * dt) * 0.28 * Math.exp(-dt * 18);
          const gain = idx === 3 ? 0.13 : idx === 4 ? 0.11 : 0.085;
          s += (fundamental + bellOvertone) * env * gain;
        }
      });
      pcm[start + i] += s * vol;
    }
  }

  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = Math.max(-0.95, Math.min(0.95, pcm[i]));
  }
  return pcm;
}
