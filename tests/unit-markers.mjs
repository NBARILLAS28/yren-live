import { parseTime, parseMarkerText, readWavCues } from '../src/js/markers.js';
let total = 0, failed = 0;
const eq = (name, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (ok ? '' : ` — obtuvo ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`)); };
console.log('\nMarcadores');
eq('Tiempos: 83.5 · 1:23.5 · 0:01:23 · 83,5 · 00:01:23:15', ['83.5', '1:23.5', '0:01:23', '83,5', '00:01:23:15'].map(parseTime), [83.5, 83.5, 83, 83.5, 83.5]);
eq('Tiempos inválidos → NaN', ['', 'hola', '1:2:3:4:5', '--'].map((x) => Number.isNaN(parseTime(x))), [true, true, true, true]);
eq('Audacity (inicio, fin, nombre con tabulaciones)', parseMarkerText('0.000000\t0.000000\tIntro\n12.500000\t12.500000\tVerso 1\n40.2\t40.2\tCoro'), [{ name: 'Intro', start: 0 }, { name: 'Verso 1', start: 12.5 }, { name: 'Coro', start: 40.2 }]);
eq('Reaper CSV con encabezado (#,Name,Start,End,Length)', parseMarkerText('#,Name,Start,End,Length\nM1,Intro,0:00.000,,\nM2,Coro,0:32.250,,\nM3,Puente,1:20.5,,'), [{ name: 'Intro', start: 0 }, { name: 'Coro', start: 32.25 }, { name: 'Puente', start: 80.5 }]);
eq('Encabezado en español y separador «;»', parseMarkerText('Nombre;Inicio\nVerso;0:10\nCoro;0:40'), [{ name: 'Verso', start: 10 }, { name: 'Coro', start: 40 }]);
eq('Líneas simples «0:45 Coro» y «Puente - 1:30»', parseMarkerText('0:45 Coro\nPuente - 1:30\n12.5 Intro'), [{ name: 'Intro', start: 12.5 }, { name: 'Coro', start: 45 }, { name: 'Puente', start: 90 }]);
eq('Duplicados y basura se descartan, queda ordenado', parseMarkerText('hola mundo\n10 A\n10 B\n5 C'), [{ name: 'C', start: 5 }, { name: 'A', start: 10 }]);
// WAV con cue points (se construye a mano)
function wavWithCues(sr, cues) {
  const data = Buffer.alloc(sr * 2); // 1 s de silencio mono 16 bit
  const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(sr, 4); fmt.writeUInt32LE(sr * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const cue = Buffer.alloc(4 + cues.length * 24); cue.writeUInt32LE(cues.length, 0);
  cues.forEach((c, i) => { const o = 4 + i * 24; cue.writeUInt32LE(i + 1, o); cue.writeUInt32LE(c.sample, o + 4); cue.write('data', o + 8); cue.writeUInt32LE(c.sample, o + 20); });
  const lab = cues.map((c, i) => { const t = Buffer.from(c.name + '\0'); const pad = t.length & 1 ? 1 : 0; const b = Buffer.alloc(8 + 4 + t.length + pad); b.write('labl', 0); b.writeUInt32LE(4 + t.length, 4); b.writeUInt32LE(i + 1, 8); t.copy(b, 12); return b; });
  const adtl = Buffer.concat([Buffer.from('adtl'), ...lab]);
  const chunk = (id, b) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b, b.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', data), chunk('cue ', cue), chunk('LIST', adtl)]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
const wav = wavWithCues(22050, [{ name: 'Intro', sample: 0 }, { name: 'Coro', sample: 22050 * 5 }, { name: 'Puente', sample: 22050 * 12 + 11025 }]);
const f = new File([wav], 'stem.wav', { type: 'audio/wav' });
eq('WAV con cue points: nombres y tiempos correctos', await readWavCues(f), [{ name: 'Intro', start: 0 }, { name: 'Coro', start: 5 }, { name: 'Puente', start: 12.5 }]);
eq('WAV sin cues → []', await readWavCues(new File([wavWithCues(22050, [])], 'x.wav')), []);
eq('Archivo que no es WAV → []', await readWavCues(new File([Buffer.from('hola')], 'x.wav')), []);
console.log(failed ? `\n${failed} de ${total} fallaron` : `\nMarcadores OK (${total} comprobaciones)`);
process.exit(failed ? 1 : 0);
