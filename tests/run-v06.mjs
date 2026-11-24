// v0.7 «Interfaz tipo Playback»: tarjetas con portada, secciones de colores, teclas del PAD, menú del setlist, transición desde la tarjeta.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('v0.7 · Interfaz tipo Playback');
const errors = [];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1300);
  for (const t of ['Uno', 'Dos', 'Tres']) {
    const song = makeSong('Cancion ' + t, 14);
    await (await p.$('#fileInput')).uploadFile(...song.files);
    await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(700);
  }
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(900);

  // ── tarjetas ──
  const cards = await p.evaluate(() => [...document.querySelectorAll('#songList .song-item')].map((li) => ({ t: li.querySelector('.t').textContent, k: li.querySelector('.k').textContent, go: !!li.querySelector('.go'), cover: !!li.querySelector('.cover'), ph: li.querySelector('.cover').classList.contains('ph'), w: li.getBoundingClientRect().width, top: Math.round(li.getBoundingClientRect().top) })));
  R.check('Tres tarjetas en una tira horizontal (misma altura), con título limpio y tonalidad entre paréntesis', cards.length === 3 && cards.every((c) => c.go && c.cover && c.ph && /^\(.+\)$/.test(c.k) && c.w > 80) && new Set(cards.map((c) => c.top)).size === 1 && cards[0].t === 'Cancion Uno', JSON.stringify(cards));
  const act = await p.$eval('#songList .song-item.active .t', (e) => e.textContent);
  R.check('La tarjeta de la canción en curso queda marcada', act === 'Cancion Uno', act);

  // ── mover una tarjeta con los botones que aparecen al pasar el ratón ──
  await p.$eval('#songList .song-item:nth-child(2) .mv .mini', (e) => e.click()); await sleep(400); // ◀ mover antes
  const order = await p.$$eval('#songList .song-item .t', (e) => e.map((x) => x.textContent));
  R.check('«◀» mueve la tarjeta una posición hacia la izquierda', order.join('|') === 'Cancion Dos|Cancion Uno|Cancion Tres', order.join('|'));
  await p.$eval('#songList .song-item:nth-child(1) .mv .mini:nth-child(2)', (e) => e.click()); await sleep(400); // ▶ mover después
  R.check('«▶» la devuelve a su sitio', (await p.$$eval('#songList .song-item .t', (e) => e.map((x) => x.textContent))).join('|') === 'Cancion Uno|Cancion Dos|Cancion Tres');
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(700);

  // ── portada: elegir imagen, reducirla, guardarla y que sobreviva al reinicio ──
  await p.click('#btnEdit'); await p.waitForSelector('#dlgEdit[open]');
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#f1c40f'; g.fillRect(400, 200, 800, 500);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'portada.png', { type: 'image/png' }));
    const inp = document.getElementById('edCoverInput'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  });
  await sleep(700);
  const prev = await p.evaluate(() => ({ bg: document.getElementById('edCoverPrev').style.backgroundImage.slice(0, 30), clear: !document.getElementById('edCoverClear').hidden }));
  R.check('El editor muestra la vista previa de la portada y el botón «Quitar»', prev.bg.includes('data:image/jpeg') && prev.clear, JSON.stringify(prev));
  await p.click('#edSave'); await sleep(900);
  const cov = await p.evaluate(async () => {
    const s = window.__yren.state, song = s.songs.get(s.setlists.find((x) => x.id === s.slId).items[0].songId);
    const img = new Image(); img.src = song.cover; await img.decode();
    const li = document.querySelector('#songList .song-item');
    return { w: img.naturalWidth, h: img.naturalHeight, kb: Math.round(song.cover.length / 1024), inline: li.querySelector('.cover').style.backgroundImage.includes('data:image/jpeg'), noLetter: !li.querySelector('.letter'), ph: li.querySelector('.cover').classList.contains('ph') };
  });
  R.check('La portada se reduce a 480×270 (pocos KB) y la tarjeta la usa en lugar del color con inicial', cov.w === 480 && cov.h === 270 && cov.kb < 120 && cov.inline && cov.noLetter && !cov.ph, JSON.stringify(cov));
  await p.reload(); await sleep(1500);
  R.check('La portada sigue ahí después de reiniciar la app', await p.$eval('#songList .song-item .cover', (e) => e.style.backgroundImage.includes('data:image/jpeg')));
  await p.click('#btnEdit'); await p.waitForSelector('#dlgEdit[open]'); await p.click('#edCoverClear'); await p.click('#edSave'); await sleep(900);
  R.check('«Quitar» devuelve el color con inicial', await p.$eval('#songList .song-item .cover', (e) => e.classList.contains('ph') && !e.style.backgroundImage));

  // ── secciones de colores sobre la onda ──
  await p.click('#btnEdit'); await p.waitForSelector('#dlgEdit[open]'); await p.click('#edPresetSections'); await sleep(200); await p.click('#edSave'); await sleep(900);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#secChips .sec-chip')].map((e) => ({ n: e.firstChild.textContent, h: e.style.getPropertyValue('--h'), left: parseFloat(e.style.left), w: e.getBoundingClientRect().width })));
  const hues = Object.fromEntries(chips.map((c) => [c.n, +c.h]));
  R.check('Cada tipo de sección tiene su color (Intro, Verso, Coro, Puente, Final)', hues['Intro'] === 160 && hues['Verso 1'] === 265 && hues['Coro'] === 350 && hues['Puente'] === 28 && hues['Final'] === 48, JSON.stringify(hues));
  R.check('Los botones de sección están alineados con su lugar en la canción (de izquierda a derecha)', chips.length === 8 && chips.every((c, i) => i === 0 || c.left > chips[i - 1].left) && chips[0].left === 0 && chips.every((c) => c.w > 30), chips.map((c) => Math.round(c.left)).join(','));
  const wv = await p.evaluate(() => { const c = document.getElementById('wave'), r = c.getBoundingClientRect(), t = document.getElementById('secChips').getBoundingClientRect(); return { sameW: Math.abs(r.width - t.width) < 2, h: Math.round(r.height) }; });
  R.check('La fila de secciones mide lo mismo que la onda (para que coincidan)', wv.sameW && wv.h > 60, JSON.stringify(wv));
  const h1 = await p.$eval('#wave', (e) => e.getBoundingClientRect().height);
  await p.setViewport({ width: 1440, height: 760 }); await sleep(500);
  const h2 = await p.evaluate(() => ({ css: document.getElementById('wave').getBoundingClientRect().height, px: document.getElementById('wave').height / (window.devicePixelRatio || 1) }));
  R.check('La onda se adapta al alto de la ventana (y su lienzo también)', h2.css < h1 - 8 && Math.abs(h2.css - h2.px) < 2, JSON.stringify([h1, h2]));
  await p.setViewport({ width: 1440, height: 900 }); await sleep(400);

  // ── mezclador ──
  const an = await p.evaluate(() => { const st = document.querySelector('#strips .strip[data-id]'); return { first: st.firstElementChild.className, hasKind: !!st.querySelector('.kind'), masters: [...document.querySelectorAll('#strips .strip.master')].map((e) => e.classList.contains('first')), n: document.querySelectorAll('#strips .strip').length }; });
  R.check('Cada pista: S/M/♯ arriba, fader grande, salida y nombre abajo; los master van a la derecha', an.first === 'btn-row' && JSON.stringify(an.masters) === '[true,false]' && an.n >= 3, JSON.stringify(an));
  const fh = await p.$eval('#strips .strip[data-id] .fader', (e) => e.getBoundingClientRect().height);
  R.check('Los faders son altos (≥ 110 px) para manejarlos con precisión', fh >= 110, String(fh));
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(600);
  await p.keyboard.press('Space'); await sleep(1200);
  const meter = await p.evaluate(() => { const el = document.querySelector('#strips .strip.master i'); return parseFloat(el.style.height); });
  R.check('El medidor se mueve con el audio (la franja que tapa baja del 100 %)', meter < 99, String(meter));

  // ── transición desde la tarjeta (➜) ──
  const lv = p.evaluate(() => window.sampleLevels ? window.sampleLevels(3000) : null);
  await p.evaluate(() => { window.sampleLevels = (ms, step = 25) => new Promise((res) => { const out = []; const t0 = performance.now(); const iv = setInterval(() => { out.push(window.__yren.engine.levelOf('main')); if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); } }, step); }); });
  const lv2 = p.evaluate(() => window.sampleLevels(3200));
  await p.$eval('#songList .song-item:nth-child(3) .go', (e) => e.click());
  const mins = await lv2; await sleep(300);
  const st = await p.evaluate(() => ({ idx: window.__yren.state.idx, playing: window.__yren.engine.playing, active: document.querySelector('#songList .song-item.active .t').textContent }));
  R.check('El botón ➜ de una tarjeta pasa a esa canción con fundido cruzado y sigue sonando', st.idx === 2 && st.playing && st.active === 'Cancion Tres' && Math.min(...mins.slice(8)) > 0.01, JSON.stringify([st, Math.min(...mins.slice(8)).toFixed(3)]));
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(400);
  await p.$eval('#songList .song-item:nth-child(1) .go', (e) => e.click()); await sleep(1800);
  const st2 = await p.evaluate(() => ({ idx: window.__yren.state.idx, playing: window.__yren.engine.playing }));
  R.check('Con la música parada, ➜ carga esa canción y la reproduce', st2.idx === 0 && st2.playing, JSON.stringify(st2));
  await p.evaluate(() => window.__yren.engine.stop()); await sleep(300);

  // ── PAD con teclas ──
  const g = await p.evaluate(() => [...document.querySelectorAll('#padGrid button')].map((e) => e.textContent));
  R.check('El PAD tiene 12 teclas de nota (C … B)', g.length === 12 && g[0] === 'C' && g[11] === 'B', g.join(' '));
  await p.click('#padGrid button:nth-child(8)'); await sleep(200); // G
  const pd = await p.evaluate(() => ({ root: document.getElementById('padRoot').value, follow: document.getElementById('padFollow').checked, on: [...document.querySelectorAll('#padGrid button.on')].map((e) => e.textContent), label: document.getElementById('padKeyLabel').textContent }));
  R.check('Tocar una tecla fija esa nota, deja de seguir la tonalidad y la resalta', pd.root === '7' && !pd.follow && pd.on.join() === 'G' && pd.label === 'G', JSON.stringify(pd));
  await p.click('#padToggle'); await sleep(3500);
  const pl = await p.evaluate(() => ({ lvl: window.__yren.engine.levelOf('pad'), root: window.__yren.engine.pad.root, txt: document.getElementById('padToggle').textContent }));
  R.check('El PAD suena solo, sin pista ni Play, en la nota elegida', pl.lvl > 0.01 && pl.root === 7 && /encendido/.test(pl.txt), JSON.stringify(pl));
  await p.click('#padGrid button:nth-child(10)'); await sleep(400); // A
  R.check('Cambiar de tecla con el PAD sonando cambia la nota sin apagarlo', (await p.evaluate(() => window.__yren.engine.pad.root)) === 9 && (await p.evaluate(() => window.__yren.state.padOn)));
  await p.click('#padToggle'); await sleep(300);

  // ── menú ⋯ del setlist ──
  await p.click('#btnSetlistMenu'); await sleep(100);
  const open1 = await p.$eval('#setlistMenu', (e) => !e.hidden);
  await p.mouse.click(700, 500); await sleep(150);
  const open2 = await p.$eval('#setlistMenu', (e) => !e.hidden);
  R.check('El menú ⋯ se abre con un clic y se cierra al tocar fuera', open1 && !open2, JSON.stringify([open1, open2]));

  R.check('Sin errores de JavaScript', errors.length === 0, errors.join(' | '));
} catch (e) { R.check('La prueba terminó sin excepción', false, e.stack || String(e)); }
await b.close(); close();
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nv0.7 OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
