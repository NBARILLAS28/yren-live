// Letras y acordes: acordes en línea [C], líneas de solo acordes, notación inglesa (C D E…) y latina (Do Re Mi…), transposición.

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LAT_S = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const LAT_F = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
const EN_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LAT_IDX = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const mod12 = (n) => ((n % 12) + 12) % 12;

const SUFFIX = /^(?:maj|min|dim|aug|sus|add|m|M|\+|°|º|ø|-)?\d{0,2}(?:(?:maj|sus|add|b|#|\+|-)\d{1,2})*(?:\([^)\s]*\))?(?:sus\d?)?$/;

function parseNote(str) {
  // Latina primero (Do, Re, Mi, Fa, Sol, La, Si; admite mayúsculas), luego inglesa
  let m = /^(sol|do|re|mi|fa|la|si)([#b♯♭]?)/i.exec(str);
  if (m) return { sys: 'lat', idx: LAT_IDX[m[1].toLowerCase()], acc: m[2], len: m[0].length, caps: m[1].length > 1 && m[1] === m[1].toUpperCase() };
  m = /^([A-G])([#b♯♭]?)/.exec(str);
  if (m) return { sys: 'en', idx: EN_IDX[m[1]], acc: m[2], len: m[0].length };
  return null;
}
const accVal = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);

/** Descompone un acorde en raíz, calidad y bajo. Devuelve null si no es un acorde. */
export function parseChord(tok) {
  const trySys = (note) => {
    if (!note) return null;
    const rest = tok.slice(note.len);
    const [qual, bass] = rest.split('/');
    if (rest.split('/').length > 2) return null;
    if (!SUFFIX.test(qual)) return null;
    let b = null;
    if (bass !== undefined) { b = parseNote(bass); if (!b || b.len !== bass.length) return null; }
    return { root: note, qual, bass: b };
  };
  const n = parseNote(tok);
  if (!n) return null;
  let r = trySys(n);
  if (!r && n.sys === 'lat') r = trySys(/^([A-G])([#b♯♭]?)/.test(tok) ? { sys: 'en', idx: EN_IDX[tok[0]], acc: /^[A-G]([#b♯♭])/.exec(tok) ? /^[A-G]([#b♯♭])/.exec(tok)[1] : '', len: /^[A-G][#b♯♭]/.test(tok) ? 2 : 1 } : null);
  return r;
}
export const isChordToken = (tok) => !!parseChord(tok);

function nameOf(note, semis, flats, sys) {
  const i = mod12(note.idx + accVal(note.acc) + semis);
  const table = sys === 'lat' ? (flats ? LAT_F : LAT_S) : (flats ? FLATS : SHARPS);
  const out = table[i];
  return note.caps ? out.toUpperCase() : out;
}

/** Transpone un acorde `semis` semitonos. Devuelve null si el texto no es un acorde. */
export function transposeChord(tok, semis, flats = false) {
  const c = parseChord(tok);
  if (!c) return null;
  const root = nameOf(c.root, semis, flats, c.root.sys);
  const bass = c.bass ? '/' + nameOf(c.bass, semis, flats, c.bass.sys) : '';
  return root + c.qual + bass;
}

const CHORDLINE_SKIP = /^(?:[|\/\-–.:()x×0-9]+|\(x?\d+\)|x\d+)$/i;
export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let chords = 0;
  for (const t of toks) {
    if (isChordToken(t)) chords++;
    else if (!CHORDLINE_SKIP.test(t)) return false;
  }
  return chords > 0;
}

function transposeChordLine(line, semis, flats) {
  let out = '';
  const re = /\S+/g; let m;
  while ((m = re.exec(line))) {
    const tok = m[0], t = transposeChord(tok, semis, flats) || tok;
    while (out.length < m.index) out += ' ';
    if (out.length > 0 && out.length >= m.index && !out.endsWith(' ')) out += ' '; // al menos un espacio entre acordes
    out += t;
  }
  return out;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEAD_BRACE = /^\s*(?:#+\s*|\{\s*)([^}\n]+?)\s*\}?\s*:?\s*$/;
const HEAD_COLON = /^\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]{2,28}):\s*$/;
export const normHead = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function headingOf(line) {
  if (isChordLine(line)) return null;
  const m = HEAD_BRACE.exec(line) || HEAD_COLON.exec(line);
  if (!m) return null;
  if (/^\s*[^#{]/.test(line) && !HEAD_COLON.test(line)) return null;
  return m[1].trim();
}

/** Divide la letra en bloques por encabezado («# Coro», «{Verso 1}» o «Coro:»). */
export function splitBlocks(text) {
  const blocks = [{ heading: '', lines: [] }];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const h = headingOf(line);
    if (h) blocks.push({ heading: h, lines: [] }); else blocks[blocks.length - 1].lines.push(line);
  }
  return blocks.filter((b, i) => b.heading || b.lines.some((l) => l.trim()) || i === 0 && b.lines.length);
}

function renderLine(line, semis, flats) {
  if (!line.trim()) return '<div class="lyr-gap"></div>';
  if (isChordLine(line)) return `<div class="lyr-chords">${esc(transposeChordLine(line, semis, flats))}</div>`;
  if (!/\[[^\]]+\]/.test(line)) return `<div class="lyr-text">${esc(line)}</div>`;
  const parts = []; let last = 0, m; const re = /\[([^\]]+)\]/g;
  let cur = { chord: '', text: '' };
  while ((m = re.exec(line))) {
    const before = line.slice(last, m.index);
    if (before) cur.text += before;
    const t = transposeChord(m[1].trim(), semis, flats);
    if (t === null) { cur.text += m[0]; last = m.index + m[0].length; continue; }
    if (cur.chord || cur.text) parts.push(cur);
    cur = { chord: t, text: '' };
    last = m.index + m[0].length;
  }
  cur.text += line.slice(last);
  if (cur.chord || cur.text) parts.push(cur);
  return '<div class="lyr-line">' + parts.map((p) => `<span class="cs"><b class="c">${esc(p.chord) || '&nbsp;'}</b><i>${esc(p.text) || '&nbsp;'}</i></span>`).join('') + '</div>';
}

/** HTML (seguro) de la letra con los acordes transpuestos. Cada bloque lleva data-h con su encabezado normalizado. */
export function renderLyrics(text, { semis = 0, flats = false } = {}) {
  return splitBlocks(text).map((b) => {
    const head = b.heading ? `<div class="lyr-head">${esc(b.heading)}</div>` : '';
    return `<section class="lyr-block" data-h="${esc(normHead(b.heading))}">${head}${b.lines.map((l) => renderLine(l, semis, flats)).join('')}</section>`;
  }).join('');
}

/** ¿Se prefiere escribir con bemoles en la tonalidad indicada? (F, Bb, Eb, Ab, Db y sus relativas menores) */
export function prefersFlats(key) {
  const major = key.minor ? mod12(key.root + 3) : key.root;
  return [1, 3, 5, 8, 10].includes(major);
}
