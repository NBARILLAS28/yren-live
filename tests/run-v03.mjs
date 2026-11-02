// v0.3 «Un servicio completo»: fundido, transición suave, respaldo, reordenar/duplicar, precarga, memoria y atajos.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('v0.3 · Un servicio completo');
const errors = [];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p._client().send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1300);

  // sampler de nivel (pico de la mezcla principal)
  await p.evaluate(() => { window.sampleLevels = (ms, step = 25) => new Promise((res) => { const out = []; const t0 = performance.now(); const iv = setInterval(() => { out.push(window.__yren.engine.levelOf('main')); if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); } }, step); }); });

  // ── 3 canciones ──
  const titles = ['Cancion Uno', 'Cancion Dos', 'Cancion Tres'];
  for (const t of titles) {
    const song = makeSong(t, 14);
    await (await p.$('#fileInput')).uploadFile(...song.files);
    await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(700);
  }
  const names = () => p.evaluate(() => [...document.querySelectorAll('#songList .song-item .t')].map((e) => e.textContent));
  R.check('Tres canciones importadas', (await names()).length === 3, (await names()).join(', '));

  // ── precarga y marcas ✓ ──
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(4500);
  const ready = await p.evaluate(() => [...document.querySelectorAll('#songList .song-item')].map((li) => !!li.querySelector('.rdy')));
  R.check('Precarga: las canciones siguientes quedan «✓ lista» sin tocarlas', ready.every(Boolean), JSON.stringify(ready));
  R.check('Indicador de memoria visible', (await p.$eval('#memInfo', (e) => e.textContent)).includes('MB'), await p.$eval('#memInfo', (e) => e.textContent));
  const plan = await p.evaluate(() => { const s = window.__yren.state; s.settings.memBudgetMB = 1; const a = window.__yren.api.planPreload().keep.size; s.settings.memBudgetMB = 1500; const c = window.__yren.api.planPreload().keep.size; return { tiny: a, normal: c }; });
  R.check('Presupuesto de memoria: con poco espacio solo conserva la canción actual', plan.tiny === 1 && plan.normal === 3, JSON.stringify(plan));
  const mono = await p.evaluate(() => {
    const e = window.__yren.engine, ctx = e.ctx;
    const st = ctx.createBuffer(2, 4800, 48000), d = ctx.createBuffer(2, 4800, 48000);
    for (let i = 0; i < 4800; i++) { const v = Math.sin(i / 20); st.getChannelData(0)[i] = v; st.getChannelData(1)[i] = v; d.getChannelData(0)[i] = v; d.getChannelData(1)[i] = -v; }
    return { dual: e.toMonoIfDual(st).numberOfChannels, real: e.toMonoIfDual(d).numberOfChannels };
  });
  R.check('Stem estéreo con dos canales idénticos se guarda en mono (mitad de memoria); uno estéreo real no se toca', mono.dual === 1 && mono.real === 2, JSON.stringify(mono));

  // ── fundido de salida ──
  await p.evaluate(() => { window.__yren.state.settings.fadeSec = 2; window.__yren.api.selectItem(0); }); await sleep(900);
  await p.click('#btnPlay'); await sleep(900);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const before = mean(await p.evaluate(() => window.sampleLevels(600)));
  await p.keyboard.press('KeyF');
  const lv = await p.evaluate(() => window.sampleLevels(2500));
  const win = (a, z) => mean(lv.slice(Math.floor(a / 25), Math.floor(z / 25)));
  const m1 = win(0, 500), m2 = win(1000, 1500), m3 = win(1500, 2000);
  R.check('Fundido (tecla F): el volumen baja de forma continua', before > 0.1 && m1 > m2 && m2 > m3 && m3 < before * 0.4, `antes ${before.toFixed(2)} · 0-0.5s ${m1.toFixed(2)} · 1.0-1.5s ${m2.toFixed(2)} · 1.5-2.0s ${m3.toFixed(2)}`);
  await sleep(300);
  const after = await p.evaluate(() => ({ playing: window.__yren.engine.playing, pos: window.__yren.engine.getPosition(), gain: window.__yren.engine.songOut.main.gain.value, fading: window.__yren.engine.fading, btn: document.getElementById('btnFade').textContent }));
  R.check('Al terminar el fundido la canción se detiene, vuelve al inicio y el volumen se restablece', !after.playing && after.pos === 0 && Math.abs(after.gain - 1) < 0.01 && !after.fading && after.btn.includes('Fundido') && !after.btn.includes('…'), JSON.stringify(after));
  await p.click('#btnPlay'); await sleep(700);
  const again = mean(await p.evaluate(() => window.sampleLevels(600)));
  R.check('Después del fundido, la canción suena otra vez a volumen normal', again > before * 0.6, `${again.toFixed(2)} vs ${before.toFixed(2)}`);
  await p.click('#btnPlay'); await sleep(200);

  // ── transición suave automática ──
  await p.evaluate(() => { const s = window.__yren.state.settings; s.crossSec = 3; s.autoNext = true; document.getElementById('autoNext').checked = true; });
  await p.evaluate(() => document.getElementById('autoNext').dispatchEvent(new Event('change')));
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(1200);
  await p.click('#btnPlay'); await sleep(300);
  await p.evaluate(() => window.__yren.engine.seek(14 - 4.5)); // faltan 4.5 s; la transición empieza a los 3 s del final
  await p.waitForFunction(() => window.__yren.state.idx === 1 && window.__yren.engine.playing, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const mid = await p.evaluate(() => ({ idx: window.__yren.state.idx, ghosts: window.__yren.engine.ghosts ? window.__yren.engine.ghosts.size : 0, playing: window.__yren.engine.playing, pos: window.__yren.engine.getPosition() }));
  R.check('Transición suave: empieza la siguiente mientras la anterior se apaga', mid.idx === 1 && mid.ghosts === 1 && mid.playing && mid.pos < 2.5, JSON.stringify(mid));
  const lv2 = await p.evaluate(() => window.sampleLevels(1500));
  const w100 = []; for (let i = 0; i + 4 <= lv2.length; i += 4) w100.push(Math.max(...lv2.slice(i, i + 4)));
  R.check('Transición suave: no hay huecos de silencio entre una canción y otra', Math.min(...w100) > 0.04, `mínimo ${Math.min(...w100).toFixed(3)}`);
  await sleep(3200);
  const end = await p.evaluate(() => ({ idx: window.__yren.state.idx, ghosts: window.__yren.engine.ghosts ? window.__yren.engine.ghosts.size : 0, playing: window.__yren.engine.playing }));
  R.check('Al terminar la transición la canción vieja se libera y solo avanza una vez', end.idx === 1 && end.ghosts === 0 && end.playing, JSON.stringify(end));
  await p.evaluate(() => { window.__yren.state.settings.crossSec = 0; window.__yren.state.settings.autoNext = false; window.__yren.engine.nearEndSec = 0; window.__yren.engine.stop(); });

  // ── atajos ──
  await p.evaluate(() => window.__yren.api.selectItem(0)); await sleep(600);
  const key0 = await p.evaluate(() => window.__yren.state.setlists[0].items[0].transpose || 0);
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowDown');
  const key1 = await p.evaluate(() => window.__yren.state.setlists[0].items[0].transpose || 0);
  await p.keyboard.down('Shift'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift');
  const tempo = await p.evaluate(() => window.__yren.state.setlists[0].items[0].tempo);
  await p.keyboard.press('KeyP'); await sleep(250);
  const padOn = await p.evaluate(() => window.__yren.state.padOn);
  await p.keyboard.press('KeyP'); await sleep(250);
  R.check('Atajos: ↑/↓ cambian la tonalidad', key1 === key0 + 1, `${key0} → ${key1}`);
  R.check('Atajos: Mayús+↓ baja el tempo', tempo === 98, `tempo ${tempo}`);
  R.check('Atajos: P enciende y apaga el pad', padOn === true && (await p.evaluate(() => window.__yren.state.padOn)) === false);
  await p.keyboard.press('ArrowDown'); await p.keyboard.down('Shift'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Shift');

  // ── reordenar y duplicar ──
  const cur0 = await p.evaluate(() => window.__yren.state.idx);
  await p.evaluate(() => window.__yren.api.reorderItem(0, 2)); await sleep(200);
  const n1 = await names();
  const cur1 = await p.evaluate(() => window.__yren.state.idx);
  R.check('Mover la canción 1 al final reordena la lista y la canción actual sigue siendo la misma', n1.join() === 'Cancion Dos,Cancion Tres,Cancion Uno' && cur0 === 0 && cur1 === 2, `${n1.join(', ')} · idx ${cur0}→${cur1}`);
  // arrastrar con eventos reales de DnD
  await p.evaluate(() => {
    const lis = [...document.querySelectorAll('#songList .song-item')];
    const dt = new DataTransfer();
    lis[2].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const r = lis[0].getBoundingClientRect();
    lis[0].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.top + 2 }));
    lis[0].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.top + 2 }));
  });
  await sleep(300);
  const n2 = await names();
  R.check('Arrastrar y soltar una canción encima de otra cambia el orden', n2.join() === 'Cancion Uno,Cancion Dos,Cancion Tres', n2.join(', '));
  await p.click('#btnDupSetlist'); await p.waitForSelector('#dlgText[open]'); await p.click('#txtOk'); await sleep(900);
  const dup = await p.evaluate(() => { const s = window.__yren.state; return { n: s.setlists.length, name: s.setlists.find((x) => x.id === s.slId).name, items: s.setlists.find((x) => x.id === s.slId).items.length, sharedIds: s.setlists[0].items.some((i) => s.setlists[1].items.some((j) => j.id === i.id)) }; });
  R.check('Duplicar setlist crea una copia independiente con las mismas canciones', dup.n === 2 && dup.items === 3 && dup.name.startsWith('Copia de') && !dup.sharedIds, JSON.stringify(dup));

  // ── respaldo ida y vuelta ──
  await p.click('#btnLibrary'); await p.waitForSelector('#dlgLibrary[open]');
  await p.click('#btnBackup'); await sleep(1500);
  const lastB = await p.evaluate(() => window.__yren.state.settings.lastBackup);
  R.check('«Guardar respaldo» registra la fecha del último respaldo', Date.now() - lastB < 20000 && (await p.$eval('#backupInfo', (e) => e.textContent)).includes('hoy'));
  await p.click('#dlgLibrary button[value="close"]');
  const packInfo = await p.evaluate(async () => {
    const { blob, counts } = await window.__yren.api.buildPack();
    counts.b64 = true;
    window.__pack = blob;
    const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    window.__packB64 = btoa(bin);
    const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
    return { counts, head };
  });
  delete packInfo.counts.b64;
  R.check('El respaldo contiene 3 canciones, 2 setlists y los 15 audios', packInfo.counts.songs === 3 && packInfo.counts.setlists === 2 && packInfo.counts.files === 15 && packInfo.head === 'YRENPK1\n', JSON.stringify(packInfo));
  // borra todo
  await p.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('yren-live'); q.onsuccess = () => r(q.result); });
    await new Promise((res) => { const t = db.transaction(['songs', 'files', 'setlists'], 'readwrite'); for (const s of ['songs', 'files', 'setlists']) t.objectStore(s).clear(); t.oncomplete = res; });
    db.close();
  });
  const b64 = await p.evaluate(() => window.__packB64);
  await p.reload(); await sleep(1800);
  await p.evaluate((x) => { const bin = atob(x), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); window.__pack = new Blob([u]); window.sampleLevels = (ms, step = 25) => new Promise((res) => { const out = []; const t0 = performance.now(); const iv = setInterval(() => { out.push(window.__yren.engine.levelOf('main')); if (performance.now() - t0 >= ms) { clearInterval(iv); res(out); } }, step); }); }, b64);
  R.check('Tras borrar los datos la biblioteca queda vacía', (await p.evaluate(() => window.__yren.state.songs.size)) === 0);
  const rest = p.evaluate(async () => window.__yren.api.restoreFromFile(new File([window.__pack], 'x.yrenpack')));
  await p.waitForSelector('#dlgConfirm[open]', { timeout: 15000 }); await p.click('#cfOk');
  const okRestore = await rest; await sleep(2500);
  const after2 = await p.evaluate(async () => ({ songs: window.__yren.state.songs.size, setlists: window.__yren.state.setlists.length, loaded: window.__yren.engine.song && window.__yren.engine.song.title, tracks: window.__yren.engine.tracks.length }));
  R.check('Restaurar devuelve canciones, setlists y deja una canción lista', okRestore === true && after2.songs === 3 && after2.setlists === 2 && after2.tracks === 5, JSON.stringify(after2));
  await p.click('#btnPlay'); await sleep(900);
  const lvR = Math.max(...(await p.evaluate(() => window.sampleLevels(300))));
  R.check('Lo restaurado suena (los audios originales volvieron)', lvR > 0.1 && (await p.evaluate(() => window.__yren.engine.playing)), `pico ${lvR.toFixed(2)}`);
  await p.click('#btnPlay');
  const bad = await p.evaluate(async () => {
    const out = {};
    const blob = window.__pack;
    const catchMsg = async (f) => { const before = document.getElementById('toast').textContent; await window.__yren.api.restoreFromFile(f); return document.getElementById('toast').textContent; };
    out.cut = await catchMsg(new File([blob.slice(0, Math.floor(blob.size / 2))], 'cortado.yrenpack'));
    out.other = await catchMsg(new File([new Uint8Array(4000)], 'otro.yrenpack'));
    out.empty = await catchMsg(new File([], 'vacio.yrenpack'));
    return out;
  });
  R.check('Un respaldo cortado se rechaza con un mensaje claro', /incompleto/i.test(bad.cut), bad.cut);
  R.check('Un archivo que no es respaldo se rechaza', /no es un respaldo/i.test(bad.other) && /vac[ií]o|da[ñn]ado/i.test(bad.empty), bad.other + ' | ' + bad.empty);

  // ── recordatorio de respaldo ──
  const rem = await p.evaluate(() => {
    const s = window.__yren.state.settings, a = window.__yren.api;
    s.lastBackup = Date.now() - 3 * 86400000; const fresh = a.checkBackupReminder();
    s.lastBackup = Date.now() - 20 * 86400000; const old = a.checkBackupReminder();
    const visible = !document.getElementById('backupBanner').hidden;
    return { fresh, old, visible };
  });
  R.check('Recordatorio: no molesta con un respaldo de hace 3 días, avisa con uno de hace 20', rem.fresh === false && rem.old === true && rem.visible, JSON.stringify(rem));
  await p.click('#backupLater'); await sleep(100);
  R.check('«Más tarde» oculta el aviso por unos días', (await p.$eval('#backupBanner', (e) => e.hidden)) && (await p.evaluate(() => window.__yren.api.backupDue())) === false);
  await p.evaluate(() => { const s = window.__yren.state.settings; s.backupSnooze = 0; s.lastBackup = Date.now() - 20 * 86400000; });
  await p.click('#btnLive'); await sleep(200);
  R.check('En modo en vivo el aviso de respaldo nunca aparece', (await p.evaluate(() => window.__yren.api.checkBackupReminder())) === false && (await p.$eval('#backupBanner', (e) => e.hidden)));
  await p.click('#btnLive');
  const dragLive = await p.evaluate(() => [...document.querySelectorAll('#songList .song-item')].some((li) => li.draggable));
  await p.click('#btnLive'); await sleep(200);
  const dragLive2 = await p.evaluate(() => [...document.querySelectorAll('#songList .song-item')].some((li) => li.draggable));
  R.check('Reordenar arrastrando se bloquea en modo en vivo', dragLive === true && dragLive2 === false);
  R.check('Sin errores de JavaScript', errors.filter((e) => !/setSinkId/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nv0.3 OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
