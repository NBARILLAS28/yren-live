// Genera stems WAV de prueba (sin archivos binarios en el repositorio).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function writeWav(file, fn, secs, sr = 22050) {
  const n = Math.floor(secs * sr), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, fn(i / sr))) * 32000 | 0, 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/** Crea una canción de 5 stems en una carpeta temporal y devuelve las rutas. */
export function makeSong(title = 'Cancion de prueba', secs = 24) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yren-'));
  const defs = {
    Bass: (t) => 0.35 * Math.sin(2 * Math.PI * 98 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t)),
    Click: (t) => { const ph = t % 0.5; return ph < 0.012 ? 0.7 * Math.sin(2 * Math.PI * 1800 * ph) : 0; },
    Drums: (t) => { const ph = t % 0.5; return ph < 0.08 ? (Math.random() * 2 - 1) * 0.4 * (1 - ph / 0.08) : 0; },
    Guia: (t) => (t % 4 < 0.4 ? 0.3 * Math.sin(2 * Math.PI * 300 * t) : 0),
    Teclas: (t) => 0.15 * (Math.sin(2 * Math.PI * 196 * t) + Math.sin(2 * Math.PI * 247 * t) + Math.sin(2 * Math.PI * 294 * t)),
  };
  const files = [];
  for (const [name, fn] of Object.entries(defs)) { const f = path.join(dir, `${title} - ${name}.wav`); writeWav(f, fn, secs); files.push(f); }
  return { dir, files };
}

/** Añade puntos «cue» con nombre (en segundos) a un WAV ya escrito. */
export function addWavCues(file, cues, sr = 22050) {
  const buf = fs.readFileSync(file);
  const cue = Buffer.alloc(4 + cues.length * 24); cue.writeUInt32LE(cues.length, 0);
  cues.forEach((c, i) => { const o = 4 + i * 24, smp = Math.round(c.t * sr); cue.writeUInt32LE(i + 1, o); cue.writeUInt32LE(smp, o + 4); cue.write('data', o + 8); cue.writeUInt32LE(smp, o + 20); });
  const labs = cues.map((c, i) => { const t = Buffer.from(c.name + '\0'); const pad = t.length & 1; const b = Buffer.alloc(12 + t.length + pad); b.write('labl', 0); b.writeUInt32LE(4 + t.length, 4); b.writeUInt32LE(i + 1, 8); t.copy(b, 12); return b; });
  const chunk = (id, b) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b, b.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const extra = Buffer.concat([chunk('cue ', cue), chunk('LIST', Buffer.concat([Buffer.from('adtl'), ...labs]))]);
  const out = Buffer.concat([buf, extra]);
  out.writeUInt32LE(out.length - 8, 4);
  fs.writeFileSync(file, out);
}
