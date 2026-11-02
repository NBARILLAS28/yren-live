// Importar marcadores (secciones) desde texto/CSV (Audacity, Reaper, listas simples) o desde los cue points de un WAV.

/** "1:23.5", "0:01:23", "83,5", "00:01:23:15" (cuadros a 30 fps) → segundos. NaN si no es un tiempo. */
export function parseTime(str) {
  let s = String(str).trim().replace(',', '.');
  if (!/^\d+(?:[:.]\d+)*$/.test(s) && !/^\d+:\d+(?::\d+)*(?:\.\d+)?$/.test(s)) return NaN;
  if (!s.includes(':')) return /^\d+(?:\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  const p = s.split(':');
  if (p.length === 4) return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]) + (+p[3]) / 30;
  if (p.length === 3) return (+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2]);
  if (p.length === 2) return (+p[0]) * 60 + parseFloat(p[1]);
  return NaN;
}

function splitCells(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const sep = line.includes(';') && !line.includes(',') ? ';' : ',';
  if (!line.includes(sep)) return null;
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const NAME_H = /^(name|nombre|marker|marcador|label|etiqueta|texto|text|description|descripci[oó]n|region|regi[oó]n)$/i;
const TIME_H = /^(start|inicio|time|tiempo|position|posici[oó]n|in|pos)$/i;

/** Devuelve [{name, start}] ordenados por tiempo. Acepta Audacity (inicio\tfin\tnombre), Reaper/CSV con encabezado y líneas «0:45 Coro». */
export function parseMarkerText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/^﻿/, '')).filter((l) => l.trim());
  const out = [];
  let nameCol = -1, timeCol = -1;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[;]/.test(line)) continue;
    const cells = splitCells(line);
    if (cells && cells.length > 1) {
      if (nameCol < 0 && timeCol < 0 && cells.every((c) => !isFinite(parseTime(c)))) {
        const n = cells.findIndex((c) => NAME_H.test(c)), t = cells.findIndex((c) => TIME_H.test(c));
        if (n >= 0 || t >= 0) { nameCol = n; timeCol = t; continue; }
      }
      let ti = timeCol >= 0 && isFinite(parseTime(cells[timeCol] || '')) ? timeCol : cells.findIndex((c) => isFinite(parseTime(c)));
      if (ti < 0) continue;
      let ni = nameCol >= 0 && cells[nameCol] ? nameCol : cells.findIndex((c, i) => i !== ti && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(c) && !isFinite(parseTime(c)));
      out.push({ name: ni >= 0 ? cells[ni] : '', start: parseTime(cells[ti]) });
      continue;
    }
    let m = /^(\d[\d:.,]*)\s*[\-–:]?\s+(.+)$/.exec(line);
    if (m && isFinite(parseTime(m[1]))) { out.push({ name: m[2].trim(), start: parseTime(m[1]) }); continue; }
    m = /^(.+?)[\s\-–:]+(\d[\d:.,]*)$/.exec(line);
    if (m && isFinite(parseTime(m[2]))) out.push({ name: m[1].trim(), start: parseTime(m[2]) });
  }
  const seen = new Set();
  return out
    .filter((x) => isFinite(x.start) && x.start >= 0)
    .map((x, i) => ({ name: x.name || `Marcador ${i + 1}`, start: Math.round(x.start * 100) / 100 }))
    .filter((x) => { const k = x.start.toFixed(2); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.start - b.start)
    .slice(0, 200);
}

const ascii = (dv, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s; };

/** Lee los puntos «cue» (y sus etiquetas) de un WAV sin cargar el audio en memoria. [] si no tiene. */
export async function readWavCues(file) {
  try {
    if (file.size < 44) return [];
    const head = new DataView(await file.slice(0, 12).arrayBuffer());
    const tag = ascii(head, 0, 4);
    if ((tag !== 'RIFF' && tag !== 'RF64') || ascii(head, 8, 4) !== 'WAVE') return [];
    let off = 12, sr = 44100;
    const cues = [], labels = new Map();
    while (off + 8 <= file.size) {
      const h = new DataView(await file.slice(off, off + 8).arrayBuffer());
      const id = ascii(h, 0, 4), size = h.getUint32(4, true), body = off + 8;
      if (id === 'fmt ') sr = new DataView(await file.slice(body, body + 8).arrayBuffer()).getUint32(4, true) || sr;
      else if (id === 'cue ' && size <= 1 << 20) {
        const d = new DataView(await file.slice(body, body + size).arrayBuffer());
        const n = d.getUint32(0, true);
        for (let i = 0; i < n && 4 + i * 24 + 24 <= size; i++) cues.push({ id: d.getUint32(4 + i * 24, true), sample: d.getUint32(4 + i * 24 + 20, true) });
      } else if (id === 'LIST' && size >= 4 && size <= 1 << 20) {
        const d = new DataView(await file.slice(body, body + size).arrayBuffer());
        if (ascii(d, 0, 4) === 'adtl') {
          let p = 4;
          while (p + 8 <= size) {
            const sid = ascii(d, p, 4), ssz = d.getUint32(p + 4, true);
            if ((sid === 'labl' || sid === 'note') && ssz >= 4) {
              const cid = d.getUint32(p + 8, true); let t = '';
              for (let i = p + 12; i < p + 8 + ssz && d.getUint8(i) !== 0; i++) t += String.fromCharCode(d.getUint8(i));
              if (!labels.has(cid)) labels.set(cid, new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(t, (c) => c.charCodeAt(0))));
            }
            p += 8 + ssz + (ssz & 1);
          }
        }
      }
      off = body + size + (size & 1);
    }
    return cues.map((c, i) => ({ name: labels.get(c.id) || `Marcador ${i + 1}`, start: Math.round((c.sample / sr) * 100) / 100 })).sort((a, b) => a.start - b.start);
  } catch { return []; }
}

/** Marcadores de cualquier archivo soportado (WAV con cues o texto). */
export async function readMarkersFromFile(file) {
  if (/\.wav$/i.test(file.name) || file.type === 'audio/wav' || file.type === 'audio/x-wav') return readWavCues(file);
  return parseMarkerText(await file.text());
}
