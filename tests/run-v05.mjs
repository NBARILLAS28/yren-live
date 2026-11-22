// v0.5.1 «Cambios de canción sin esperas»: precarga por cercanía, memoria automática, carga que no tapa los controles y transición con un toque.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('v0.5 · Cambios de canción sin esperas');
const errors = [];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1300);
  await p.evaluate(() => { window.sampleLevels = (ms, step = 25) => new Promise((res) => { const out = []; const t0 = performance.now(); const iv = setInterval(() => { out.push(window.__yren.engine.levelOf('main')); if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); } }, step); }); });

  const titles = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'];
  for (const t of titles) {
    const song = makeSong('Cancion ' + t, 14);
    await (await p.$('#fileInput')).uploadFile(...song.files);
    await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(700);
  }
  R.check('Cinco canciones importadas', (await p.$$('#songList .song-item')).length === 5);

  // ── memoria automática ──
  const auto = await p.evaluate(() => { const s = window.__yren.state; s.settings.memBudgetMB = 0; return { auto: window.__yren.api.memBudgetMB(), manual: (s.settings.memBudgetMB = 2500, window.__yren.api.memBudgetMB()) }; });
  R.check('Memoria «Automático»: entre 1,5 y 8 GB según la RAM; un valor manual se respeta', auto.auto >= 1500 && auto.auto <= 8000 && auto.manual === 2500, JSON.stringify(auto));

  // ── la precarga va por cercanía: actual, siguiente, anterior… (no solo hacia adelante) ──
  await p.evaluate(() => { window.__yren.state.settings.memBudgetMB = 40; });
  await p.evaluate(() => window.__yren.api.selectItem(2)); await sleep(1500);
  const keep = await p.evaluate(() => { const s = window.__yren.state, sl = s.setlists.find((x) => x.id === s.slId); const k = window.__yren.api.planPreload().keep; return sl.items.map((it) => k.has(it.songId)); });
  R.check('Con poca memoria se conservan la actual, la siguiente y la ANTERIOR (no solo las de adelante)', JSON.stringify(keep) === JSON.stringify([false, true, true, true, false]), JSON.stringify(keep));
  await p.evaluate(() => { window.__yren.state.settings.memBudgetMB = 0; });
  await p.evaluate(() => window.__yren.api.preloadSetlist()); await sleep(5000);
  const ready = await p.evaluate(() => [...document.querySelectorAll('#songList .song-item')].map((li) => !!li.querySelector('.rdy')));
  R.check('Con memoria automática todo el setlist queda «✓ lista»', ready.every(Boolean), JSON.stringify(ready));

  // ── la carga NO tapa los controles (se puede seguir haciendo fundido, parar, etc.) ──
  const load = await p.evaluate(async () => {
    const A = window.__yren, s = A.state, e = A.engine;
    const sl = s.setlists.find((x) => x.id === s.slId); const last = sl.items.length - 1;
    s.cache.delete(sl.items[last].songId);
    const orig = e.decode.bind(e); e.decode = async (blob) => { await new Promise((r) => setTimeout(r, 350)); return orig(blob); };
    const done = A.api.selectItem(last);
    await new Promise((r) => setTimeout(r, 250));
    const el = document.getElementById('loading'), btn = document.getElementById('btnFade'), r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const out = { visible: !el.hidden, mini: el.classList.contains('mini'), pe: getComputedStyle(el).pointerEvents, reachable: top === btn, text: document.getElementById('loadingText').textContent };
    await done; e.decode = orig; out.after = document.getElementById('loading').hidden;
    return out;
  });
  R.check('Mientras carga una canción se ve el avance, pero NO se tapa ni bloquea la pantalla', load.visible && load.mini && load.pe === 'none' && load.reachable && load.after, JSON.stringify(load));

  // ── transición con un toque ──
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(800);
  await p.keyboard.press('Space'); await sleep(1200);
  const idx0 = await p.evaluate(() => window.__yren.state.idx);
  const lv = p.evaluate(() => window.sampleLevels(3200));
  await p.keyboard.press('KeyT');
  const mins = await lv;
  await sleep(300);
  const st1 = await p.evaluate(() => ({ idx: window.__yren.state.idx, playing: window.__yren.engine.playing, id: window.__yren.engine.song && window.__yren.engine.song.title }));
  R.check('Tecla T con una canción sonando: pasa a la siguiente y sigue sonando', idx0 === 0 && st1.idx === 1 && st1.playing && st1.id === 'Cancion Dos', JSON.stringify([idx0, st1]));
  R.check('La transición es un fundido cruzado: nunca hay silencio entre las dos canciones', Math.min(...mins.slice(8)) > 0.01, 'mínimo ' + Math.min(...mins.slice(8)).toFixed(3));
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(400);
  await p.keyboard.press('KeyT'); await sleep(1800);
  const st2 = await p.evaluate(() => ({ idx: window.__yren.state.idx, playing: window.__yren.engine.playing }));
  R.check('Con la música parada, T carga la siguiente y la reproduce', st2.idx === 2 && st2.playing, JSON.stringify(st2));
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(300);
  await p.evaluate(() => window.__yren.api.selectItem(4)); await sleep(800);
  await p.keyboard.press('KeyT'); await sleep(600);
  const st3 = await p.evaluate(() => ({ idx: window.__yren.state.idx, playing: window.__yren.engine.playing, toast: document.getElementById('toast').textContent }));
  R.check('En la última canción, T avisa y no cambia nada', st3.idx === 4 && !st3.playing && /última/.test(st3.toast), JSON.stringify(st3));
  R.check('El botón «Transición» existe y el pedal tiene la acción', !!(await p.$('#btnTrans')) && (await p.evaluate(async () => (await import('/app/js/midi.js')).ACTIONS.some((a) => a[0] === 'transition'))));
  await p.evaluate(() => window.__yren.engine.stop());

  // ── el ajuste antiguo de 1,5 GB fijo pasa a «Automático» una sola vez ──
  await p.evaluate(async () => { const st = (await import("/app/js/store.js")).store; await st.setSetting('settings', { ...window.__yren.state.settings, memBudgetMB: 1500, memMigrated: false }); });
  await p.reload(); await sleep(1500);
  const mig = await p.evaluate(() => ({ v: window.__yren.state.settings.memBudgetMB, m: window.__yren.state.settings.memMigrated }));
  R.check('El valor antiguo (1,5 GB fijo) pasa a Automático', mig.v === 0 && mig.m === true, JSON.stringify(mig));
  await p.evaluate(async () => { const st = (await import("/app/js/store.js")).store; await st.setSetting('settings', { ...window.__yren.state.settings, memBudgetMB: 1500, memMigrated: true }); });
  await p.reload(); await sleep(1500);
  R.check('Si después eliges 1,5 GB a propósito, se respeta', (await p.evaluate(() => window.__yren.state.settings.memBudgetMB)) === 1500);

  R.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
} catch (e) { R.check('La prueba terminó sin excepción', false, e.stack || String(e)); }
await b.close(); close();
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nv0.5 OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
