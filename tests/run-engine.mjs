// Pruebas del motor de audio en un navegador real (Chrome headless) con audio sintético.
import { startServer, launch, reporter } from './lib.mjs';
const { port, close } = await startServer();
const b = await launch();
const R = reporter('Motor de audio');
try {
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/t/engine.html`);
  const r = await p.evaluate(() => window.runEngine());
  R.check('AudioContext en marcha', r.state === 'running', r.state);
  R.near('Reproduce: la posición avanza en tiempo real', r.pos_after_1_5s, 1.5, 0.35, ' s');
  R.near('Sin cambios: la nota es 440 Hz', r.freq_main_orig, 440, 12, ' Hz');
  R.near('+2 semitonos: 440 → 493,9 Hz', r.freq_main_plus2, 493.9, 14, ' Hz');
  R.check('Salto en cola programado', r.pending === true);
  R.near('Tras el salto: sección D (770 Hz) subida +2 = 864 Hz', r.freq_after_jump, 864.3, 22, ' Hz');
  R.check('El salto no produce clics (salto máximo entre muestras)', r.max_sample_jump_window < 0.6, String(r.max_sample_jump_window));
  R.near('Tempo 90%: el tono no cambia (queda en la nota de su sección)', r.freq_tempo90, r.expected_tempo90, 20, ' Hz');
  R.check('Bucle activo y la posición se mantiene dentro de la región', r.loopSet === true && r.pos_looping >= r.loop_region[0] - 0.1 && r.pos_looping <= r.loop_region[1] + 0.1, `pos ${r.pos_looping} en [${r.loop_region}]`);
  R.check('Pausa y búsqueda funcionan', r.paused_pos > 0 && r.pos_after_seek_play > 1.5 && r.pos_after_seek_play < 2.5, `pausa ${r.paused_pos}, tras seek ${r.pos_after_seek_play}`);
  R.check('Mute del monitor silencia la pista', r.rms_monitor_muted < 0.002, String(r.rms_monitor_muted));
  R.check('Modo dividido y pares se aplican sin error', r.outSplit.mode && r.outPairs.mode, `${r.outSplit.mode} / ${r.outPairs.mode}`);

  for (const rate of [1, 0.9, 1.1]) {
    const j = await p.evaluate((x) => window.runJump(x), rate);
    R.near(`Salto limpio al ${Math.round(rate * 100)}%: duración de la sección`, j.measuredSectionLen, j.expectedSectionLen, 0.06, ' s');
  }
  await p.close();
  for (const seed of [11, 4242]) {
    const q = await b.newPage(); q.on('pageerror', (e) => errs.push(e.message));
    await q.goto(`http://127.0.0.1:${port}/t/engine.html`);
    const s = await q.evaluate((x) => window.runStress(x, 12000), seed);
    R.check(`Estrés (semilla ${seed}): ${s.ops} operaciones aleatorias sin errores`, s.errs.length === 0 && s.playing && s.finalAdvance > 0.8 && s.finalAdvance < 1.3, JSON.stringify(s.errs));
    await q.close();
  }
  R.check('Sin errores de JavaScript', errs.filter((e) => !/setSinkId/.test(e)).length === 0, errs.slice(0, 2).join(' | '));
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nMotor OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
