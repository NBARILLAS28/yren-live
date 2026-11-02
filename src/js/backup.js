// Respaldo de la biblioteca: un solo archivo .yrenpack con canciones, setlists, ajustes y los audios originales.
// Formato: "YRENPK1\n" (8 bytes) · largo del encabezado (4 bytes, little-endian) · encabezado JSON · audios uno tras otro.

import { store } from './store.js';

const MAGIC = 'YRENPK1\n';
const DEVICE_KEYS = ['deviceId', 'deviceLabel', 'mainPair', 'monitorPair', 'mode'];

export async function buildPack(appVersion = '') {
  const [songs, setlists, settings, entries] = await Promise.all([
    store.getAll('songs'), store.getAll('setlists'), store.getSetting('settings'), store.getAllEntries('files'),
  ]);
  const songIds = new Set(songs.map((s) => s.id));
  const used = entries.filter(([key]) => songIds.has(String(key).split(':')[0]));
  const cleanSettings = { ...(settings || {}) };
  for (const k of DEVICE_KEYS) delete cleanSettings[k]; // la interfaz de audio es de cada Mac
  const header = {
    format: 'yrenpack', v: 1, app: 'YREN LIVE', version: appVersion, created: Date.now(),
    songs, setlists, settings: cleanSettings,
    files: used.map(([key, rec]) => ({ key, name: rec.name, type: rec.type, size: rec.blob.size })),
  };
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, hb.length, true);
  const blob = new Blob([MAGIC, len, hb, ...used.map(([, rec]) => rec.blob)], { type: 'application/octet-stream' });
  return { blob, counts: { songs: songs.length, setlists: setlists.length, files: used.length, bytes: blob.size } };
}

/** Lee el encabezado de un respaldo sin cargarlo entero en memoria. Lanza un Error con mensaje claro si no sirve. */
export async function readPack(file) {
  if (!file || file.size < 16) throw new Error('El archivo está vacío o dañado.');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const magic = new TextDecoder().decode(head.slice(0, 8));
  if (magic !== MAGIC) throw new Error('Ese archivo no es un respaldo de YREN LIVE (.yrenpack).');
  const hl = new DataView(head.buffer).getUint32(8, true);
  if (hl <= 0 || 12 + hl > file.size) throw new Error('El respaldo está incompleto: se cortó al copiarlo o descargarlo.');
  let header;
  try { header = JSON.parse(await file.slice(12, 12 + hl).text()); } catch { throw new Error('El respaldo está dañado (no se puede leer el índice).'); }
  if (header.format !== 'yrenpack' || !Array.isArray(header.songs) || !Array.isArray(header.setlists) || !Array.isArray(header.files)) throw new Error('El respaldo no tiene el formato esperado.');
  if (header.v > 1) throw new Error('El respaldo viene de una versión más nueva de YREN LIVE. Actualiza la app e inténtalo otra vez.');
  let off = 12 + hl;
  const parts = header.files.map((f) => { const p = { ...f, start: off }; off += f.size; return p; });
  if (off > file.size) throw new Error('El respaldo está incompleto: faltan archivos de audio al final.');
  return { header, parts, file };
}

/** Escribe el contenido del respaldo en la biblioteca local. Lo que ya existe con el mismo id se reemplaza; lo demás no se toca. */
export async function importPack(pack, onProgress = () => {}) {
  const { header, parts, file } = pack;
  let n = 0;
  for (const p of parts) {
    const blob = file.slice(p.start, p.start + p.size, p.type || 'application/octet-stream');
    await store.put('files', { blob, name: p.name, type: p.type }, p.key);
    onProgress(++n, parts.length);
  }
  for (const s of header.songs) await store.put('songs', s);
  for (const sl of header.setlists) await store.put('setlists', sl);
  return { songs: header.songs.length, setlists: header.setlists.length, files: parts.length };
}

export function packFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `YREN-LIVE-respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.yrenpack`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
