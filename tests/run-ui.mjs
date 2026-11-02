// Prueba de la interfaz completa en Chrome headless: importar, editar, reproducir, tonalidad, tempo, saltos, bucle, solo y persistencia.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch(['--window-size=1440,900']);
const R = reporter('Interfaz');
const song = makeSong('Digno es el Cordero', 24);
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const errors = []; p.on('pageerror', (e) => errors.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1500);
  R.check('Arranca con el motor listo', await p.evaluate(() => !!window.__yren.engine.ctx));
  await (await p.$('#fileInput')).uploadFile(...song.files);
  await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 });
  R.check('Importar: título propuesto desde los nombres', (await p.$eval('#edTitle', (e) => e.value)) === 'Digno es el Cordero');
  const tracks = await p.$$eval('#edTracks .tr-row:not(.head)', (rows) => rows.map((r) => [r.querySelector('input[type=text]').value, r.querySelector('.k').value, r.querySelector('.r').value, r.querySelector('.tp').checked]));
  const byName = Object.fromEntries(tracks.map((t) => [t[0], t]));
  R.check('Detecta click y guía → Monitor, sin transponer', byName.Click[1] === 'click' && byName.Click[2] === 'monitor' && !byName.Click[3] && byName.Guia[1] === 'guide' && byName.Guia[2] === 'monitor');
  R.check('Batería → Principal sin transponer; música se transpone', byName.Drums[2] === 'main' && !byName.Drums[3] && byName.Bass[3] && byName.Teclas[3]);
  await p.$eval('#edArtist', (e) => (e.value = 'Dios de Pactos'));
  await p.select('#edKeyRoot', '7'); await p.$eval('#edBpm', (e) => (e.value = '100'));
  await p.click('#edPresetSections');
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#edSections .sec-row')]; const times = ['0:00.0', '0:06.0', '0:12.0', '0:18.0'];
    rows.forEach((r, i) => { if (i < 4) { const t = r.querySelector('.st'); t.value = times[i]; t.dispatchEvent(new Event('change')); } });
  });
  for (let i = 0; i < 4; i++) { const btns = await p.$$('#edSections .sec-row .mini'); await btns[btns.length - 1].click(); }
  await p.click('#edSave'); await sleep(900);
  R.check('La canción aparece en el setlist con su tonalidad (G)', (await p.$eval('#chipKey', (e) => e.textContent)) === 'G');
  R.check('Se crean 4 secciones', (await p.$$('#secChips .sec-chip')).length === 4);
  await p.click('#btnPlay'); await sleep(2200);
  R.check('Reproduce', await p.evaluate(() => window.__yren.engine.playing));
  await p.click('#keyUp'); await p.click('#keyUp');
  R.check('Subir 2 semitonos: G → A', (await p.$eval('#keyBig', (e) => e.textContent)) === 'A' && (await p.evaluate(() => window.__yren.engine.semis)) === 2);
  for (let i = 0; i < 10; i++) await p.click('#tempoDown');
  R.check('Tempo 90% → 90 BPM', (await p.$eval('#tempoVal', (e) => e.textContent)) === '90' && (await p.$eval('#bpmVal', (e) => e.textContent)) === '90');
  await p.click('#secChips .sec-chip:nth-child(3)'); await sleep(300);
  R.check('Salto en cola marcado en la sección 3', (await p.$$eval('#secChips .sec-chip.queued', (e) => e.length)) === 1);
  await sleep(6500);
  const after = await p.evaluate(() => ({ pos: window.__yren.engine.getPosition(), pend: window.__yren.engine.getPending() }));
  R.check('El salto se ejecutó (posición ≥ sección 3)', after.pos >= 12 && !after.pend, `pos ${after.pos.toFixed(1)}`);
  await p.click('#btnLoop'); R.check('Bucle activado', await p.evaluate(() => !!window.__yren.engine.loop));
  await p.evaluate(() => document.querySelectorAll('#strips .strip')[3].querySelector('.solo').click());
  R.check('Solo atenúa las demás pistas', (await p.$$eval('#strips .strip.dim', (e) => e.length)) >= 3);
  await p.click('#btnPlay'); R.check('Pausa', !(await p.evaluate(() => window.__yren.engine.playing)));
  await sleep(1200); // deja que se guarden los cambios
  await p.reload(); await sleep(2600);
  const re = await p.evaluate(() => ({ songs: [...document.querySelectorAll('#songList .song-item .t')].map((e) => e.textContent), key: document.querySelector('#chipKey').textContent, tempo: document.querySelector('#tempoVal').textContent, tracks: document.querySelectorAll('#strips .strip').length, semis: window.__yren.engine.semis }));
  R.check('Persistencia: canción, tonalidad y tempo tras recargar', re.songs[0] === 'Digno es el Cordero' && re.key === 'A' && re.tempo === '90' && re.semis === 2 && re.tracks >= 5, JSON.stringify(re));
  R.check('Sin errores de JavaScript', errors.filter((e) => !/Failed to load resource|ScriptProcessor|setSinkId|Fallback to the default/.test(e)).length === 0, errors.slice(0, 2).join(' | '));
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nInterfaz OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
