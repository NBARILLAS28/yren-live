// v0.2 «Seguro en vivo»: tono de prueba por salida, interfaz desconectada y modo en vivo.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('v0.2 · Seguro en vivo');
try {
  // ── tono de prueba ──
  const t = await b.newPage();
  await t.goto(`http://127.0.0.1:${port}/t/engine.html`);
  for (const which of ['main', 'monitor']) {
    const r = await t.evaluate((w) => window.runToneTest(w), which);
    R.check(`Tono de prueba ${which === 'main' ? 'PRINCIPAL' : 'MONITOR'}: primero grave por la izquierda (330 Hz)`, Math.abs(r.firstLeftFreq - 330) <= 12 && r.firstLeftRms > 0.05 && r.firstRightRms < 0.005, JSON.stringify(r));
    R.check(`Tono de prueba ${which === 'main' ? 'PRINCIPAL' : 'MONITOR'}: luego agudo por la derecha (495 Hz)`, Math.abs(r.secondRightFreq - 495) <= 15 && r.secondRightRms > 0.05 && r.secondLeftRms < 0.005);
  }
  await t.close();

  // ── interfaz desconectada + modo en vivo ──
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1300);
  const song = makeSong('Prueba v02', 20);
  await (await p.$('#fileInput')).uploadFile(...song.files);
  await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(900);
  await p.click('#btnPlay'); await sleep(600);
  R.check('Reproduciendo antes de la desconexión', await p.evaluate(() => window.__yren.engine.playing));
  await p.evaluate(() => { window.__yren.state.settings.deviceId = 'interfaz-usb-falsa'; window.__yren.state.settings.deviceLabel = 'Scarlett 18i20'; window.__yren.outputLost(); });
  await sleep(200);
  R.check('Desconexión: la música se PAUSA de inmediato', !(await p.evaluate(() => window.__yren.engine.playing)));
  R.check('Desconexión: alerta grande visible con el nombre de la interfaz', (await p.$eval('#outAlert', (e) => !e.hidden)) && (await p.$eval('#alertText', (e) => e.textContent)).includes('Scarlett 18i20'));
  await p.keyboard.press('Space'); await sleep(300);
  R.check('Desconexión: reproducir queda BLOQUEADO (no suena por las bocinas del Mac)', !(await p.evaluate(() => window.__yren.engine.playing)));
  await p.click('#alertDefault'); await sleep(400);
  R.check('«Usar la salida del Mac»: se cierra la alerta y se puede reproducir', (await p.$eval('#outAlert', (e) => e.hidden)) && (await p.evaluate(async () => { await window.__yren.playSafe(); return window.__yren.engine.playing; })));
  await p.evaluate(() => window.__yren.engine.pause());
  // modo en vivo
  const vis = (sel) => p.$eval(sel, (e) => getComputedStyle(e).display !== 'none');
  R.check('Edición: botones de borrar/editar visibles', (await vis('#btnDelSetlist')) && (await vis('#btnEdit')) && (await vis('.add-row')));
  await p.click('#btnLive'); await sleep(200);
  R.check('Modo en vivo: oculta eliminar, editar, importar y biblioteca', !(await vis('#btnDelSetlist')) && !(await vis('#btnEdit')) && !(await vis('.add-row')) && !(await vis('#btnLibrary')) && !(await vis('#btnRenameSetlist')));
  R.check('Modo en vivo: el reproductor sigue disponible', (await vis('#btnPlay')) && (await vis('#keyUp')) && (await vis('.sec-chip, #secChips')));
  await sleep(700); await p.reload(); await sleep(2000);
  R.check('Modo en vivo se recuerda al reiniciar', await p.$eval('body', (e) => e.classList.contains('live')));
  R.check('Sin errores de JavaScript', errors.filter((e) => !/setSinkId/.test(e)).length === 0, errors.slice(0, 2).join(' | '));
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nv0.2 OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
