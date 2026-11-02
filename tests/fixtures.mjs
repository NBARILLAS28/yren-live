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
