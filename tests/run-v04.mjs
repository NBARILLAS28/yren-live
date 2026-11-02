// v0.4 «Para el equipo de alabanza»: letras y acordes, escenario, click generado, cuenta previa, marcadores y automatización por sección.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong, addWavCues } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('v0.4 · Para el equipo de alabanza');
const errors = [];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1300);
  await p.evaluate(() => { window.sampleBus = (bus, ms, step = 25) => new Promise((res) => { const out = []; const t0 = performance.now(); const iv = setInterval(() => { out.push(window.__yren.engine.levelOf(bus)); if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); } }, step); }); });

  // ── marcadores dentro del WAV al importar ──
  const song = makeSong('Cancion Marcada', 20);
  const teclas = song.files.find((f) => /Teclas/.test(f));
  addWavCues(teclas, [{ t: 0, name: 'Intro' }, { t: 5, name: 'Verso 1' }, { t: 10, name: 'Coro' }, { t: 15, name: 'Puente' }]);
  await (await p.$('#fileInput')).uploadFile(...song.files);
  await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await sleep(300);
  const secs0 = await p.evaluate(() => window.__yren.state.songs.values().next().value.sections.map((s) => `${s.name}@${s.start}`));
  R.check('Al importar, las secciones salen de los marcadores (cue) del WAV', secs0.join() === 'Intro@0,Verso 1@5,Coro@10,Puente@15', secs0.join(', '));

  // ── letra y notas, click generado, automatización (todo desde el editor) ──
  await p.type('#edBpm', ''); await p.$eval('#edBpm', (e) => { e.value = '120'; });
  await p.$eval('#edLyrics', (e) => { e.value = '# Intro\n[C]Instrumental\n\n# Verso 1\n[C]Santo, [G]santo, [Am]santo es el [F]Señor\n\nCoro:\nC       G\nDigno es el Cordero\n\n{Puente}\n[Dm]Aleluya'; });
  await p.$eval('#edNotes', (e) => { e.value = 'Entra solo el piano'; });
  await p.click('#edGenClick'); await p.$eval('#edClickBeats', (e) => { e.value = '4'; });
  // automatización: sección 2 (Coro) silencia Drums y enciende el pad; sección 3 (Puente) apaga el pad
  const rows = await p.$$('#edSections .sec-row');
  R.check('Cada sección tiene su botón de automatización (⚙)', rows.length === 4 && !!(await rows[2].$('.au')));
  await (await rows[2].$('.au')).click();
  const boxes = await rows[2].$$('.sec-auto input[type=checkbox]');
  const names = await rows[2].$$eval('.sec-auto label', (ls) => ls.map((l) => l.textContent.trim()));
  await boxes[names.findIndex((n) => /Drums/.test(n))].click();
  await rows[2].$eval('.sec-auto select', (e) => { e.value = 'on'; e.dispatchEvent(new Event('change')); });
  await (await rows[3].$('.au')).click();
  await rows[3].$eval('.sec-auto select', (e) => { e.value = 'off'; e.dispatchEvent(new Event('change')); });
  await p.click('#edSave'); await sleep(1500);
  const sv = await p.evaluate(() => { const s = window.__yren.state.songs.values().next().value; return { lyr: s.lyrics.length, notes: s.notes, gen: s.tracks.filter((t) => t.generated).length, tracks: window.__yren.engine.tracks.length, mute: s.sections[2].mute, pad2: s.sections[2].pad, pad3: s.sections[3].pad, drumsId: s.tracks.find((t) => /Drums/.test(t.name)).id }; });
  R.check('Se guardan letra, notas y la pista de click generada', sv.lyr > 50 && sv.notes === 'Entra solo el piano' && sv.gen === 1 && sv.tracks === 6, JSON.stringify({ ...sv, drumsId: undefined }));
  R.check('Se guarda la automatización por sección (silenciar Drums, pad on/off)', Array.isArray(sv.mute) && sv.mute[0] === sv.drumsId && sv.pad2 === 'on' && sv.pad3 === 'off');

  // ── click generado ──
  const click = await p.evaluate(() => {
    const E = window.__yren.engine.constructor, ctx = window.__yren.engine.ctx, sr = ctx.sampleRate;
    const buf = E.makeClickBuffer(ctx, 4, 120, 0, 4), d = buf.getChannelData(0);
    const peak = (t0, t1) => { let m = 0; for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) m = Math.max(m, Math.abs(d[i])); return m; };
    const zc = (t0) => { let n = 0; for (let i = Math.floor(t0 * sr) + 1; i < Math.floor((t0 + 0.03) * sr); i++) if (d[i - 1] < 0 !== d[i] < 0) n++; return n; };
    return { b0: peak(0, 0.03), mid: peak(0.2, 0.45), b1: peak(0.5, 0.53), b2: peak(1.0, 1.03), accent: zc(0), normal: zc(0.5), len: buf.duration, ch: buf.numberOfChannels };
  });
  R.check('Click generado: un pulso cada medio segundo a 120 BPM, silencio entre pulsos', click.b0 > 0.3 && click.b1 > 0.3 && click.b2 > 0.3 && click.mid < 0.01 && Math.abs(click.len - 4) < 0.01, JSON.stringify(click));
  R.check('Click generado: el primer tiempo del compás suena más agudo', click.accent > click.normal * 1.3, `${click.accent} vs ${click.normal} cruces`);
  R.check('La pista generada va solo al monitor', await p.evaluate(() => { const t = window.__yren.engine.tracks.find((x) => x.meta.generated); return !!t && t.meta.route === 'monitor' && t.meta.kind === 'click' && !!t.buffer; }));

  // ── vista de escenario, letra y transposición ──
  await p.click('#btnStage'); await sleep(300);
  const st = await p.evaluate(() => ({ open: !document.getElementById('stageView').hidden, title: document.getElementById('svTitle').textContent, key: document.getElementById('svKey').textContent, blocks: document.querySelectorAll('.lyr-block').length, notes: document.getElementById('svNotes').textContent, chords: [...document.querySelectorAll('#svLyrics .lyr-line .c')].map((e) => e.textContent).join(' ') }));
  R.check('Escenario: título, tono, notas y 4 bloques de letra', st.open && st.title === 'Cancion Marcada' && st.key === 'C' && st.blocks >= 4 && st.notes.includes('piano'), JSON.stringify({ ...st, chords: undefined }));
  R.check('Escenario: acordes en la tonalidad original', st.chords === 'C C G Am F Dm', st.chords);
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await sleep(250);
  const tr = await p.evaluate(() => ({ key: document.getElementById('svKey').textContent, chords: [...document.querySelectorAll('#svLyrics .lyr-line .c')].map((e) => e.textContent).join(' '), line: document.querySelector('#svLyrics .lyr-chords') && document.querySelector('#svLyrics .lyr-chords').textContent }));
  R.check('Subir 2 semitonos (↑↑) transpone los acordes: C G Am F Dm → D A Bm G Em y la línea «C   G» → «D   A»', tr.key === 'D' && tr.chords === 'D D A Bm G Em' && /^D\s+A$/.test(tr.line.trim()), JSON.stringify(tr));
  await p.evaluate(() => window.__yren.engine.seek(11)); await sleep(500);
  const hl = await p.evaluate(() => ({ now: [...document.querySelectorAll('.lyr-block.here')].map((e) => e.dataset.h), sec: document.getElementById('svSec').textContent, next: document.getElementById('svNext').textContent }));
  R.check('Escenario: al entrar al Coro se resalta su letra y se muestra la sección y la siguiente', hl.now.join() === 'coro' && hl.sec === 'Coro' && /Puente/.test(hl.next), JSON.stringify(hl));
  await p.keyboard.press('Escape'); await sleep(150);
  R.check('Esc cierra el escenario', await p.$eval('#stageView', (e) => e.hidden));
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');

  // ── automatización en reproducción ──
  await p.evaluate(() => { window.__yren.engine.seek(0); }); await sleep(300);
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(1500);
  await p.click('#btnPlay'); await sleep(500);
  const a0 = await p.evaluate(() => { const t = window.__yren.engine.tracks.find((x) => /Drums/.test(x.meta.name)); return { auto: !!t.autoMute, g: t.gain.gain.value }; });
  await p.evaluate(() => window.__yren.engine.seek(10.4)); await sleep(500);
  const a1 = await p.evaluate(() => { const t = window.__yren.engine.tracks.find((x) => /Drums/.test(x.meta.name)); return { auto: !!t.autoMute, g: t.gain.gain.value, pad: window.__yren.state.padOn, dim: document.querySelector('.strip[data-id="' + t.meta.id + '"]').classList.contains('dim') }; });
  R.check('Automatización: en la sección «Coro» los Drums se silencian solos y el pad se enciende', !a0.auto && a0.g > 0.9 && a1.auto && a1.g < 0.05 && a1.pad === true && a1.dim, JSON.stringify({ a0, a1 }));
  await p.evaluate(() => window.__yren.engine.seek(15.4)); await sleep(500);
  const a2 = await p.evaluate(() => { const t = window.__yren.engine.tracks.find((x) => /Drums/.test(x.meta.name)); return { auto: !!t.autoMute, g: t.gain.gain.value, pad: window.__yren.state.padOn }; });
  R.check('Automatización: en el «Puente» los Drums vuelven y el pad se apaga', !a2.auto && a2.g > 0.9 && a2.pad === false, JSON.stringify(a2));
  await p.click('#btnPlay'); await sleep(200);

  // ── cuenta previa ──
  await p.evaluate(() => { const s = window.__yren.state.settings; s.countIn = 4; document.getElementById('countSel'); });
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(200);
  R.check('Cuenta previa: solo al empezar desde el inicio', (await p.evaluate(() => window.__yren.api.countOpts())).countIn === 4);
  await p.click('#btnPlay');
  const mon = await p.evaluate(() => window.sampleBus('monitor', 1700));
  const main = await p.evaluate(() => window.sampleBus('main', 100));
  const posDuring = await p.evaluate(() => window.__yren.engine.getPosition());
  R.check('Cuenta previa: se oyen clicks por el MONITOR, no suena la canción por la sala y la posición no avanza', Math.max(...mon) > 0.1 && Math.max(...main) < 0.02 && posDuring < 0.05, `monitor ${Math.max(...mon).toFixed(2)} · sala ${Math.max(...main).toFixed(3)} · pos ${posDuring.toFixed(2)}`);
  await sleep(1500);
  const posAfter = await p.evaluate(() => window.__yren.engine.getPosition());
  R.check('Cuenta previa: tras los 4 tiempos (2 s a 120 BPM) arranca la canción', posAfter > 0.2 && posAfter < 1.6, `pos ${posAfter.toFixed(2)}`);
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(200);
  await p.click('#btnPlay'); await sleep(700); await p.click('#btnPlay'); await sleep(200);
  const quiet = Math.max(...(await p.evaluate(() => window.sampleBus('monitor', 1600))));
  R.check('Pausar durante la cuenta previa corta los clicks que faltaban', quiet < 0.02 && !(await p.evaluate(() => window.__yren.engine.playing)), `monitor ${quiet.toFixed(3)}`);
  await p.evaluate(() => { window.__yren.state.settings.countIn = 0; });
  await p.evaluate(() => { window.__yren.engine.seek(5); });
  await p.evaluate(() => window.__yren.state.settings.countIn = 4);
  R.check('Cuenta previa: no se aplica si no se empieza desde el inicio', (await p.evaluate(() => window.__yren.api.countOpts())).countIn === undefined);
  await p.evaluate(() => { window.__yren.state.settings.countIn = 0; });

  // ── importar marcadores desde texto ──
  const txt = path.join(os.tmpdir(), 'marcadores-' + Date.now() + '.txt');
  fs.writeFileSync(txt, '0.000000\t0.000000\tIntro\n4.000000\t4.000000\tEstrofa\n9.5\t9.5\tEstribillo\n99\t99\tFuera de rango\n');
  await p.click('#btnEdit'); await p.waitForSelector('#dlgEdit[open]');
  await (await p.$('#markersInput')).uploadFile(txt); await sleep(300);
  await p.waitForSelector('#dlgConfirm[open]', { timeout: 5000 }); await p.click('#cfOk'); await sleep(400);
  const imp = await p.$$eval('#edSections .sn', (ins) => ins.map((i) => i.value));
  R.check('Importar marcadores desde un .txt de Audacity reemplaza las secciones y omite los que exceden la duración', imp.join() === 'Intro,Estrofa,Estribillo', imp.join(', '));
  await p.click('#edSave'); await sleep(700);

  // el respaldo conserva letra, automatización y click generado
  const bk = await p.evaluate(async () => { const { blob } = await window.__yren.api.buildPack(); const u = new Uint8Array(await blob.arrayBuffer()); const hl = new DataView(u.buffer).getUint32(8, true); const h = JSON.parse(new TextDecoder().decode(u.slice(12, 12 + hl))); const s = h.songs[0]; return { lyr: !!s.lyrics, gen: s.tracks.some((t) => t.generated), files: h.files.length, tracks: s.tracks.length }; });
  R.check('El respaldo incluye la letra y el click generado (que no ocupa archivo)', bk.lyr && bk.gen && bk.files === 5 && bk.tracks === 6, JSON.stringify(bk));
  // ── pedal MIDI (con mensajes simulados) y comandos externos ──
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(1200);
  await p.click('#btnSettings'); await p.waitForSelector('#dlgSettings[open]'); await sleep(300);
  R.check('Ajustes: lista las 13 acciones del pedal con su botón «Aprender»', (await p.$$eval('#midiMap button', (b) => b.length)) === 13);
  R.check('Ajustes: el control remoto avisa que es solo de escritorio (en el navegador)', await p.$eval('#remoteNA', (e) => !e.hidden));
  await p.click('#dlgSettings button[value="close"]'); await sleep(200);
  await p.evaluate(() => { const m = window.__yren.api.midi; m.learn('toggle'); m.handle([0xb0, 64, 127]); });
  await sleep(250);
  await p.evaluate(() => { const m = window.__yren.api.midi; m.learn('keyUp'); m.handle([0x90, 60, 100]); });
  await sleep(250);
  const mapped = await p.evaluate(() => ({ ...window.__yren.state.settings.midiMap }));
  R.check('Pedal: dos botones aprendidos y guardados en los ajustes', mapped['c:64:1'] === 'toggle' && mapped['n:60:1'] === 'keyUp', JSON.stringify(mapped));
  await p.evaluate(() => window.__yren.api.midiMessage([0xb0, 64, 127])); await sleep(900);
  const m1 = await p.evaluate(() => window.__yren.engine.playing);
  await sleep(250);
  await p.evaluate(() => window.__yren.api.midiMessage([0xb0, 64, 127])); await sleep(500);
  const m2 = await p.evaluate(() => window.__yren.engine.playing);
  R.check('Pedal: pisar el botón asignado reproduce y pisarlo otra vez pausa', m1 === true && m2 === false);
  const k0 = await p.evaluate(() => window.__yren.state.setlists[0].items[0].transpose || 0);
  await p.evaluate(() => window.__yren.api.midiMessage([0x90, 60, 100])); await sleep(300);
  const k1 = await p.evaluate(() => window.__yren.state.setlists[0].items[0].transpose || 0);
  R.check('Pedal: la nota asignada sube el tono un semitono', k1 === k0 + 1, `${k0} → ${k1}`);
  await p.evaluate(() => window.__yren.api.midiMessage([0x90, 61, 100])); await sleep(100);
  R.check('Pedal: un botón sin asignar no hace nada', (await p.evaluate(() => window.__yren.state.setlists[0].items[0].transpose || 0)) === k1);
  await sleep(1000); await p.reload(); await sleep(2000);
  R.check('Las asignaciones del pedal sobreviven al reiniciar', (await p.evaluate(() => window.__yren.api.midi.keyOf('toggle'))) === 'c:64:1');
  const rs = await p.evaluate(() => window.__yren.api.remoteState());
  R.check('Estado para el celular: título, tono, secciones, canciones', rs.title === 'Cancion Marcada' && typeof rs.key === 'string' && rs.sections.length === 3 && rs.songs.length === 1 && rs.dur > 10, JSON.stringify({ ...rs, songs: rs.songs.length }));
  await p.evaluate(() => window.__yren.api.runCommand('section', 99)); await p.evaluate(() => window.__yren.api.runCommand('borrar-todo'));
  R.check('Comandos fuera de rango o desconocidos no hacen nada ni rompen la app', (await p.evaluate(() => window.__yren.state.songs.size)) === 1);
  await p.evaluate(() => window.__yren.engine.stop());

  R.check('Sin errores de JavaScript', errors.filter((e) => !/setSinkId/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nv0.4 OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
