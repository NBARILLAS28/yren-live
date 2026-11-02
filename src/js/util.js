// Utilidades: tonalidades, formato de tiempo, detección de tipo de pista.

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Tonalidades mayores que se escriben con bemoles por convención
const FLAT_MAJORS = new Set([1, 3, 5, 8, 10]); // Db Eb F Ab Bb

export const APP_VERSION = '0.3.0';

export const ROOT_OPTIONS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

export function mod12(n) { return ((n % 12) + 12) % 12; }

export function keyLabel(key) {
  if (!key) return '—';
  const major = key.minor ? mod12(key.root + 3) : key.root;
  const names = FLAT_MAJORS.has(major) ? FLAT : SHARP;
  return names[mod12(key.root)] + (key.minor ? 'm' : '');
}

export function shiftKey(key, semis) {
  return { root: mod12(key.root + semis), minor: !!key.minor };
}

/** Semitonos (−6…+6) para llegar de la tonalidad `from` a la raíz `toRoot` por el camino más corto. */
export function semisBetween(fromRoot, toRoot) {
  let d = mod12(toRoot - fromRoot);
  if (d > 6) d -= 12;
  return d;
}

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const t = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, '0')}.${t}`;
}

export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const RX_CLICK = /\b(click|clic|metr[oó]nomo|metronome)\b|^click|click$/i;
const RX_GUIDE = /(guide|gu[ií]a|cue|cues|voice ?count|count ?off|vocal ?guide)/i;
const RX_PERC = /(drum|bater[ií]a|percus|perc\b|loop|kick|snare|hat|cajon)/i;

/** Adivina el tipo de pista por el nombre del archivo. */
export function guessTrack(fileName) {
  const base = cleanName(fileName);
  if (RX_GUIDE.test(base)) return { kind: 'guide', route: 'monitor', transpose: false };
  if (RX_CLICK.test(base)) return { kind: 'click', route: 'monitor', transpose: false };
  if (RX_PERC.test(base)) return { kind: 'music', route: 'main', transpose: false };
  return { kind: 'music', route: 'main', transpose: true };
}

export function cleanName(fileName) {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
}

/** Nombre corto de pista: quita el prefijo común (título de la canción) si lo hay. */
export function trackNames(fileNames) {
  const names = fileNames.map(cleanName);
  if (names.length < 2) return names;
  // prefijo común
  let p = names[0];
  for (const n of names) {
    let i = 0;
    while (i < p.length && i < n.length && p[i].toLowerCase() === n[i].toLowerCase()) i++;
    p = p.slice(0, i);
  }
  p = p.replace(/[\s\-–—.]+$/, '');
  if (p.length < 3) return names;
  return names.map((n) => {
    const r = n.slice(p.length).replace(/^[\s\-–—._]+/, '');
    return r || n;
  });
}

export function commonTitle(fileNames, fallback = 'Nueva canción') {
  const names = fileNames.map(cleanName);
  if (!names.length) return fallback;
  let p = names[0];
  for (const n of names) {
    let i = 0;
    while (i < p.length && i < n.length && p[i].toLowerCase() === n[i].toLowerCase()) i++;
    p = p.slice(0, i);
  }
  p = p.replace(/[\s\-–—._(\[]+$/, '').trim();
  return p.length >= 3 ? p : (names.length === 1 ? names[0] : fallback);
}

export const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff|caf)$/i;

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

export function dbToGain(db) { return Math.pow(10, db / 20); }
